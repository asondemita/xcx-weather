import BlockType from '../../extension-support/block-type';
import ArgumentType from '../../extension-support/argument-type';
import Cast from '../../util/cast';
import translations from './translations.json';
import blockIcon from './block-icon.png';

/**
 * Formatter which is used for translation.
 * This will be replaced which is used in the runtime.
 * @param {object} messageData - format-message object
 * @returns {string} - message for the locale
 */
let formatMessage = messageData => messageData.default;

/**
 * Setup format-message for this extension.
 */
const setupTranslations = () => {
    const localeSetup = formatMessage.setup();
    if (localeSetup && localeSetup.translations[localeSetup.locale]) {
        Object.assign(
            localeSetup.translations[localeSetup.locale],
            translations[localeSetup.locale]
        );
    }
};

const EXTENSION_ID = 'weatherForecast';

/**
 * URL to get this extension as a module.
 * When it was loaded as a module, 'extensionURL' will be replaced a URL which is retrieved from.
 * @type {string}
 */
let extensionURL = 'https://asondemita.github.io/xcx-weather/dist/weatherForecast.mjs';

/**
 * Endpoint to convert a Japanese postal code into latitude/longitude.
 * @type {string}
 */
const ZIP_API = 'https://api.zippopotam.us/jp/';

/**
 * Endpoint for the Open-Meteo hourly forecast.
 * @type {string}
 */
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';

/**
 * Endpoint for the Open-Meteo geocoding search (used to localize place names).
 * @type {string}
 */
const GEOCODE_API = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * Time-to-live (ms) for the cached forecast of a location.
 * @type {number}
 */
const FORECAST_TTL = 10 * 60 * 1000;

/**
 * Number of forecast days requested from Open-Meteo. Must be large enough that
 * the largest HOUR_OPTIONS value (48h) always falls inside the returned window.
 * @type {number}
 */
const FORECAST_DAYS = 4;

/**
 * Number of days requested for the daily (weekly) forecast. Open-Meteo returns
 * today plus the following days, so this also bounds the DAY dropdown.
 * @type {number}
 */
const WEEKLY_DAYS = 7;

/**
 * Japanese labels for WMO weather interpretation codes.
 * @see https://open-meteo.com/en/docs
 * @type {Object.<number, string>}
 */
const WEATHER_CODE_JA = {
    0: '快晴',
    1: '晴れ',
    2: '晴れ時々曇り',
    3: '曇り',
    45: '霧',
    48: '霧氷',
    51: '霧雨（弱）',
    53: '霧雨',
    55: '霧雨（強）',
    56: '着氷性の霧雨（弱）',
    57: '着氷性の霧雨（強）',
    61: '雨（弱）',
    63: '雨',
    65: '雨（強）',
    66: '着氷性の雨（弱）',
    67: '着氷性の雨（強）',
    71: '雪（弱）',
    73: '雪',
    75: '雪（強）',
    77: '細氷',
    80: 'にわか雨（弱）',
    81: 'にわか雨',
    82: 'にわか雨（強）',
    85: 'にわか雪（弱）',
    86: 'にわか雪（強）',
    95: '雷雨',
    96: '雷雨（弱いひょう）',
    99: '雷雨（強いひょう）'
};

/**
 * Convert a WMO weather code into a Japanese label.
 * @param {number} code - WMO weather code
 * @returns {string} - Japanese label (or the raw code when unknown)
 */
const weatherCodeToJa = code => {
    if (code === null || typeof code === 'undefined') return '';
    return WEATHER_CODE_JA[code] || `不明(${code})`;
};

/**
 * Estimate the outdoor WBGT (Wet Bulb Globe Temperature / 暑さ指数) from standard
 * meteorological values, using the regression by Ono et al. (2014). This is the
 * same formula the Japanese Ministry of the Environment uses for its WBGT
 * observations and forecasts.
 * @see https://www.wbgt.env.go.jp/wbgt_detail.php
 * @param {number} ta - air temperature (°C)
 * @param {number} rh - relative humidity (%)
 * @param {number} srWattsPerM2 - global solar (shortwave) radiation (W/m²)
 * @param {number} ws - wind speed (m/s)
 * @returns {number} - estimated WBGT (°C)
 */
const computeWbgt = (ta, rh, srWattsPerM2, ws) => {
    const sr = srWattsPerM2 / 1000; // formula expects kW/m²
    return (0.735 * ta) +
        (0.0374 * rh) +
        (0.00292 * ta * rh) +
        (7.619 * sr) -
        (4.557 * sr * sr) -
        (0.0572 * ws) -
        4.064;
};

/**
 * WBGT danger levels (日本生気象学会「日常生活における熱中症予防指針」).
 * Ordered ascending; the first entry whose `max` exceeds the value wins, so a
 * value sitting exactly on a boundary falls into the higher (more severe) level.
 * @type {Array.<{max: number, id: string, default: string}>}
 */
const WBGT_LEVELS = [
    {max: 21, id: 'weatherForecast.wbgt.safe', default: 'almost safe'},
    {max: 25, id: 'weatherForecast.wbgt.caution', default: 'caution'},
    {max: 28, id: 'weatherForecast.wbgt.warning', default: 'warning'},
    {max: 31, id: 'weatherForecast.wbgt.severe', default: 'strict caution'},
    {max: Infinity, id: 'weatherForecast.wbgt.danger', default: 'danger'}
];

/**
 * Pick the WBGT danger level descriptor for a WBGT value.
 * @param {number} wbgt - WBGT value (°C)
 * @returns {{max: number, id: string, default: string}} - level descriptor
 */
const wbgtLevel = wbgt => WBGT_LEVELS.find(level => wbgt < level.max);

/**
 * 16-point compass labels (Japanese), starting at north and going clockwise.
 * @type {Array.<string>}
 */
const WIND_DIRECTIONS_JA = [
    '北', '北北東', '北東', '東北東',
    '東', '東南東', '南東', '南南東',
    '南', '南南西', '南西', '西南西',
    '西', '西北西', '北西', '北北西'
];

/**
 * Convert a wind direction in degrees (meteorological: where the wind comes
 * from) into a 16-point Japanese compass label.
 * @param {number} deg - wind direction in degrees (0 = north)
 * @returns {string} - Japanese compass label, or '' when unavailable
 */
const windDirectionToJa = deg => {
    if (deg === null || typeof deg === 'undefined' || deg === '') return '';
    const idx = Math.round(Number(deg) / 22.5);
    return WIND_DIRECTIONS_JA[((idx % 16) + 16) % 16];
};

/**
 * Tolerance (ms) for matching a requested hour to an available hourly data
 * point. The grid is hourly, so any in-window request is within 30 min; a wider
 * gap means the requested time is outside the forecast window.
 * @type {number}
 */
const HOUR_MATCH_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * Convert full-width ASCII characters (！-～) and the full-width space to their
 * half-width equivalents, so free-typed full-width input is accepted.
 * @param {string} raw - user input
 * @returns {string} - input with full-width forms converted to half-width
 */
const toHalfWidth = raw => String(raw)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ');

/**
 * Parse a freely-typed number, accepting half-width or full-width digits/signs
 * (e.g. "3", "１２", "－2").
 * @param {string} raw - user input
 * @returns {number} - parsed number, or NaN when it is not numeric
 */
const parseLooseNumber = raw => {
    const text = toHalfWidth(raw).trim();
    if (text === '') return NaN;
    const value = Number(text);
    return Number.isFinite(value) ? value : NaN;
};

/**
 * Normalize a Japanese postal code into the "NNN-NNNN" form expected by the API.
 * Accepts half-width or full-width digits, with or without a hyphen
 * (e.g. "1000001", "100-0001", "１０００００１", "１００－０００１").
 * @param {string} raw - user input
 * @returns {?string} - normalized code, or null when it is not 7 digits
 */
const normalizeZip = raw => {
    const digits = toHalfWidth(raw).replace(/[^0-9]/g, '');
    if (digits.length !== 7) return null;
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
};

/**
 * Scratch 3.0 blocks to get a weather forecast from Open-Meteo.
 */
class ExtensionBlocks {
    /**
     * A translation object which is used in this class.
     * @param {FormatObject} formatter - translation object
     */
    static set formatMessage (formatter) {
        formatMessage = formatter;
        if (formatMessage) setupTranslations();
    }

    /**
     * @return {string} - the name of this extension.
     */
    static get EXTENSION_NAME () {
        return formatMessage({
            id: 'weatherForecast.name',
            default: '天気予報',
            description: 'name of the extension'
        });
    }

    /**
     * @return {string} - the ID of this extension.
     */
    static get EXTENSION_ID () {
        return EXTENSION_ID;
    }

    /**
     * URL to get this extension.
     * @type {string}
     */
    static get extensionURL () {
        return extensionURL;
    }

    /**
     * Set URL to get this extension.
     * The extensionURL will be changed to the URL of the loading server.
     * @param {string} url - URL
     */
    static set extensionURL (url) {
        extensionURL = url;
    }

    /**
     * Construct a set of blocks for 天気予報.
     * @param {Runtime} runtime - the Scratch 3.0 runtime.
     */
    constructor (runtime) {
        /**
         * The Scratch 3.0 runtime.
         * @type {Runtime}
         */
        this.runtime = runtime;

        if (runtime.formatMessage) {
            // Replace 'formatMessage' to a formatter which is used in the runtime.
            formatMessage = runtime.formatMessage;
        }

        /**
         * Cache of postal-code -> {latitude, longitude} lookups.
         * @type {Object.<string, Promise<?object>>}
         */
        this._geoCache = {};

        /**
         * Cache of location -> {time, data} forecast results.
         * @type {Object.<string, {fetchedAt: number, data: Promise<?object>}>}
         */
        this._forecastCache = {};

        /**
         * Cache of location -> {time, data} daily (weekly) forecast results.
         * @type {Object.<string, {fetchedAt: number, data: Promise<?object>}>}
         */
        this._dailyCache = {};

        /**
         * Cache of coordinates -> Promise<string> Japanese place name lookups.
         * @type {Object.<string, Promise<string>>}
         */
        this._nameCache = {};
    }

    /**
     * @returns {object} metadata for this extension and its blocks.
     */
    getInfo () {
        setupTranslations();
        return {
            id: ExtensionBlocks.EXTENSION_ID,
            name: ExtensionBlocks.EXTENSION_NAME,
            extensionURL: ExtensionBlocks.extensionURL,
            blockIconURI: blockIcon,
            showStatusButton: false,
            blocks: [
                {
                    opcode: 'getForecast',
                    blockType: BlockType.REPORTER,
                    blockAllThreads: false,
                    text: formatMessage({
                        id: 'weatherForecast.getForecast',
                        default: 'forecast [ITEM] in [HOURS] hours near zip [ZIP]',
                        description: 'get a weather forecast value'
                    }),
                    func: 'getForecast',
                    arguments: {
                        ITEM: {
                            type: ArgumentType.STRING,
                            menu: 'itemMenu',
                            defaultValue: 'weather'
                        },
                        HOURS: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 1
                        },
                        ZIP: {
                            type: ArgumentType.STRING,
                            defaultValue: '100-0001'
                        }
                    }
                },
                {
                    opcode: 'getDailyForecast',
                    blockType: BlockType.REPORTER,
                    blockAllThreads: false,
                    text: formatMessage({
                        id: 'weatherForecast.getDailyForecast',
                        default: 'weekly [DAILY_ITEM] in [DAY] days near zip [ZIP]',
                        description: 'get a daily (weekly) weather forecast value'
                    }),
                    func: 'getDailyForecast',
                    arguments: {
                        DAILY_ITEM: {
                            type: ArgumentType.STRING,
                            menu: 'dailyItemMenu',
                            defaultValue: 'weather'
                        },
                        DAY: {
                            type: ArgumentType.NUMBER,
                            defaultValue: 1
                        },
                        ZIP: {
                            type: ArgumentType.STRING,
                            defaultValue: '100-0001'
                        }
                    }
                },
                {
                    opcode: 'getPlaceName',
                    blockType: BlockType.REPORTER,
                    blockAllThreads: false,
                    text: formatMessage({
                        id: 'weatherForecast.getPlaceName',
                        default: 'weather forecast point name near zip [ZIP]',
                        description: 'get the resolved place name for a postal code'
                    }),
                    func: 'getPlaceName',
                    arguments: {
                        ZIP: {
                            type: ArgumentType.STRING,
                            defaultValue: '100-0001'
                        }
                    }
                }
            ],
            menus: {
                itemMenu: {
                    acceptReporters: true,
                    items: [
                        {
                            text: formatMessage({
                                id: 'weatherForecast.item.weather',
                                default: 'weather',
                                description: 'weather menu item'
                            }),
                            value: 'weather'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.item.temperature',
                                default: 'temperature',
                                description: 'temperature menu item'
                            }),
                            value: 'temperature'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.item.precipitation',
                                default: 'precipitation probability',
                                description: 'precipitation probability menu item'
                            }),
                            value: 'precipitation'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.item.windspeed',
                                default: 'wind speed',
                                description: 'wind speed menu item'
                            }),
                            value: 'windspeed'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.item.winddir',
                                default: 'wind direction',
                                description: 'wind direction menu item'
                            }),
                            value: 'winddir'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.item.wbgt',
                                default: 'heat index (WBGT)',
                                description: 'WBGT value menu item'
                            }),
                            value: 'wbgt'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.item.wbgtLevel',
                                default: 'heat risk level (WBGT)',
                                description: 'WBGT danger level menu item'
                            }),
                            value: 'wbgtLevel'
                        }
                    ]
                },
                dailyItemMenu: {
                    acceptReporters: true,
                    items: [
                        {
                            text: formatMessage({
                                id: 'weatherForecast.daily.weather',
                                default: 'weather',
                                description: 'daily weather menu item'
                            }),
                            value: 'weather'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.daily.tempMax',
                                default: 'highest temperature',
                                description: 'daily max temperature menu item'
                            }),
                            value: 'tempMax'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.daily.tempMin',
                                default: 'lowest temperature',
                                description: 'daily min temperature menu item'
                            }),
                            value: 'tempMin'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.daily.precipitation',
                                default: 'precipitation probability',
                                description: 'daily precipitation probability menu item'
                            }),
                            value: 'precipitation'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.daily.sunrise',
                                default: 'sunrise',
                                description: 'daily sunrise time menu item'
                            }),
                            value: 'sunrise'
                        },
                        {
                            text: formatMessage({
                                id: 'weatherForecast.daily.sunset',
                                default: 'sunset',
                                description: 'daily sunset time menu item'
                            }),
                            value: 'sunset'
                        }
                    ]
                }
            }
        };
    }

    /**
     * Look up latitude/longitude for a postal code (memoized).
     * @param {string} zip - normalized "NNN-NNNN" postal code
     * @returns {Promise<?{latitude: number, longitude: number}>} - coordinates or null
     */
    _lookupLocation (zip) {
        if (this._geoCache[zip]) return this._geoCache[zip];
        const request = fetch(`${ZIP_API}${zip}`)
            .then(res => (res.ok ? res.json() : null))
            .then(json => {
                if (!json || !json.places || json.places.length === 0) return null;
                const place = json.places[0];
                // Zippopotam returns Japanese names in romaji (e.g. "Chiyoda", "Toukyouto").
                const placeName = place['place name'] || '';
                const state = place.state || '';
                const name = [state, placeName].filter(Boolean).join(' ');
                return {
                    latitude: Number(place.latitude),
                    longitude: Number(place.longitude),
                    placeName: placeName,
                    state: state,
                    name: name
                };
            })
            .catch(() => null);
        this._geoCache[zip] = request;
        return request;
    }

    /**
     * Fetch the hourly forecast for a location (memoized with a short TTL).
     * @param {{latitude: number, longitude: number}} location - coordinates
     * @returns {Promise<?object>} - Open-Meteo hourly response or null
     */
    _fetchForecast (location) {
        const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
        const cached = this._forecastCache[key];
        const now = Date.now();
        if (cached && (now - cached.fetchedAt) < FORECAST_TTL) {
            return cached.data;
        }
        const params = new URLSearchParams({
            latitude: String(location.latitude),
            longitude: String(location.longitude),
            hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,' +
                'weather_code,wind_speed_10m,wind_direction_10m,shortwave_radiation',
            wind_speed_unit: 'ms',
            timezone: 'Asia/Tokyo',
            forecast_days: String(FORECAST_DAYS)
        });
        const request = fetch(`${FORECAST_API}?${params.toString()}`)
            .then(res => (res.ok ? res.json() : null))
            .catch(() => null);
        this._forecastCache[key] = {fetchedAt: now, data: request};
        return request;
    }

    /**
     * Fetch the daily (weekly) forecast for a location (memoized with a short TTL).
     * @param {{latitude: number, longitude: number}} location - coordinates
     * @returns {Promise<?object>} - Open-Meteo daily response or null
     */
    _fetchDailyForecast (location) {
        const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
        const cached = this._dailyCache[key];
        const now = Date.now();
        if (cached && (now - cached.fetchedAt) < FORECAST_TTL) {
            return cached.data;
        }
        const params = new URLSearchParams({
            latitude: String(location.latitude),
            longitude: String(location.longitude),
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,' +
                'precipitation_probability_max,sunrise,sunset',
            timezone: 'Asia/Tokyo',
            forecast_days: String(WEEKLY_DAYS)
        });
        const request = fetch(`${FORECAST_API}?${params.toString()}`)
            .then(res => (res.ok ? res.json() : null))
            .catch(() => null);
        this._dailyCache[key] = {fetchedAt: now, data: request};
        return request;
    }

    /**
     * Resolve a Japanese place name for a location (memoized). Zippopotam only
     * returns romaji, so we search Open-Meteo geocoding (language=ja) by the
     * romaji name and pick the candidate closest to the known coordinates.
     * Falls back to the romaji name when geocoding finds nothing.
     * @param {{latitude: number, longitude: number, placeName: string, name: string}} location
     *     - resolved location with its romaji name
     * @returns {Promise<string>} - Japanese place name (or romaji fallback)
     */
    _lookupJapaneseName (location) {
        const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
        if (this._nameCache[key]) return this._nameCache[key];
        const fallback = location.name || '';
        if (!location.placeName) {
            this._nameCache[key] = Promise.resolve(fallback);
            return this._nameCache[key];
        }
        const params = new URLSearchParams({
            name: location.placeName,
            count: '10',
            language: 'ja',
            format: 'json'
        });
        const request = fetch(`${GEOCODE_API}?${params.toString()}`)
            .then(res => (res.ok ? res.json() : null))
            .then(json => {
                const results = (json && json.results) || [];
                const jp = results.filter(r => r.country_code === 'JP');
                const pool = jp.length ? jp : results;
                if (pool.length === 0) return fallback;
                // Multiple places can share a romaji name; pick the nearest.
                let best = pool[0];
                let bestDiff = Infinity;
                pool.forEach(r => {
                    const dLat = Number(r.latitude) - location.latitude;
                    const dLon = Number(r.longitude) - location.longitude;
                    const diff = (dLat * dLat) + (dLon * dLon);
                    if (diff < bestDiff) {
                        bestDiff = diff;
                        best = r;
                    }
                });
                const name = [best.admin1, best.name].filter(Boolean).join('');
                return name || fallback;
            })
            .catch(() => fallback);
        this._nameCache[key] = request;
        return request;
    }

    /**
     * Find the index in the hourly time array that is closest to "now + hours".
     * Timezone-robust: uses the offset returned by the API rather than the
     * browser's local timezone.
     * @param {object} forecast - Open-Meteo response
     * @param {number} hours - hours ahead of the current time
     * @returns {{index: number, diffMs: number}} - nearest index and how far
     *     (ms) that data point is from the requested time
     */
    _indexForHoursAhead (forecast, hours) {
        const times = forecast.hourly.time;
        const offsetMs = (forecast.utc_offset_seconds || 0) * 1000;
        const targetMs = Date.now() + (hours * 60 * 60 * 1000);
        let bestIndex = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < times.length; i++) {
            // The time strings are local wall-clock; convert back to a real instant.
            const instant = Date.parse(`${times[i]}:00Z`) - offsetMs;
            const diff = Math.abs(instant - targetMs);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIndex = i;
            }
        }
        return {index: bestIndex, diffMs: bestDiff};
    }

    /**
     * Report a forecast value for a postal code at a given hour offset.
     * @param {object} args - block arguments
     * @param {string} args.ITEM - one of temperature/precipitation/weather/windspeed
     * @param {string} args.HOURS - hours ahead of now (free input, full-width ok)
     * @param {string} args.ZIP - Japanese postal code
     * @returns {Promise<(string|number)>} - the requested value, or '' on failure
     */
    getForecast (args) {
        const item = Cast.toString(args.ITEM);
        const hours = parseLooseNumber(args.HOURS);
        const zip = normalizeZip(args.ZIP);
        // Reject non-numeric or past times; out-of-window times are caught below.
        if (!zip || Number.isNaN(hours) || hours < 0) return Promise.resolve('');

        return this._lookupLocation(zip)
            .then(location => {
                if (!location) return '';
                return this._fetchForecast(location).then(forecast => {
                    if (!forecast || !forecast.hourly || !forecast.hourly.time) return '';
                    const match = this._indexForHoursAhead(forecast, hours);
                    // Outside the available forecast window -> no misleading value.
                    if (match.diffMs > HOUR_MATCH_TOLERANCE_MS) return '';
                    const i = match.index;
                    const hourly = forecast.hourly;
                    switch (item) {
                    case 'temperature': {
                        const v = hourly.temperature_2m && hourly.temperature_2m[i];
                        return (v === null || typeof v === 'undefined') ? '' : v;
                    }
                    case 'precipitation': {
                        const v = hourly.precipitation_probability &&
                            hourly.precipitation_probability[i];
                        return (v === null || typeof v === 'undefined') ? '' : v;
                    }
                    case 'windspeed': {
                        const v = hourly.wind_speed_10m && hourly.wind_speed_10m[i];
                        return (v === null || typeof v === 'undefined') ? '' : v;
                    }
                    case 'winddir': {
                        const v = hourly.wind_direction_10m && hourly.wind_direction_10m[i];
                        return windDirectionToJa(v);
                    }
                    case 'weather': {
                        const v = hourly.weather_code && hourly.weather_code[i];
                        return weatherCodeToJa(v);
                    }
                    case 'wbgt':
                    case 'wbgtLevel': {
                        const ta = hourly.temperature_2m && hourly.temperature_2m[i];
                        const rh = hourly.relative_humidity_2m && hourly.relative_humidity_2m[i];
                        const sr = hourly.shortwave_radiation && hourly.shortwave_radiation[i];
                        const ws = hourly.wind_speed_10m && hourly.wind_speed_10m[i];
                        const missing = [ta, rh, sr, ws].some(
                            v => v === null || typeof v === 'undefined'
                        );
                        if (missing) return '';
                        const wbgt = computeWbgt(ta, rh, sr, ws);
                        if (item === 'wbgtLevel') {
                            const level = wbgtLevel(wbgt);
                            return formatMessage({
                                id: level.id,
                                default: level.default,
                                description: 'WBGT danger level'
                            });
                        }
                        return Math.round(wbgt * 10) / 10;
                    }
                    default:
                        return '';
                    }
                });
            })
            .catch(() => '');
    }

    /**
     * Report a daily (weekly) forecast value for a postal code on a given day.
     * @param {object} args - block arguments
     * @param {string} args.DAILY_ITEM - one of weather/tempMax/tempMin/precipitation
     * @param {string} args.DAY - days ahead of today (0 = today, free input, full-width ok)
     * @param {string} args.ZIP - Japanese postal code
     * @returns {Promise<(string|number)>} - the requested value, or '' on failure
     */
    getDailyForecast (args) {
        const item = Cast.toString(args.DAILY_ITEM);
        const dayValue = parseLooseNumber(args.DAY);
        const day = Math.round(dayValue);
        const zip = normalizeZip(args.ZIP);
        if (!zip || Number.isNaN(dayValue)) return Promise.resolve('');

        return this._lookupLocation(zip)
            .then(location => {
                if (!location) return '';
                return this._fetchDailyForecast(location).then(forecast => {
                    if (!forecast || !forecast.daily || !forecast.daily.time) return '';
                    const daily = forecast.daily;
                    if (day < 0 || day >= daily.time.length) return '';
                    switch (item) {
                    case 'weather': {
                        const v = daily.weather_code && daily.weather_code[day];
                        return weatherCodeToJa(v);
                    }
                    case 'tempMax': {
                        const v = daily.temperature_2m_max && daily.temperature_2m_max[day];
                        return (v === null || typeof v === 'undefined') ? '' : v;
                    }
                    case 'tempMin': {
                        const v = daily.temperature_2m_min && daily.temperature_2m_min[day];
                        return (v === null || typeof v === 'undefined') ? '' : v;
                    }
                    case 'precipitation': {
                        const v = daily.precipitation_probability_max &&
                            daily.precipitation_probability_max[day];
                        return (v === null || typeof v === 'undefined') ? '' : v;
                    }
                    case 'sunrise':
                    case 'sunset': {
                        const series = item === 'sunrise' ? daily.sunrise : daily.sunset;
                        const v = series && series[day];
                        if (v === null || typeof v === 'undefined') return '';
                        // ISO8601 like "2026-06-15T04:25" -> "04:25".
                        return String(v).split('T')[1] || '';
                    }
                    default:
                        return '';
                    }
                });
            })
            .catch(() => '');
    }

    /**
     * Report the Japanese place name that a postal code resolves to. This makes
     * it clear that the forecast is for the area around the code (one
     * representative point), not an exact pinpoint, e.g. "東京都千代田区".
     * @param {object} args - block arguments
     * @param {string} args.ZIP - Japanese postal code
     * @returns {Promise<string>} - resolved place name, or '' on failure
     */
    getPlaceName (args) {
        const zip = normalizeZip(args.ZIP);
        if (!zip) return Promise.resolve('');
        return this._lookupLocation(zip)
            .then(location => (location ? this._lookupJapaneseName(location) : ''))
            .catch(() => '');
    }
}

export {
    ExtensionBlocks as default,
    ExtensionBlocks as blockClass,
    weatherCodeToJa,
    normalizeZip,
    parseLooseNumber,
    computeWbgt,
    wbgtLevel,
    windDirectionToJa
};

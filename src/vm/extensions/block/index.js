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
 * HeartRails Geo API covers all Japanese postal codes (including ones
 * starting with 0, which Zippopotam.us lacks) and returns Japanese
 * place names directly. Expects a 7-digit code without a hyphen.
 * @type {string}
 */
const ZIP_API = 'https://geoapi.heartrails.com/api/json?method=searchByPostal&postal=';

/**
 * Endpoint for the Open-Meteo hourly forecast.
 * @type {string}
 */
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';

/**
 * Time-to-live (ms) for the cached forecast of a location.
 * @type {number}
 */
const FORECAST_TTL = 10 * 60 * 1000;

/**
 * Time-to-live (ms) for a cached *failure* (network error, HTTP error, rate
 * limit, unknown postal code). Kept far shorter than FORECAST_TTL so a
 * transient failure does not blank the blocks for ten minutes, but long enough
 * that a `forever` loop calling a block every frame cannot hammer the API.
 * @type {number}
 */
const FAILURE_TTL = 20 * 1000;

/**
 * Timeout (ms) for one API request. Without it a request that never settles
 * would sit in the cache unresolved forever — and because a resolved location
 * is kept for the whole session, a hung postal-code lookup would blank every
 * block until the page is reloaded.
 * @type {number}
 */
const REQUEST_TIMEOUT = 15 * 1000;

/**
 * Fetch a URL and parse it as JSON, resolving to null on *any* failure:
 * network error, HTTP error status, unparseable body, timeout, or `fetch`
 * itself being unavailable. Never rejects, so callers can treat null uniformly
 * and a reporter block can never break its thread with a rejected promise.
 * @param {string} url - request URL
 * @returns {Promise<?object>} - parsed body, or null
 */
const fetchJson = url => new Promise(resolve => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    let settled = false;
    const finish = value => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(value);
    };
    timer = setTimeout(() => {
        if (controller) controller.abort();
        finish(null);
    }, REQUEST_TIMEOUT);
    try {
        fetch(url, controller ? {signal: controller.signal} : {})
            .then(res => (res.ok ? res.json() : null))
            .then(finish, () => finish(null));
    } catch (e) {
        // `fetch` missing or throwing synchronously on an old host.
        finish(null);
    }
});

/**
 * Number of forecast days requested from Open-Meteo. The window starts at today
 * 00:00 local time, so this reaches roughly three days past the current hour.
 * Hours beyond it report an empty value.
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
    2: '晴れ（雲多め）',
    3: '曇り',
    45: '霧',
    48: '着氷性の霧',
    // Open-Meteo derives 51/53/55 purely from mm/h, not from droplet size, so
    // they are not 霧雨 in the Japanese sense. Measured over 4,608 station-hours
    // across Japan: 51 = 0.03-0.85 mm/h (median 0.10), 53 = 0.20-0.90 (0.60),
    // 55 = 1.00-1.20 (1.10) — all 「小雨」/「弱い雨」 by JMA's wording.
    51: '小雨',
    53: '弱い雨',
    55: '弱い雨（強め）',
    56: '着氷性の小雨',
    57: '着氷性の弱い雨',
    61: '雨（弱）',
    63: '雨',
    65: '雨（強）',
    66: '着氷性の雨（弱）',
    67: '着氷性の雨（強）',
    71: '雪（弱）',
    73: '雪',
    75: '雪（強）',
    77: '霧雪',
    80: 'にわか雨（弱）',
    81: 'にわか雨',
    82: 'にわか雨（強）',
    85: 'にわか雪（弱）',
    86: 'にわか雪（強）',
    95: '雷雨',
    // In WMO 4677 the 弱/強 qualifies the thunderstorm, not the hail, and
    // Open-Meteo documents its hail forecast as Central Europe only — so the
    // hail is hedged rather than asserted.
    96: '雷雨（ひょうの可能性）',
    99: '激しい雷雨（ひょうの可能性）'
};

/**
 * Convert a WMO weather code into a Japanese label.
 * @param {number} code - WMO weather code
 * @returns {string} - Japanese label (or the raw code when unknown)
 */
const weatherCodeToJa = code => {
    if (code === null || typeof code === 'undefined') return '';
    if (Object.prototype.hasOwnProperty.call(WEATHER_CODE_JA, code)) {
        return WEATHER_CODE_JA[code];
    }
    // Only echo back something that is actually a code; an object or an array
    // would otherwise be stringified into the label as "不明([object Object])".
    return Number.isFinite(Number(code)) && String(code).trim() !== '' ?
        `不明(${code})` :
        '';
};

/**
 * Coerce an API field to a number for reporting, rejecting anything that is not
 * genuinely numeric. `Number()` alone turns null, '', ' ', [], and false into 0
 * and objects into NaN, either of which would put a wrong number or the literal
 * text "NaN" on the stage.
 * @param {*} value - raw value from an API response
 * @returns {?number} - the number, or null when it is not usable
 */
const toNumber = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Same as toNumber, but shaped for a reporter block: missing or unusable values
 * become the empty string rather than null.
 * @param {*} value - raw value from an API response
 * @returns {(number|string)} - the number, or ''
 */
const reportNumber = value => {
    const parsed = toNumber(value);
    return parsed === null ? '' : parsed;
};

/**
 * Parse a latitude/longitude string from the postal-code API.
 * @param {*} value - raw coordinate field
 * @returns {?number} - the coordinate, or null when it is not usable
 */
const toCoordinate = value => toNumber(value);

/**
 * Hours (local time) that count as daytime when summarizing a day's weather.
 * "明日の天気" means the daylight hours, not 3am.
 * @type {number}
 */
const DAYTIME_START_HOUR = 6;

/**
 * Last daytime hour (inclusive). See DAYTIME_START_HOUR.
 * @type {number}
 */
const DAYTIME_END_HOUR = 18;

/**
 * Last hour (inclusive) scanned for significant weather.
 *
 * The sky is described from daylight hours, but rain, snow and thunder must not
 * be invisible just because they arrive after 18:00 — this extension is used to
 * build hazard alerts, and Japan's warm-season convective maximum is around
 * 20:00-21:00. Measured against AMeDAS observations, 06-18 captures only 46% of
 * a day's precipitation and misses about a third of thunderstorm hours;
 * extending to 21:00 captures 62%. The small hours stay excluded, so pre-dawn
 * rain still cannot take over a sunny day.
 * @type {number}
 */
const SIGNIFICANT_END_HOUR = 21;

/**
 * WMO codes that mean "no weather to report" (clear through overcast).
 * @type {Array.<number>}
 */
const CLEAR_CODES = [0, 1, 2, 3];

/**
 * WMO codes too weak for a single hour of them to define a whole day: fog and
 * plain drizzle. Anything else that precipitates counts as significant and is
 * reported as soon as it appears, so a one-hour thunderstorm is never hidden.
 * @type {Array.<number>}
 */
const LIGHT_CODES = [51, 53, 55];

/**
 * Fog codes. They need the same "must last" rule as light rain, but never the
 * cloud floor below: radiation fog forms on clear, calm nights, so requiring
 * cloud would be exactly backwards. (Open-Meteo's Japanese models appear never
 * to emit these — 0 hours across 114,000 station-hours — but the rule should
 * still be right if that changes.)
 * @type {Array.<number>}
 */
const FOG_CODES = [45, 48];

/**
 * Significant codes grouped by how bad an hour of each one is, mildest tier
 * first.
 *
 * WMO code order is not a severity order: showers (80-82) and snow showers
 * (85-86) are numerically above steady rain (61-65) and snow (71-75), so taking
 * the largest code let one hour of light showers speak for a day of heavy rain.
 * Within a tier the codes are the same intensity in different forms — steady,
 * showery, frozen — so which one is reported is settled by how long it lasted.
 * Codes in no tier rank below every code that is in one.
 * @type {Array.<Array.<number>>}
 */
const SEVERITY_TIERS = [
    [77],
    [61, 71, 80, 85],
    [63, 66, 73, 81],
    [65, 67, 75, 82, 86],
    [95],
    [96],
    [99]
];

/**
 * Pick the code that represents a day: the worst hour first, then — among hours
 * that are equally bad — the one that lasted longest, so six hours of rain are
 * not described by the single hour of showers beside them. The larger code
 * breaks a remaining tie, which keeps the choice deterministic.
 * @param {Array.<number>} codes - WMO codes, one per matching hour
 * @returns {number} - the representative code
 */
const representativeCode = codes => {
    const severityOf = code => SEVERITY_TIERS.findIndex(tier => tier.indexOf(code) !== -1) + 1;
    const hoursOf = code => codes.filter(entry => entry === code).length;
    return codes.slice().sort((a, b) =>
        (severityOf(b) - severityOf(a)) || (hoursOf(b) - hoursOf(a)) || (b - a))[0];
};

/**
 * How many daytime hours a LIGHT_CODES condition must last before it is allowed
 * to represent the day.
 * @type {number}
 */
const LIGHT_MIN_HOURS = 2;

/**
 * Cloud cover (%) and rate (mm/h) an hour of light rain must reach to count.
 *
 * `cloud_cover` is an *area fraction* and `precipitation` a *grid-cell mean*, so
 * a trace rate under a mostly-open sky does not mean the model is wrong — it
 * means the rain is sub-grid and patchy. But a whole day should not be called
 * rainy on that basis. Verified against AMeDAS observations over 1,018
 * station-days: requiring both thresholds cuts the false-rain rate from 52.9% to
 * 43.0% and lifts the critical success index from 0.446 to 0.510, at the cost of
 * 2 correctly-called rain days out of 138.
 *
 * Heavier codes are never filtered: a shower under broken cloud is real, and
 * this extension is used to build hazard alerts.
 * @type {number}
 */
const LIGHT_MIN_CLOUD = 50;

/**
 * Minimum hourly rate (mm/h) for an hour of light rain to count. See
 * LIGHT_MIN_CLOUD.
 * @type {number}
 */
const LIGHT_MIN_RATE = 0.3;

/**
 * Cloud cover (%) upper bounds used to describe a day's sky.
 *
 * The 15% and 85% edges come from JMA's definitions (快晴 = 雲量1以下,
 * 曇り = 雲量9以上); the 50% edge does not — JMA's 晴れ spans 雲量2-8, i.e.
 * 20-80%, so the 晴れ/晴れ（雲多め）split is this extension's own convention.
 * Note also that JMA's 雲量 is an observer's whole-sky estimate while
 * `cloud_cover` is a model column fraction over a grid box: reusing the numbers
 * is a rough convention, not an identity.
 *
 * 快晴 is deliberately absent. JMA's glossary says of it 「予報文には用いない」,
 * so a *forecast* should not use the word — the hourly block still reports it,
 * because there it describes one moment rather than summarizing a day.
 * @type {Array.<{maxCloud: number, code: number}>}
 */
const SKY_BY_CLOUD = [
    {maxCloud: 50, code: 1},
    {maxCloud: 85, code: 2},
    {maxCloud: Infinity, code: 3}
];

/**
 * Pick the clear-sky WMO code that matches a cloud cover percentage.
 * @param {number} cloud - cloud cover (%)
 * @returns {number} - WMO code 0-3
 */
const skyFromCloudCover = cloud => SKY_BY_CLOUD.find(band => cloud < band.maxCloud).code;

/**
 * True when a reading meets a floor. A missing reading is never held against
 * the hour — the check can only reject on evidence.
 * @param {?number} value - reading, or null when unavailable
 * @param {number} floor - minimum acceptable value
 * @returns {boolean} - whether the reading passes
 */
const meetsFloor = (value, floor) => value === null || value >= floor;

/**
 * Whether an hour of light rain is solid enough to be stated outright.
 * @param {number} code - WMO code for the hour
 * @param {?number} cloud - cloud cover (%) for the hour
 * @param {?number} rate - precipitation (mm/h) for the hour
 * @returns {boolean} - false when the model is describing sub-grid, patchy rain
 */
const isSolidLightRain = (code, cloud, rate) =>
    meetsFloor(cloud, LIGHT_MIN_CLOUD) && meetsFloor(rate, LIGHT_MIN_RATE);

/**
 * Compose 「<sky>所により<rain>」 for rain the model puts somewhere in the area
 * rather than everywhere in it.
 * @param {number} sky - clear-sky WMO code
 * @param {number} code - the light-rain WMO code
 * @returns {string} - Japanese label
 */
const patchyLabel = (sky, code) => `${weatherCodeToJa(sky)}所により${weatherCodeToJa(code)}`;

/**
 * Describe a single hour, hedging light rain the model is reporting sub-grid.
 *
 * `cloud_cover` is an area fraction and `precipitation` a grid-cell mean, so a
 * trace rate under an open sky means the rain is patchy within the cell, not
 * that it is everywhere. Stated flatly at one point it is wrong about nine
 * times in ten, so the sky is reported with a 「所により」 hedge instead.
 * @param {*} code - WMO code for the hour
 * @param {?number} cloud - cloud cover (%) for the hour
 * @param {?number} rate - precipitation (mm/h) for the hour
 * @returns {string} - Japanese label, or '' when there is no code
 */
const describeHourWeather = (code, cloud, rate) => {
    const numeric = toNumber(code);
    if (numeric === null || LIGHT_CODES.indexOf(numeric) === -1) return weatherCodeToJa(code);
    if (isSolidLightRain(numeric, cloud, rate) || cloud === null) {
        return weatherCodeToJa(numeric);
    }
    return patchyLabel(skyFromCloudCover(cloud), numeric);
};

/**
 * Resolve the index into the daily arrays for "today + day", matching on the
 * dates the API returned rather than trusting array position.
 *
 * A payload fetched just before local midnight stays cached for FORECAST_TTL,
 * and from then on position 0 is *yesterday* — so `0日後` would quietly report
 * yesterday's forecast. This is the same discipline `_indexForHoursAhead`
 * already applies on the hourly side.
 * @param {object} forecast - Open-Meteo daily response
 * @param {number} day - days ahead of today (0 = today)
 * @returns {number} - index into the daily arrays, or -1 when unavailable
 */
const dailyIndexForDay = (forecast, day) => {
    const times = forecast.daily.time;
    if (!Array.isArray(times)) return -1;
    if (!Number.isFinite(forecast.utc_offset_seconds)) return -1;
    const today = new Date(Date.now() + (forecast.utc_offset_seconds * 1000))
        .toISOString()
        .slice(0, 10);
    const base = times.indexOf(today);
    if (base < 0) return -1;
    const index = base + day;
    return (index >= 0 && index < times.length) ? index : -1;
};

/**
 * Mean of an hourly field across one whole day.
 *
 * Open-Meteo's daily `precipitation_probability_max` is the maximum of 24
 * hourly probabilities, each of which is P(>0.1mm in that hour). A maximum over
 * 24 marginal probabilities inflates badly: measured against JMA over 52
 * locations x 5 lead days it ran +27 points high (MAE 31.4). The mean of the
 * same hourly values tracks JMA's figure far better — bias -2.9, MAE 12.3,
 * r 0.67 — and beat the maximum on 200 of 200 resamples and at every lead day.
 *
 * The whole day is used, including the night, because JMA's own daily figure is
 * the largest of its four 6-hour blocks and two of those are outside daylight.
 * @param {object} forecast - Open-Meteo response with an `hourly` block
 * @param {string} date - the day to average ("YYYY-MM-DD")
 * @param {string} field - hourly field name to read
 * @returns {?number} - mean value, or null when the day has no usable data
 */
const hourlyMean = (forecast, date, field) => {
    const hourly = forecast.hourly;
    if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly[field])) return null;
    let total = 0;
    let count = 0;
    for (let i = 0; i < hourly.time.length; i++) {
        const time = hourly.time[i];
        if (typeof time !== 'string' || time.slice(0, 10) !== date) continue;
        const value = toNumber(hourly[field][i]);
        if (value === null) continue;
        total += value;
        count++;
    }
    return count === 0 ? null : total / count;
};

/**
 * Summarize one day from its hourly WMO codes.
 *
 * Open-Meteo's daily `weather_code` is the maximum over all 24 hours, so a
 * single hour of pre-dawn drizzle labels an otherwise sunny day as rain. This
 * describes the sky from daylight hours, looks for significant weather (rain,
 * snow, thunder) into the evening and reports it immediately, requires fog and
 * light rain to persist *and* to be more than a trace under an open sky, and
 * otherwise describes the sky from the average daytime cloud cover.
 * @param {Array.<string>} times - hourly ISO timestamps ("YYYY-MM-DDTHH:MM")
 * @param {Array.<number>} codes - hourly WMO codes, parallel to `times`
 * @param {Array.<number>} clouds - hourly cloud cover (%), parallel to `times`
 * @param {Array.<number>} rates - hourly precipitation (mm/h), parallel to `times`
 * @param {string} date - the day to summarize ("YYYY-MM-DD")
 * @returns {(number|{sky: number, patchy: number}|null)} - a WMO code, or a sky
 *     code plus the light rain the model wants somewhere in the area, or null
 */
const summarizeDayWeather = (times, codes, clouds, rates, date) => {
    if (!Array.isArray(times) || !Array.isArray(codes)) return null;
    const at = (series, i) => toNumber(Array.isArray(series) ? series[i] : null);
    const scanned = [];
    for (let i = 0; i < times.length; i++) {
        const time = times[i];
        if (typeof time !== 'string' || time.slice(0, 10) !== date) continue;
        const hour = Number(time.slice(11, 13));
        if (!(hour >= DAYTIME_START_HOUR && hour <= SIGNIFICANT_END_HOUR)) continue;
        const code = toNumber(codes[i]);
        if (code === null) continue;
        scanned.push({hour: hour, code: code, cloud: at(clouds, i), rate: at(rates, i)});
    }
    const daytime = scanned.filter(entry => entry.hour <= DAYTIME_END_HOUR);

    // Rain, snow and thunder are reported as soon as they appear, and are looked
    // for into the evening.
    const significant = scanned
        .filter(entry => CLEAR_CODES.indexOf(entry.code) === -1 &&
            LIGHT_CODES.indexOf(entry.code) === -1 &&
            FOG_CODES.indexOf(entry.code) === -1)
        .map(entry => entry.code);
    if (significant.length > 0) return representativeCode(significant);
    if (daytime.length === 0) return null;

    const hoursOf = code => daytime.filter(entry => entry.code === code).length;
    const lasts = entry => hoursOf(entry.code) >= LIGHT_MIN_HOURS;

    // Light rain must last, and must be more than a trace under an open sky.
    const light = daytime
        .filter(entry => LIGHT_CODES.indexOf(entry.code) !== -1 && lasts(entry) &&
            isSolidLightRain(entry.code, entry.cloud, entry.rate))
        .map(entry => entry.code);
    // Fog only has to last; it forms under clear skies, so no cloud floor.
    const fog = daytime
        .filter(entry => FOG_CODES.indexOf(entry.code) !== -1 && lasts(entry))
        .map(entry => entry.code);
    const reported = light.concat(fog);
    if (reported.length > 0) return Math.max.apply(null, reported);

    // Light rain that lasted but was rejected for being a trace under an open
    // sky. The model is saying the rain is sub-grid — patchy in space, not
    // absent — and observations back that: of the days this rejection turns
    // from rainy to dry, about a quarter saw rain within 20 km. Reporting a
    // plain 晴れ would be a stronger claim than the data supports, so the sky
    // carries a 「所により」 hedge instead.
    const patchy = daytime
        .filter(entry => LIGHT_CODES.indexOf(entry.code) !== -1 && lasts(entry))
        .map(entry => entry.code);

    // Otherwise describe the sky from the average cloud cover.
    const measured = daytime.filter(entry => entry.cloud !== null);
    if (measured.length > 0) {
        const mean = measured.reduce((sum, entry) => sum + entry.cloud, 0) / measured.length;
        const sky = skyFromCloudCover(mean);
        return patchy.length > 0 ?
            {sky: sky, patchy: Math.max.apply(null, patchy)} :
            sky;
    }
    // No cloud data at all: fall back to the most overcast code that lasted.
    const clear = daytime.map(entry => entry.code)
        .filter(code => CLEAR_CODES.indexOf(code) !== -1);
    const lasting = clear.filter(code => hoursOf(code) >= LIGHT_MIN_HOURS);
    const pool = lasting.length > 0 ? lasting : clear;
    return Math.max.apply(null, pool.length > 0 ? pool : daytime.map(entry => entry.code));
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
    const value = Number(deg);
    // Without this guard a non-numeric value indexes the table with NaN and the
    // block reports the string "undefined".
    if (!Number.isFinite(value)) return '';
    const idx = Math.round(value / 22.5);
    return WIND_DIRECTIONS_JA[((idx % 16) + 16) % 16];
};

/**
 * Tolerance (ms) for matching a requested hour to an available hourly data
 * point. The grid is hourly, so any in-window request is within 30 min of a data
 * point; a wider gap means the requested time is outside the forecast window.
 * Anything larger would let times past the end of the window silently report the
 * last available hour.
 * @type {number}
 */
const HOUR_MATCH_TOLERANCE_MS = 30 * 60 * 1000;

/**
 * Convert full-width ASCII characters (！-～) and the full-width space to their
 * half-width equivalents, so free-typed full-width input is accepted.
 * @param {string} raw - user input
 * @returns {string} - input with full-width forms converted to half-width
 */
const toHalfWidth = raw => String(raw)
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // The literal U+3000 is the whole point of this line, so the rule cannot apply.
    // eslint-disable-next-line no-irregular-whitespace
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
 * Read a cached request, treating an expired entry as absent.
 * @param {object.<string, {data: Promise<?object>, expiresAt: number}>} cache - cache to read
 * @param {string} key - cache key
 * @returns {?Promise<?object>} - the cached request, or null when absent/expired
 */
const readCache = (cache, key) => {
    const entry = cache[key];
    if (!entry) return null;
    const now = Date.now();
    if (now >= entry.expiresAt) {
        // Drop it rather than just reporting a miss: a project that sweeps
        // through postal codes would otherwise retain every payload forever.
        delete cache[key];
        return null;
    }
    // A clock that jumps backwards (NTP correction, a shared classroom PC being
    // set by hand) must not strand an entry far in the future.
    if (entry.expiresAt - now > entry.ttl) entry.expiresAt = now + entry.ttl;
    return entry.data;
};

/**
 * Store an in-flight request, shortening its lifetime if it turns out to have
 * failed. Concurrent callers share the single in-flight promise, so a block used
 * inside a `forever` loop normally issues one request per TTL. The TTL is
 * measured from the request's start, so a request that outlives it can be joined
 * by a second one — rare, and harmless beyond the extra call.
 * @param {object.<string, {data: Promise<?object>, expiresAt: number}>} cache - cache to write
 * @param {string} key - cache key
 * @param {Promise<?object>} request - in-flight request, which resolves to null on failure
 * @param {number} ttl - lifetime (ms) to keep a successful result
 * @returns {Promise<?object>} - the same request
 */
const writeCache = (cache, key, request, ttl) => {
    const entry = {data: request, ttl: ttl, expiresAt: Date.now() + ttl};
    cache[key] = entry;
    const expireSoon = () => {
        entry.ttl = Math.min(entry.ttl, FAILURE_TTL);
        entry.expiresAt = Math.min(entry.expiresAt, Date.now() + FAILURE_TTL);
    };
    // Handle rejection too: `request` is expected to be already terminated, but
    // this helper must not depend on that convention to stay correct.
    request.then(
        result => {
            if (!result) expireSoon();
        },
        expireSoon
    );
    return request;
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
 * Items offered by the hourly block's dropdown, in display order.
 * @type {Array.<{id: string, default: string, description: string, value: string}>}
 */
const ITEM_MENU = [
    {
        id: 'weatherForecast.item.weather',
        default: 'weather',
        description: 'weather menu item',
        value: 'weather'
    },
    {
        id: 'weatherForecast.item.temperature',
        default: 'temperature',
        description: 'temperature menu item',
        value: 'temperature'
    },
    {
        id: 'weatherForecast.item.humidity',
        default: 'humidity',
        description: 'relative humidity menu item',
        value: 'humidity'
    },
    {
        id: 'weatherForecast.item.pressure',
        default: 'pressure',
        description: 'sea-level pressure menu item',
        value: 'pressure'
    },
    {
        id: 'weatherForecast.item.precipitation',
        default: 'precipitation probability',
        description: 'precipitation probability menu item',
        value: 'precipitation'
    },
    {
        id: 'weatherForecast.item.precipAmount',
        default: 'precipitation amount',
        description: 'precipitation amount menu item',
        value: 'precipAmount'
    },
    {
        id: 'weatherForecast.item.windspeed',
        default: 'wind speed',
        description: 'wind speed menu item',
        value: 'windspeed'
    },
    {
        id: 'weatherForecast.item.winddir',
        default: 'wind direction',
        description: 'wind direction menu item',
        value: 'winddir'
    },
    {
        id: 'weatherForecast.item.wbgt',
        default: 'heat index (WBGT)',
        description: 'WBGT value menu item',
        value: 'wbgt'
    },
    {
        id: 'weatherForecast.item.wbgtLevel',
        default: 'heat risk level (WBGT)',
        description: 'WBGT danger level menu item',
        value: 'wbgtLevel'
    },
    {
        id: 'weatherForecast.item.uvIndex',
        default: 'UV index',
        description: 'UV index menu item',
        value: 'uvIndex'
    }
];

/**
 * Items offered by the weekly block's dropdown, in display order.
 * @type {Array.<{id: string, default: string, description: string, value: string}>}
 */
const DAILY_ITEM_MENU = [
    {
        id: 'weatherForecast.daily.weather',
        default: 'weather',
        description: 'daily weather menu item',
        value: 'weather'
    },
    {
        id: 'weatherForecast.daily.tempMax',
        default: 'highest temperature',
        description: 'daily max temperature menu item',
        value: 'tempMax'
    },
    {
        id: 'weatherForecast.daily.tempMin',
        default: 'lowest temperature',
        description: 'daily min temperature menu item',
        value: 'tempMin'
    },
    {
        id: 'weatherForecast.daily.precipitation',
        default: 'precipitation probability',
        description: 'daily precipitation probability menu item',
        value: 'precipitation'
    },
    {
        id: 'weatherForecast.daily.precipAmount',
        default: 'precipitation amount',
        description: 'daily precipitation amount menu item',
        value: 'precipAmount'
    },
    {
        id: 'weatherForecast.daily.sunrise',
        default: 'sunrise',
        description: 'daily sunrise time menu item',
        value: 'sunrise'
    },
    {
        id: 'weatherForecast.daily.sunset',
        default: 'sunset',
        description: 'daily sunset time menu item',
        value: 'sunset'
    },
    {
        id: 'weatherForecast.daily.sunshine',
        default: 'sunshine duration',
        description: 'daily sunshine duration menu item',
        value: 'sunshine'
    }
];

/**
 * Build a Scratch menu from descriptors, translating each label.
 * @param {Array.<object>} descriptors - menu descriptors
 * @returns {object} - menu definition for getInfo
 */
const buildMenu = descriptors => ({
    acceptReporters: true,
    items: descriptors.map(descriptor => ({
        text: formatMessage(descriptor),
        value: descriptor.value
    }))
});

/**
 * Resolve whatever arrived in a menu slot to one of its values.
 *
 * The menus set `acceptReporters`, so a reporter block can be dropped in — and
 * what it supplies is usually the label the user can see (「気温」), not the
 * internal value. Accept the label in any locale, and tolerate the stray
 * whitespace that `join` blocks tend to leave behind.
 * @param {Array.<object>} descriptors - menu descriptors
 * @param {string} raw - the value the block received
 * @returns {string} - a menu value, or the input unchanged when nothing matches
 */
const resolveMenuValue = (descriptors, raw) => {
    const text = String(raw).trim();
    const match = descriptors.find(descriptor => {
        if (descriptor.value === text) return true;
        if (formatMessage(descriptor) === text) return true;
        return Object.keys(translations).some(locale =>
            translations[locale][descriptor.id] === text);
    });
    return match ? match.value : raw;
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
         * @type {Object.<string, {data: Promise<?object>, expiresAt: number}>}
         */
        this._geoCache = {};

        /**
         * Cache of location -> hourly forecast results.
         * @type {Object.<string, {data: Promise<?object>, expiresAt: number}>}
         */
        this._forecastCache = {};

        /**
         * Cache of location -> daily (weekly) forecast results.
         * @type {Object.<string, {data: Promise<?object>, expiresAt: number}>}
         */
        this._dailyCache = {};
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
                            defaultValue: 0
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
                            defaultValue: 0
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
                itemMenu: buildMenu(ITEM_MENU),
                dailyItemMenu: buildMenu(DAILY_ITEM_MENU)
            }
        };
    }

    /**
     * Look up latitude/longitude for a postal code (memoized).
     * @param {string} zip - normalized "NNN-NNNN" postal code
     * @returns {Promise<?{latitude: number, longitude: number}>} - coordinates or null
     */
    _lookupLocation (zip) {
        const cached = readCache(this._geoCache, zip);
        if (cached) return cached;
        const request = fetchJson(`${ZIP_API}${zip.replace('-', '')}`)
            .then(json => {
                const locations = json && json.response && json.response.location;
                if (!locations || locations.length === 0) return null;
                const place = locations[0];
                const latitude = toCoordinate(place.y);
                const longitude = toCoordinate(place.x);
                // Blank or missing coordinates coerce to 0 through Number(),
                // which would silently forecast the Gulf of Guinea. These are
                // Japanese postal codes, so anything outside Japan is bad data.
                if (latitude === null || longitude === null) return null;
                if (latitude < 20 || latitude > 46 || longitude < 122 || longitude > 154) {
                    return null;
                }
                return {
                    latitude: latitude,
                    longitude: longitude,
                    // e.g. "東京都" + "千代田区" -> "東京都千代田区"
                    name: [place.prefecture, place.city]
                        .filter(part => typeof part === 'string' && part !== '')
                        .join('')
                };
            })
            .catch(() => null);
        // A resolved location never changes, so keep it for the whole session;
        // writeCache still expires a failure quickly.
        return writeCache(this._geoCache, zip, request, Infinity);
    }

    /**
     * Fetch the hourly forecast for a location (memoized with a short TTL).
     * @param {{latitude: number, longitude: number}} location - coordinates
     * @returns {Promise<?object>} - Open-Meteo hourly response or null
     */
    _fetchForecast (location) {
        const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
        const cached = readCache(this._forecastCache, key);
        if (cached) return cached;
        const params = new URLSearchParams({
            latitude: String(location.latitude),
            longitude: String(location.longitude),
            hourly: 'temperature_2m,relative_humidity_2m,pressure_msl,' +
                'precipitation_probability,precipitation,weather_code,cloud_cover,' +
                'wind_speed_10m,wind_direction_10m,shortwave_radiation,uv_index',
            wind_speed_unit: 'ms',
            timezone: 'Asia/Tokyo',
            forecast_days: String(FORECAST_DAYS)
        });
        const request = fetchJson(`${FORECAST_API}?${params.toString()}`);
        return writeCache(this._forecastCache, key, request, FORECAST_TTL);
    }

    /**
     * Fetch the daily (weekly) forecast for a location (memoized with a short TTL).
     * @param {{latitude: number, longitude: number}} location - coordinates
     * @returns {Promise<?object>} - Open-Meteo daily response or null
     */
    _fetchDailyForecast (location) {
        const key = `${location.latitude.toFixed(3)},${location.longitude.toFixed(3)}`;
        const cached = readCache(this._dailyCache, key);
        if (cached) return cached;
        const params = new URLSearchParams({
            latitude: String(location.latitude),
            longitude: String(location.longitude),
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,' +
                'precipitation_probability_max,precipitation_sum,sunrise,sunset,' +
                'sunshine_duration',
            // The day's weather is derived from the hourly codes and cloud cover
            // (see summarizeDayWeather) and its precipitation probability from
            // the hourly probabilities (see hourlyMean). Both ride along on the
            // same request.
            hourly: 'weather_code,cloud_cover,precipitation,precipitation_probability',
            timezone: 'Asia/Tokyo',
            forecast_days: String(WEEKLY_DAYS)
        });
        const request = fetchJson(`${FORECAST_API}?${params.toString()}`);
        return writeCache(this._dailyCache, key, request, FORECAST_TTL);
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
        // Guessing UTC when the offset is missing would silently shift every
        // reading by 9 hours, and the tolerance check below cannot detect that
        // because the whole array moves together. Report nothing instead.
        if (!Number.isFinite(forecast.utc_offset_seconds)) {
            return {index: 0, diffMs: Infinity};
        }
        const offsetMs = forecast.utc_offset_seconds * 1000;
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
     * @param {string} args.ITEM - one of weather/temperature/humidity/pressure/
     *     precipitation/precipAmount/windspeed/winddir/wbgt/wbgtLevel/uvIndex
     * @param {string} args.HOURS - hours ahead of now (free input, full-width ok)
     * @param {string} args.ZIP - Japanese postal code
     * @returns {Promise<(string|number)>} - the requested value, or '' on failure
     */
    getForecast (args) {
        const item = resolveMenuValue(ITEM_MENU, Cast.toString(args.ITEM));
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
                        return reportNumber(v);
                    }
                    case 'humidity': {
                        const v = hourly.relative_humidity_2m && hourly.relative_humidity_2m[i];
                        return reportNumber(v);
                    }
                    case 'pressure': {
                        const v = hourly.pressure_msl && hourly.pressure_msl[i];
                        return reportNumber(v);
                    }
                    case 'precipitation': {
                        const v = hourly.precipitation_probability &&
                            hourly.precipitation_probability[i];
                        return reportNumber(v);
                    }
                    case 'precipAmount': {
                        const v = hourly.precipitation && hourly.precipitation[i];
                        return reportNumber(v);
                    }
                    case 'uvIndex': {
                        const v = toNumber(hourly.uv_index && hourly.uv_index[i]);
                        return v === null ? '' : Math.round(v * 10) / 10;
                    }
                    case 'windspeed': {
                        const v = hourly.wind_speed_10m && hourly.wind_speed_10m[i];
                        return reportNumber(v);
                    }
                    case 'winddir': {
                        const v = hourly.wind_direction_10m && hourly.wind_direction_10m[i];
                        return windDirectionToJa(v);
                    }
                    case 'weather': {
                        const v = hourly.weather_code && hourly.weather_code[i];
                        return describeHourWeather(
                            v,
                            toNumber(hourly.cloud_cover && hourly.cloud_cover[i]),
                            toNumber(hourly.precipitation && hourly.precipitation[i])
                        );
                    }
                    case 'wbgt':
                    case 'wbgtLevel': {
                        const ta = toNumber(hourly.temperature_2m && hourly.temperature_2m[i]);
                        const rh = toNumber(
                            hourly.relative_humidity_2m && hourly.relative_humidity_2m[i]
                        );
                        const sr = toNumber(
                            hourly.shortwave_radiation && hourly.shortwave_radiation[i]
                        );
                        const ws = toNumber(hourly.wind_speed_10m && hourly.wind_speed_10m[i]);
                        if ([ta, rh, sr, ws].some(v => v === null)) return '';
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
     * @param {string} args.DAILY_ITEM - one of weather/tempMax/tempMin/
     *     precipitation/precipAmount/sunrise/sunset/sunshine
     * @param {string} args.DAY - days ahead of today (0 = today, free input, full-width ok)
     * @param {string} args.ZIP - Japanese postal code
     * @returns {Promise<(string|number)>} - the requested value, or '' on failure
     */
    getDailyForecast (args) {
        const item = resolveMenuValue(DAILY_ITEM_MENU, Cast.toString(args.DAILY_ITEM));
        const dayValue = parseLooseNumber(args.DAY);
        const zip = normalizeZip(args.ZIP);
        // Reject before rounding: Math.round(-0.4) is -0, and -0 < 0 is false.
        if (!zip || Number.isNaN(dayValue) || dayValue < 0) return Promise.resolve('');
        const day = Math.round(dayValue);

        return this._lookupLocation(zip)
            .then(location => {
                if (!location) return '';
                return this._fetchDailyForecast(location).then(forecast => {
                    if (!forecast || !forecast.daily || !forecast.daily.time) return '';
                    const daily = forecast.daily;
                    const index = dailyIndexForDay(forecast, day);
                    if (index < 0) return '';
                    switch (item) {
                    case 'weather': {
                        const summary = forecast.hourly && summarizeDayWeather(
                            forecast.hourly.time,
                            forecast.hourly.weather_code,
                            forecast.hourly.cloud_cover,
                            forecast.hourly.precipitation,
                            daily.time[index]
                        );
                        if (summary !== null && typeof summary !== 'undefined') {
                            return typeof summary === 'object' ?
                                patchyLabel(summary.sky, summary.patchy) :
                                weatherCodeToJa(summary);
                        }
                        // No hourly codes for that day: fall back to the daily field.
                        const v = daily.weather_code && daily.weather_code[index];
                        return weatherCodeToJa(v);
                    }
                    case 'tempMax': {
                        const v = daily.temperature_2m_max && daily.temperature_2m_max[index];
                        return reportNumber(v);
                    }
                    case 'tempMin': {
                        const v = daily.temperature_2m_min && daily.temperature_2m_min[index];
                        return reportNumber(v);
                    }
                    case 'precipitation': {
                        const mean = hourlyMean(
                            forecast, daily.time[index], 'precipitation_probability'
                        );
                        if (mean !== null) return Math.round(mean);
                        // No hourly data: fall back to Open-Meteo's daily field.
                        const v = daily.precipitation_probability_max &&
                            daily.precipitation_probability_max[index];
                        return reportNumber(v);
                    }
                    case 'precipAmount': {
                        const v = daily.precipitation_sum && daily.precipitation_sum[index];
                        return reportNumber(v);
                    }
                    case 'sunshine': {
                        const v = toNumber(daily.sunshine_duration && daily.sunshine_duration[index]);
                        if (v === null) return '';
                        // API returns seconds; report hours (e.g. 23400 -> 6.5).
                        return Math.round((v / 3600) * 10) / 10;
                    }
                    case 'sunrise':
                    case 'sunset': {
                        const series = item === 'sunrise' ? daily.sunrise : daily.sunset;
                        const v = series && series[index];
                        if (typeof v !== 'string') return '';
                        // ISO8601 like "2026-06-15T04:25" -> "04:25".
                        return v.split('T')[1] || '';
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
            .then(location => (location ? location.name : ''))
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
    windDirectionToJa,
    summarizeDayWeather
};

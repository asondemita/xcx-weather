import {
    blockClass,
    weatherCodeToJa,
    normalizeZip,
    parseLooseNumber,
    computeWbgt,
    wbgtLevel,
    windDirectionToJa,
    summarizeDayWeather
} from "../../src/vm/extensions/block/index.js";

describe("summarizeDayWeather", () => {
    const TIMES = [];
    for (let h = 0; h < 24; h++) {
        TIMES.push(`2026-06-15T${String(h).padStart(2, "0")}:00`);
    }
    const fill = (base, overrides) => {
        const out = new Array(24).fill(base);
        Object.keys(overrides || {}).forEach(h => (out[Number(h)] = overrides[h]));
        return out;
    };
    // Overcast and raining properly by default, so a rain code is believed
    // unless a test says otherwise.
    const day = (codes, clouds, rates) =>
        summarizeDayWeather(TIMES, codes, clouds || fill(100), rates || fill(1), "2026-06-15");

    test("ignores rain outside daylight hours", () => {
        expect(day(fill(1, {0: 51, 1: 51, 2: 53, 3: 51, 4: 51, 22: 51, 23: 51}), fill(30)))
            .toBe(1);
    });

    test("ignores a single daytime hour of light rain or fog", () => {
        expect(day(fill(1, {7: 51}), fill(30))).toBe(1);
        expect(day(fill(1, {14: 45}), fill(30))).toBe(1);
    });

    test("reports light rain once it lasts long enough under cloud", () => {
        expect(day(fill(1, {7: 51, 8: 51}))).toBe(51);
    });

    test("reports fog on persistence alone, with no cloud floor", () => {
        // Radiation fog forms on clear, calm nights, so requiring cloud would
        // be exactly backwards.
        expect(day(fill(1, {10: 45, 11: 45, 12: 45}), fill(5), fill(0))).toBe(45);
    });

    test("does not call the day rainy on a trace rate alone", () => {
        const codes = fill(1, {10: 51, 11: 51, 12: 53, 13: 53});
        expect(day(codes, fill(95), fill(0.1))).toEqual({sky: 3, patchy: 53});
        expect(day(codes, fill(95), fill(0.5))).toBe(53);
    });

    test("does not call the day rainy when the sky is open", () => {
        // Seven daytime hours flagged as light rain under a nearly clear sky:
        // the rain is sub-grid, so the day is not 「弱い雨」 — but it is not a
        // plain 晴れ either, hence the hedge.
        const codes = fill(1, {9: 51, 10: 51, 11: 53, 12: 53, 13: 53, 14: 51, 15: 51});
        expect(day(codes, fill(20))).toEqual({sky: 1, patchy: 53});
        // Same codes under a genuinely cloudy sky are believed outright.
        expect(day(codes, fill(90))).toBe(53);
    });

    test("finds significant weather into the evening, but not before dawn", () => {
        // Japan's warm-season convective maximum is around 20:00-21:00, and this
        // extension is used to build hazard alerts.
        expect(day(fill(0, {20: 95}), fill(10))).toBe(95);
        expect(day(fill(0, {21: 63}), fill(10))).toBe(63);
        // 22:00 onward is outside the scan, as are the small hours — otherwise
        // pre-dawn rain would take over a sunny day again.
        expect(day(fill(0, {22: 95}), fill(10))).toBe(1);
        expect(day(fill(0, {3: 95}), fill(10))).toBe(1);
    });

    test("describes the sky from daylight hours only", () => {
        // Evening cloud must not darken the day's sky word.
        expect(day(fill(1, {19: 3, 20: 3, 21: 3}), fill(20, {19: 100, 20: 100, 21: 100})))
            .toBe(1);
    });

    test("reports significant weather after a single hour, whatever the sky", () => {
        expect(day(fill(0, {12: 95}), fill(10))).toBe(95); // 雷雨
        expect(day(fill(1, {15: 63}), fill(10))).toBe(63); // 雨
        expect(day(fill(1, {9: 71}), fill(10))).toBe(71); // 雪
        expect(day(fill(1, {9: 80}), fill(10))).toBe(80); // にわか雨
        expect(day(fill(3, {9: 56}), fill(10))).toBe(56); // 着氷性の霧雨
    });

    test("prefers the most severe significant code", () => {
        expect(day(fill(1, {9: 51, 10: 51, 13: 95}))).toBe(95);
    });

    test("describes the sky from the average daytime cloud cover", () => {
        // 快晴 is absent on purpose: JMA never publishes it in a forecast.
        expect(day(fill(3), fill(5))).toBe(1);
        expect(day(fill(0), fill(30))).toBe(1);
        expect(day(fill(0), fill(70))).toBe(2);
        expect(day(fill(0), fill(95))).toBe(3);
    });

    test("is not swayed by a single overcast hour", () => {
        // 12 clear daytime hours plus one hour of high cloud is a clear day.
        expect(day(fill(0), fill(5, {18: 96}))).toBe(1);
    });

    test("hedges with 所により when lasting light rain was rejected", () => {
        // The model wants light rain for six hours under an open sky: sub-grid
        // and patchy, so neither 「雨」 nor a bare 「晴れ」 is honest.
        const codes = fill(1, {9: 51, 10: 51, 11: 53, 12: 53, 13: 51, 14: 51});
        expect(day(codes, fill(20), fill(0.2))).toEqual({sky: 1, patchy: 53});
        // A single hour is not enough to hedge on.
        expect(day(fill(1, {9: 51}), fill(20), fill(0.2))).toBe(1);
    });

    test("falls back to the codes when no cloud data is available", () => {
        expect(summarizeDayWeather(TIMES, fill(0, {12: 3, 13: 3}), null, null, "2026-06-15")).toBe(3);
        expect(summarizeDayWeather(TIMES, fill(0, {18: 3}), null, null, "2026-06-15")).toBe(0);
        // With no cloud data there is nothing to hedge against, so the rejected
        // light rain simply does not appear.
        expect(summarizeDayWeather(TIMES, fill(1, {9: 51, 10: 51}), null, fill(0.1), "2026-06-15"))
            .toBe(1);
    });

    test("returns null when the day has no hourly data", () => {
        expect(summarizeDayWeather(["2026-06-16T12:00"], [3], [50], [1], "2026-06-15")).toBe(null);
        expect(summarizeDayWeather([], [], [], [], "2026-06-15")).toBe(null);
        expect(summarizeDayWeather(null, null, null, null, "2026-06-15")).toBe(null);
    });
});

describe("blockClass", () => {
    const runtime = {
        formatMessage: function (msg) {
            return msg.default;
        }
    };

    test("should create an instance of blockClass", () => {
        const block = new blockClass(runtime);
        expect(block).toBeInstanceOf(blockClass);
    });
});

describe("weatherCodeToJa", () => {
    test("maps known WMO codes to Japanese", () => {
        expect(weatherCodeToJa(0)).toBe("快晴");
        expect(weatherCodeToJa(3)).toBe("曇り");
        expect(weatherCodeToJa(63)).toBe("雨");
        expect(weatherCodeToJa(95)).toBe("雷雨");
    });

    test("labels 51/53/55 by rain intensity rather than as 霧雨", () => {
        // Open-Meteo derives these from mm/h, not from droplet size, so they are
        // not 霧雨 in the Japanese sense. Measured medians: 0.10 / 0.60 / 1.10.
        expect(weatherCodeToJa(51)).toBe("小雨");
        expect(weatherCodeToJa(53)).toBe("弱い雨");
        expect(weatherCodeToJa(55)).toBe("弱い雨（強め）");
    });

    test("describes an instantaneous sky without a forecast-period word", () => {
        // 「時々」 is a period expression; code 2 is a single moment at 50-78% cloud.
        expect(weatherCodeToJa(2)).toBe("晴れ（雲多め）");
    });

    test("does not assert hail, and puts the intensity on the thunderstorm", () => {
        expect(weatherCodeToJa(96)).toBe("雷雨（ひょうの可能性）");
        expect(weatherCodeToJa(99)).toBe("激しい雷雨（ひょうの可能性）");
    });

    test("uses the WMO 4677 meaning for the fog and frozen codes", () => {
        // 48 is "depositing rime fog", i.e. a fog, not the rime deposit itself.
        expect(weatherCodeToJa(48)).toBe("着氷性の霧");
        // 77 is "snow grains"; 細氷 (diamond dust) is 76, a different phenomenon.
        expect(weatherCodeToJa(77)).toBe("霧雪");
    });

    test("handles unknown / empty codes", () => {
        expect(weatherCodeToJa(123)).toBe("不明(123)");
        expect(weatherCodeToJa(null)).toBe("");
        expect(weatherCodeToJa(undefined)).toBe("");
    });
});

describe("normalizeZip", () => {
    test("normalizes 7 digits with or without hyphen", () => {
        expect(normalizeZip("1000001")).toBe("100-0001");
        expect(normalizeZip("100-0001")).toBe("100-0001");
    });

    test("normalizes full-width digits and hyphen", () => {
        expect(normalizeZip("１０００００１")).toBe("100-0001");
        expect(normalizeZip("１００-０００１")).toBe("100-0001");
        expect(normalizeZip("１００－０００１")).toBe("100-0001"); // full-width hyphen
        expect(normalizeZip("100０001")).toBe("100-0001"); // mixed widths
    });

    test("rejects non 7-digit input", () => {
        expect(normalizeZip("123")).toBe(null);
        expect(normalizeZip("")).toBe(null);
        expect(normalizeZip("12345678")).toBe(null);
    });
});

describe("parseLooseNumber", () => {
    test("parses half-width and full-width digits", () => {
        expect(parseLooseNumber("3")).toBe(3);
        expect(parseLooseNumber(12)).toBe(12);
        expect(parseLooseNumber("１２")).toBe(12); // full-width
        expect(parseLooseNumber("－2")).toBe(-2); // full-width minus
        expect(parseLooseNumber(" 5 ")).toBe(5);
    });

    test("returns NaN for non-numeric or empty input", () => {
        expect(Number.isNaN(parseLooseNumber("abc"))).toBe(true);
        expect(Number.isNaN(parseLooseNumber(""))).toBe(true);
        expect(Number.isNaN(parseLooseNumber("   "))).toBe(true);
    });
});

describe("getForecast", () => {
    const runtime = {
        formatMessage: msg => msg.default
    };

    const forecastResponse = {
        utc_offset_seconds: 32400,
        hourly: {
            time: ["2026-06-07T12:00", "2026-06-07T13:00", "2026-06-07T14:00"],
            temperature_2m: [20, 21, 22],
            relative_humidity_2m: [50, 60, 70],
            pressure_msl: [1013.2, 1010.5, 998.7],
            precipitation_probability: [10, 30, 60],
            precipitation: [0, 0.5, 3.2],
            weather_code: [0, 3, 63],
            cloud_cover: [5, 90, 95],
            wind_speed_10m: [1.5, 2.0, 3.2],
            wind_direction_10m: [0, 90, 45],
            shortwave_radiation: [0, 200, 800],
            uv_index: [0, 2.35, 6.6]
        }
    };

    beforeEach(() => {
        global.fetch = jest.fn(url => {
            if (url.startsWith("https://geoapi.heartrails.com/")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: {location: [{y: "35.68", x: "139.76"}]}
                    })
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(forecastResponse)
            });
        });
        // Freeze time to 2026-06-07T12:00:00+09:00 = 03:00:00Z
        jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-07T03:00:00Z"));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("returns weather as Japanese label 2 hours later", async () => {
        const block = new blockClass(runtime);
        const result = await block.getForecast({ITEM: "weather", HOURS: 2, ZIP: "100-0001"});
        expect(result).toBe("雨"); // index 2 -> weather_code 63
    });

    test("returns temperature 1 hour later", async () => {
        const block = new blockClass(runtime);
        const result = await block.getForecast({ITEM: "temperature", HOURS: 1, ZIP: "100-0001"});
        expect(result).toBe(21);
    });

    test("returns wind speed and precipitation", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "windspeed", HOURS: 0, ZIP: "100-0001"})).toBe(1.5);
        expect(await block.getForecast({ITEM: "precipitation", HOURS: 2, ZIP: "100-0001"})).toBe(60);
    });

    test("returns relative humidity and pressure", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "humidity", HOURS: 1, ZIP: "100-0001"})).toBe(60);
        expect(await block.getForecast({ITEM: "pressure", HOURS: 2, ZIP: "100-0001"})).toBe(998.7);
    });

    test("returns precipitation amount in mm (including 0)", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "precipAmount", HOURS: 0, ZIP: "100-0001"})).toBe(0);
        expect(await block.getForecast({ITEM: "precipAmount", HOURS: 2, ZIP: "100-0001"})).toBe(3.2);
    });

    test("returns UV index rounded to one decimal", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "uvIndex", HOURS: 0, ZIP: "100-0001"})).toBe(0);
        expect(await block.getForecast({ITEM: "uvIndex", HOURS: 1, ZIP: "100-0001"})).toBe(2.4);
        expect(await block.getForecast({ITEM: "uvIndex", HOURS: 2, ZIP: "100-0001"})).toBe(6.6);
    });

    test("returns wind direction as a Japanese compass label", async () => {
        const block = new blockClass(runtime);
        // index 0 -> 0deg -> 北, index 1 -> 90deg -> 東, index 2 -> 45deg -> 北東
        expect(await block.getForecast({ITEM: "winddir", HOURS: 0, ZIP: "100-0001"})).toBe("北");
        expect(await block.getForecast({ITEM: "winddir", HOURS: 1, ZIP: "100-0001"})).toBe("東");
        expect(await block.getForecast({ITEM: "winddir", HOURS: 2, ZIP: "100-0001"})).toBe("北東");
    });

    test("hedges light rain the model is reporting sub-grid", async () => {
        const block = new blockClass(runtime);
        const hour = {...forecastResponse.hourly};
        try {
            // Trace rain under a mostly open sky: patchy within the grid cell,
            // and wrong about nine times in ten if stated flatly at one point.
            forecastResponse.hourly = {
                ...hour, weather_code: [51], cloud_cover: [30], precipitation: [0.1],
                time: ["2026-06-07T12:00"]
            };
            expect(await block.getForecast({ITEM: "weather", HOURS: 0, ZIP: "100-0001"}))
                .toBe("晴れ所により小雨");

            // Same code with a real rate under a cloudy sky is stated outright.
            forecastResponse.hourly = {
                ...hour, weather_code: [51], cloud_cover: [95], precipitation: [0.5],
                time: ["2026-06-07T12:00"]
            };
            expect(await block.getForecast({ITEM: "weather", HOURS: 0, ZIP: "100-0001"}))
                .toBe("小雨");

            // Heavier codes are never hedged.
            forecastResponse.hourly = {
                ...hour, weather_code: [95], cloud_cover: [20], precipitation: [0.1],
                time: ["2026-06-07T12:00"]
            };
            expect(await block.getForecast({ITEM: "weather", HOURS: 0, ZIP: "100-0001"}))
                .toBe("雷雨");

            // With no cloud reading there is nothing to hedge with.
            forecastResponse.hourly = {
                ...hour, weather_code: [51], precipitation: [0.1],
                cloud_cover: undefined, time: ["2026-06-07T12:00"]
            };
            expect(await block.getForecast({ITEM: "weather", HOURS: 0, ZIP: "100-0001"}))
                .toBe("小雨");
        } finally {
            forecastResponse.hourly = hour;
        }
    });

    test("returns '' for invalid postal code", async () => {
        const block = new blockClass(runtime);
        const result = await block.getForecast({ITEM: "temperature", HOURS: 1, ZIP: "abc"});
        expect(result).toBe("");
    });

    test("returns estimated WBGT value 2 hours later", async () => {
        const block = new blockClass(runtime);
        // index 2: ta=22, rh=70, sr=800 W/m^2, ws=3.2 -> ~22.2
        const result = await block.getForecast({ITEM: "wbgt", HOURS: 2, ZIP: "100-0001"});
        expect(result).toBeCloseTo(22.2, 1);
    });

    test("returns WBGT danger label 2 hours later", async () => {
        const block = new blockClass(runtime);
        const result = await block.getForecast({ITEM: "wbgtLevel", HOURS: 2, ZIP: "100-0001"});
        expect(result).toBe("caution"); // ~22.2 -> 21..25 band
    });

    test("requests several forecast days of hourly data", async () => {
        const block = new blockClass(runtime);
        await block.getForecast({ITEM: "temperature", HOURS: "1", ZIP: "100-0001"});
        const forecastCall = global.fetch.mock.calls
            .map(call => call[0])
            .find(url => url.startsWith("https://api.open-meteo.com/"));
        expect(forecastCall).toContain("forecast_days=4");
    });

    test("accepts free-typed full-width hours", async () => {
        const block = new blockClass(runtime);
        // "２" (full-width) -> 2 -> index 2 -> temperature 22
        const result = await block.getForecast({ITEM: "temperature", HOURS: "２", ZIP: "100-0001"});
        expect(result).toBe(22);
    });

    test("returns '' for hours outside the forecast window", async () => {
        const block = new blockClass(runtime);
        // only 3 hours of data exist; 50h ahead is far outside -> no value
        const result = await block.getForecast({ITEM: "temperature", HOURS: 50, ZIP: "100-0001"});
        expect(result).toBe("");
    });

    test("returns '' just past the end of the window, not the last hour again", async () => {
        const block = new blockClass(runtime);
        // Data ends at 14:00 (= 2h ahead). Half a grid step past it still counts...
        expect(await block.getForecast({ITEM: "temperature", HOURS: 2.5, ZIP: "100-0001"}))
            .toBe(22);
        // ...but a full hour past the end is outside the window.
        expect(await block.getForecast({ITEM: "temperature", HOURS: 3, ZIP: "100-0001"}))
            .toBe("");
        expect(await block.getForecast({ITEM: "precipAmount", HOURS: 4, ZIP: "100-0001"}))
            .toBe("");
    });

    test("returns '' for non-numeric or negative hours", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "temperature", HOURS: "abc", ZIP: "100-0001"}))
            .toBe("");
        expect(await block.getForecast({ITEM: "temperature", HOURS: -3, ZIP: "100-0001"}))
            .toBe("");
    });
});

describe("computeWbgt", () => {
    test("matches the Ono et al. regression for known inputs", () => {
        // ta=30, rh=70, sr=800 W/m^2 (0.8 kW/m^2), ws=1
        expect(computeWbgt(30, 70, 800, 1)).toBeCloseTo(29.86, 1);
    });

    test("converts solar radiation from W/m^2 to kW/m^2 (no sun -> lower)", () => {
        const sunny = computeWbgt(25, 60, 800, 1);
        const shade = computeWbgt(25, 60, 0, 1);
        expect(sunny).toBeGreaterThan(shade);
    });
});

describe("wbgtLevel", () => {
    test("assigns boundary values to the more severe level", () => {
        expect(wbgtLevel(20.9).id).toBe("weatherForecast.wbgt.safe");
        expect(wbgtLevel(21).id).toBe("weatherForecast.wbgt.caution");
        expect(wbgtLevel(25).id).toBe("weatherForecast.wbgt.warning");
        expect(wbgtLevel(28).id).toBe("weatherForecast.wbgt.severe");
        expect(wbgtLevel(31).id).toBe("weatherForecast.wbgt.danger");
        expect(wbgtLevel(40).id).toBe("weatherForecast.wbgt.danger");
    });
});

describe("getDailyForecast", () => {
    const runtime = {
        formatMessage: msg => msg.default
    };

    const DAILY_DATES = [
        "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18",
        "2026-06-19", "2026-06-20", "2026-06-21"
    ];

    // Hourly codes behind each day, as {all-day base, hour: override}. Only
    // 06:00-18:00 is looked at. Day 0 is the case the daily field gets wrong:
    // drizzle before dawn, clear all day -> daily says 53, the block says 快晴.
    const HOURLY_BY_DAY = [
        {base: 0, at: {0: 51, 1: 51, 2: 53, 3: 51, 4: 51}},
        {base: 3, at: {}},
        {base: 1, at: {13: 63, 14: 63}},
        {base: 1, at: {}},
        {base: 2, at: {}},
        {base: 1, at: {12: 80}},
        {base: 0, at: {15: 95}}
    ];

    // Cloud cover implied by each clear-sky code, so the summary agrees with the
    // codes; precipitating hours get an overcast sky so the rain is believed.
    const CLOUD_FOR_CODE = {0: 5, 1: 30, 2: 70, 3: 95};

    const dailyHourly = () => {
        const time = [];
        const codes = [];
        const clouds = [];
        const pops = [];
        DAILY_DATES.forEach((date, d) => {
            for (let h = 0; h < 24; h++) {
                time.push(`${date}T${String(h).padStart(2, "0")}:00`);
                const spec = HOURLY_BY_DAY[d];
                const code = Object.prototype.hasOwnProperty.call(spec.at, h) ?
                    spec.at[h] :
                    spec.base;
                codes.push(code);
                clouds.push(Object.prototype.hasOwnProperty.call(CLOUD_FOR_CODE, code) ?
                    CLOUD_FOR_CODE[code] :
                    95);
                // Day 0 peaks before dawn and is quiet afterwards, so "today"
                // must not keep reporting the small hours' figure.
                pops.push(d === 0 && h < 6 ? 90 : 20);
            }
        });
        return {
            time: time,
            weather_code: codes,
            cloud_cover: clouds,
            precipitation_probability: pops
        };
    };

    const dailyResponse = {
        utc_offset_seconds: 32400,
        hourly: dailyHourly(),
        daily: {
            time: DAILY_DATES,
            weather_code: [53, 3, 63, 1, 2, 80, 95],
            temperature_2m_max: [28, 29, 25, 30, 31, 27, 26],
            temperature_2m_min: [18, 19, 17, 20, 21, 16, 15],
            precipitation_probability_max: [90, 20, 80, 10, 5, 60, 90],
            precipitation_sum: [0, 1.2, 25.4, 0.3, 0, 8, 40.5],
            sunshine_duration: [43200, 36000, 7200, 23400, 45000, 10800, 0],
            sunrise: [
                "2026-06-15T04:25", "2026-06-16T04:25", "2026-06-17T04:25",
                "2026-06-18T04:26", "2026-06-19T04:26", "2026-06-20T04:26",
                "2026-06-21T04:26"
            ],
            sunset: [
                "2026-06-15T18:58", "2026-06-16T18:59", "2026-06-17T18:59",
                "2026-06-18T19:00", "2026-06-19T19:00", "2026-06-20T19:00",
                "2026-06-21T19:01"
            ]
        }
    };

    beforeEach(() => {
        global.fetch = jest.fn(url => {
            if (url.startsWith("https://geoapi.heartrails.com/")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: {location: [{y: "35.68", x: "139.76"}]}
                    })
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(dailyResponse)
            });
        });
        // The block resolves DAY against the dates in the payload, so "today"
        // has to line up with DAILY_DATES[0]. 2026-06-15T09:00+09:00.
        jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-15T00:00:00Z"));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("returns tomorrow's weather as a Japanese label", async () => {
        const block = new blockClass(runtime);
        const result = await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 1, ZIP: "100-0001"});
        expect(result).toBe("曇り"); // overcast through the whole daytime
    });

    test("summarizes the day from daylight hours, not the 24h maximum", async () => {
        const block = new blockClass(runtime);
        // Day 0 drizzles before dawn and is clear all day. Open-Meteo's daily
        // weather_code is 53 (霧雨); the block must report the daytime instead.
        expect(dailyResponse.daily.weather_code[0]).toBe(53);
        expect(await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 0, ZIP: "100-0001"}))
            .toBe("晴れ");
    });

    test("still reports short but significant weather", async () => {
        const block = new blockClass(runtime);
        // A single 15:00 hour of thunder must not be smoothed away.
        expect(await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 6, ZIP: "100-0001"}))
            .toBe("雷雨");
        expect(await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 5, ZIP: "100-0001"}))
            .toBe("にわか雨（弱）");
    });

    test("falls back to the daily code when hourly codes are missing", async () => {
        const block = new blockClass(runtime);
        const original = dailyResponse.hourly;
        delete dailyResponse.hourly;
        try {
            expect(await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 2, ZIP: "100-0001"}))
                .toBe("雨"); // daily.weather_code[2] === 63
        } finally {
            dailyResponse.hourly = original;
        }
    });

    test("asks for the hourly codes it needs to summarize a day", async () => {
        const block = new blockClass(runtime);
        await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 1, ZIP: "100-0001"});
        const dailyCall = global.fetch.mock.calls
            .map(call => call[0])
            .find(url => url.startsWith("https://api.open-meteo.com/"));
        expect(dailyCall).toContain("hourly=weather_code");
    });

    test("returns today's highest and a later day's lowest temperature", async () => {
        const block = new blockClass(runtime);
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: 0, ZIP: "100-0001"}))
            .toBe(28);
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMin", DAY: 2, ZIP: "100-0001"}))
            .toBe(17);
    });

    test("averages the hourly probabilities instead of taking the peak", async () => {
        const block = new blockClass(runtime);
        // Day 0 is 90% for six hours before dawn and 20% for the other 18.
        // The daily field reports the 90% peak; the mean is the honest figure.
        expect(dailyResponse.daily.precipitation_probability_max[0]).toBe(90);
        expect(await block.getDailyForecast({DAILY_ITEM: "precipitation", DAY: 0, ZIP: "100-0001"}))
            .toBe(38); // (6*90 + 18*20) / 24 = 37.5
    });

    test("gives the same answer whatever time of day it is asked", async () => {
        const block = new blockClass(runtime);
        const readAt = async iso => {
            Date.now.mockReturnValue(Date.parse(iso));
            return block.getDailyForecast({DAILY_ITEM: "precipitation", DAY: 0, ZIP: "100-0001"});
        };
        expect(await readAt("2026-06-15T00:00:00Z")).toBe(38); // 09:00 JST
        expect(await readAt("2026-06-15T06:00:00Z")).toBe(38); // 15:00 JST
        expect(await readAt("2026-06-15T11:00:00Z")).toBe(38); // 20:00 JST
    });

    test("falls back to the daily field when there are no hourly values", async () => {
        const block = new blockClass(runtime);
        const original = dailyResponse.hourly.precipitation_probability;
        delete dailyResponse.hourly.precipitation_probability;
        try {
            expect(await block.getDailyForecast(
                {DAILY_ITEM: "precipitation", DAY: 2, ZIP: "100-0001"}
            )).toBe(80); // daily.precipitation_probability_max[2]
        } finally {
            dailyResponse.hourly.precipitation_probability = original;
        }
    });

    test("returns the average precipitation probability for a later day", async () => {
        const block = new blockClass(runtime);
        // Every hour of day 2 sits at 20%, so the mean is 20 — while
        // Open-Meteo's daily field for that day reports its 80% peak.
        expect(dailyResponse.daily.precipitation_probability_max[2]).toBe(80);
        expect(await block.getDailyForecast({DAILY_ITEM: "precipitation", DAY: 2, ZIP: "100-0001"}))
            .toBe(20);
    });

    test("returns precipitation amount in mm (including 0)", async () => {
        const block = new blockClass(runtime);
        expect(await block.getDailyForecast({DAILY_ITEM: "precipAmount", DAY: 0, ZIP: "100-0001"}))
            .toBe(0);
        expect(await block.getDailyForecast({DAILY_ITEM: "precipAmount", DAY: 2, ZIP: "100-0001"}))
            .toBe(25.4);
    });

    test("returns sunshine duration converted from seconds to hours", async () => {
        const block = new blockClass(runtime);
        // 43200 s -> 12 h, 23400 s -> 6.5 h, 0 s -> 0 h
        expect(await block.getDailyForecast({DAILY_ITEM: "sunshine", DAY: 0, ZIP: "100-0001"}))
            .toBe(12);
        expect(await block.getDailyForecast({DAILY_ITEM: "sunshine", DAY: 3, ZIP: "100-0001"}))
            .toBe(6.5);
        expect(await block.getDailyForecast({DAILY_ITEM: "sunshine", DAY: 6, ZIP: "100-0001"}))
            .toBe(0);
    });

    test("returns sunrise and sunset as HH:MM", async () => {
        const block = new blockClass(runtime);
        expect(await block.getDailyForecast({DAILY_ITEM: "sunrise", DAY: 0, ZIP: "100-0001"}))
            .toBe("04:25");
        expect(await block.getDailyForecast({DAILY_ITEM: "sunset", DAY: 6, ZIP: "100-0001"}))
            .toBe("19:01");
    });

    test("returns '' for a day outside the forecast window", async () => {
        const block = new blockClass(runtime);
        expect(await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 7, ZIP: "100-0001"}))
            .toBe("");
        expect(await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 10, ZIP: "100-0001"}))
            .toBe("");
    });

    test("keeps DAY anchored to today when a cached payload outlives midnight", async () => {
        const block = new blockClass(runtime);
        // Warm the cache at 23:59 JST on 06-15, when the payload starts at 06-15.
        Date.now.mockReturnValue(Date.parse("2026-06-15T14:59:00Z"));
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: 0, ZIP: "100-0001"}))
            .toBe(28); // 06-15

        // Midnight passes. The cached payload now starts at *yesterday*, so
        // trusting array position would report 06-15 as "today".
        Date.now.mockReturnValue(Date.parse("2026-06-15T15:01:00Z"));
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: 0, ZIP: "100-0001"}))
            .toBe(29); // 06-16
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: 1, ZIP: "100-0001"}))
            .toBe(25); // 06-17
        // The last row of the stale payload is no longer a full week out.
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: 6, ZIP: "100-0001"}))
            .toBe("");
    });

    test("returns '' when the payload has no timezone offset", async () => {
        const block = new blockClass(runtime);
        const original = dailyResponse.utc_offset_seconds;
        delete dailyResponse.utc_offset_seconds;
        try {
            expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: 0, ZIP: "100-0001"}))
                .toBe("");
        } finally {
            dailyResponse.utc_offset_seconds = original;
        }
    });

    test("returns '' for a negative day that rounds to zero", async () => {
        const block = new blockClass(runtime);
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: -0.4, ZIP: "100-0001"}))
            .toBe("");
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: -1, ZIP: "100-0001"}))
            .toBe("");
    });

    test("accepts free-typed full-width day", async () => {
        const block = new blockClass(runtime);
        // "２" (full-width) -> day index 2 -> weather_code 63 -> 雨
        const result = await block.getDailyForecast({DAILY_ITEM: "weather", DAY: "２", ZIP: "100-0001"});
        expect(result).toBe("雨");
    });

    test("returns '' for non-numeric day", async () => {
        const block = new blockClass(runtime);
        const result = await block.getDailyForecast({DAILY_ITEM: "weather", DAY: "abc", ZIP: "100-0001"});
        expect(result).toBe("");
    });

    test("returns '' for invalid postal code", async () => {
        const block = new blockClass(runtime);
        const result = await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 1, ZIP: "abc"});
        expect(result).toBe("");
    });

    test("requests daily variables over a weekly window", async () => {
        const block = new blockClass(runtime);
        await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 1, ZIP: "100-0001"});
        const dailyCall = global.fetch.mock.calls
            .map(call => call[0])
            .find(url => url.startsWith("https://api.open-meteo.com/"));
        expect(dailyCall).toContain("forecast_days=7");
        expect(dailyCall).toContain("daily=");
    });
});

describe("getPlaceName", () => {
    const runtime = {
        formatMessage: msg => msg.default
    };

    const zipResponse = {
        response: {
            location: [{
                prefecture: "東京都",
                city: "千代田区",
                town: "千代田",
                x: "139.753336",
                y: "35.684473"
            }]
        }
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const mockFetch = zip => jest.fn(() =>
        Promise.resolve({ok: true, json: () => Promise.resolve(zip)})
    );

    test("returns the Japanese place name for the postal code", async () => {
        global.fetch = mockFetch(zipResponse);
        const block = new blockClass(runtime);
        const result = await block.getPlaceName({ZIP: "100-0001"});
        expect(result).toBe("東京都千代田区");
    });

    test("resolves postal codes with a leading zero", async () => {
        const sapporo = {
            response: {
                location: [{
                    prefecture: "北海道",
                    city: "札幌市厚別区",
                    town: "（その他）",
                    x: "141.473243",
                    y: "43.047671"
                }]
            }
        };
        global.fetch = mockFetch(sapporo);
        const block = new blockClass(runtime);
        const result = await block.getPlaceName({ZIP: "004-0000"});
        expect(result).toBe("北海道札幌市厚別区");
        // The API expects the 7 digits without a hyphen, zeros preserved.
        expect(global.fetch.mock.calls[0][0]).toContain("postal=0040000");
    });

    test("returns '' for invalid postal code", async () => {
        global.fetch = jest.fn();
        const block = new blockClass(runtime);
        expect(await block.getPlaceName({ZIP: "abc"})).toBe("");
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("returns '' when the postal code is not found", async () => {
        // HeartRails reports unknown codes as an error object without "location".
        global.fetch = mockFetch({response: {error: "Cities of postal code:'9999999' do not exist."}});
        const block = new blockClass(runtime);
        expect(await block.getPlaceName({ZIP: "999-9999"})).toBe("");
    });
});

describe("failure caching", () => {
    const runtime = {
        formatMessage: msg => msg.default
    };

    const forecastResponse = {
        utc_offset_seconds: 32400,
        hourly: {
            time: ["2026-06-07T12:00", "2026-06-07T13:00", "2026-06-07T14:00"],
            temperature_2m: [20, 21, 22]
        }
    };

    let now;
    let geoCalls;
    let forecastCalls;
    let geoFails;
    let forecastFails;

    beforeEach(() => {
        now = Date.parse("2026-06-07T03:00:00Z"); // 12:00 JST
        geoCalls = 0;
        forecastCalls = 0;
        geoFails = false;
        forecastFails = false;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        global.fetch = jest.fn(url => {
            if (url.startsWith("https://geoapi.heartrails.com/")) {
                geoCalls++;
                if (geoFails) return Promise.reject(new Error("offline"));
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: {
                            location: [{
                                y: "35.68", x: "139.76",
                                prefecture: "東京都", city: "千代田区"
                            }]
                        }
                    })
                });
            }
            forecastCalls++;
            // Open-Meteo answers 429 when the shared classroom IP is rate limited.
            if (forecastFails) return Promise.resolve({ok: false, status: 429});
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(forecastResponse)
            });
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("a failed postal-code lookup is retried instead of sticking forever", async () => {
        const block = new blockClass(runtime);
        geoFails = true;
        expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("");
        expect(geoCalls).toBe(1);

        // Inside the failure TTL the request is throttled, so a `forever` loop
        // cannot hammer the API.
        now += 5 * 1000;
        expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("");
        expect(geoCalls).toBe(1);

        // Past the failure TTL it retries and recovers.
        now += 20 * 1000;
        geoFails = false;
        expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("東京都千代田区");
        expect(geoCalls).toBe(2);
    });

    test("a resolved postal code stays cached for the whole session", async () => {
        const block = new blockClass(runtime);
        expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("東京都千代田区");
        now += 60 * 60 * 1000;
        expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("東京都千代田区");
        expect(geoCalls).toBe(1);
    });

    test("a rate-limited forecast is retried in seconds, not after the full TTL", async () => {
        const block = new blockClass(runtime);
        forecastFails = true;
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe("");
        expect(forecastCalls).toBe(1);

        now += 5 * 1000;
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe("");
        expect(forecastCalls).toBe(1);

        now += 20 * 1000;
        forecastFails = false;
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe(20);
        expect(forecastCalls).toBe(2);
    });

    test("a successful forecast is still cached for the full TTL", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe(20);
        now += 9 * 60 * 1000;
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe(20);
        expect(forecastCalls).toBe(1);

        now += 2 * 60 * 1000; // past FORECAST_TTL
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe(20);
        expect(forecastCalls).toBe(2);
    });
});

describe("menu slots fed by a reporter block", () => {
    const runtime = {
        formatMessage: msg => msg.default
    };

    const forecastResponse = {
        utc_offset_seconds: 32400,
        hourly: {
            time: ["2026-06-07T12:00"],
            temperature_2m: [20],
            precipitation: [1.5]
        }
    };

    beforeEach(() => {
        jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-07T03:00:00Z"));
        global.fetch = jest.fn(url => {
            if (url.startsWith("https://geoapi.heartrails.com/")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: {location: [{y: "35.68", x: "139.76"}]}
                    })
                });
            }
            return Promise.resolve({ok: true, json: () => Promise.resolve(forecastResponse)});
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // The menus set acceptReporters, so a reporter can be dropped in — and what
    // it supplies is the visible label, not the internal value.
    test("accepts the label the user can see, in any locale", async () => {
        const block = new blockClass(runtime);
        for (const label of ["temperature", "気温", "きおん"]) {
            expect(await block.getForecast({ITEM: label, HOURS: 0, ZIP: "100-0001"}))
                .toBe(20);
        }
    });

    test("tolerates stray whitespace from join blocks", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: " 降水量 ", HOURS: 0, ZIP: "100-0001"}))
            .toBe(1.5);
    });

    test("still reports '' for something that is not a menu item", async () => {
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "でたらめ", HOURS: 0, ZIP: "100-0001"}))
            .toBe("");
    });
});

describe("hostile API responses", () => {
    const runtime = {
        formatMessage: msg => msg.default
    };

    const hourlyOf = values => ({
        utc_offset_seconds: 32400,
        hourly: {
            time: ["2026-06-15T12:00"],
            temperature_2m: [values],
            relative_humidity_2m: [values],
            pressure_msl: [values],
            precipitation_probability: [values],
            precipitation: [values],
            weather_code: [values],
            wind_speed_10m: [values],
            wind_direction_10m: [values],
            shortwave_radiation: [values],
            uv_index: [values]
        }
    });

    const HOURLY_ITEMS = [
        "weather", "temperature", "humidity", "pressure", "precipitation",
        "precipAmount", "windspeed", "winddir", "wbgt", "wbgtLevel", "uvIndex"
    ];

    let payload;

    beforeEach(() => {
        jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-15T03:00:00Z"));
        global.fetch = jest.fn(url => {
            if (url.startsWith("https://geoapi.heartrails.com/")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: {location: [{y: "35.68", x: "139.76"}]}
                    })
                });
            }
            return Promise.resolve({ok: true, json: () => Promise.resolve(payload)});
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // A reporter must always hand Scratch a string or a finite number; describe
    // whatever came back so a failure names the offending value.
    const renderable = value => (
        (typeof value === "string") || (typeof value === "number" && Number.isFinite(value)) ?
            "renderable" :
            `${typeof value} ${String(value)}`
    );

    [
        ["objects", {}],
        ["arrays", []],
        ["booleans", true],
        ["non-numeric strings", "n/a"],
        ["empty strings", ""],
        ["nulls", null]
    ].forEach(([label, value]) => {
        test(`never returns NaN or a raw object when fields are ${label}`, async () => {
            payload = hourlyOf(value);
            const block = new blockClass(runtime);
            for (const item of HOURLY_ITEMS) {
                const result = await block.getForecast({ITEM: item, HOURS: 0, ZIP: "100-0001"});
                expect(`${item}: ${renderable(result)}`).toBe(`${item}: renderable`);
            }
        });
    });

    test("reports '' rather than a 9-hour-shifted reading when the offset is missing", async () => {
        payload = hourlyOf(20);
        delete payload.utc_offset_seconds;
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe("");
    });

    test("accepts numeric strings from the API as numbers", async () => {
        payload = hourlyOf("21.5");
        const block = new blockClass(runtime);
        expect(await block.getForecast({ITEM: "temperature", HOURS: 0, ZIP: "100-0001"}))
            .toBe(21.5);
    });
});

describe("postal-code coordinates", () => {
    const runtime = {
        formatMessage: msg => msg.default
    };

    const lookupWith = place => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({response: {location: [place]}})
        }));
        return new blockClass(runtime);
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("rejects blank coordinates instead of forecasting lat 0 / lon 0", async () => {
        for (const blank of ["", " ", null, false, []]) {
            const block = lookupWith({y: blank, x: blank, prefecture: "東京都", city: "千代田区"});
            expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("");
        }
    });

    test("rejects coordinates outside Japan", async () => {
        const block = lookupWith({y: "0", x: "0", prefecture: "東京都", city: "千代田区"});
        expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("");
    });

    test("accepts a normal Japanese coordinate", async () => {
        const block = lookupWith({
            y: "35.684473", x: "139.753336", prefecture: "東京都", city: "千代田区"
        });
        expect(await block.getPlaceName({ZIP: "100-0001"})).toBe("東京都千代田区");
    });
});

describe("windDirectionToJa", () => {
    test("maps degrees to 16-point compass labels", () => {
        expect(windDirectionToJa(0)).toBe("北");
        expect(windDirectionToJa(45)).toBe("北東");
        expect(windDirectionToJa(90)).toBe("東");
        expect(windDirectionToJa(180)).toBe("南");
        expect(windDirectionToJa(270)).toBe("西");
        expect(windDirectionToJa(360)).toBe("北"); // wraps around
        expect(windDirectionToJa(338)).toBe("北北西");
    });

    test("returns '' for missing values", () => {
        expect(windDirectionToJa(null)).toBe("");
        expect(windDirectionToJa(undefined)).toBe("");
        expect(windDirectionToJa("")).toBe("");
    });

    test("returns '' for non-numeric values instead of the string 'undefined'", () => {
        // NaN would index the compass table with NaN and leak `undefined`.
        expect(windDirectionToJa("abc")).toBe("");
        expect(windDirectionToJa(NaN)).toBe("");
        expect(windDirectionToJa(Infinity)).toBe("");
        expect(windDirectionToJa({})).toBe("");
    });
});

describe("getInfo", () => {
    const formatMessage = msg => msg.default;
    formatMessage.setup = () => null; // skip translation merge in setupTranslations
    const runtime = {formatMessage};

    test("uses free numeric input with defaults of 0 for hours and day", () => {
        const block = new blockClass(runtime);
        const blocks = block.getInfo().blocks;
        const forecast = blocks.find(b => b.opcode === "getForecast");
        const daily = blocks.find(b => b.opcode === "getDailyForecast");
        // free input -> NUMBER type, no menu
        expect(forecast.arguments.HOURS.menu).toBeUndefined();
        expect(forecast.arguments.HOURS.defaultValue).toBe(0);
        expect(daily.arguments.DAY.menu).toBeUndefined();
        expect(daily.arguments.DAY.defaultValue).toBe(0);
    });

    test("no longer defines the hours/day dropdown menus", () => {
        const block = new blockClass(runtime);
        const menus = block.getInfo().menus;
        expect(menus.hoursMenu).toBeUndefined();
        expect(menus.dayMenu).toBeUndefined();
    });

    test("defaults the hourly item selector to weather", () => {
        const block = new blockClass(runtime);
        const forecastBlock = block.getInfo().blocks.find(b => b.opcode === "getForecast");
        expect(forecastBlock.arguments.ITEM.defaultValue).toBe("weather");
    });

    test("lists item menu in the requested order", () => {
        const block = new blockClass(runtime);
        const values = block.getInfo().menus.itemMenu.items.map(item => item.value);
        expect(values).toEqual([
            "weather", "temperature", "humidity", "pressure",
            "precipitation", "precipAmount", "windspeed", "winddir",
            "wbgt", "wbgtLevel", "uvIndex"
        ]);
    });

    test("lists daily item menu in the requested order", () => {
        const block = new blockClass(runtime);
        const values = block.getInfo().menus.dailyItemMenu.items.map(item => item.value);
        expect(values).toEqual([
            "weather", "tempMax", "tempMin", "precipitation",
            "precipAmount", "sunrise", "sunset", "sunshine"
        ]);
    });

    test("exposes the hourly, weekly and place-name blocks", () => {
        const block = new blockClass(runtime);
        const opcodes = block.getInfo().blocks.map(b => b.opcode);
        expect(opcodes).toEqual(["getForecast", "getDailyForecast", "getPlaceName"]);
    });

    test("frames forecasts as 'near' the postal code, not exact", () => {
        const block = new blockClass(runtime);
        const texts = block.getInfo().blocks.map(b => b.text);
        expect(texts[0]).toContain("near zip");
        expect(texts[1]).toContain("near zip");
    });
});

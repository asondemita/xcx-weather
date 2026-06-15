import {
    blockClass,
    weatherCodeToJa,
    normalizeZip,
    computeWbgt,
    wbgtLevel,
    windDirectionToJa
} from "../../src/vm/extensions/block/index.js";

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
            precipitation_probability: [10, 30, 60],
            weather_code: [0, 3, 63],
            wind_speed_10m: [1.5, 2.0, 3.2],
            wind_direction_10m: [0, 90, 45],
            shortwave_radiation: [0, 200, 800]
        }
    };

    beforeEach(() => {
        global.fetch = jest.fn(url => {
            if (url.startsWith("https://api.zippopotam.us/")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        places: [{latitude: "35.68", longitude: "139.76"}]
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

    test("returns wind direction as a Japanese compass label", async () => {
        const block = new blockClass(runtime);
        // index 0 -> 0deg -> 北, index 1 -> 90deg -> 東, index 2 -> 45deg -> 北東
        expect(await block.getForecast({ITEM: "winddir", HOURS: 0, ZIP: "100-0001"})).toBe("北");
        expect(await block.getForecast({ITEM: "winddir", HOURS: 1, ZIP: "100-0001"})).toBe("東");
        expect(await block.getForecast({ITEM: "winddir", HOURS: 2, ZIP: "100-0001"})).toBe("北東");
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

    test("requests enough forecast days to cover the longest menu option", async () => {
        const block = new blockClass(runtime);
        await block.getForecast({ITEM: "temperature", HOURS: "1", ZIP: "100-0001"});
        const forecastCall = global.fetch.mock.calls
            .map(call => call[0])
            .find(url => url.startsWith("https://api.open-meteo.com/"));
        expect(forecastCall).toContain("forecast_days=4");
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

    const dailyResponse = {
        daily: {
            time: [
                "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18",
                "2026-06-19", "2026-06-20", "2026-06-21"
            ],
            weather_code: [0, 3, 63, 1, 2, 80, 95],
            temperature_2m_max: [28, 29, 25, 30, 31, 27, 26],
            temperature_2m_min: [18, 19, 17, 20, 21, 16, 15],
            precipitation_probability_max: [0, 20, 80, 10, 5, 60, 90],
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
            if (url.startsWith("https://api.zippopotam.us/")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        places: [{latitude: "35.68", longitude: "139.76"}]
                    })
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(dailyResponse)
            });
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("returns tomorrow's weather as a Japanese label", async () => {
        const block = new blockClass(runtime);
        const result = await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 1, ZIP: "100-0001"});
        expect(result).toBe("曇り"); // weather_code[1] === 3
    });

    test("returns today's highest and a later day's lowest temperature", async () => {
        const block = new blockClass(runtime);
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMax", DAY: 0, ZIP: "100-0001"}))
            .toBe(28);
        expect(await block.getDailyForecast({DAILY_ITEM: "tempMin", DAY: 2, ZIP: "100-0001"}))
            .toBe(17);
    });

    test("returns max precipitation probability for a day", async () => {
        const block = new blockClass(runtime);
        const result = await block.getDailyForecast(
            {DAILY_ITEM: "precipitation", DAY: 2, ZIP: "100-0001"}
        );
        expect(result).toBe(80);
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
        const result = await block.getDailyForecast({DAILY_ITEM: "weather", DAY: 10, ZIP: "100-0001"});
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
        places: [{
            "place name": "Chiyoda",
            state: "Toukyouto",
            latitude: "35.6845",
            longitude: "139.7559"
        }]
    };

    // Two "Chiyoda" results; the Tokyo one is nearest to the zip coordinates.
    const geocodeResponse = {
        results: [
            {
                name: "千代田区", admin1: "東京都", country_code: "JP",
                latitude: 35.68449, longitude: 139.75056
            },
            {
                name: "千代田", admin1: "北海道", country_code: "JP",
                latitude: 44.09222, longitude: 143.40056
            }
        ]
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const mockFetch = geocode => jest.fn(url => {
        if (url.startsWith("https://api.zippopotam.us/")) {
            return Promise.resolve({ok: true, json: () => Promise.resolve(zipResponse)});
        }
        return Promise.resolve({ok: true, json: () => Promise.resolve(geocode)});
    });

    test("returns the Japanese place name nearest to the coordinates", async () => {
        global.fetch = mockFetch(geocodeResponse);
        const block = new blockClass(runtime);
        const result = await block.getPlaceName({ZIP: "100-0001"});
        expect(result).toBe("東京都千代田区");
    });

    test("falls back to the romaji name when geocoding finds nothing", async () => {
        global.fetch = mockFetch({results: []});
        const block = new blockClass(runtime);
        const result = await block.getPlaceName({ZIP: "100-0001"});
        expect(result).toBe("Toukyouto Chiyoda");
    });

    test("returns '' for invalid postal code", async () => {
        global.fetch = jest.fn();
        const block = new blockClass(runtime);
        expect(await block.getPlaceName({ZIP: "abc"})).toBe("");
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("returns '' when the postal code is not found", async () => {
        global.fetch = jest.fn(url => {
            if (url.startsWith("https://api.zippopotam.us/")) {
                return Promise.resolve({ok: true, json: () => Promise.resolve({places: []})});
            }
            return Promise.resolve({ok: true, json: () => Promise.resolve({results: []})});
        });
        const block = new blockClass(runtime);
        expect(await block.getPlaceName({ZIP: "999-9999"})).toBe("");
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
});

describe("getInfo hoursMenu", () => {
    const formatMessage = msg => msg.default;
    formatMessage.setup = () => null; // skip translation merge in setupTranslations
    const runtime = {formatMessage};

    test("offers a fixed, reporter-free dropdown of in-range hours", () => {
        const block = new blockClass(runtime);
        const hoursMenu = block.getInfo().menus.hoursMenu;
        expect(hoursMenu.acceptReporters).toBe(false);
        const values = hoursMenu.items.map(item => item.value);
        expect(values).toEqual(["0", "1", "2", "3", "6", "12", "24", "48"]);
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
            "weather", "temperature", "precipitation",
            "windspeed", "winddir", "wbgt", "wbgtLevel"
        ]);
    });

    test("lists daily item menu in the requested order", () => {
        const block = new blockClass(runtime);
        const values = block.getInfo().menus.dailyItemMenu.items.map(item => item.value);
        expect(values).toEqual([
            "weather", "tempMax", "tempMin", "precipitation", "sunrise", "sunset"
        ]);
    });

    test("offers a fixed, reporter-free dropdown of weekly days", () => {
        const block = new blockClass(runtime);
        const dayMenu = block.getInfo().menus.dayMenu;
        expect(dayMenu.acceptReporters).toBe(false);
        const values = dayMenu.items.map(item => item.value);
        expect(values).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
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

import { describe, it, expect } from "vitest";
import { weatherOutlook, type WeatherKind } from "../../src/sim/environment/weather";
import type { Season } from "../../src/sim/environment/season";
import { WEATHER_MATRIX } from "../../src/sim/params";

const SEASONS: Season[] = ["SPRING", "SUMMER", "AUTTMN", "WINTER"];
const KINDS: WeatherKind[] = ["CLEAR", "RAIN", "SNOW", "HEAT", "WIND"];

describe("weatherOutlook", () => {
    it("is a proper probability distribution for every season and weather", () => {
        for (const season of SEASONS) {
            for (const kind of KINDS) {
                const outlook = weatherOutlook(season, kind);
                const sum = outlook.reduce((total, o) => total + o.probability, 0);
                expect(sum).toBeCloseTo(1, 10);
                for (const o of outlook) expect(o.probability).toBeGreaterThan(0);
            }
        }
    });

    it("lists the most likely outcome first", () => {
        for (const season of SEASONS) {
            for (const kind of KINDS) {
                const probabilities = weatherOutlook(season, kind).map((o) => o.probability);
                expect(probabilities).toEqual([...probabilities].sort((a, b) => b - a));
            }
        }
    });

    it("reports exactly the odds the sim rolls against, and leaves out impossible outcomes", () => {
        const outlook = weatherOutlook("SPRING", "CLEAR");
        expect(outlook.map((o) => o.kind)).toEqual(["CLEAR", "RAIN", "WIND"]);
        expect(outlook[0].probability).toBeCloseTo(WEATHER_MATRIX.SPRING.CLEAR.CLEAR, 10);
        expect(outlook[1].probability).toBeCloseTo(WEATHER_MATRIX.SPRING.CLEAR.RAIN, 10);
        // Snow can't follow clear weather in spring.
        expect(outlook.some((o) => o.kind === "SNOW")).toBe(false);
    });

    it("is not a repeat of one outcome: it varies with the weather it follows", () => {
        expect(weatherOutlook("WINTER", "SNOW")[0].kind).toBe("SNOW");
        expect(weatherOutlook("WINTER", "CLEAR").map((o) => o.kind)).toContain("SNOW");
        expect(weatherOutlook("SPRING", "HEAT")).toEqual([{ kind: "CLEAR", probability: 1 }]);
    });
});

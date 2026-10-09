// Single source of truth for "what color is season X" — shared by
// surface-view.ts (ground/patch/grass), props.ts (tree foliage), and
// sky.ts (sky gradient), so a visitor sees one consistent seasonal palette
// across the ground, the trees standing on it, and the sky above it,
// instead of three separate places drifting out of sync with each other.
import type { Season } from "../../sim/environment/season";

export type FoliagePair = { main: string; highlight: string };

export type SeasonPalette = {
    groundColor: string;
    patchColor: string;
    grassBladeColor: string;
    // One or more tint pairs, cycled across tree clusters (props.ts) — most
    // seasons use a single uniform tint, but autumn trees turning uniformly
    // orange reads as flat/artificial, so autumn gets a few different
    // variants ("fall they should be different colors").
    treeFoliage: FoliagePair[];
    skyTop: string;
    skyHorizon: string;
};

export const SEASON_PALETTE: Record<Season, SeasonPalette> = {
    SPRING: {
        groundColor: "#8fc25f",
        patchColor: "#6fa04a",
        grassBladeColor: "#4f8a3f",
        treeFoliage: [{ main: "#5a9c48", highlight: "#7cc264" }],
        skyTop: "#7fc8f0",
        skyHorizon: "#e3f5f2",
    },
    SUMMER: {
        groundColor: "#7fae52",
        patchColor: "#5f9142",
        grassBladeColor: "#3f6b35",
        treeFoliage: [{ main: "#3f6b35", highlight: "#588c47" }],
        skyTop: "#5aa8e8",
        skyHorizon: "#cfe8f7",
    },
    // env.season's real value is the misspelled "AUTTMN" (sim/environment/
    // season.ts) — matched here rather than renamed, same reasoning as
    // ui/control-panel.ts's SEASON_LABEL.
    AUTTMN: {
        groundColor: "#a6863f",
        patchColor: "#8a6a2e",
        grassBladeColor: "#b06a2a",
        treeFoliage: [
            { main: "#b5451f", highlight: "#d97a3f" },
            { main: "#c9772e", highlight: "#e0a53f" },
            { main: "#c99a17", highlight: "#e8c34a" },
        ],
        skyTop: "#8fa0c0",
        skyHorizon: "#f0c896",
    },
    WINTER: {
        groundColor: "#e4ecf0",
        patchColor: "#cfdbe2",
        grassBladeColor: "#c8d4da",
        // "for winter just make the trees white" — one flat snow-covered tint.
        treeFoliage: [{ main: "#f2f6f8", highlight: "#ffffff" }],
        skyTop: "#b8c8d8",
        skyHorizon: "#e8eef2",
    },
};

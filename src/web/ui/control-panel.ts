// PHASE 12f: one dock replacing every scattered fixed-position control that
// used to exist independently — the Reset view / Show trails buttons
// (view-switch.ts), the Show/Hide stats button + dashboard panel
// (weather-hud.ts), the always-on time/season/weather readout
// (ui/env-hud.ts, now folded in here as the env strip), and main.ts's
// TEMPORARY fast-forward button (removed outright — see main.ts's header).
// One corner element, one place a visitor looks for "what can I do here."
//
// Mounted once by main.ts (which owns `state`/`stats`, the only two things
// this needs live data from) and updated on the sim's own tick cadence via
// update() — nothing here needs a full animation-frame refresh rate, same
// reasoning the old weather-hud.ts's 250ms setInterval used, just riding
// the tick loop instead of running a second timer for it.
import type { ColonyState } from "../../sim/state";
import type { TuningStats } from "../main";
import { buildStatsSections } from "./dashboard-stats";
import { mountAntInfo } from "./ant-info";

const TRAILS_KEY = "ant-farm-show-trails";
const PATCHES_KEY = "ant-farm-show-patches";
const CHAMBER_COLORS_KEY = "ant-farm-show-chamber-colors";
const DASHBOARD_KEY = "ant-farm-show-dashboard";

function readStoredBool(key: string, fallback: boolean): boolean {
    try {
        const stored = localStorage.getItem(key);
        return stored === "true" || stored === "false" ? stored === "true" : fallback;
    } catch {
        // localStorage can throw (private browsing, disabled storage) —
        // falling back to the default is harmless here.
        return fallback;
    }
}

function writeStoredBool(key: string, value: boolean): void {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // Not worth surfacing — losing a persisted toggle isn't a real error.
    }
}

// A live getter object, not a plain snapshot — render code reads these
// fresh every frame/tile, so a toggle click needs to be visible immediately
// without threading a new object through the whole render call chain.
export type RenderOptions = {
    readonly showTrails: boolean;
    readonly showPatches: boolean;
    readonly showChamberColors: boolean;
};

export type ControlPanel = {
    renderOptions: RenderOptions;
    onResetView: (handler: () => void) => void;
    update: (state: ColonyState, stats: TuningStats) => void;
};

const TIME_COLOR: Record<ColonyState["env"]["timeOfDay"], string> = {
    DAWN: "#ffaf78",
    DAY: "#ffe58a",
    DUSK: "#ff6a46",
    NIGHT: "#4a5a9a",
};
const SEASON_COLOR: Record<ColonyState["env"]["season"], string> = {
    SPRING: "#8fd48f",
    SUMMER: "#ffd76a",
    AUTTMN: "#d98a3d",
    WINTER: "#a8c8e8",
};
const SEASON_LABEL: Record<ColonyState["env"]["season"], string> = {
    SPRING: "SPRING",
    SUMMER: "SUMMER",
    AUTTMN: "AUTUMN", // env.season is misspelled ("AUTTMN") — the visitor-facing label isn't
    WINTER: "WINTER",
};
const WEATHER_COLOR: Record<ColonyState["env"]["weather"]["kind"], string> = {
    CLEAR: "#cfe8f7",
    RAIN: "#6a93b0",
    SNOW: "#e8f0f7",
    HEAT: "#e0793a",
    WIND: "#b8c4b0",
};

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
        .ant-farm-panel {
            position: fixed;
            top: 0.6rem;
            left: 0.6rem;
            z-index: 1000;
            width: min(20rem, calc(100vw - 1.2rem));
            max-height: calc(100vh - 1.2rem);
            overflow-y: auto;
            transition: width 0.15s ease;
            background: rgba(26, 20, 12, 0.82);
            border: 1px solid rgba(200, 184, 152, 0.4);
            border-radius: 8px;
            color: #f0e6d2;
            font: 13px/1.4 sans-serif;
            padding: 0.6rem 0.7rem;
        }
        .ant-farm-panel--wide {
            width: min(38rem, calc(100vw - 1.2rem));
        }
        .ant-farm-panel-title-row {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.5rem;
        }
        .ant-farm-panel-title {
            font-family: Georgia, "Times New Roman", serif;
            font-size: 1.05rem;
            line-height: 1.2;
        }
        .ant-farm-panel-subtitle {
            font-size: 0.7rem;
            color: #c8b898;
            margin-top: 0.15rem;
        }
        .ant-farm-panel-icon-btn {
            flex: none;
            width: 1.4rem;
            height: 1.4rem;
            border-radius: 50%;
            border: 1px solid rgba(200, 184, 152, 0.5);
            background: rgba(240, 230, 210, 0.08);
            color: #f0e6d2;
            font: italic 600 0.8rem Georgia, serif;
            cursor: pointer;
            padding: 0;
        }
        .ant-farm-panel-icon-btn:hover {
            background: rgba(240, 230, 210, 0.18);
        }
        .ant-farm-panel-env {
            display: flex;
            flex-direction: column;
            gap: 0.2rem;
            margin-top: 0.6rem;
            font-size: 0.75rem;
        }
        .ant-farm-panel-env-row {
            display: flex;
            align-items: center;
            gap: 0.35rem;
        }
        .ant-farm-panel-dot {
            width: 0.55rem;
            height: 0.55rem;
            border-radius: 50%;
            flex: none;
        }
        .ant-farm-panel-controls {
            display: flex;
            flex-wrap: wrap;
            gap: 0.35rem;
            margin-top: 0.65rem;
        }
        .ant-farm-panel-btn {
            font: 0.72rem sans-serif;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            border: 1px solid rgba(200, 184, 152, 0.4);
            background: rgba(240, 230, 210, 0.06);
            color: #f0e6d2;
            cursor: pointer;
        }
        .ant-farm-panel-btn:hover {
            background: rgba(240, 230, 210, 0.15);
        }
        .ant-farm-panel-btn[aria-pressed="true"] {
            background: rgba(140, 200, 140, 0.28);
            border-color: rgba(140, 200, 140, 0.6);
        }
        .ant-farm-panel-dashboard {
            margin-top: 0.65rem;
            border-top: 1px solid rgba(200, 184, 152, 0.25);
            padding-top: 0.5rem;
        }
        .ant-farm-panel-dashboard-header {
            width: 100%;
            text-align: left;
            background: none;
            border: none;
            color: #e0c890;
            font: 600 0.85rem sans-serif;
            cursor: pointer;
            padding: 0;
        }
        .ant-farm-panel-dashboard-body {
            margin: 0.6rem 0 0;
            /* Two newspaper-style columns instead of one long stack — the
               panel is wide enough now that the goal is "wider, not
               longer": fitting without an internal scrollbar. */
            columns: 2;
            column-gap: 1.4rem;
        }
        .ant-farm-panel-dashboard-body[hidden] {
            display: none;
        }
        .ant-farm-panel-stat-section {
            break-inside: avoid;
        }
        .ant-farm-panel-stat-section + .ant-farm-panel-stat-section {
            margin-top: 0.65rem;
        }
        .ant-farm-panel-stat-title {
            font: 700 0.72rem/1.3 sans-serif;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #8fc2e8;
            border-bottom: 1px solid rgba(143, 194, 232, 0.3);
            padding-bottom: 0.15rem;
            margin-bottom: 0.3rem;
        }
        .ant-farm-panel-stat-lines {
            margin: 0;
            font: 13px/1.55 "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            white-space: pre-wrap;
            overflow-x: auto;
            color: #f0e6d2;
        }
    `;
    document.head.appendChild(style);
}

function buildEnvRow(): { row: HTMLElement; dot: HTMLElement; label: HTMLElement } {
    const row = document.createElement("div");
    row.className = "ant-farm-panel-env-row";
    const dot = document.createElement("span");
    dot.className = "ant-farm-panel-dot";
    const label = document.createElement("span");
    row.append(dot, label);
    return { row, dot, label };
}

function buildToggleButton(
    label: string,
    initial: boolean,
    onChange: (next: boolean) => void,
): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ant-farm-panel-btn";
    let value = initial;

    function render(): void {
        button.setAttribute("aria-pressed", String(value));
        button.textContent = `${label}: ${value ? "On" : "Off"}`;
    }

    button.addEventListener("click", () => {
        value = !value;
        render();
        onChange(value);
    });

    render();
    return button;
}

export function mountControlPanel(container: HTMLElement): ControlPanel {
    injectStyles();

    const panel = document.createElement("div");
    panel.className = "ant-farm-panel";

    // ---- Title row ----
    const titleRow = document.createElement("div");
    titleRow.className = "ant-farm-panel-title-row";
    const titleBlock = document.createElement("div");
    const title = document.createElement("div");
    title.className = "ant-farm-panel-title";
    title.textContent = "Global Ant Farm";
    const subtitle = document.createElement("div");
    subtitle.className = "ant-farm-panel-subtitle";
    subtitle.textContent = "Currently in the testing phase";
    titleBlock.append(title, subtitle);

    const infoButton = document.createElement("button");
    infoButton.type = "button";
    infoButton.className = "ant-farm-panel-icon-btn";
    infoButton.textContent = "i";
    infoButton.title = "About the ants";

    titleRow.append(titleBlock, infoButton);

    // ---- Env strip (time / season / weather) ----
    const envStrip = document.createElement("div");
    envStrip.className = "ant-farm-panel-env";
    const timeRow = buildEnvRow();
    const seasonRow = buildEnvRow();
    const weatherRow = buildEnvRow();
    envStrip.append(timeRow.row, seasonRow.row, weatherRow.row);

    // ---- View controls ----
    const controls = document.createElement("div");
    controls.className = "ant-farm-panel-controls";

    let resetHandler: (() => void) | undefined;
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "ant-farm-panel-btn";
    resetButton.textContent = "Reset view";
    resetButton.addEventListener("click", () => resetHandler?.());

    let showTrails = readStoredBool(TRAILS_KEY, false);
    const trailsButton = buildToggleButton("Trails", showTrails, (next) => {
        showTrails = next;
        writeStoredBool(TRAILS_KEY, next);
    });

    let showPatches = readStoredBool(PATCHES_KEY, false);
    const patchesButton = buildToggleButton("Patches", showPatches, (next) => {
        showPatches = next;
        writeStoredBool(PATCHES_KEY, next);
    });

    let showChamberColors = readStoredBool(CHAMBER_COLORS_KEY, false);
    const chamberButton = buildToggleButton("Chamber colors", showChamberColors, (next) => {
        showChamberColors = next;
        writeStoredBool(CHAMBER_COLORS_KEY, next);
    });

    controls.append(resetButton, trailsButton, patchesButton, chamberButton);

    // ---- Collapsible dashboard ----
    const dashboard = document.createElement("div");
    dashboard.className = "ant-farm-panel-dashboard";
    const dashboardHeader = document.createElement("button");
    dashboardHeader.type = "button";
    dashboardHeader.className = "ant-farm-panel-dashboard-header";
    const dashboardBody = document.createElement("div");
    dashboardBody.className = "ant-farm-panel-dashboard-body";

    let dashboardOpen = readStoredBool(DASHBOARD_KEY, false);
    function applyDashboardVisibility(): void {
        dashboardHeader.textContent = `${dashboardOpen ? "▾" : "▸"} Dashboard`;
        dashboardBody.hidden = !dashboardOpen;
        // Only the two-column stats need the wider panel — collapsed, it
        // should shrink back to just fit the title/controls.
        panel.classList.toggle("ant-farm-panel--wide", dashboardOpen);
        writeStoredBool(DASHBOARD_KEY, dashboardOpen);
    }
    dashboardHeader.addEventListener("click", () => {
        dashboardOpen = !dashboardOpen;
        applyDashboardVisibility();
    });
    applyDashboardVisibility();

    dashboard.append(dashboardHeader, dashboardBody);

    panel.append(titleRow, envStrip, controls, dashboard);
    container.appendChild(panel);

    const info = mountAntInfo(container);
    infoButton.addEventListener("click", () => info.open());

    return {
        renderOptions: {
            get showTrails() {
                return showTrails;
            },
            get showPatches() {
                return showPatches;
            },
            get showChamberColors() {
                return showChamberColors;
            },
        },
        onResetView: (handler: () => void) => {
            resetHandler = handler;
        },
        update: (state: ColonyState, stats: TuningStats) => {
            const { env } = state;
            timeRow.dot.style.background = TIME_COLOR[env.timeOfDay];
            timeRow.label.textContent = `Day ${env.dayOfYear} · ${env.timeOfDay}`;
            seasonRow.dot.style.background = SEASON_COLOR[env.season];
            seasonRow.label.textContent = SEASON_LABEL[env.season];
            weatherRow.dot.style.background = WEATHER_COLOR[env.weather.kind];
            weatherRow.label.textContent = env.weather.kind;

            if (dashboardOpen) {
                dashboardBody.replaceChildren(
                    ...buildStatsSections(state, stats).map(({ title, lines }) => {
                        const section = document.createElement("div");
                        section.className = "ant-farm-panel-stat-section";
                        const heading = document.createElement("div");
                        heading.className = "ant-farm-panel-stat-title";
                        heading.textContent = title;
                        const body = document.createElement("pre");
                        body.className = "ant-farm-panel-stat-lines";
                        body.textContent = lines.join("\n");
                        section.append(heading, body);
                        return section;
                    }),
                );
            }
        },
    };
}

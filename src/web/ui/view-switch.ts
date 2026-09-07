// Lays out the two views and lets the visitor move between them.
//
// The sim has two coordinate spaces (docs/simulation-model.md): the NEST
// (render/nest-view.ts) and the SURFACE (render/surface-view.ts). Side by
// side by default; a plain CSS media query stacks them vertically on narrow
// screens, no JS involved. Separately, a toggle button lets the visitor
// collapse to just one pane at a time (useful if even stacked is too tall,
// or just a preference) — cycles split -> nest -> surface -> split and is
// remembered in localStorage across reloads. config.ts's VIEW_LAYOUT picks
// what a fresh visitor with no stored choice starts on.
import { VIEW_LAYOUT } from "../config";

const STORAGE_KEY = "ant-farm-view-mode";

type ViewName = "nest" | "surface";
type Mode = "split" | ViewName;

const CYCLE: Mode[] = ["split", "nest", "surface"];

function nextMode(mode: Mode): Mode {
    return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
}

function labelFor(mode: Mode): string {
    // Labels what clicking will switch TO, not the current state — reads
    // more naturally as a button ("Show nest only") than a status readout.
    if (mode === "split") {
        return "Show nest only";
    }
    return mode === "nest" ? "Show surface only" : "Show both";
}

function readStoredMode(): Mode | undefined {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored === "split" || stored === "nest" || stored === "surface" ? stored : undefined;
    } catch {
        // localStorage can throw (private browsing, disabled storage) —
        // falling back to VIEW_LAYOUT's default is harmless here.
        return undefined;
    }
}

function writeStoredMode(mode: Mode): void {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // Losing the persisted choice isn't worth surfacing an error over.
    }
}

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
        .ant-farm-views {
            display: flex;
            flex-direction: row;
            gap: 1rem;
            align-items: flex-start;
        }
        @media (max-width: 700px) {
            .ant-farm-views {
                flex-direction: column;
            }
        }
        .ant-farm-view-pane[hidden] {
            display: none;
        }
        .ant-farm-view-pane {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }
        .ant-farm-view-pane canvas {
            border: 1px solid #c8b898;
            max-width: 100%;
        }
        .ant-farm-view-label {
            font: 0.85rem sans-serif;
            color: #5a4a32;
        }
        .ant-farm-view-toggle {
            font: 0.85rem sans-serif;
            padding: 0.25rem 0.6rem;
            width: fit-content;
        }
    `;
    document.head.appendChild(style);
}

export type Views = {
    nestCanvas: HTMLCanvasElement;
    surfaceCanvas: HTMLCanvasElement;
};

export function mountViews(container: HTMLElement): Views {
    injectStyles();

    const wrapper = document.createElement("div");
    wrapper.className = "ant-farm-views";

    const nestPane = document.createElement("div");
    nestPane.className = "ant-farm-view-pane";
    const nestLabel = document.createElement("span");
    nestLabel.className = "ant-farm-view-label";
    nestLabel.textContent = "Nest";
    const nestCanvas = document.createElement("canvas");
    nestPane.append(nestLabel, nestCanvas);

    const surfacePane = document.createElement("div");
    surfacePane.className = "ant-farm-view-pane";
    const surfaceLabel = document.createElement("span");
    surfaceLabel.className = "ant-farm-view-label";
    surfaceLabel.textContent = "Surface";
    const surfaceCanvas = document.createElement("canvas");
    surfacePane.append(surfaceLabel, surfaceCanvas);

    wrapper.append(nestPane, surfacePane);

    const toggle = document.createElement("button");
    toggle.className = "ant-farm-view-toggle";
    toggle.type = "button";

    container.replaceChildren(wrapper, toggle);

    let mode: Mode = readStoredMode() ?? VIEW_LAYOUT;

    function applyMode(): void {
        nestPane.hidden = mode === "surface";
        surfacePane.hidden = mode === "nest";
        toggle.textContent = labelFor(mode);
        writeStoredMode(mode);
    }

    toggle.addEventListener("click", () => {
        mode = nextMode(mode);
        applyMode();
    });

    applyMode();

    return { nestCanvas, surfaceCanvas };
}
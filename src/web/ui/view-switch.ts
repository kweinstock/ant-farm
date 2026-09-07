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
//
// PHASE 4: a second, independent toggle for the trail heat-map
// (render/pheromone-layer.ts). Same localStorage pattern as the view mode
// above, but its own key and its own button — it's an orthogonal setting
// (which layers show), not another position in the view-mode cycle.
import { VIEW_LAYOUT } from "../config";

const STORAGE_KEY = "ant-farm-view-mode";
const TRAILS_STORAGE_KEY = "ant-farm-show-trails";

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

function readStoredShowTrails(): boolean | undefined {
    try {
        const stored = localStorage.getItem(TRAILS_STORAGE_KEY);
        return stored === "true" || stored === "false" ? stored === "true" : undefined;
    } catch {
        return undefined;
    }
}

function writeStoredShowTrails(value: boolean): void {
    try {
        localStorage.setItem(TRAILS_STORAGE_KEY, String(value));
    } catch {
        // Same as writeStoredMode above — not worth surfacing.
    }
}

function trailsLabelFor(shown: boolean): string {
    return shown ? "Hide trails" : "Show trails";
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
        .ant-farm-view-controls {
            display: flex;
            flex-direction: row;
            gap: 0.5rem;
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
    renderOptions: RenderOptions;
};

// A live getter, not a plain boolean copied at mount time — render/engine.ts
// reads options.showTrails fresh every animation frame, so this has to
// reflect whatever the button was last clicked to, not a snapshot from
// whenever mountViews happened to run. `readonly` from the consumer's side
// (engine.ts can't assign to it); mountViews' own click handler is the only
// thing that ever changes the underlying value, through its own closured
// variable, not through this property.
export type RenderOptions = {
    readonly showTrails: boolean;
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

    const controls = document.createElement("div");
    controls.className = "ant-farm-view-controls";

    const toggle = document.createElement("button");
    toggle.className = "ant-farm-view-toggle";
    toggle.type = "button";

    const trailsToggle = document.createElement("button");
    trailsToggle.className = "ant-farm-view-toggle";
    trailsToggle.type = "button";

    controls.append(toggle, trailsToggle);
    container.replaceChildren(wrapper, controls);

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

    // PHASE 4: defaults to OFF (readStoredShowTrails() ?? false) —
    // pheromone-layer.ts's own header calls this an "optional toggle,"
    // which I'm reading as opt-in rather than shown immediately. Flag if
    // you'd rather a fresh visitor see the heat-map by default.
    let showTrails = readStoredShowTrails() ?? false;

    function applyTrailsToggle(): void {
        trailsToggle.textContent = trailsLabelFor(showTrails);
        writeStoredShowTrails(showTrails);
    }

    trailsToggle.addEventListener("click", () => {
        showTrails = !showTrails;
        applyTrailsToggle();
    });

    applyTrailsToggle();

    const renderOptions: RenderOptions = {
        get showTrails() {
            return showTrails;
        },
    };

    return { nestCanvas, surfaceCanvas, renderOptions };
}
// Mounts the 3D scene's container element — render/engine.ts owns the
// actual three.js scene/camera/cube and draws into whatever element this
// hands back.
//
// PHASE 12a: this used to lay out two flat <canvas> elements (nest +
// surface) with a cycle button to show one/both/the other
// (docs/simulation-model.md's two coordinate spaces). That toggle doesn't
// make sense anymore — nest and surface are two faces of one 3D cube the
// visitor orbits, not two panes to switch between — so it's gone.
//
// PHASE 12f: this used to also own the visitor-facing controls (Reset view,
// Show/Hide trails) as a row of buttons below the scene — those, plus the
// tuning dashboard and the fast-forward button that used to live scattered
// across main.ts/weather-hud.ts, are now all one dock (ui/control-panel.ts).
// This file is down to just the one thing render/engine.ts actually needs:
// a positioned element to mount its canvas and overlays into, sized to
// fill the viewport (index.html's #ant-farm-views is the sim's whole page
// now, not one section of it).
let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
        .ant-farm-scene {
            width: 100%;
            height: 100%;
            position: relative;
        }
        .ant-farm-scene canvas {
            display: block;
            touch-action: none;
        }
    `;
    document.head.appendChild(style);
}

export type Views = {
    sceneContainer: HTMLElement;
};

export function mountViews(container: HTMLElement): Views {
    injectStyles();

    const sceneContainer = document.createElement("div");
    sceneContainer.className = "ant-farm-scene";
    container.replaceChildren(sceneContainer);

    return { sceneContainer };
}

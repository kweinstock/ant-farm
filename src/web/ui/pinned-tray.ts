// PHASE 16: this visitor's pinned ants, as the "Pinned" screen of the nav bar.
// Each row jumps the camera to that ant (and opens its card); the × unpins it.
// Pins follow an ant's heir when it dies (state/pins.ts), so a row's name can
// change under you — that's the point. Opens as a popover above the dock, or a
// sheet above the bottom bar on a phone, like the control panel.
import type { ColonyState } from "../../sim/state";
import type { AntId } from "../../sim/ants/ant";
import type { PinStore } from "../state/pins";
import { MOBILE_MAX_WIDTH, NAV_HEIGHT_REM, DOCK_OFFSET_REM } from "./layout";
import { icon } from "./icons";

const STYLE_ID = "ant-farm-pins-style";

function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .ant-farm-pins {
            position: fixed;
            left: 50%;
            transform: translateX(-50%);
            bottom: ${DOCK_OFFSET_REM}rem;
            z-index: 1000;
            box-sizing: border-box;
            width: min(22rem, calc(100vw - 2rem));
            max-height: calc(100vh - ${DOCK_OFFSET_REM + 3}rem);
            overflow-y: auto;
            background: rgba(26, 20, 12, 0.9);
            border: 1px solid rgba(200, 184, 152, 0.4);
            border-radius: 12px;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            color: #f0e6d2;
            font: 13px/1.4 sans-serif;
            padding: 0.8rem 0.9rem;
        }
        .ant-farm-pins[hidden] { display: none; }
        .ant-farm-pins-title {
            font-size: 0.66rem;
            font-weight: 600;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #e0c890;
            margin-bottom: 0.45rem;
        }
        .ant-farm-pins-empty { color: #c8b898; font-style: italic; }
        .ant-farm-pins-row {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.15rem 0;
        }
        .ant-farm-pins-jump {
            flex: 1;
            min-width: 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.6rem;
            text-align: left;
            padding: 0.4rem 0.6rem;
            border-radius: 8px;
            border: 1px solid transparent;
            background: rgba(240, 230, 210, 0.07);
            color: #f0e6d2;
            font: inherit;
            cursor: pointer;
        }
        .ant-farm-pins-jump:hover { background: rgba(240, 230, 210, 0.16); }
        .ant-farm-pins-jump.is-waiting { color: #a89878; font-style: italic; }
        .ant-farm-pins-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ant-farm-pins-meta { flex: none; font-size: 0.7rem; color: #a89878; text-transform: uppercase; letter-spacing: 0.06em; }
        .ant-farm-pins-remove {
            flex: none;
            width: 1.7rem;
            height: 1.7rem;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            border: 1px solid rgba(200, 184, 152, 0.4);
            background: transparent;
            color: #c8b898;
            cursor: pointer;
            padding: 0;
        }
        .ant-farm-pins-remove:hover { background: rgba(240, 230, 210, 0.16); color: #f0e6d2; }
        @media (max-width: ${MOBILE_MAX_WIDTH}px) {
            .ant-farm-pins {
                left: 0.5rem;
                right: 0.5rem;
                transform: none;
                width: auto;
                bottom: calc(${NAV_HEIGHT_REM}rem + env(safe-area-inset-bottom, 0px) + 0.5rem);
                max-height: 52vh;
                max-height: 52dvh;
            }
            .ant-farm-pins-remove { width: 2.1rem; height: 2.1rem; }
        }
    `;
    document.head.appendChild(style);
}

export type PinnedTray = {
    setOpen: (open: boolean) => void;
    // Re-draw from the current state (cheap; does nothing while the tray is closed).
    render: (state: ColonyState) => void;
};

export function mountPinnedTray(
    parent: HTMLElement,
    pins: PinStore,
    onJump: (id: AntId) => void,
): PinnedTray {
    injectStyles();

    const tray = document.createElement("div");
    tray.className = "ant-farm-pins";
    tray.hidden = true;
    const title = document.createElement("div");
    title.className = "ant-farm-pins-title";
    title.textContent = "Pinned ants";
    const list = document.createElement("div");
    tray.append(title, list);
    parent.appendChild(tray);

    let open = false;

    function render(state: ColonyState): void {
        if (!open) {
            return;
        }
        const ids = pins.ids();
        if (ids.length === 0) {
            const empty = document.createElement("div");
            empty.className = "ant-farm-pins-empty";
            empty.textContent = "No pinned ants yet. Open an ant and tap the pin.";
            list.replaceChildren(empty);
            return;
        }
        list.replaceChildren(
            ...ids.map((id) => {
                const ant = state.ants.get(id);
                const row = document.createElement("div");
                row.className = "ant-farm-pins-row";

                const jump = document.createElement("button");
                jump.type = "button";
                jump.className = "ant-farm-pins-jump";
                const name = document.createElement("span");
                name.className = "ant-farm-pins-name";
                if (ant) {
                    name.textContent = ant.name;
                    const meta = document.createElement("span");
                    meta.className = "ant-farm-pins-meta";
                    meta.textContent = ant.caste === "QUEEN" ? "queen" : ant.job.toLowerCase();
                    jump.append(name, meta);
                    jump.addEventListener("click", () => onJump(id));
                } else {
                    // Dead and waiting for the next hatch to hand its name on.
                    name.textContent = "Waiting for an heir…";
                    jump.classList.add("is-waiting");
                    jump.disabled = true;
                    jump.append(name);
                }

                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "ant-farm-pins-remove";
                remove.setAttribute("aria-label", "Unpin");
                remove.title = "Unpin";
                remove.appendChild(icon("close", 0.75));
                remove.addEventListener("click", () => pins.remove(id));

                row.append(jump, remove);
                return row;
            }),
        );
    }

    return {
        setOpen: (next) => {
            open = next;
            tray.hidden = !next;
        },
        render,
    };
}

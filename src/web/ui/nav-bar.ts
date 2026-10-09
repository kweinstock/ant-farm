// PHASE 15: the menu, one bar for every screen size. Three buttons open
// "screens" — the control panel shown as a popover above the bar (Colony =
// the stats dashboard, View = camera and overlay toggles), the Pinned list
// (ui/pinned-tray.ts), or the About modal —
// and an arrow sits on either side to step through the ants. Stepping selects
// the ant, which opens its card (ui/ant-card.ts).
//
// Wide screens get a floating dock centred at the bottom; at MOBILE_MAX_WIDTH
// and below it becomes a full-width bar with the labels under the icons, and the
// panel opens as a sheet along the full width. Tapping the active button again
// closes its screen.
import { MOBILE_MAX_WIDTH, NAV_HEIGHT_REM } from "./layout";
import { icon, type IconName } from "./icons";

export type NavScreen = "colony" | "view" | "pins";

const STYLE_ID = "ant-farm-nav-style";

function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        /* Desktop: a floating dock, centred along the bottom. */
        .ant-farm-nav {
            position: fixed;
            left: 50%;
            bottom: 1rem;
            transform: translateX(-50%);
            z-index: 1100;
            box-sizing: border-box;
            display: flex;
            align-items: stretch;
            gap: 0.3rem;
            padding: 0.35rem;
            background: rgba(26, 20, 12, 0.9);
            border: 1px solid rgba(200, 184, 152, 0.4);
            border-radius: 14px;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            color: #f0e6d2;
            font: 13px/1.2 sans-serif;
        }
        .ant-farm-nav-btn {
            display: flex;
            align-items: center;
            gap: 0.45rem;
            padding: 0.5rem 0.95rem;
            border-radius: 10px;
            border: 1px solid transparent;
            background: transparent;
            color: #c8b898;
            font: inherit;
            cursor: pointer;
        }
        .ant-farm-nav-btn .icon { display: flex; }
        .ant-farm-nav-btn .label { font-size: 0.82rem; letter-spacing: 0.03em; }
        .ant-farm-nav-btn:hover { background: rgba(240, 230, 210, 0.1); color: #f0e6d2; }
        .ant-farm-nav-btn[aria-pressed="true"] {
            background: rgba(240, 230, 210, 0.14);
            border-color: rgba(200, 184, 152, 0.5);
            color: #f0e6d2;
        }
        .ant-farm-nav-arrow {
            flex: none;
            width: 2.4rem;
            border-radius: 10px;
            border: 1px solid rgba(200, 184, 152, 0.4);
            background: rgba(240, 230, 210, 0.08);
            color: #f0e6d2;
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ant-farm-nav-arrow:hover { background: rgba(240, 230, 210, 0.18); }
        .ant-farm-nav-arrow:active { background: rgba(240, 230, 210, 0.26); }

        /* Phone: a full-width bar, labels under the icons. */
        @media (max-width: ${MOBILE_MAX_WIDTH}px) {
            .ant-farm-nav {
                left: 0;
                right: 0;
                bottom: 0;
                transform: none;
                height: calc(${NAV_HEIGHT_REM}rem + env(safe-area-inset-bottom, 0px));
                padding: 0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom, 0px));
                gap: 0.35rem;
                background: rgba(26, 20, 12, 0.94);
                border: none;
                border-top: 1px solid rgba(200, 184, 152, 0.4);
                border-radius: 0;
                box-shadow: none;
                backdrop-filter: none;
            }
            .ant-farm-nav-btn {
                flex: 1;
                min-width: 0;
                flex-direction: column;
                justify-content: center;
                gap: 0.1rem;
                padding: 0;
            }
            .ant-farm-nav-btn .label { font-size: 0.68rem; letter-spacing: 0.04em; }
            .ant-farm-nav-arrow { width: 2.6rem; }
        }
    `;
    document.head.appendChild(style);
}

export type NavBarOptions = {
    // Show this screen (the control panel popover), or hide it when null.
    onScreen: (screen: NavScreen | null) => void;
    onAbout: () => void;
    // +1 = next ant, -1 = previous.
    onCycle: (direction: 1 | -1) => void;
};

export function mountNavBar(parent: HTMLElement, options: NavBarOptions): { closeScreen: () => void } {
    injectStyles();

    const bar = document.createElement("nav");
    bar.className = "ant-farm-nav";
    bar.setAttribute("aria-label", "Colony navigation");

    let active: NavScreen | null = null;
    const tabs = new Map<NavScreen, HTMLButtonElement>();

    function setActive(next: NavScreen | null): void {
        active = next;
        for (const [screen, button] of tabs) {
            button.setAttribute("aria-pressed", String(screen === active));
        }
        options.onScreen(active);
    }

    function arrow(name: IconName, label: string, direction: 1 | -1): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ant-farm-nav-arrow";
        button.title = label;
        button.appendChild(icon(name, 1.2));
        button.setAttribute("aria-label", label);
        button.addEventListener("click", () => options.onCycle(direction));
        return button;
    }

    function tab(name: IconName, label: string, onPress: () => void): HTMLButtonElement {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ant-farm-nav-btn";
        button.setAttribute("aria-pressed", "false");
        const iconEl = document.createElement("span");
        iconEl.className = "icon";
        iconEl.appendChild(icon(name, 1.3));
        const labelEl = document.createElement("span");
        labelEl.className = "label";
        labelEl.textContent = label;
        button.append(iconEl, labelEl);
        button.addEventListener("click", onPress);
        return button;
    }

    const colony = tab("colony", "Colony", () => setActive(active === "colony" ? null : "colony"));
    const view = tab("view", "View", () => setActive(active === "view" ? null : "view"));
    const pinned = tab("pin", "Pinned", () => setActive(active === "pins" ? null : "pins"));
    const about = tab("about", "About", () => {
        setActive(null);
        options.onAbout();
    });
    tabs.set("colony", colony);
    tabs.set("view", view);
    tabs.set("pins", pinned);

    bar.append(arrow("left", "Previous ant", -1), colony, view, pinned, about, arrow("right", "Next ant", 1));
    parent.appendChild(bar);

    return { closeScreen: () => setActive(null) };
}

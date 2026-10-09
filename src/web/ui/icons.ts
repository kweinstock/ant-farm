// Small stroke icons for the overlay UI, drawn as inline SVG so they take the
// surrounding text colour (currentColor) and never fall back to a platform emoji
// — which the arrow/triangle characters (◀ ▶ ▼) and the globe/camera emoji all do
// on some phones. Built with createElementNS, not innerHTML.
const NS = "http://www.w3.org/2000/svg";

type Shape = { tag: "circle" | "path" | "ellipse"; attrs: Record<string, string> };

const ICONS = {
    // A globe: the colony as a whole.
    colony: [
        { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
        { tag: "ellipse", attrs: { cx: "12", cy: "12", rx: "4", ry: "9" } },
        { tag: "path", attrs: { d: "M3 12h18" } },
    ],
    // An eye: how you look at it.
    view: [
        { tag: "path", attrs: { d: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" } },
        { tag: "circle", attrs: { cx: "12", cy: "12", r: "3" } },
    ],
    // The same "i" in a ring the dock's info button uses.
    about: [
        { tag: "circle", attrs: { cx: "12", cy: "12", r: "9" } },
        { tag: "path", attrs: { d: "M12 11v6" } },
        { tag: "path", attrs: { d: "M12 7.5v.01" } },
    ],
    left: [{ tag: "path", attrs: { d: "M15 5l-7 7 7 7" } }],
    right: [{ tag: "path", attrs: { d: "M9 5l7 7-7 7" } }],
    down: [{ tag: "path", attrs: { d: "M5 9l7 7 7-7" } }],
    up: [{ tag: "path", attrs: { d: "M5 15l7-7 7 7" } }],
    close: [{ tag: "path", attrs: { d: "M6 6l12 12M18 6L6 18" } }],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, sizeRem = 1.1): SVGSVGElement {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", `${sizeRem}rem`);
    svg.setAttribute("height", `${sizeRem}rem`);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.style.display = "block";
    for (const shape of ICONS[name]) {
        const node = document.createElementNS(NS, shape.tag);
        for (const [key, value] of Object.entries(shape.attrs)) {
            node.setAttribute(key, value);
        }
        svg.appendChild(node);
    }
    return svg;
}

// Swap the icon inside a button without touching anything else on it.
export function setIcon(button: HTMLElement, name: IconName, sizeRem?: number): void {
    button.replaceChildren(icon(name, sizeRem));
}

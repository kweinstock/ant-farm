// PHASE 15: the card for the ant a visitor clicked (or cycled to) — everything
// the client knows about it, top-right. Pure read-out of the same ColonyState
// local mode steps and stream mode rebuilds from the wire, so it works
// identically in both. (Fields that never cross the wire — memory, trip state —
// aren't shown, because in stream mode they'd be placeholders.)
//
// An ant that dies is followed to its heir (state.heirs: the next ant to hatch
// takes over its surname — see sim/names/generator.ts). Between the death and
// that hatch there is no heir yet; the card says so and keeps checking. When it
// does switch to an heir it calls `onFollow` so the camera can move too.
// Nothing about a dead ant is kept beyond the name needed for that message.
//
// Selection comes from render/engine.ts's click picking (onAntPicked) and from
// the nav bar's arrows (ui/nav-bar.ts via main.ts); main.ts calls update(state) on
// every sim update, the same cadence as the control panel.
import type { ColonyState } from "../../sim/state";
import type { Ant, AntId } from "../../sim/ants/ant";
import { chamberAt } from "../../sim/world/nest";
import { surnameOf } from "../../sim/names/generator";
import { DAY_LENGTH_TICKS, MAX_ENERGY, HUNGER_THRESHOLD } from "../../sim/params";
import { MOBILE_MAX_WIDTH, NAV_HEIGHT_REM } from "./layout";
import { setIcon } from "./icons";
import { resolveAnt } from "../state/succession";
import type { PinStore } from "../state/pins";

// Still importable from here (tests, the card itself); the logic lives in state/succession.ts.
export { resolveAnt };

const HOUR_TICKS = DAY_LENGTH_TICKS / 24;

const STYLE_ID = "ant-farm-ant-card-style";

function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .ant-farm-ant-card {
            position: fixed;
            top: 0.6rem;
            right: 0.6rem;
            z-index: 1000;
            box-sizing: border-box;
            width: min(19rem, calc(100vw - 1.2rem));
            max-height: calc(100vh - 1.2rem);
            overflow-y: auto;
            background: rgba(26, 20, 12, 0.86);
            border: 1px solid rgba(200, 184, 152, 0.4);
            border-top: 3px solid #c8b898;
            border-radius: 10px;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            color: #f0e6d2;
            font: 13px/1.4 sans-serif;
            padding: 0.75rem 0.85rem 0.8rem;
        }
        .ant-farm-ant-card[hidden], .ant-farm-ant-card [hidden] { display: none; }
        .ant-farm-ant-card.is-queen { border-top-color: #e0b34a; }
        .ant-farm-ant-card.is-dead { border-top-color: #7a6a58; }

        .ant-farm-ant-card-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.5rem;
        }
        .ant-farm-ant-card-name {
            font-family: Georgia, "Times New Roman", serif;
            font-size: 1.25rem;
            line-height: 1.15;
        }
        .ant-farm-ant-card-role {
            display: inline-block;
            margin-top: 0.3rem;
            padding: 0.05rem 0.55rem;
            border-radius: 999px;
            background: rgba(200, 184, 152, 0.18);
            color: #e6d9bd;
            font-size: 0.7rem;
            letter-spacing: 0.06em;
            text-transform: uppercase;
        }
        .ant-farm-ant-card-close {
            flex: none;
            width: 1.5rem;
            height: 1.5rem;
            border-radius: 50%;
            border: 1px solid rgba(200, 184, 152, 0.5);
            background: rgba(240, 230, 210, 0.08);
            color: #f0e6d2;
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ant-farm-ant-card-close:hover { background: rgba(240, 230, 210, 0.2); }

        .ant-farm-ant-card-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.6rem; }
        .ant-farm-ant-card-chip {
            padding: 0.05rem 0.5rem;
            border-radius: 999px;
            font-size: 0.72rem;
            background: rgba(240, 230, 210, 0.1);
            color: #e6d9bd;
        }
        .ant-farm-ant-card-chip.is-asleep { background: rgba(110, 130, 200, 0.28); color: #c9d3f5; }
        .ant-farm-ant-card-chip.is-hungry { background: rgba(217, 130, 74, 0.28); color: #ffd2b0; }
        .ant-farm-ant-card-chip.is-task { background: rgba(143, 191, 106, 0.25); color: #d6efbf; }

        .ant-farm-ant-card-section {
            margin-top: 0.75rem;
            padding-top: 0.55rem;
            border-top: 1px solid rgba(200, 184, 152, 0.18);
        }
        .ant-farm-ant-card-heading {
            font-size: 0.64rem;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #a89878;
            margin-bottom: 0.35rem;
        }
        .ant-farm-ant-card-bar {
            height: 6px;
            margin-top: 0.4rem;
            border-radius: 3px;
            background: rgba(240, 230, 210, 0.14);
            overflow: hidden;
        }
        .ant-farm-ant-card-bar > div { height: 100%; width: 0; background: #c8b898; border-radius: 3px; }
        .ant-farm-ant-card-bar--energy > div { background: #8fbf6a; }
        .ant-farm-ant-card-bar--energy.is-hungry > div { background: #d9824a; }
        .ant-farm-ant-card-bar-caption { display: flex; justify-content: space-between; margin-top: 0.2rem; font-size: 0.7rem; color: #a89878; }

        .ant-farm-ant-card-row { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.08rem 0; }
        .ant-farm-ant-card-label { color: #a89878; flex: none; }
        .ant-farm-ant-card-value { text-align: right; }

        .ant-farm-ant-card-note { margin-top: 0.6rem; color: #c8b898; font-style: italic; }

        .ant-farm-ant-card-actions { display: flex; align-items: center; gap: 0.4rem; flex: none; }
        .ant-farm-ant-card-toggle { display: none; }
        .ant-farm-ant-card-pin[aria-pressed="true"] { color: #e0b34a; border-color: rgba(224, 179, 74, 0.7); background: rgba(224, 179, 74, 0.16); }
        .ant-farm-ant-card-pin[aria-pressed="true"] svg { fill: rgba(224, 179, 74, 0.4); }

        /* Phone layout: the card is a bar along the top showing just the ant's
           name; the arrow opens the stats beneath it. The nav and the sheets live
           at the bottom (ui/nav-bar.ts). */
        @media (max-width: ${MOBILE_MAX_WIDTH}px) {
            .ant-farm-ant-card {
                top: calc(0.5rem + env(safe-area-inset-top, 0px));
                left: 0.5rem;
                right: 0.5rem;
                width: auto;
                max-height: calc(100vh - ${NAV_HEIGHT_REM}rem - 2rem);
                max-height: calc(100dvh - ${NAV_HEIGHT_REM}rem - 2rem);
                padding: 0.55rem 0.7rem;
            }
            .ant-farm-ant-card-head { align-items: center; }
            .ant-farm-ant-card-name { font-size: 1.1rem; }
            .ant-farm-ant-card-role { margin-top: 0.15rem; }
            .ant-farm-ant-card-toggle, .ant-farm-ant-card-close { display: flex; width: 2rem; height: 2rem; }
            .ant-farm-ant-card:not(.is-expanded) .ant-farm-ant-card-chips,
            .ant-farm-ant-card:not(.is-expanded) .ant-farm-ant-card-body { display: none; }
        }
    `;
    document.head.appendChild(style);
}

// "1d 4h" for long spans, "5h" / "<1h" for short ones.
function formatSpan(ticks: number): string {
    const t = Math.max(0, Math.floor(ticks));
    const days = Math.floor(t / DAY_LENGTH_TICKS);
    const hours = Math.floor((t % DAY_LENGTH_TICKS) / HOUR_TICKS);
    return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h` : "<1h";
}

// The span with the raw tick count alongside, so it can still be compared with
// the dashboard.
export function formatTicks(ticks: number): string {
    return `${formatSpan(ticks)} (${Math.max(0, Math.floor(ticks)).toLocaleString("en-US")} ticks)`;
}

function ordinal(n: number): string {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) {
        return `${n}th`;
    }
    return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
}

// 1 = oldest. Ties share the lower number.
function ageRank(state: ColonyState, ant: Ant): number {
    let older = 0;
    for (const other of state.ants.values()) {
        if (other.ageTicks > ant.ageTicks) {
            older++;
        }
    }
    return older + 1;
}

function inheritedFrom(state: ColonyState, id: AntId): AntId | undefined {
    for (const [deadId, heirId] of Object.entries(state.heirs)) {
        if (heirId === id) {
            return deadId;
        }
    }
    return undefined;
}

export type AntCard = {
    select: (id: AntId | undefined) => void;
    selected: () => AntId | undefined;
    update: (state: ColonyState) => void;
};

type Row = { row: HTMLElement; value: HTMLElement };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

export function mountAntCard(
    parent: HTMLElement,
    onFollow?: (id: AntId) => void,
    onClose?: () => void,
    pins?: PinStore,
): AntCard {
    injectStyles();

    const card = el("div", "ant-farm-ant-card");
    card.hidden = true;

    // ---- header: name, one role pill, close ----
    const head = el("div", "ant-farm-ant-card-head");
    const titles = el("div");
    const nameEl = el("div", "ant-farm-ant-card-name");
    const roleEl = el("span", "ant-farm-ant-card-role");
    titles.append(nameEl, roleEl);
    const closeButton = el("button", "ant-farm-ant-card-close");
    setIcon(closeButton, "close", 0.8);
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close ant card");
    // Phone layout only (CSS hides it otherwise): opens/closes the stats under the name bar.
    const toggleButton = el("button", "ant-farm-ant-card-close ant-farm-ant-card-toggle");
    setIcon(toggleButton, "down", 0.9);
    toggleButton.type = "button";
    toggleButton.setAttribute("aria-label", "Show stats");
    toggleButton.setAttribute("aria-expanded", "false");
    // Pin / unpin this ant (state/pins.ts). Pins follow the ant's heir when it dies.
    const pinButton = el("button", "ant-farm-ant-card-close ant-farm-ant-card-pin");
    setIcon(pinButton, "pin", 0.9);
    pinButton.type = "button";
    pinButton.title = "Pin this ant";
    pinButton.setAttribute("aria-label", "Pin this ant");
    pinButton.setAttribute("aria-pressed", "false");
    pinButton.hidden = pins === undefined;
    const actions = el("div", "ant-farm-ant-card-actions");
    actions.append(pinButton, toggleButton, closeButton);
    head.append(titles, actions);

    // ---- state chips ----
    const chips = el("div", "ant-farm-ant-card-chips");

    const body = el("div", "ant-farm-ant-card-body");

    const section = (title: string): HTMLElement => {
        const node = el("div", "ant-farm-ant-card-section");
        node.appendChild(el("div", "ant-farm-ant-card-heading", title));
        return node;
    };
    const row = (label: string): Row => {
        const node = el("div", "ant-farm-ant-card-row");
        const value = el("span", "ant-farm-ant-card-value");
        node.append(el("span", "ant-farm-ant-card-label", label), value);
        return { row: node, value };
    };
    // ---- life ----
    const lifeSection = section("Life");
    const lifespanRow = row("lifespan");
    const lifeBar = el("div", "ant-farm-ant-card-bar");
    const lifeFill = el("div");
    lifeBar.appendChild(lifeFill);
    const lifeCaption = el("div", "ant-farm-ant-card-bar-caption");
    const lifePct = el("span");
    const lifeTotal = el("span");
    lifeCaption.append(lifePct, lifeTotal);
    lifeSection.append(lifespanRow.row, lifeBar, lifeCaption);

    // ---- energy ----
    const energySection = section("Energy");
    const energyRow = row("food reserve");
    const energyBar = el("div", "ant-farm-ant-card-bar ant-farm-ant-card-bar--energy");
    const energyFill = el("div");
    energyBar.appendChild(energyFill);
    const carryRow = row("carrying");
    energySection.append(energyRow.row, energyBar, carryRow.row);

    // ---- whereabouts ----
    const whereSection = section("Whereabouts");
    const whereRow = row("where");
    const roomRow = row("room");
    whereSection.append(whereRow.row, roomRow.row);

    // ---- colony ----
    const colonySection = section("In the colony");
    const rankRow = row("age rank");
    const lineRow = row("surname line");
    const inheritedRow = row("took the name of");
    colonySection.append(rankRow.row, lineRow.row, inheritedRow.row);

    body.append(lifeSection, energySection, whereSection, colonySection);

    const note = el("div", "ant-farm-ant-card-note");

    card.append(head, chips, body, note);
    parent.appendChild(card);

    let selected: AntId | undefined;
    // Kept only so the "has died" message can still say who it was.
    let lastName = "";

    function select(next: AntId | undefined): void {
        selected = next;
        lastName = "";
        card.hidden = next === undefined;
    }

    pinButton.addEventListener("click", () => {
        if (selected === undefined || !pins) {
            return;
        }
        pinButton.setAttribute("aria-pressed", String(pins.toggle(selected)));
    });

    toggleButton.addEventListener("click", () => {
        const expanded = card.classList.toggle("is-expanded");
        setIcon(toggleButton, expanded ? "up" : "down", 0.9);
        toggleButton.setAttribute("aria-expanded", String(expanded));
        toggleButton.setAttribute("aria-label", expanded ? "Hide stats" : "Show stats");
    });

    // Same as clicking empty ground: drop the selection and zoom the camera back out.
    closeButton.addEventListener("click", () => {
        select(undefined);
        onClose?.();
    });

    function setChips(labels: { text: string; kind?: string }[]): void {
        chips.replaceChildren(...labels.map(({ text, kind }) => el("span", `ant-farm-ant-card-chip${kind ? ` is-${kind}` : ""}`, text)));
    }

    function update(state: ColonyState): void {
        if (selected === undefined) {
            return;
        }
        const resolved = resolveAnt(state, selected);
        const switched = resolved.id !== selected;
        selected = resolved.id;

        if (!resolved.ant) {
            // Dead, and the next hatch hasn't happened yet (or the line ended).
            card.classList.add("is-dead");
            nameEl.textContent = lastName;
            roleEl.textContent = "has died";
            setChips([]);
            pinButton.hidden = true;
            body.hidden = true;
            note.textContent = "Waiting for an heir to take the name…";
            return;
        }

        const ant = resolved.ant;
        if (switched) {
            onFollow?.(ant.id);
        }
        lastName = ant.name;
        card.classList.remove("is-dead");
        pinButton.hidden = pins === undefined;
        pinButton.setAttribute("aria-pressed", String(pins?.has(ant.id) ?? false));
        card.classList.toggle("is-queen", ant.caste === "QUEEN");
        body.hidden = false;
        note.textContent = "";

        nameEl.textContent = ant.name;
        // The one place the job is shown.
        roleEl.textContent = ant.caste === "QUEEN" ? "queen" : ant.job.toLowerCase();

        const hungry = ant.energy / MAX_ENERGY < HUNGER_THRESHOLD;
        const flags: { text: string; kind?: string }[] = [ant.asleep ? { text: "asleep", kind: "asleep" } : { text: "awake" }];
        if (hungry) {
            flags.push({ text: "hungry", kind: "hungry" });
        }
        if (ant.undertaking) {
            flags.push({ text: "undertaking", kind: "task" });
        }
        if (ant.digging) {
            flags.push({ text: "digging", kind: "task" });
        }
        setChips(flags);

        // One readout for the whole life: age out of lifespan, and the bar for how far in.
        lifespanRow.value.textContent = `${formatSpan(ant.ageTicks)} / ${formatSpan(ant.lifespanTicks)}`;
        const lifeFraction = Math.max(0, Math.min(1, ant.ageTicks / ant.lifespanTicks));
        lifeFill.style.width = `${lifeFraction * 100}%`;
        lifePct.textContent = `${Math.round(lifeFraction * 100)}% of its life`;
        lifeTotal.textContent = `${Math.floor(ant.ageTicks).toLocaleString("en-US")} / ${Math.floor(ant.lifespanTicks).toLocaleString("en-US")} ticks`;

        const energyFraction = Math.max(0, Math.min(1, ant.energy / MAX_ENERGY));
        energyRow.value.textContent = `${Math.round(ant.energy).toLocaleString("en-US")} / ${MAX_ENERGY.toLocaleString("en-US")} (${Math.round(energyFraction * 100)}%)`;
        energyFill.style.width = `${energyFraction * 100}%`;
        energyBar.classList.toggle("is-hungry", hungry);

        const loads: string[] = [];
        if (ant.carryingFood > 0) {
            loads.push(`${ant.carryingFood} food`);
        }
        if (ant.carrying.length > 0) {
            loads.push(`${ant.carrying.length} ${ant.carrying.length === 1 ? "egg" : "eggs"}`);
        }
        carryRow.row.hidden = loads.length === 0;
        carryRow.value.textContent = loads.join(", ");

        const { x, y } = ant.location.pos;
        whereRow.value.textContent = `${ant.location.where} (${x}, ${y})`;
        const role = ant.location.where === "nest" ? chamberAt(state.nest, ant.location.pos) : undefined;
        roomRow.row.hidden = role === undefined;
        roomRow.value.textContent = role ? role.toLowerCase().replace("_", " ") : "";

        rankRow.value.textContent = `${ordinal(ageRank(state, ant))} oldest of ${state.ants.size}`;
        lineRow.value.textContent = surnameOf(ant.name);
        const from = inheritedFrom(state, ant.id);
        inheritedRow.row.hidden = from === undefined;
        inheritedRow.value.textContent = from ?? "";
    }

    return { select, selected: () => selected, update };
}

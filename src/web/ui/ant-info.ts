// PHASE 12f: the info panel a visitor opens from the dock's [i] button —
// plain-language facts about how the simulated colony actually works
// (jobs, castes, memory/trails, decision priority order, life cycle),
// pulled from reading src/sim itself rather than generic ant facts, so it
// stays true to what this specific simulation does. A static modal, not
// live data (ui/dashboard-stats.ts already covers the live numbers) — this
// is the "what am I looking at" explainer, shown once and dismissed.
import { setIcon } from "./icons";

const SECTIONS: { title: string; body: string }[] = [
    {
        title: "Castes",
        body:
            "Two castes: the queen and workers. The queen never leaves the nest, lives far " +
            "longer (thousands of ticks vs. hundreds for a worker), and is the only one who " +
            "lays eggs. Workers do every other job — nursing, foraging, undertaking, digging.",
    },
    {
        title: "Jobs",
        body:
            "Every worker starts as a nurse and is automatically promoted to forager once " +
            "she's old enough — a one-way, age-based switch, not a free choice. Undertaking " +
            "and digging are temporary overrides layered on top of a worker's base job, not " +
            "separate jobs of their own.",
    },
    {
        title: "How an ant decides what to do",
        body:
            "Each tick, an ant runs down a priority list and acts on the first thing that " +
            "applies: flee a spotted predator or a strong-enough alarm scent; eat if hungry " +
            "and home; sleep if sleepy and unburdened; finish an undertaking or digging " +
            "assignment already in progress; otherwise fall through to her job's own routine " +
            "(nursing or foraging).",
    },
    {
        title: "Memory and trail scent",
        body:
            "Foragers lay down a food-scent trail while hauling food home, and other ants " +
            "sniff out and follow the strongest nearby trail to get guided toward food. A " +
            "separate, faster-fading alarm scent spreads panic outward from danger. Each ant " +
            "also keeps her own short-term memory — recently found food piles, patches that " +
            "turned up empty, and recent predator sightings — steering her without needing to " +
            "re-explore from scratch every time.",
    },
    {
        title: "Undertaking",
        body:
            "When an ant dies, her body lingers as a corpse that slowly decays. The colony " +
            "periodically reassigns some idle workers as undertakers, who walk to a corpse, " +
            "carry it out to a surface graveyard, and drop it there before returning to their " +
            "normal job.",
    },
    {
        title: "Energy, hunger, and sleep",
        body:
            "Every ant burns energy just by being alive. Once she's more than half-starved " +
            "she'll detour to eat before anything else. Ants also sleep on a recurring cycle — " +
            "while asleep an ant burns no energy but does nothing else that tick either.",
    },
    {
        title: "Life cycle",
        body:
            "Brood passes through egg, larva, and pupa before emerging as an adult worker; " +
            "neglected brood develops slower and can die if left untended too long. Adults die " +
            "of old age at a randomly-rolled lifespan, or from starvation, cold, a predator " +
            "strike, or a random surface hazard while out foraging.",
    },
    {
        title: "The queen",
        body:
            "Confined to the nest, she lays eggs probabilistically based on food stores, " +
            "population, season, and available nursery space — and depends entirely on " +
            "foragers feeding her, since she can't feed herself. She can die of old age or " +
            "starvation just like anyone else, and the colony has no queen again until a " +
            "replacement is raised.",
    },
    {
        title: "The predator",
        body:
            "A lone predator occasionally wanders onto the surface — more likely in some " +
            "seasons and weather. She'll lock onto and chase any ant she spots within range, " +
            "giving up after a while if the chase drags on too long, and may linger near a " +
            "large graveyard before eventually wandering off.",
    },
    {
        title: "Season and weather",
        body:
            "Season sets how much food spawns, how fast the queen lays, and how fast brood " +
            "develops — all at their lowest in winter. Cold snaps below a threshold add a " +
            "chance of death by exposure each tick. Rain speeds up trail scent evaporation, " +
            "and both rain and wind raise the odds of a random surface hazard while foraging.",
    },
];

let stylesInjected = false;

function injectStyles(): void {
    if (stylesInjected) {
        return;
    }
    stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
        .ant-farm-info-backdrop {
            position: fixed;
            inset: 0;
            z-index: 2000;
            background: rgba(10, 8, 4, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
        }
        .ant-farm-info-backdrop[hidden] {
            display: none;
        }
        /* Same palette as the panels and the ant card. */
        .ant-farm-info-modal {
            box-sizing: border-box;
            width: min(34rem, 100%);
            max-height: calc(100vh - 3rem);
            max-height: calc(100dvh - 3rem);
            overflow-y: auto;
            background: rgba(26, 20, 12, 0.96);
            border: 1px solid rgba(200, 184, 152, 0.4);
            border-top: 3px solid #c8b898;
            border-radius: 10px;
            box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
            color: #f0e6d2;
            font: 13px/1.55 sans-serif;
            padding: 0.9rem 1.1rem 1.2rem;
        }
        /* The exit button lives in the first line of the text, so it scrolls
           away with it rather than staying pinned to the screen. */
        .ant-farm-info-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 0.75rem;
        }
        .ant-farm-info-modal h2 {
            margin: 0;
            font-family: Georgia, "Times New Roman", serif;
            font-size: 1.25rem;
            line-height: 1.2;
        }
        .ant-farm-info-sub {
            margin-top: 0.15rem;
            font-size: 0.7rem;
            color: #c8b898;
        }
        .ant-farm-info-close {
            flex: none;
            width: 2rem;
            height: 2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            border: 1px solid rgba(200, 184, 152, 0.5);
            background: rgba(240, 230, 210, 0.08);
            color: #f0e6d2;
            cursor: pointer;
            padding: 0;
        }
        .ant-farm-info-close:hover { background: rgba(240, 230, 210, 0.2); }
        .ant-farm-info-section {
            margin-top: 0.85rem;
            padding-top: 0.6rem;
            border-top: 1px solid rgba(200, 184, 152, 0.18);
        }
        .ant-farm-info-modal h3 {
            margin: 0 0 0.3rem;
            font-size: 0.66rem;
            font-weight: 600;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: #e0c890;
        }
        .ant-farm-info-modal p {
            margin: 0;
            color: #e6d9bd;
        }
    `;
    document.head.appendChild(style);
}

export type AntInfoPanel = {
    open: () => void;
};

export function mountAntInfo(container: HTMLElement): AntInfoPanel {
    injectStyles();

    const backdrop = document.createElement("div");
    backdrop.className = "ant-farm-info-backdrop";
    backdrop.hidden = true;

    const modal = document.createElement("div");
    modal.className = "ant-farm-info-modal";

    const head = document.createElement("div");
    head.className = "ant-farm-info-head";
    const titles = document.createElement("div");
    const heading = document.createElement("h2");
    heading.textContent = "About the colony";
    const sub = document.createElement("div");
    sub.className = "ant-farm-info-sub";
    sub.textContent = "How this simulated colony actually works";
    titles.append(heading, sub);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ant-farm-info-close";
    closeButton.setAttribute("aria-label", "Close");
    setIcon(closeButton, "close", 0.85);
    head.append(titles, closeButton);
    modal.append(head);

    for (const { title, body } of SECTIONS) {
        const section = document.createElement("div");
        section.className = "ant-farm-info-section";
        const h3 = document.createElement("h3");
        h3.textContent = title;
        const p = document.createElement("p");
        p.textContent = body;
        section.append(h3, p);
        modal.append(section);
    }

    backdrop.append(modal);
    container.appendChild(backdrop);

    function close(): void {
        backdrop.hidden = true;
    }

    closeButton.addEventListener("click", close);
    // Clicking the dimmed backdrop (not the modal itself) closes it too —
    // modal clicks stop propagation so they don't bubble up and self-close.
    backdrop.addEventListener("click", close);
    modal.addEventListener("click", (event) => event.stopPropagation());

    // Escape closes it too (only while it is open).
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !backdrop.hidden) {
            close();
        }
    });

    return {
        open: () => {
            backdrop.hidden = false;
            modal.scrollTop = 0;
        },
    };
}

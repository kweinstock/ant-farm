// PHASE 15: the screen shown until the colony is actually running. In stream
// mode the renderer starts from a placeholder colony (see main.ts's baseState),
// and even the first Snapshot is only a still picture — the ants stay frozen
// until the first live frames follow it (up to one server alarm later). So this
// covers the page until the live stream is flowing, not merely connected. It
// comes back if the connection drops, and stays up (with a Reload button) when
// the server speaks a newer protocol than this page.
//
// Local mode (SOURCE = "local") never mounts it: the sim is right there.
const STYLE_ID = "ant-farm-loading-style";
// If it's still up after this long, say why it can take a moment.
const HINT_AFTER_MS = 6000;
const FADE_MS = 350;
// Never leave the page covered for longer than this once the colony's state is
// in hand (e.g. a paused alarm): better a still picture than a stuck screen.
const GIVE_UP_AFTER_MS = 15000;

export type LoadingKind = "connecting" | "loading" | "syncing" | "reconnecting";

const MESSAGES: Record<LoadingKind, string> = {
    connecting: "Connecting to the colony…",
    loading: "Loading the colony…",
    syncing: "Syncing with the colony…",
    reconnecting: "Reconnecting to the colony…",
};

function injectStyles(): void {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .ant-farm-loading {
            position: fixed;
            inset: 0;
            z-index: 3000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1.5rem;
            box-sizing: border-box;
            background: radial-gradient(ellipse at 50% 40%, #2a2014 0%, #1a140c 70%);
            color: #f0e6d2;
            font: 14px/1.5 sans-serif;
            opacity: 1;
            transition: opacity ${FADE_MS}ms ease;
        }
        .ant-farm-loading.is-hiding { opacity: 0; pointer-events: none; }
        .ant-farm-loading[hidden] { display: none; }
        .ant-farm-loading-card { text-align: center; max-width: 22rem; }
        .ant-farm-loading-title {
            font-family: Georgia, "Times New Roman", serif;
            font-size: 1.6rem;
            line-height: 1.2;
        }
        .ant-farm-loading-spinner {
            width: 2.4rem;
            height: 2.4rem;
            margin: 1.4rem auto 1rem;
            border-radius: 50%;
            border: 3px solid rgba(200, 184, 152, 0.25);
            border-top-color: #e0b34a;
            animation: ant-farm-spin 0.9s linear infinite;
        }
        .ant-farm-loading.is-blocked .ant-farm-loading-spinner { display: none; }
        .ant-farm-loading-status { color: #e6d9bd; }
        .ant-farm-loading-hint { margin-top: 0.6rem; font-size: 0.8rem; color: #a89878; min-height: 2.4em; }
        .ant-farm-loading-reload {
            margin-top: 1rem;
            padding: 0.5rem 1.1rem;
            border-radius: 10px;
            border: 1px solid rgba(200, 184, 152, 0.5);
            background: rgba(240, 230, 210, 0.1);
            color: #f0e6d2;
            font: inherit;
            cursor: pointer;
        }
        .ant-farm-loading-reload:hover { background: rgba(240, 230, 210, 0.2); }
        @keyframes ant-farm-spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
            .ant-farm-loading { transition: none; }
            .ant-farm-loading-spinner { animation: none; border-top-color: rgba(200, 184, 152, 0.25); }
        }
    `;
    document.head.appendChild(style);
}

export type LoadingScreen = {
    // Show the screen (if it was hidden) with this status.
    show: (kind: LoadingKind) => void;
    // The colony's state has arrived: fade the screen away.
    hide: () => void;
    // This page is older than the server: stay up and offer a reload.
    showUpdateRequired: () => void;
};

export function mountLoadingScreen(parent: HTMLElement, initial: LoadingKind = "connecting"): LoadingScreen {
    injectStyles();

    const root = document.createElement("div");
    root.className = "ant-farm-loading";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");

    const card = document.createElement("div");
    card.className = "ant-farm-loading-card";
    const title = document.createElement("div");
    title.className = "ant-farm-loading-title";
    title.textContent = "Global Ant Farm";
    const spinner = document.createElement("div");
    spinner.className = "ant-farm-loading-spinner";
    const status = document.createElement("div");
    status.className = "ant-farm-loading-status";
    const hint = document.createElement("div");
    hint.className = "ant-farm-loading-hint";
    card.append(title, spinner, status, hint);
    root.appendChild(card);
    parent.appendChild(root);

    let blocked = false;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let giveUpTimer: ReturnType<typeof setTimeout> | undefined;

    function armHint(): void {
        clearTimeout(hintTimer);
        hint.textContent = "";
        hintTimer = setTimeout(() => {
            hint.textContent = "Still working — the colony keeps living while nobody watches, and catches up on that first.";
        }, HINT_AFTER_MS);
    }

    function show(kind: LoadingKind): void {
        if (blocked) {
            return;
        }
        clearTimeout(hideTimer);
        status.textContent = MESSAGES[kind];
        if (kind === "syncing") {
            // The state is here; only the live frames are still to come.
            giveUpTimer ??= setTimeout(() => hide(), GIVE_UP_AFTER_MS);
        }
        const wasHidden = root.hidden || root.classList.contains("is-hiding");
        root.hidden = false;
        root.classList.remove("is-hiding");
        if (wasHidden || kind === "connecting" || kind === "reconnecting") {
            armHint();
        }
    }

    function hide(): void {
        if (blocked || root.hidden) {
            return;
        }
        clearTimeout(hintTimer);
        clearTimeout(giveUpTimer);
        giveUpTimer = undefined;
        root.classList.add("is-hiding");
        hideTimer = setTimeout(() => {
            root.hidden = true;
        }, FADE_MS);
    }

    show(initial);

    return {
        show,
        hide,
        showUpdateRequired: () => {
            blocked = true;
            clearTimeout(hintTimer);
            clearTimeout(giveUpTimer);
            clearTimeout(hideTimer);
            root.hidden = false;
            root.classList.remove("is-hiding");
            root.classList.add("is-blocked");
            status.textContent = "The farm has been updated.";
            hint.textContent = "Reload to pick up the new version.";
            if (!root.querySelector(".ant-farm-loading-reload")) {
                const reload = document.createElement("button");
                reload.type = "button";
                reload.className = "ant-farm-loading-reload";
                reload.textContent = "Reload";
                reload.addEventListener("click", () => location.reload());
                card.appendChild(reload);
            }
        },
    };
}

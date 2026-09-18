// Ant/queen/corpse sprite ART ONLY — this file draws canvases once at
// module load and exports them; it never touches a live render target.
//
// PHASE 12 (ant art, part 2): ants used to be painted straight into the
// flat nest/surface CanvasTexture (a 2D drawAnt() call per ant, every
// frame). They're real 3D objects now — render/ant-props.ts stands one
// upright cutout per ant on the cube itself, the same "canvas-drawn art on
// a PlaneGeometry" technique render/props.ts uses for trees and rocks, so
// ants stop reading as flat paint on the ground and actually stand in the
// scene. This file only builds the sprite ART (the canvas each caste's
// texture is drawn onto, once, at module load) — render/ant-props.ts owns
// placing, rotating, and animating them every frame.
//
// buildAntSprite draws a stylized ant silhouette — segmented body, legs,
// antennae, a big cartoon eye, a thick outline in the Paper-Mario-ish
// direction Phase 12 settled on — onto a transparent canvas, facing +x
// (east). state/interpolate.ts's headingRad uses the same atan2(dy, dx)
// convention (0 = facing +x), so whatever consumes this sprite can rotate
// it directly by heading with no offset. This is still placeholder art —
// no walk-cycle frames, no left/right mirroring beyond rotation — but it's
// a real silhouette instead of a dot.
//
// The corpse sprite lives here too rather than in its own module — it's a
// couple of constants and one small canvas-drawing function, the same size
// class as buildAntSprite. render/corpse-props.ts (not this file) turns it
// into a real decal mesh — corpses used to be a flat 2D drawCorpse() call
// straight into the shared nest/surface CanvasTexture, which is exactly
// what caused them (and brood, and food) to blur and bleed into
// neighboring tiles once zoomed in; see corpse-props.ts's header.

// Source sprite canvas size (rendered once, well above final on-screen size
// so scaling down stays crisp) and its aspect ratio, used by anything that
// draws WORKER_SPRITE/QUEEN_SPRITE at a caste-specific width.
const SPRITE_WIDTH = 96;
const SPRITE_HEIGHT = 60;
export const SPRITE_ASPECT = SPRITE_HEIGHT / SPRITE_WIDTH;

// How wide (in grid tiles) each caste's sprite is drawn — a worker's whole
// body-length spans a bit more than one tile, a queen noticeably more,
// echoing the old WORKER/QUEEN_RADIUS_RATIO split (0.3 vs 0.45) but as a
// body-length instead of a dot radius.
export const WORKER_WIDTH_RATIO = 1.15;
export const QUEEN_WIDTH_RATIO = 1.7;

type AntSpritePalette = {
    bodyColor: string;
    headColor: string;
    highlightColor: string;
    outlineColor: string;
};

const WORKER_PALETTE: AntSpritePalette = {
    bodyColor: "#2b2118",
    headColor: "#1f1710",
    highlightColor: "#4a392a",
    outlineColor: "#0c0906",
};

const QUEEN_PALETTE: AntSpritePalette = {
    bodyColor: "#8a1c3b",
    headColor: "#6e1530",
    highlightColor: "#c96f8a",
    outlineColor: "#3a0b18",
};

// Drawn facing +x (east) — gaster at the back (-x), head at the front (+x).
function buildAntSprite(palette: AntSpritePalette): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_WIDTH;
    canvas.height = SPRITE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for ant sprite");
    }

    const cx = SPRITE_WIDTH / 2;
    const cy = SPRITE_HEIGHT / 2;

    ctx.strokeStyle = palette.outlineColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    // Legs, drawn first so the body segments layer on top of them.
    ctx.beginPath();
    for (const lx of [cx - 22, cx - 6, cx + 9]) {
        ctx.moveTo(lx, cy - 3);
        ctx.lineTo(lx - 9, cy - 19);
        ctx.moveTo(lx, cy + 3);
        ctx.lineTo(lx - 9, cy + 19);
    }
    ctx.stroke();

    // Antennae, forward of the head.
    ctx.beginPath();
    ctx.moveTo(cx + 31, cy - 5);
    ctx.quadraticCurveTo(cx + 44, cy - 19, cx + 52, cy - 23);
    ctx.moveTo(cx + 31, cy + 3);
    ctx.quadraticCurveTo(cx + 45, cy + 11, cx + 53, cy + 15);
    ctx.stroke();

    // Gaster (back segment, largest).
    ctx.fillStyle = palette.bodyColor;
    ctx.beginPath();
    ctx.ellipse(cx - 24, cy, 22, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // A soft highlight patch on the gaster, same trick as
    // render/props.ts's tree-canopy highlight — one cheap ellipse suggests
    // a lit surface without real shading.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = palette.highlightColor;
    ctx.beginPath();
    ctx.ellipse(cx - 30, cy - 6, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Thorax (middle segment).
    ctx.fillStyle = palette.bodyColor;
    ctx.beginPath();
    ctx.ellipse(cx + 2, cy, 13, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Head (front segment).
    ctx.fillStyle = palette.headColor;
    ctx.beginPath();
    ctx.arc(cx + 27, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // A single big cartoon eye reads better than two at this scale.
    ctx.fillStyle = "#f7efe0";
    ctx.beginPath();
    ctx.arc(cx + 31, cy - 3, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.outlineColor;
    ctx.beginPath();
    ctx.arc(cx + 32, cy - 3, 1.7, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
}

export const WORKER_SPRITE = buildAntSprite(WORKER_PALETTE);
export const QUEEN_SPRITE = buildAntSprite(QUEEN_PALETTE);

// A muted, desaturated body with limp splayed legs (irregular angles,
// unlike buildAntSprite's tidy symmetric walking pose) and an X for the
// eye — the universal "this one's dead" cue.
const CORPSE_SPRITE_SIZE = 40;
// How wide (in grid tiles) a corpse decal is drawn — exported for
// render/corpse-props.ts's sizing.
export const CORPSE_WIDTH_RATIO = 0.32;
const CORPSE_COLOR = "#6b6255";
const CORPSE_OUTLINE = "#332e26";

function buildCorpseSprite(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = CORPSE_SPRITE_SIZE;
    canvas.height = CORPSE_SPRITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for corpse sprite");
    }
    const cx = CORPSE_SPRITE_SIZE / 2;
    const cy = CORPSE_SPRITE_SIZE / 2;

    // Limp legs, splayed at irregular angles (unlike buildAntSprite's tidy
    // symmetric walking pose) — drawn first, under the body.
    ctx.strokeStyle = CORPSE_OUTLINE;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    const legs: [number, number, number, number][] = [
        [-6, -3, -13, -10],
        [-1, -5, -4, -15],
        [5, -4, 11, -11],
        [-7, 3, -14, 9],
        [0, 5, 1, 15],
        [6, 4, 13, 10],
    ];
    for (const [x1, y1, x2, y2] of legs) {
        ctx.moveTo(cx + x1, cy + y1);
        ctx.lineTo(cx + x2, cy + y2);
    }
    ctx.stroke();

    // Body — one squashed ellipse plus a small head bump, simpler than
    // buildAntSprite's three segments since a corpse reads at a much
    // smaller size.
    ctx.fillStyle = CORPSE_COLOR;
    ctx.strokeStyle = CORPSE_OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy, 13, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 12, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // An X for the eye — the one cue that reads as "dead" rather than
    // "small ant."
    ctx.strokeStyle = CORPSE_OUTLINE;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + 10, cy - 2);
    ctx.lineTo(cx + 14, cy + 2);
    ctx.moveTo(cx + 14, cy - 2);
    ctx.lineTo(cx + 10, cy + 2);
    ctx.stroke();

    return canvas;
}

export const CORPSE_SPRITE = buildCorpseSprite();

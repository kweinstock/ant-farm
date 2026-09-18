// Procedural placeholder terrain texture — the grass-tuft texture
// render/surface-view.ts tiles over the ground. Still a placeholder —
// Phase 12c's real terrain art replaces it without touching how it's
// composited.
export type GrassOverlayOptions = {
    size: number;
    tuftCount: number;
    bladeColor: string;
};

// Small tuft-of-grass clusters (a few short curved blades fanned up from a
// base point), meant to be tiled via ctx.createPattern(tile, "repeat") over
// an already-filled grass-green base (render/surface-view.ts).
export function buildGrassOverlayTile(options: GrassOverlayOptions): HTMLCanvasElement {
    const { size, tuftCount, bladeColor } = options;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        throw new Error("Could not get 2D canvas context for grass overlay tile");
    }

    ctx.strokeStyle = bladeColor;
    ctx.lineWidth = 1.3;
    ctx.lineCap = "round";

    for (let i = 0; i < tuftCount; i++) {
        const baseX = Math.random() * size;
        const baseY = Math.random() * size;
        const bladeLength = 3 + Math.random() * 3;

        for (const spread of [-0.55, 0, 0.55]) {
            const angle = -Math.PI / 2 + spread + (Math.random() - 0.5) * 0.25;
            const endX = baseX + Math.cos(angle) * bladeLength;
            const endY = baseY + Math.sin(angle) * bladeLength;
            const controlX = baseX + (endX - baseX) * 0.5;
            const controlY = baseY + (endY - baseY) * 0.3;

            ctx.beginPath();
            ctx.moveTo(baseX, baseY);
            ctx.quadraticCurveTo(controlX, controlY, endX, endY);
            ctx.stroke();
        }
    }

    return canvas;
}

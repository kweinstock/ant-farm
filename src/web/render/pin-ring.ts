// PHASE 16: the highlight ring drawn around every pinned ant (render/engine.ts
// places one billboard sprite per pinned ant that is currently on screen).
// A soft gold circle on a transparent canvas — the colour matches the queen's
// accent on the ant card and the pinned state of its pin button.
import * as THREE from "three";

export function buildPinRingTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
        ctx.clearRect(0, 0, size, size);
        // Faint fill so the ring reads against both light ground and dark soil...
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(224, 179, 74, 0.12)";
        ctx.fill();
        // ...then the ring itself, with a dark edge outside it.
        ctx.lineWidth = size * 0.1;
        ctx.strokeStyle = "rgba(26, 20, 12, 0.7)";
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = size * 0.06;
        ctx.strokeStyle = "#e0b34a";
        ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

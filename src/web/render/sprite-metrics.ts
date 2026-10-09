// Measures where a canvas-drawn sprite's actual visible content sits
// vertically, so anything standing upright on the cube (trees, rocks, ants
// — render/props.ts, render/ant-props.ts) can be grounded by where its art
// visually touches the ground, not by the plane geometry's bottom edge.
// Every sprite canvas here is drawn with transparent margin around the
// actual silhouette (so alphaTest can cut it into a cutout at all), and
// that margin is rarely symmetric top-to-bottom — a standing PlaneGeometry
// positioned by "its geometric bottom touches the ground" then visibly
// floats by however much transparent margin sits below the art. Measuring
// the real content bottom instead means this stays correct even if the art
// itself changes, rather than a magic fraction someone eyeballed once.
export function measureContentBottomFraction(canvas: HTMLCanvasElement, alphaThreshold = 10): number {
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        return 1;
    }

    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > alphaThreshold) {
                return (y + 1) / height;
            }
        }
    }

    return 1;
}

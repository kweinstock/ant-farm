// requestAnimationFrame loop + camera (pan/zoom) + layer compositing order:
//   season-fx -> nest-view -> surface-view -> pheromone-layer(optional) ->
//   ants -> weather-fx -> daynight grade -> UI overlay.
// Canvas 2D (or WebGL if ant counts demand it). Pulls render positions from
// state/interpolate.ts each frame.

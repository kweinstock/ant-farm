// ALL balance constants in one place, separated from logic so tuning never means
// editing behavior files. Imported (read-only) across src/sim and re-exported
// from src/sim/index.ts.
//
// Groups: energy costs + regen, starvation thresholds, forage risk curve,
// pheromone deposit/diffuse/evaporate rates, queen laying curve coefficients,
// brood stage durations, mutation magnitude, weather transition matrix,
// resource decay/evaporation rates, predator frequency, disease transmission.
//
// Changing a number here should never break determinism — it just changes the
// trajectory. Keep values as plain literals (no computed expressions that could
// reorder).

// Markov-style weather: current WeatherKind, remaining duration, and a short
// forecast (shown in the HUD). Transition probabilities depend on season
// (SNOW only when cold, HEAT mostly SUMMER). Weather is visualized client-side
// (weather-fx.ts) and mechanically affects pheromone evaporation, movement,
// forage risk, and flooding. Server-only — no visitor input path exists.

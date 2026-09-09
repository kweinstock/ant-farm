import { createInitialState } from "./src/sim/state.ts";
import { step } from "./src/sim/index.ts";
for (const seed of [4001, 2, 3, 13579]) {
  let s = createInitialState(seed, { season: "SPRING", weather: "CLEAR" });
  let peak=0, min=999;
  for (let t = 1; t <= 4500; t++) { s=step(s,1).state; peak=Math.max(peak,s.ants.size); if(t>1500)min=Math.min(min,s.ants.size);}
  console.log(`seed${seed} peak=${peak} min@>1500=${min} end=${s.ants.size} store=${s.foodStore.amount.toFixed(0)} q=${s.ants.has(s.queenId)}`);
}

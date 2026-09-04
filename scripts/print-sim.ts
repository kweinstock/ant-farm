// Not part of the test suite — a scratch script to *watch* the sim, run via
// `npm run test:basic` (tsx, no build step). Safe to keep hacking on this
// file directly; nothing else imports it.
import { createInitialState } from "../src/sim/state";
import { step } from "../src/sim";

const seed = 12345;
const MAX_TICKS = 1001;

let state = createInitialState(seed);

for (let tick = 1; tick <= MAX_TICKS; tick++) {
  const result = step(state, 1);
  state = result.state;

  console.clear();

  console.log(`Tick: ${tick}`);

  if (state.ant === null) {
    console.log("Ant: DEAD");
  } else {
    console.log(`Age: ${state.ant.ageTicks}`);
    console.log(`Energy: ${state.ant.energy}`);
    console.log(`Position: (${state.ant.position.x}, ${state.ant.position.y})`);
  }

  console.log();

  // Print the grid
  for (let y = 0; y < state.grid.height; y++) {
    let row = "";

    for (let x = 0; x < state.grid.width; x++) {
      if (
        state.ant !== null &&
        state.ant.position.x === x &&
        state.ant.position.y === y
      ) {
        row += "@";
      } else {
        row += ".";
      }
    }

    console.log(row);
  }

  if (state.ant === null) {
    console.log();
    console.log(`Died at tick ${tick}`);
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
}

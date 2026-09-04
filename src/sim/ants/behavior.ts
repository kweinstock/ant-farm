// The rule engine. Each job has an ORDERED list of condition -> action rules;
// the first whose condition fires this tick wins. Example worker ordering:
//   threat nearby            -> raise alarm / attack
//   carrying food & inside   -> deposit in granary
//   starving                 -> eat from stores
//   on a strong trail        -> follow gradient
//   recruited                -> move toward recruit signal
//   job task available       -> do job (jobs.ts)
//   else                     -> wander (biased by memory)
//
// Deliberately small and legible — emergent complexity is the goal, so resist
// adding special-case rules. Randomness via state rng only.

# Ant biology the model tries to honor

Reference notes for tuning `src/sim`. The goal is *plausible*, not a research
simulation. Where a real fact and a fun simulation conflict, favor readability —
but write down the deviation.

## Colony structure

- One **queen** is the reproductive center: lays all eggs, ensures continuity.
  Mates with multiple males during a single **nuptial flight**, stores sperm for
  life, and meters it out to fertilize eggs. Larger and much longer-lived than
  workers (years vs weeks–months).
- **Workers** are sterile females and do everything else. Their role shifts with
  age — **temporal polyethism**: young workers do internal tasks (brood care,
  nest work), older workers move to external, riskier tasks (foraging, defense,
  refuse). Model this as a soft age → job mapping plus response to colony need.
- **Males (drones)** exist only to mate. They leave on the nuptial flight and die
  soon after.
- **Soldiers** (in species that have them) are workers specialized for defense —
  larger, stronger jaws, sometimes chemical defenses.

## Worker tasks

| Task | Model hook |
| --- | --- |
| Foraging — nectar, seeds, insects; recruit via pheromone trails | `foraging.ts`, `pheromones.ts` TRAIL layer |
| Brood care — feed/clean eggs, larvae, pupae; move brood to optimal temp/humidity | `colony/brood.ts`, `ants/jobs.ts` nurse actions |
| Nest maintenance — dig/repair tunnels + chambers, ventilation, storage | `world/nest.ts`, `ants/jobs.ts` builder actions |
| Defense — repel predators/threats, alarm recruitment | `pheromones.ts` ALARM layer, soldier job |
| Waste management — remove debris and corpses, nest hygiene | undertaker job, `world/nest.ts` MIDDEN |

## Reproduction & genetics

- **Haplodiploidy**: fertilized eggs → diploid females (workers or new queens);
  unfertilized eggs → haploid males. Larva fate (worker vs gyne) is driven mostly
  by **nutrition** and colony conditions.
- New queens and males are produced **seasonally** as winged **alates**, then
  leave on the nuptial flight. Founding new colonies is out of scope for v1 —
  departing gynes are treated as emigration plus a lineage note.

## Life cycle

Egg → larva → pupa → adult. Development speed depends on temperature and feeding.
Adults emerge into an age-appropriate job.

## Environment sensitivity

- Colony activity, foraging, and brood development all scale with **temperature**
  and **season**.
- Ants actively **thermoregulate the brood** by relocating it within the nest.
- **Weather** (rain, cold) suppresses foraging and can flood shallow nests.
- Nest depth **buffers** temperature swings.

## Stigmergy (why "simple rules → complex colony")

Ants coordinate mostly through the **environment**, not direct commands: a
forager drops trail pheromone, others follow and reinforce it, the trail decays
if unused. Alarm pheromone triggers defense. This indirect coordination
(*stigmergy*) is the core mechanic — model the pheromone layers well and much of
the interesting colony behavior falls out for free.

## Deliberate simplifications (v1)

- One species' worth of behavior, not a configurable taxonomy.
- No multi-queen colonies, no colony budding, no slave-making or parasitism.
- Foraging targets are abstract "food" and "water", not distinct nutrients.
- Disease is a single abstract contagion, not modeled pathogens.

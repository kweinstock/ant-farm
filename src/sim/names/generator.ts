// deterministicName(lineageId, birthIndex, rng) -> { given, surname }
// Surname is stable per lineage (so a dynasty reads coherently); given name is
// drawn from wordlists.ts. Fully deterministic so replays reproduce identical
// names.

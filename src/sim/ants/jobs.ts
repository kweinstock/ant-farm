// Per-job action implementations + the age->job assignment ("temporal
// polyethism"): young adults do NURSE / NEST_WORKER / BUILDER inside; older
// adults become FORAGER / SOLDIER / UNDERTAKER outside. Reassignment also
// responds to colony need (lots of brood -> more nurses; corpses piling up ->
// more undertakers) so the workforce self-balances.
//
// Actions: forage (delegates to foraging.ts), nurseBrood, buildTunnel,
// repairChamber, defend, haulCorpseToMidden, tendGranary.

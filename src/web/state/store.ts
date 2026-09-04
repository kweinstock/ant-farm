// Client mirror of the colony. Holds the latest Snapshot plus reducers that
// apply Diff change-sets. Exposes subscribe() for the render loop and UI.
// Also tracks client-only state: selected ant, camera, active tool, pin set,
// last server tick time (for interpolation).

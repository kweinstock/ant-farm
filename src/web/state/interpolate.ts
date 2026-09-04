// Smooths ant motion between server ticks: given prev + current positions and
// the time since the last tick, produce render positions. Snaps (no interp) on
// teleport-like jumps (death removal, resync).

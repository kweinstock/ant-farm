// Family-tree bookkeeping. On each Birth, records parent->child edges and the
// child's LineageId (inherited from the mother's line). Tracks per-lineage
// founding time, member count, and living count; when living count hits zero
// emits LineageExtinct (surfaced in the web "roll of the dead"). Edge + node
// data is streamed to D1 by the Worker for the family-tree UI.

// GET /ant-farm/api/lineage/:lineageId   full family tree as nested LineageNode,
//                                        built from lineage_edge + ant rows in D1.
// GET /ant-farm/api/lineage              "roll of the dead": extinct lineages +
//                                        notable ants (most-pinned, longest-lived,
//                                        founders). Cached in KV.

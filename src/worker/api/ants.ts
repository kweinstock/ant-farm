// GET /ant-farm/api/ants        paginated list of LIVING ants (AntSummary): name,
//                               caste, job, age. Served from KV cache when warm,
//                               else D1 (ant WHERE died_at IS NULL), cache for ~60s.
// GET /ant-farm/api/ants/:id    AntDetail: stats + parents + children count +
//                               lineage crumb + memory digest. D1 join; if the ant
//                               is alive, the client merges live pos/energy from
//                               the current snapshot.

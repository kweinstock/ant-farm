// Connection registry on top of the Hibernation API. Per socket, stores small
// metadata via serializeAttachment (currently just the last snapshot sequence
// number acked). ctx.getWebSockets() (colony-do.ts / broadcast.ts) is always
// the authoritative list of live sockets — this file never keeps its own
// array, since that wouldn't survive hibernation eviction the way
// serializeAttachment does.

export interface ConnectionMeta {
    lastAckedSeq: number;
}

export function registerConnection(ws: WebSocket, meta: ConnectionMeta): void {
    ws.serializeAttachment(meta);
}

export function getConnectionMeta(ws: WebSocket): ConnectionMeta | null {
    return (ws.deserializeAttachment() as ConnectionMeta | null) ?? null;
}

export function setConnectionMeta(ws: WebSocket, meta: ConnectionMeta): void {
    ws.serializeAttachment(meta);
}

export function unregisterConnection(_ws: WebSocket): void {}

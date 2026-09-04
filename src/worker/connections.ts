// Connection registry on top of the Hibernation API. Per socket, stores small
// metadata via serializeAttachment (visitorId, last acked seq, viewport). Helpers
// to iterate live sockets, look one up, and garbage-collect on close. No state of
// its own beyond what the runtime keeps for hibernating sockets.

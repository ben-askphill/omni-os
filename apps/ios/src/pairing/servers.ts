export interface PairedServer {
  id: string;
  name: string;
  origin: string;
  sessionId: string;
  pairedAt: string;
}

export interface ServerIndex {
  activeId: string | null;
  servers: PairedServer[];
}

export const emptyIndex: ServerIndex = { activeId: null, servers: [] };

export function defaultServerName(origin: string): string {
  return new URL(origin).hostname;
}

export function activeServer(index: ServerIndex): PairedServer | null {
  return index.servers.find((server) => server.id === index.activeId) ?? null;
}

/** One record per origin: pairing again replaces the old record in place and makes it active. */
export function upsertServer(index: ServerIndex, server: PairedServer): ServerIndex {
  const existing = index.servers.findIndex((candidate) => candidate.origin === server.origin);
  const servers =
    existing === -1
      ? [...index.servers, server]
      : index.servers.map((candidate, i) => (i === existing ? server : candidate));
  return { activeId: server.id, servers };
}

export function setActive(index: ServerIndex, id: string): ServerIndex {
  if (!index.servers.some((server) => server.id === id)) return index;
  return { ...index, activeId: id };
}

export function removeServer(index: ServerIndex, id: string): ServerIndex {
  const servers = index.servers.filter((server) => server.id !== id);
  if (index.activeId !== id) return { ...index, servers };
  return { activeId: servers[0]?.id ?? null, servers };
}

export function serializeServerIndex(index: ServerIndex): string {
  return JSON.stringify(index);
}

/** Anything that is not a well-formed index is an empty one; a stale `activeId` falls back to the first server. */
export function parseServerIndex(value: unknown): ServerIndex {
  if (typeof value !== 'object' || value === null) return emptyIndex;
  const { activeId, servers } = value as Record<string, unknown>;
  if (!Array.isArray(servers) || !servers.every(isPairedServer)) return emptyIndex;
  if (activeId !== null && typeof activeId !== 'string') return emptyIndex;
  const ids = new Set(servers.map((server) => server.id));
  if (ids.size !== servers.length) return emptyIndex;

  const resolvedActive = activeId !== null && ids.has(activeId) ? activeId : (servers[0]?.id ?? null);
  return { activeId: resolvedActive, servers };
}

export function parseStoredServerIndex(text: string | null): ServerIndex {
  if (text === null) return emptyIndex;
  try {
    return parseServerIndex(JSON.parse(text));
  } catch {
    return emptyIndex;
  }
}

function isPairedServer(value: unknown): value is PairedServer {
  if (typeof value !== 'object' || value === null) return false;
  const server = value as Record<string, unknown>;
  return (
    typeof server.id === 'string' &&
    server.id !== '' &&
    typeof server.name === 'string' &&
    typeof server.origin === 'string' &&
    typeof server.sessionId === 'string' &&
    typeof server.pairedAt === 'string'
  );
}

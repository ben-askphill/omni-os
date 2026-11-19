declare const brand: unique symbol;

/**
 * A thread on one paired server. A cloned install keeps its thread ids, so two servers can hold threads with the same
 * id. What the phone keeps for a thread's next message (the text, the staged files and the Changes context) is filed
 * under this key, never under the bare id, so it stays with the server it was written for.
 */
export type ThreadKey = string & { readonly [brand]: true };

export const threadKey = (serverId: string, threadId: string): ThreadKey => JSON.stringify([serverId, threadId]) as ThreadKey;

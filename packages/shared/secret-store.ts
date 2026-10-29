// Where a server keeps secret values, as GET /api/status reports it in `server.secretStore`. The server picks the store
// (apps/server/secret-store.ts); clients name it in their Secrets, Sync and Automations copy. The Mac app mirrors
// this in OmniKit SecretStore.swift.

export const SECRET_STORES = ['keychain', 'libsecret', 'file'] as const;
export type SecretStoreKind = (typeof SECRET_STORES)[number];

/** A store kind from the server, or keychain for an older server that does not say: those only ran on a Mac. */
export function secretStoreKind(raw: unknown): SecretStoreKind {
  return (SECRET_STORES as readonly unknown[]).includes(raw) ? (raw as SecretStoreKind) : 'keychain';
}

/** The store as a sentence names it: "Values live in {label}." */
export function secretStoreLabel(kind: SecretStoreKind): string {
  switch (kind) {
    case 'keychain':
      return "the server Mac's Keychain";
    case 'libsecret':
      return "the server's system keyring";
    case 'file':
      return "a private file on the server (data/secrets.json)";
  }
}

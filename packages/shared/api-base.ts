// Where the Web UI keeps the base of its /api requests (apps/web/src/api-base.ts): localStorage, which is per origin,
// port included. The server's QR pairing page writes the same key (apps/server/auth-api.ts GET /pair-link).
export const API_BASE_STORE_KEY = 'omni.api';

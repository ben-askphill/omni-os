import { apiPath, createHttpClient, OmniHttpError, parseBaseUrl, type Fetch, type HttpClient } from '@omni/client-core';
import type { AppPairingRedeemResponse, ServerCapabilities } from '@omni/shared/app-pairing.ts';

export const SUPPORTED_API_VERSION = 1;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export type PairingApiErrorKind =
  | 'invalid-input'
  | 'code-unavailable'
  | 'rate-limited'
  | 'unauthorized'
  | 'incompatible'
  | 'unreachable'
  | 'server-error';

export class PairingApiError extends Error {
  readonly kind: PairingApiErrorKind;
  readonly origin: string;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly api?: number;

  constructor(
    kind: PairingApiErrorKind,
    details: { origin: string; status?: number; retryAfterSeconds?: number; api?: number },
  ) {
    super(`Pairing request failed: ${kind}`);
    this.name = 'PairingApiError';
    this.kind = kind;
    this.origin = details.origin;
    if (details.status !== undefined) this.status = details.status;
    if (details.retryAfterSeconds !== undefined) this.retryAfterSeconds = details.retryAfterSeconds;
    if (details.api !== undefined) this.api = details.api;
  }
}

export interface PairingApi {
  redeemPairingCode(input: {
    origin: string;
    code: string;
    name: string;
  }): Promise<AppPairingRedeemResponse>;
  fetchCapabilities(input: { origin: string; token: string }): Promise<ServerCapabilities>;
  signOut(input: { origin: string; token: string }): Promise<void>;
  /** Takes this phone's push token off the server. Needs the session, so it runs before `signOut`. Deleting what is not there succeeds. */
  deletePushToken(input: { origin: string; token: string }): Promise<void>;
}

export interface PairingApiOptions {
  fetch?: Fetch;
  timeoutMs?: number;
}

type StatusKinds = Partial<Record<number, PairingApiErrorKind>>;

/** Pairing's three calls on the shared HTTP layer: no redirect is followed, one timeout covers the body, one error type. */
export function createPairingApi(options: PairingApiOptions = {}): PairingApi {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    origin: string,
    token: string | undefined,
    byStatus: StatusKinds,
    badBody: PairingApiErrorKind,
    run: (http: HttpClient) => Promise<T>,
  ): Promise<T> {
    try {
      const baseUrl = parseBaseUrl(origin);
      if (!baseUrl) throw new PairingApiError('unreachable', { origin });
      return await run(createHttpClient({ baseUrl, token: token ?? null, fetch: options.fetch, timeoutMs }));
    } catch (error) {
      throw toPairingError(origin, error, byStatus, badBody);
    }
  }

  return {
    redeemPairingCode({ origin, code, name }) {
      const statuses: StatusKinds = { 400: 'invalid-input', 404: 'code-unavailable', 429: 'rate-limited' };
      return call(origin, undefined, statuses, 'server-error', async (http) => {
        const body = await http.request('POST', apiPath`/auth/app-pairings/redeem`, { body: { code, name } });
        if (isRecord(body) && isNonEmptyString(body.token) && isNonEmptyString(body.sessionId)) {
          return { token: body.token, sessionId: body.sessionId };
        }
        throw new PairingApiError('server-error', { origin });
      });
    },

    fetchCapabilities({ origin, token }) {
      return call(origin, token, { 401: 'unauthorized', 404: 'incompatible' }, 'incompatible', async (http) => {
        const body = await http.request('GET', apiPath`/capabilities`);
        if (!isRecord(body)) throw new PairingApiError('incompatible', { origin });
        if (body.api !== SUPPORTED_API_VERSION) {
          const api = typeof body.api === 'number' ? body.api : undefined;
          throw new PairingApiError('incompatible', { origin, ...(api !== undefined && { api }) });
        }
        if (!hasCapabilitySections(body)) throw new PairingApiError('incompatible', { origin });
        return body as unknown as ServerCapabilities;
      });
    },

    signOut({ origin, token }) {
      return call(origin, token, { 401: 'unauthorized' }, 'server-error', async (http) => {
        await http.request('POST', apiPath`/auth/signout`).catch((error: unknown) => {
          // Any 2xx answer signed the phone out, whatever its body was.
          const failure = error instanceof OmniHttpError ? error.failure : null;
          if (failure?.kind !== 'not-json' && failure?.kind !== 'decoding') throw error;
        });
      });
    },

    deletePushToken({ origin, token }) {
      return call(origin, token, { 401: 'unauthorized' }, 'server-error', async (http) => {
        await http.request('DELETE', apiPath`/auth/push-token`);
      });
    },
  };
}

/** An answer with a status gets the kind its status maps to. Anything without an answer is unreachable. */
function toPairingError(
  origin: string,
  error: unknown,
  byStatus: StatusKinds,
  badBody: PairingApiErrorKind,
): PairingApiError {
  if (error instanceof PairingApiError) return error;
  if (!(error instanceof OmniHttpError)) return new PairingApiError('unreachable', { origin });

  const failure = error.failure;
  switch (failure.kind) {
    case 'http': {
      const kind = byStatus[failure.status] ?? 'server-error';
      return new PairingApiError(kind, {
        origin,
        status: failure.status,
        ...(kind === 'rate-limited' && { retryAfterSeconds: parseRetryAfter(failure.retryAfter) }),
      });
    }
    case 'not-json':
    case 'decoding':
      return new PairingApiError(badBody, { origin });
    case 'unreachable':
    case 'cancelled':
    case 'redirect':
      return new PairingApiError('unreachable', { origin });
  }
}

function parseRetryAfter(header: string | null): number {
  if (header !== null && /^\d+$/.test(header.trim())) {
    const seconds = Number.parseInt(header, 10);
    if (seconds > 0) return seconds;
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function hasCapabilitySections(body: Record<string, unknown>): boolean {
  return ['auth', 'pairing', 'push', 'streams'].every((key) => isRecord(body[key]));
}

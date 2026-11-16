// Whether the server on the install's port is this install's Omni, asked without the token: GET /api/auth/proof
// answers an HMAC of its port and a nonce under its token, the probe the desktop app makes before it starts or attaches
// (apps/desktop/src/backend/launch.ts). `doctor` reports it; every other command needs it before it sends the token.
import { createHmac } from 'node:crypto';
import type { Connection } from './connection.ts';
import type { Io } from './io.ts';

export const PROBE_MS = 2000;

/** What answers on the port. `mine` is null when there is no token to check the proof with, or the server is remote. */
export type Probe = { kind: 'free' } | { kind: 'slow' } | { kind: 'not-omni'; detail: string } | { kind: 'omni'; mine: boolean | null };

/** The proof an Omni server answers GET /api/auth/proof with: an HMAC of its port and the nonce under its token. */
export const proofFor = (token: string, port: number, nonce: string) => createHmac('sha256', token).update(`omni-proof:${port}:${nonce}`).digest('hex');

function errnoOf(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string; errors?: { code?: string }[] } } | null)?.cause;
  return cause?.code ?? cause?.errors?.find((e) => e.code)?.code;
}

export async function probe(io: Pick<Io, 'fetch' | 'uuid'>, conn: Connection): Promise<Probe> {
  const nonce = io.uuid().replace(/-/g, '');
  let status: number;
  let body: string;
  try {
    const res = await io.fetch(`${conn.baseUrl}/api/auth/proof?nonce=${nonce}`, { method: 'GET', headers: {}, redirect: 'manual', signal: AbortSignal.timeout(PROBE_MS) });
    status = res.status;
    body = await res.text();
  } catch (err) {
    if (errnoOf(err) === 'ECONNREFUSED') return { kind: 'free' };
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'slow' };
    return { kind: 'not-omni', detail: 'nothing answered as HTTP' };
  }
  let proof: unknown = null;
  try {
    proof = (JSON.parse(body) as { proof?: unknown }).proof;
  } catch {
    proof = null;
  }
  if (status !== 200 || typeof proof !== 'string') return { kind: 'not-omni', detail: `it answered ${status}, not an Omni proof` };
  const token = conn.token();
  // Through a tunnel or proxy the server signs its own port, not the one in OMNI_URL: only a local proof can be checked.
  if (!token || conn.remote) return { kind: 'omni', mine: null };
  return { kind: 'omni', mine: proof === proofFor(token, conn.port, nonce) };
}

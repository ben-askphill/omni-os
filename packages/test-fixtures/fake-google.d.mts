import type { KeyObject } from 'node:crypto';

export type FakeAccount = { email: string; name: string; sub: string; email_verified: boolean | string; hd?: string };

export declare const FAKE_ACCOUNTS: FakeAccount[];

export type FakeGoogle = {
  url: string;
  endpoints: { auth: string; token: string; jwks: string };
  accounts: FakeAccount[];
  idTokenFor(account: FakeAccount, clientId: string, nonce: string | null, now?: number): string;
  signIdToken(claims: Record<string, unknown>, key?: KeyObject, keyId?: string): string;
  close(): Promise<void>;
};

export declare function startFakeGoogle(options?: {
  port?: number;
  host?: string;
  accounts?: FakeAccount[];
  clients?: Record<string, string | null>;
  ttlSeconds?: number;
}): Promise<FakeGoogle>;

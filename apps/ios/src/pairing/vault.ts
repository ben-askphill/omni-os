import type { ServerIndex } from './servers';

export interface CredentialVault {
  loadIndex(): Promise<ServerIndex>;
  saveIndex(index: ServerIndex): Promise<void>;
  getToken(id: string): Promise<string | null>;
  setToken(id: string, token: string): Promise<void>;
  deleteToken(id: string): Promise<void>;
}

export class VaultError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Secure storage ${operation} failed`, { cause });
    this.name = 'VaultError';
  }
}

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { globalSecret, setSecret, SIGN_SECRET_NAME } from '../secrets.ts';
import { privateKeyFromDer, rawPublicKey } from './signing.ts';

// This machine's Ed25519 key for the sync changes it pushes (sync/signing.ts). The private half stays in the secret
// store (never handed to a thread, secrets.ts); the public half goes out in the device record (sync/devices.ts).

let own: Promise<KeyObject> | null = null;

/** This machine's signing key, made and saved the first time it is asked for. */
export function signingKey(): Promise<KeyObject> {
  own ??= (async () => {
    const saved = await globalSecret(SIGN_SECRET_NAME);
    if (saved) return privateKeyFromDer(saved);
    const { privateKey } = generateKeyPairSync('ed25519');
    await setSecret('global', SIGN_SECRET_NAME, privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'));
    return privateKey;
  })().catch((err) => {
    // The test runner's Keychain stub stores nothing (tests/runner-boot.ts). Each machine a test plays loads its own
    // copy of this module, so a key kept here is still one per machine.
    if (process.env.VITEST) return generateKeyPairSync('ed25519').privateKey;
    own = null;
    throw err;
  });
  return own;
}

/** The public half for the device record, base64url raw Ed25519. */
export const signPublicKey = async (): Promise<string> => rawPublicKey(await signingKey());

/** For tests: forget the cached key, so the next call reads the secret store again. */
export const resetSigningKey = () => void (own = null);

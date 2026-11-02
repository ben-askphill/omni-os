import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { generateKeyPairSync, verify } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { classify, http2Transport, providerTokens, reasonOf, signProviderToken, type ApnsKey } from '../push-apns.ts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const KEY: ApnsKey = {
  keyId: 'ABC123DEFG',
  teamId: 'TEAM123456',
  pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

describe('the provider token', () => {
  it('is an ES256 JWT that verifies against the key and names the key id and team', () => {
    const jwt = signProviderToken(KEY, 1_700_000_000);
    const [header, claims, sig] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'ES256', kid: KEY.keyId });
    expect(decode(claims)).toEqual({ iss: KEY.teamId, iat: 1_700_000_000 });
    // The raw r||s form a JWT carries; a DER signature would fail here.
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('is reused for fifty minutes, then signed again', () => {
    let clock = 1_700_000_000_000;
    const tokens = providerTokens(KEY, () => clock);
    const first = tokens.get();
    clock += 49 * 60_000;
    expect(tokens.get()).toBe(first);
    clock += 2 * 60_000;
    expect(tokens.get()).not.toBe(first);
  });

  it('is signed again on demand, for after APNs says it expired', () => {
    let clock = 1_700_000_000_000;
    const tokens = providerTokens(KEY, () => clock);
    const first = tokens.get();
    clock += 1_000;
    tokens.refresh();
    expect(tokens.get()).not.toBe(first);
  });
});

describe('what APNs answered', () => {
  it.each<[number, string | null, ReturnType<typeof classify>]>([
    [200, null, 'delivered'],
    [410, 'Unregistered', 'forget'],
    [400, 'BadDeviceToken', 'forget'],
    [403, 'ExpiredProviderToken', 'refresh'],
    [429, 'TooManyRequests', 'retry'],
    [503, 'ServiceUnavailable', 'retry'],
    [0, 'network', 'retry'],
    [400, 'PayloadTooLarge', 'drop'],
    [400, 'DeviceTokenNotForTopic', 'drop'],
    [403, 'InvalidProviderToken', 'drop'],
    [413, null, 'drop'],
  ])('status %i %s is %s', (status, reason, action) => {
    expect(classify(status, reason)).toBe(action);
  });

  it('reads the reason from the error body and gives none for anything else', () => {
    expect(reasonOf('{"reason":"BadDeviceToken"}')).toBe('BadDeviceToken');
    expect(reasonOf('')).toBeNull();
    expect(reasonOf('not json')).toBeNull();
    expect(reasonOf('{"reason":5}')).toBeNull();
  });
});

describe('the HTTP/2 transport', () => {
  let server: http2.Http2Server | undefined;
  let transport: ReturnType<typeof http2Transport> | undefined;

  afterEach(async () => {
    transport?.close();
    transport = undefined;
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  /** A local h2c server standing in for APNs. `answer` decides each request's response. */
  async function fakeApns(answer: (path: string, headers: http2.IncomingHttpHeaders, body: string, stream: http2.ServerHttp2Stream) => void) {
    server = http2.createServer();
    server.on('stream', (stream: http2.ServerHttp2Stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => (body += chunk));
      stream.on('end', () => answer(String(headers[':path']), headers, body, stream));
    });
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', () => done()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('posts the alert to the device path with the headers APNs requires, and returns the answer', async () => {
    let seen: { path: string; headers: http2.IncomingHttpHeaders; body: string } | undefined;
    const origin = await fakeApns((path, headers, body, stream) => {
      seen = { path, headers, body };
      stream.respond({ ':status': 200 });
      stream.end();
    });
    transport = http2Transport({ origins: { sandbox: origin, production: origin }, timeoutMs: 2_000 });
    const answer = await transport.send({
      environment: 'sandbox',
      token: 'abcdef0123',
      topic: 'app.omni-os.ios',
      jwt: 'jwt-value',
      body: '{"aps":{}}',
      expiration: 1_700_000_900,
    });
    expect(answer).toEqual({ status: 200, reason: null });
    expect(seen?.path).toBe('/3/device/abcdef0123');
    expect(seen?.headers).toMatchObject({
      ':method': 'POST',
      authorization: 'bearer jwt-value',
      'apns-topic': 'app.omni-os.ios',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': '1700000900',
    });
    expect(seen?.body).toBe('{"aps":{}}');
  });

  it('reads the reason from a refusal', async () => {
    const origin = await fakeApns((_path, _headers, _body, stream) => {
      stream.respond({ ':status': 410 });
      stream.end('{"reason":"Unregistered","timestamp":1}');
    });
    transport = http2Transport({ origins: { sandbox: origin, production: origin }, timeoutMs: 2_000 });
    const answer = await transport.send({ environment: 'sandbox', token: 'dead', topic: 't', jwt: 'j', body: '{}', expiration: 1 });
    expect(answer).toEqual({ status: 410, reason: 'Unregistered' });
  });

  it('rejects a request APNs leaves unanswered, so the sender treats it as a network failure', async () => {
    const origin = await fakeApns(() => {
      // Never answers.
    });
    transport = http2Transport({ origins: { sandbox: origin, production: origin }, timeoutMs: 50 });
    await expect(transport.send({ environment: 'sandbox', token: 'abc', topic: 't', jwt: 'j', body: '{}', expiration: 1 })).rejects.toThrow();
  });
});

#!/usr/bin/env node
// A local stand-in for the Cloudflare relay (apps/relay) for QA: the same HTTP and WebSocket protocol the server's
// sync transport speaks (apps/server/sync/transport.ts), kept in memory, behind one shared token. No Clerk, no
// per-machine tokens, no Omni Connect. Node built-ins only, so it runs wherever the server does.
//
//   node scripts/qa-relay.mjs <port> <token>
//
// Prints "listening <url>" on stdout once it takes connections. Restarting it forgets everything, so restart the
// servers' sync state with it (scripts/qa-handoff-stack.sh does).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const [port = '0', token = ''] = process.argv.slice(2);
if (!token) {
  console.error('usage: qa-relay.mjs <port> <token>');
  process.exit(2);
}

const MAX_BATCH = 1000;
const ENTITY = /^[a-z][a-z_]{0,39}$/;
const changes = [];
const objects = new Map();
let seq = 0;
/** Open WebSockets, with the machine each one belongs to. */
const sockets = new Set();

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const fail = (res, status, error, code) => json(res, status, { error, ...(code && { code }) });

function bearer(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  for (const p of (req.headers['sec-websocket-protocol'] ?? '').split(',')) if (p.trim().startsWith('bearer.')) return p.trim().slice(7);
  return null;
}
const signedOut = (res) => fail(res, 401, 'This machine is signed out of the relay', 'signed_out');

/** One change as the real relay checks it (apps/relay/src/store.ts checkChange), or null. */
function checkChange(c) {
  const s = (k, max) => (typeof c?.[k] === 'string' && c[k] && c[k].length <= max ? c[k] : null);
  const entity = s('entity', 40);
  const ts = new Date(s('ts', 40) ?? NaN);
  const machine = s('machine_id', 200);
  const id = s('entity_id', 1000);
  if (!entity || !ENTITY.test(entity) || !machine || !id || Number.isNaN(ts.getTime()) || (c.op !== 'upsert' && c.op !== 'delete')) return null;
  return { machine_id: machine, entity, entity_id: id, op: c.op, data: c.data ?? null, ts: ts.toISOString() };
}

const read = (req) =>
  new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });

// ---------- WebSocket, just enough for /v1/subscribe: text frames out, ping text in ----------

const frame = (opcode, payload) => {
  const body = Buffer.from(payload);
  const head = body.length < 126 ? Buffer.from([0x80 | opcode, body.length]) : Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
};

function onSocketData(sock, buf) {
  let b = Buffer.concat([sock.wsBuf, buf]);
  for (;;) {
    if (b.length < 2) break;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let at = 2;
    if (len === 126) {
      if (b.length < 4) break;
      len = b.readUInt16BE(2);
      at = 4;
    } else if (len === 127) {
      if (b.length < 10) break;
      len = Number(b.readBigUInt64BE(2));
      at = 10;
    }
    const end = at + (masked ? 4 : 0) + len;
    if (b.length < end) break;
    const mask = masked ? b.subarray(at, at + 4) : null;
    const data = Buffer.from(b.subarray(at + (masked ? 4 : 0), end));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    b = b.subarray(end);
    if (opcode === 8) {
      sock.end(frame(8, data.subarray(0, 2)));
      break;
    }
    if (opcode === 9) sock.write(frame(10, data));
    else if (opcode === 1 && data.toString() === 'ping') sock.write(frame(1, 'pong'));
  }
  sock.wsBuf = b;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://relay');
    const path = url.pathname;
    if (path === '/v1/info' && req.method === 'GET') return json(res, 200, { service: 'omni-relay', version: 1, issuer: null, clientId: null, connect: false });
    if (!path.startsWith('/v1/')) return fail(res, 404, 'Not found');
    if (bearer(req) !== token) return signedOut(res);

    if (path === '/v1/changes' && req.method === 'POST') {
      const list = JSON.parse((await read(req)).toString() || 'null')?.changes;
      if (!Array.isArray(list) || list.length > MAX_BATCH) return fail(res, 400, `Send {changes: [...]}, at most ${MAX_BATCH}`);
      const checked = list.map(checkChange);
      if (checked.includes(null)) return fail(res, 400, 'A change is malformed');
      for (const c of checked) changes.push({ ...c, seq: ++seq });
      const pushers = new Set(checked.map((c) => c.machine_id));
      for (const s of sockets) if ([...pushers].some((m) => m !== s.wsMachine)) s.write(frame(1, 'changes'));
      return json(res, 200, { ok: true });
    }

    if (path === '/v1/changes' && req.method === 'GET') {
      const q = url.searchParams;
      const after = Number(q.get('after') ?? 0);
      if (!Number.isFinite(after)) return fail(res, 400, 'after: a number');
      const limit = Math.max(1, Math.min(MAX_BATCH, Number(q.get('limit') ?? 200) || 200));
      const exclude = q.get('exclude') ?? '';
      return json(res, 200, { changes: changes.filter((c) => c.seq > after && c.machine_id !== exclude).slice(0, limit) });
    }

    if (path === '/v1/auth/token' && req.method === 'DELETE') return json(res, 200, { ok: true });

    if (path.startsWith('/v1/objects/')) {
      let rel = '';
      try {
        rel = decodeURIComponent(path.slice('/v1/objects/'.length));
      } catch {
        // Refused below as an empty path.
      }
      if (!rel || rel.split('/').some((p) => p === '' || p === '.' || p === '..')) return fail(res, 400, `Bad object path "${rel}"`);
      if (req.method === 'PUT') {
        objects.set(rel, { body: await read(req), type: req.headers['content-type'] ?? 'application/octet-stream' });
        return json(res, 200, { ok: true });
      }
      const o = objects.get(rel);
      if (req.method === 'HEAD') {
        res.writeHead(o ? 200 : 404);
        return res.end();
      }
      if (req.method === 'GET') {
        if (!o) return fail(res, 404, 'No such object');
        res.writeHead(200, { 'content-type': o.type });
        return res.end(o.body);
      }
    }
    return fail(res, 404, 'Not found');
  } catch (err) {
    console.error(err);
    return fail(res, 500, err?.message ?? 'relay error');
  }
});

server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://relay');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/v1/subscribe' || !key || bearer(req) !== token) {
    sock.end(`HTTP/1.1 ${bearer(req) === token ? 400 : 401} Refused\r\nconnection: close\r\n\r\n`);
    return;
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  sock.write(
    `HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\nsec-websocket-protocol: omni-relay\r\n\r\n`,
  );
  sock.wsMachine = url.searchParams.get('exclude') ?? '';
  sock.wsBuf = Buffer.alloc(0);
  sockets.add(sock);
  sock.on('data', (d) => onSocketData(sock, d));
  sock.on('close', () => sockets.delete(sock));
  sock.on('error', () => sockets.delete(sock));
});

server.listen(Number(port), '127.0.0.1', () => console.log(`listening http://127.0.0.1:${server.address().port}`));

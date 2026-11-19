// The Connect page the relay serves at /connect (docs/adr/0009-omni-connect.md): sign in with Clerk once, then open
// any of your machines. Plain HTML and a little script, no build step. Colours and radii are the Web UI's tokens
// (apps/web/src/index.css). Everything it shows comes from same-origin JSON and goes in with textContent.

const STYLE = `
:root{color-scheme:light dark;--bg:light-dark(#fff,#121316);--surface:light-dark(#f7f7f6,#191b1e);--fg:light-dark(#17181a,#eceae5);
--fg-3:light-dark(#6f6e68,#908f89);--line:light-dark(rgb(23 24 26/.08),rgb(236 235 231/.08));--live:light-dark(#2b3bff,#7280ff);
--done:#c6f52b;--needs:#ff4420;--ink:#17181a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:520px;margin:0 auto;padding:48px 20px}h1{font-size:22px;margin:0 0 4px;letter-spacing:-.01em}
p{color:var(--fg-3);margin:0 0 20px}.who{font-size:13px}
button,a.btn{appearance:none;border:0;border-radius:999px;background:var(--fg);color:var(--bg);font:inherit;font-weight:550;padding:9px 18px;cursor:pointer;text-decoration:none;display:inline-block}
button.quiet{background:transparent;color:var(--fg-3);padding:6px 10px}
ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
li{display:flex;align-items:center;gap:12px;padding:14px 2px;border-bottom:1px solid var(--line)}
li .name{font-weight:550}li .host{color:var(--fg-3);font-size:13px;word-break:break-all}li>div{flex:1;min-width:0}
.dot{width:8px;height:8px;border-radius:50%;background:var(--fg-3);flex:none}.dot.on{background:var(--done);box-shadow:0 0 0 1px var(--ink) inset}
.code{font:600 28px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;background:var(--surface);border-radius:12px;padding:18px;text-align:center;margin:0 0 16px}
.err{color:var(--needs)}footer{margin-top:28px;display:flex;justify-content:space-between;align-items:center}
`;

const SCRIPT = `
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) }));
// Only back to /connect/open on this origin, never elsewhere.
const next = ((n) => (n && n.startsWith('/connect/open?') ? n : null))(new URLSearchParams(location.search).get('next'));
const view = $('#view');
const show = (...kids) => view.replaceChildren(...kids);
const error = (msg) => el('p', { className: 'err', textContent: msg });

async function signIn() {
  const r = await post('/connect/signin/start');
  if (!r.ok) return show(error(r.body.error || 'Could not start sign-in'), el('button', { textContent: 'Try again', onclick: signIn }));
  const f = r.body;
  const open = () => window.open(f.verificationUriComplete || f.verificationUri, '_blank', 'noopener');
  show(
    el('p', { textContent: 'Approve this code on Clerk with your Google account. Check the page shows the same code.' }),
    el('div', { className: 'code', textContent: f.userCode }),
    el('button', { textContent: 'Open Clerk', onclick: open }),
  );
  open();
  let wait = f.interval * 1000;
  const deadline = Date.now() + f.expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, wait));
    const p = await post('/connect/signin/poll', { flow: f.flow, secret: f.secret });
    const state = p.body.state;
    if (state === 'signed_in') return next ? location.replace(next) : list();
    if (state === 'slow_down') wait += 5000;
    else if (state !== 'pending') return show(error(p.body.error || (state === 'denied' ? 'Sign-in was declined' : 'The code expired')), el('button', { textContent: 'Start again', onclick: signIn }));
  }
}

async function list() {
  show(el('p', { textContent: 'Checking your machines…' }));
  const r = await fetch('/connect/api/machines').then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));
  if (r.status === 401) return show(el('p', { textContent: 'Sign in with the Google account your Omni machines use.' }), el('button', { textContent: 'Sign in with Google', onclick: signIn }));
  if (r.status !== 200) return show(error(r.body.error || 'Could not list your machines'));
  $('#who').textContent = r.body.email ? 'Signed in as ' + r.body.email : '';
  const machines = r.body.machines || [];
  if (!machines.length) return show(el('p', { textContent: 'No machine has Omni Connect on yet. Turn it on in Omni, Settings, Omni Connect.' }));
  show(el('ul', {}, ...machines.map((m) => el('li', {},
    el('span', { className: 'dot' + (m.online ? ' on' : ''), title: m.online ? 'Online' : 'Offline' }),
    el('div', {}, el('div', { className: 'name', textContent: m.name }), el('div', { className: 'host', textContent: m.problem || (m.online ? m.hostname : 'Offline · ' + m.hostname) })),
    m.online ? el('a', { className: 'btn', href: 'https://' + m.hostname + '/#/connect', textContent: 'Open' }) : '',
  ))));
}

$('#signout').onclick = async () => { await post('/connect/signout'); $('#who').textContent = ''; list(); };
list();
`;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(body: string, script = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Omni Connect</title><style>${STYLE}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;
}

let scriptHash: Promise<string> | undefined;
/** SCRIPT's `'sha256-…'` source, worked out on the first page rather than kept by hand next to the script. */
const hashOfScript = () =>
  (scriptHash ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(SCRIPT))
    .then((d) => `'sha256-${btoa(String.fromCharCode(...new Uint8Array(d)))}'`));

/** The one inline script, by its hash, so no other script on the page could run. No other origin, no framing. */
export async function pageHeaders(): Promise<Record<string, string>> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; script-src ${await hashOfScript()}; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  };
}

export function connectPage(): string {
  return shell(
    `<h1>Omni Connect</h1><p class="who" id="who"></p><div id="view"></div><footer><span></span><button class="quiet" id="signout">Sign out</button></footer>`,
    SCRIPT,
  );
}

/** A page for a refused /connect/open: what went wrong and the way back. */
export function errorPage(message: string): string {
  return shell(`<h1>Omni Connect</h1><p class="err">${escape(message)}</p><a class="btn" href="/connect">Your machines</a>`);
}

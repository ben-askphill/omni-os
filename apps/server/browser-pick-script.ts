// The script that reads one element out of the channel browser's page for an element pick (browser-pick.ts). It runs in
// the page, through Runtime.evaluate, finds what is at a point and returns a bounded description of it: never the DOM.
// It changes nothing on the page. Everything it returns is the page's own data and is cleaned and checked again on the
// server, so a page that tampers with the script's results gets a refused pick, not a larger record.

/** What the page's side may read of one element, before the server bounds and checks it. */
export interface RawPick {
  ok: boolean;
  reason?: string;
  tag?: unknown;
  selector?: unknown;
  text?: unknown;
  html?: unknown;
  ancestors?: unknown;
  bounds?: unknown;
  frames?: unknown;
  opaque?: unknown;
  truncated?: unknown;
  styles?: unknown;
}

/** What the page's side may read of the element under the pointer for the hover inspector (`inspectScript`). */
export interface RawInspect {
  ok: boolean;
  reason?: string;
  tag?: unknown;
  id?: unknown;
  classes?: unknown;
  path?: unknown;
  bounds?: unknown;
  styles?: unknown;
  opaque?: unknown;
  /** The main frame's innerWidth and innerHeight, which the box is clipped to. */
  viewport?: unknown;
}

/** Budgets the script keeps to while it reads. The server cuts again to the record's own limits. */
export const SCRIPT_BUDGET = { html: 2_000, text: 600, readText: 4_000, children: 6, depth: 2, attrs: 8, attr: 100, selector: 300, ancestors: 4, ancestor: 160, frames: 3 };

// The computed styles both scripts read, as [record key, CSS property]: ELEMENT_STYLE_KEYS in
// packages/shared/message-context-browser.ts, in its order.
const STYLE_PROPS = [
  ['display', 'display'],
  ['position', 'position'],
  ['color', 'color'],
  ['background_color', 'background-color'],
  ['font_family', 'font-family'],
  ['font_size', 'font-size'],
  ['font_weight', 'font-weight'],
  ['line_height', 'line-height'],
  ['padding', 'padding'],
  ['margin', 'margin'],
  ['z_index', 'z-index'],
];

/**
 * The start of both scripts: the element at (x, y) of the main frame's viewport, through same-origin frames and open
 * shadow roots. Leaves `el` (null for nothing), `doc` its document, `ox`/`oy` its frame's offset, `frames`, `shadows`
 * and `opaque`, and the helpers `cut`, `flat`, `lower` and `styles`.
 */
const FIND = (x: number, y: number) => `
  const x = ${Math.round(x)}, y = ${Math.round(y)};
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '\\u2026' : s);
  const flat = (s) => String(s).replace(/\\s+/g, ' ').trim();
  const lower = (el) => String(el.localName || el.tagName || '').toLowerCase();
  const styles = (e) => {
    const out = {};
    let cs = null;
    try { cs = (e.ownerDocument.defaultView || window).getComputedStyle(e); } catch (err) {}
    if (!cs) return out;
    for (const [key, prop] of ${JSON.stringify(STYLE_PROPS)}) {
      const v = flat(cs.getPropertyValue(prop) || '');
      if (v) out[key] = cut(v, 120);
    }
    return out;
  };

  let doc = document, ox = 0, oy = 0, el = null, opaque = false;
  const frames = [];
  const shadows = [];
  for (let hops = 0; hops < 8; hops++) {
    let hit = doc.elementFromPoint(x - ox, y - oy);
    if (!hit) break;
    for (let s = 0; s < 6 && hit.shadowRoot; s++) {
      const inner = hit.shadowRoot.elementFromPoint(x - ox, y - oy);
      if (!inner || inner === hit) break;
      shadows.push(hit);
      hit = inner;
    }
    el = hit;
    if (!/^(IFRAME|FRAME)$/.test(hit.tagName)) break;
    let inner = null;
    try { inner = hit.contentDocument; } catch (e) {}
    if (!inner) { opaque = true; break; }
    const r = hit.getBoundingClientRect();
    ox += r.left + hit.clientLeft;
    oy += r.top + hit.clientTop;
    frames.push(String(inner.URL || ''));
    doc = inner;
    el = null;
  }`;

// Written as one expression so Runtime.evaluate returns its value. `x` and `y` are in the main frame's viewport.
export const pickScript = (x: number, y: number) => `(() => {
  const B = ${JSON.stringify(SCRIPT_BUDGET)};
  const KEEP = ['id', 'class', 'href', 'src', 'alt', 'title', 'role', 'name', 'type', 'placeholder', 'for', 'aria-label', 'data-testid', 'data-test'];
  const SKIP_CHILDREN = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'OPTION', 'OPTGROUP']);
  const VOID = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'SOURCE', 'TRACK', 'WBR']);
${FIND(x, y)}
  if (!el) return { ok: false, reason: 'nothing' };
  if (frames.length > B.frames) return { ok: false, reason: 'deep' };

  const attrs = (e) => {
    const out = [];
    for (const name of KEEP) {
      if (out.length >= B.attrs) break;
      let v = e.getAttribute && e.getAttribute(name);
      if (v == null || v === '') continue;
      // A link's address without its query or fragment, which can hold a token.
      if (name === 'href' || name === 'src') v = String(v).replace(/[?#].*$/, '');
      out.push(name + '="' + cut(flat(v), B.attr).replace(/"/g, "'") + '"');
    }
    return out.length ? ' ' + out.join(' ') : '';
  };
  const open = (e) => '<' + lower(e) + attrs(e) + '>';

  let budget = B.html, truncated = false;
  const parts = [];
  const push = (s) => {
    if (budget <= 0) { truncated = true; return false; }
    if (s.length > budget) { parts.push(s.slice(0, budget)); budget = 0; truncated = true; return false; }
    parts.push(s);
    budget -= s.length;
    return true;
  };
  // A shallow outline: its own tag, a few children to a fixed depth, text trimmed. Nothing a user typed into a field.
  const outline = (e, depth) => {
    if (!push(open(e))) return;
    if (VOID.has(e.tagName)) return;
    if (SKIP_CHILDREN.has(e.tagName)) { push('\\u2026'); push('</' + lower(e) + '>'); return; }
    let shown = 0, total = 0;
    for (const n of e.childNodes) {
      if (n.nodeType === 3) {
        const t = flat(n.nodeValue || '');
        if (t && !push(cut(t, 80))) return;
      } else if (n.nodeType === 1) {
        total++;
        if (shown >= B.children || depth >= B.depth) continue;
        shown++;
        outline(n, depth + 1);
        if (budget <= 0) return;
      }
    }
    if (total > shown) { truncated = true; if (!push('\\u2026')) return; }
    push('</' + lower(e) + '>');
  };
  outline(el, 0);

  let text = '';
  if (!/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
    const raw = el.innerText != null ? el.innerText : el.textContent;
    text = flat(String(raw || '').slice(0, B.readText));
    if (text.length > B.text) { text = cut(text, B.text); truncated = true; }
  }

  // A selector from the nearest ancestor with a unique id, one step per level.
  const step = (e) => {
    const root = e.getRootNode();
    const id = e.getAttribute && e.getAttribute('id');
    if (id) {
      let unique = false;
      try { unique = root.querySelectorAll('#' + CSS.escape(id)).length === 1; } catch (err) {}
      if (unique) return { s: '#' + CSS.escape(id), anchor: true };
    }
    let s = lower(e);
    const cls = (e.getAttribute && e.getAttribute('class') || '').split(/\\s+/).filter((c) => /^[A-Za-z_-][\\w-]{0,30}$/.test(c)).slice(0, 2);
    for (const c of cls) s += '.' + CSS.escape(c);
    const p = e.parentElement;
    if (p) {
      const same = [...p.children].filter((c) => c.localName === e.localName);
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(e) + 1) + ')';
    }
    return { s, anchor: false };
  };
  const path = (e) => {
    const out = [];
    for (let n = e; n && n.nodeType === 1 && out.length < 12; n = n.parentElement) {
      const st = step(n);
      out.unshift(st.s);
      if (st.anchor || n === doc.documentElement) break;
    }
    return out.join(' > ');
  };
  let selector = [...shadows.map(path), path(el)].join(' >>> ');
  if (selector.length > B.selector) selector = '\\u2026' + selector.slice(selector.length - B.selector + 1);

  const ancestors = [];
  for (let n = el.parentElement; n && ancestors.length < B.ancestors; n = n.parentElement) ancestors.push(cut(open(n), B.ancestor));

  const r = el.getBoundingClientRect();
  return {
    ok: true,
    tag: lower(el),
    selector,
    text,
    html: parts.join(''),
    ancestors,
    bounds: { x: ox + r.left, y: oy + r.top, width: r.width, height: r.height },
    frames,
    opaque,
    truncated,
    styles: styles(el),
  };
})()`;

/**
 * The hover inspector's script: what is under the pointer at (x, y), as a tag, id, a few classes, its place in the page
 * as `tag#id.class` steps, its box and a few computed styles. Lighter than `pickScript` (no markup, no text), since it
 * runs as the pointer moves. It changes nothing on the page and the server bounds what it returns (browser-pick.ts).
 */
export const inspectScript = (x: number, y: number) => `(() => {
${FIND(x, y)}
  if (!el) return { ok: false, reason: 'nothing' };
  const classesOf = (e) => (e.getAttribute && e.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 6).map((c) => cut(c, 60));
  const step = (e) => {
    const id = e.getAttribute && e.getAttribute('id');
    if (id) return lower(e) + '#' + cut(flat(id), 40);
    return [lower(e), ...classesOf(e).slice(0, 2)].join('.');
  };
  const path = [];
  for (let n = el; n && n.nodeType === 1 && path.length < 9; n = n.parentElement) {
    if (n === doc.documentElement) break;
    path.unshift(cut(step(n), 80));
  }
  if (path.length > 8) path.splice(0, path.length - 7, '\\u2026');
  const r = el.getBoundingClientRect();
  return {
    ok: true,
    tag: lower(el),
    id: cut(flat(el.getAttribute && el.getAttribute('id') || ''), 100),
    classes: classesOf(el),
    path,
    bounds: { x: ox + r.left, y: oy + r.top, width: r.width, height: r.height },
    styles: styles(el),
    opaque,
    viewport: { width: innerWidth, height: innerHeight },
  };
})()`;

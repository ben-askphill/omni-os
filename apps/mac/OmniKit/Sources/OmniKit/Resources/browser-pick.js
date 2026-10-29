"use strict";
(() => {
  // packages/shared/message-context.ts
  var overLimit = (s, max) => s.length > max && (s.length > 2 * max || [...s].length > max);

  // packages/shared/message-context-terminal.ts
  var FORBIDDEN_RANGES = [[0, 8], [11, 31], [127, 159], [8232, 8233], [8234, 8238], [8294, 8297]];
  var unit = (n) => `\\u{${n.toString(16)}}`;
  var FORBIDDEN_CLASS = `[${FORBIDDEN_RANGES.map(([a, b]) => `${unit(a)}-${unit(b)}`).join("")}]`;
  var FORBIDDEN = new RegExp(FORBIDDEN_CLASS, "u");
  function plain(v, at, max) {
    if (typeof v !== "string" || !v || overLimit(v, max)) return { ok: false, error: `${at} must be a string of 1 to ${max} characters` };
    if (FORBIDDEN.test(v) || v.includes("\n") || v.includes("	")) return { ok: false, error: `${at} must be plain text on one line` };
    return { ok: true, value: v };
  }

  // packages/shared/message-context-marks.ts
  var MARK_COLORS = [
    { name: "red", hex: "#ff4420" },
    { name: "orange", hex: "#ff9f1c" },
    { name: "yellow", hex: "#ffd23f" },
    { name: "green", hex: "#2ec27e" },
    { name: "blue", hex: "#3b82f6" },
    { name: "purple", hex: "#a855f7" },
    { name: "white", hex: "#ffffff" },
    { name: "black", hex: "#111111" }
  ];
  var COLOR_HEX = MARK_COLORS.map((c) => c.hex);

  // packages/shared/message-context-browser.ts
  var ELEMENT_STYLE_KEYS = ["display", "position", "color", "background_color", "font_family", "font_size", "font_weight", "line_height", "padding", "margin", "z_index"];
  var SELECTOR_MAX = 300;
  var ELEMENT_TEXT_MAX = 600;
  var ELEMENT_HTML_MAX = 2e3;
  var ANCESTORS_MAX = 4;
  var ANCESTOR_MAX = 160;
  var FRAMES_MAX = 3;
  var FRAME_URL_MAX = 512;
  var STYLE_VALUE_MAX = 120;
  var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  var whole = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
  function rectOf(v, viewport) {
    if (!isObj(v)) return { ok: false, error: "rect must be an object" };
    const { x, y, width, height } = v;
    if (!whole(x, 0, viewport.width) || !whole(y, 0, viewport.height) || !whole(width, 1, viewport.width) || !whole(height, 1, viewport.height))
      return { ok: false, error: "rect must be whole CSS pixels inside the viewport" };
    if (x + width > viewport.width || y + height > viewport.height) return { ok: false, error: "rect reaches outside the viewport" };
    return { ok: true, value: { x, y, width, height } };
  }
  function maybePlain(v, at, max) {
    return v === "" ? { ok: true, value: "" } : plain(v, at, max);
  }
  function elementOf(v, viewport) {
    if (!isObj(v)) return { ok: false, error: "element must be an object" };
    const tag = plain(v.tag, "element.tag", 40);
    if (!tag.ok) return tag;
    if (!/^[a-z][a-z0-9-]*$/.test(tag.value)) return { ok: false, error: "element.tag must be a lowercase tag name" };
    const selector = plain(v.selector, "element.selector", SELECTOR_MAX);
    if (!selector.ok) return selector;
    const text = maybePlain(v.text, "element.text", ELEMENT_TEXT_MAX);
    if (!text.ok) return text;
    const html = plain(v.html, "element.html", ELEMENT_HTML_MAX);
    if (!html.ok) return html;
    if (!Array.isArray(v.ancestors) || v.ancestors.length > ANCESTORS_MAX) return { ok: false, error: `element.ancestors must be at most ${ANCESTORS_MAX} tags` };
    const ancestors = [];
    for (const a of v.ancestors) {
      const one = plain(a, "element.ancestors", ANCESTOR_MAX);
      if (!one.ok) return one;
      ancestors.push(one.value);
    }
    const bounds = rectOf(v.bounds, viewport);
    if (!bounds.ok) return { ok: false, error: bounds.error.replace("rect", "element.bounds") };
    const pt = v.point;
    if (!isObj(pt) || !whole(pt.x, 0, viewport.width - 1) || !whole(pt.y, 0, viewport.height - 1)) return { ok: false, error: "element.point must be whole CSS pixels inside the viewport" };
    if (!Array.isArray(v.frames) || v.frames.length > FRAMES_MAX) return { ok: false, error: `element.frames must be at most ${FRAMES_MAX} addresses` };
    const frames = [];
    for (const f of v.frames) {
      const one = plain(f, "element.frames", FRAME_URL_MAX);
      if (!one.ok) return one;
      frames.push(one.value);
    }
    if (typeof v.opaque_frame !== "boolean" || typeof v.truncated !== "boolean") return { ok: false, error: "element.opaque_frame and element.truncated must be true or false" };
    const styles = stylesOf(v.styles, "element.styles");
    if (!styles.ok) return styles;
    return {
      ok: true,
      value: {
        tag: tag.value,
        selector: selector.value,
        text: text.value,
        html: html.value,
        ancestors,
        bounds: bounds.value,
        point: { x: pt.x, y: pt.y },
        frames,
        opaque_frame: v.opaque_frame,
        truncated: v.truncated,
        ...Object.keys(styles.value).length > 0 && { styles: styles.value }
      }
    };
  }
  function stylesOf(v, at = "styles") {
    if (v === void 0 || v === null) return { ok: true, value: {} };
    if (!isObj(v)) return { ok: false, error: `${at} must be an object` };
    const out = {};
    for (const key of ELEMENT_STYLE_KEYS) {
      if (v[key] === void 0) continue;
      const one = plain(v[key], `${at}.${key}`, STYLE_VALUE_MAX);
      if (!one.ok) return one;
      out[key] = one.value;
    }
    return { ok: true, value: out };
  }
  var INSPECT_CLASSES_MAX = 6;
  var INSPECT_PATH_MAX = 8;
  var INSPECT_STEP_MAX = 80;

  // packages/shared/browser-pick-script.ts
  var SCRIPT_BUDGET = { html: 2e3, text: 600, readText: 4e3, children: 6, depth: 2, attrs: 8, attr: 100, selector: 300, ancestors: 4, ancestor: 160, frames: 3 };
  var STYLE_PROPS = ELEMENT_STYLE_KEYS.map((key) => [key, key.replaceAll("_", "-")]);
  var FIND = (x, y) => `
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
  var pickScript = (x, y) => `(() => {
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
  var inspectScript = (x, y) => `(() => {
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

  // packages/shared/browser-pick-read.ts
  var pickUnavailable = (reason, message) => ({
    unavailable: { reason, message: `${message} The screenshot and the area you mark still go with your message.` }
  });
  var FORBIDDEN2 = new RegExp(FORBIDDEN_CLASS, "gu");
  function clean(raw, max) {
    if (typeof raw !== "string") return "";
    const flat = raw.slice(0, max * 4).replace(FORBIDDEN2, " ").replace(/\s+/g, " ").trim();
    const chars = [...flat];
    return chars.length > max ? `${chars.slice(0, max - 1).join("")}\u2026` : flat;
  }
  var isObj2 = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  function cleanStyles(raw) {
    const out = {};
    if (!isObj2(raw)) return out;
    for (const key of ELEMENT_STYLE_KEYS) {
      const v = clean(raw[key], STYLE_VALUE_MAX);
      if (v) out[key] = v;
    }
    return out;
  }
  function clipBox(raw, viewport) {
    if (!isObj2(raw)) return null;
    const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : NaN;
    const left = Math.max(0, Math.floor(num(raw.x)));
    const top = Math.max(0, Math.floor(num(raw.y)));
    const right = Math.min(viewport.width, Math.ceil(num(raw.x) + num(raw.width)));
    const bottom = Math.min(viewport.height, Math.ceil(num(raw.y) + num(raw.height)));
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  function elementFrom(raw, point, viewport) {
    if (!isObj2(raw) || raw.ok !== true) return null;
    const bounds = clipBox(raw.bounds, viewport);
    if (!bounds) return null;
    const styles = cleanStyles(raw.styles);
    const list = (v, max, each) => Array.isArray(v) ? v.slice(0, max).map((s) => clean(s, each)).filter(Boolean) : [];
    const html = clean(raw.html, ELEMENT_HTML_MAX);
    const text = clean(raw.text, ELEMENT_TEXT_MAX);
    const candidate = {
      tag: clean(raw.tag, 40).toLowerCase(),
      selector: clean(raw.selector, SELECTOR_MAX),
      text,
      html,
      ancestors: list(raw.ancestors, ANCESTORS_MAX, ANCESTOR_MAX),
      bounds,
      point,
      frames: list(raw.frames, FRAMES_MAX, FRAME_URL_MAX),
      opaque_frame: raw.opaque === true,
      truncated: raw.truncated === true || typeof raw.html === "string" && raw.html.length > ELEMENT_HTML_MAX || typeof raw.text === "string" && raw.text.length > ELEMENT_TEXT_MAX,
      ...Object.keys(styles).length > 0 && { styles }
    };
    const parsed = elementOf(candidate, viewport);
    return parsed.ok ? parsed.value : null;
  }
  function pickReply(raw, point, viewport) {
    if (isObj2(raw) && raw.ok === false && raw.reason === "nothing") return pickUnavailable("nothing", "Nothing could be picked at that spot.");
    const element = elementFrom(raw, point, viewport);
    return element ? { element } : pickUnavailable("unreadable", "That part of the page could not be read.");
  }
  function inspectedFrom(raw) {
    if (!isObj2(raw) || raw.ok !== true || !isObj2(raw.viewport)) return null;
    const vw = raw.viewport.width;
    const vh = raw.viewport.height;
    if (typeof vw !== "number" || typeof vh !== "number" || !(vw >= 1 && vw <= 2e4 && vh >= 1 && vh <= 2e4)) return null;
    const bounds = clipBox(raw.bounds, { width: Math.round(vw), height: Math.round(vh) });
    const tag = clean(raw.tag, 40).toLowerCase();
    if (!bounds || !/^[a-z][a-z0-9-]*$/.test(tag)) return null;
    const box = raw.bounds;
    const size = (v) => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
    const list = (v, max, each) => Array.isArray(v) ? v.slice(-max).map((s) => clean(s, each)).filter(Boolean) : [];
    return {
      tag,
      id: clean(raw.id, 100),
      classes: list(raw.classes, INSPECT_CLASSES_MAX, 60),
      path: list(raw.path, INSPECT_PATH_MAX, INSPECT_STEP_MAX),
      bounds,
      size: { width: size(box.width), height: size(box.height) },
      styles: cleanStyles(raw.styles),
      opaque_frame: raw.opaque === true
    };
  }
  var noInspect = (reason, message) => ({ unavailable: { reason, message } });
  function inspectReply(raw) {
    if (isObj2(raw) && raw.ok === false && raw.reason === "nothing") return noInspect("nothing", "Nothing is under the pointer.");
    const element = inspectedFrom(raw);
    return element ? { element } : noInspect("unreadable", "That part of the page could not be read.");
  }

  // apps/mac/browser-pick/entry.ts
  var call = (f) => (json) => JSON.stringify(f(JSON.parse(json)) ?? null);
  globalThis.OmniPick = {
    inspectScript: call(({ x, y }) => inspectScript(x, y)),
    pickScript: call(({ x, y }) => pickScript(x, y)),
    inspectReply: call(({ raw }) => inspectReply(raw)),
    pickReply: call(({ raw, point, viewport }) => pickReply(raw, point, viewport))
  };
})();

// Where a thread's HTML artifacts render inline in its transcript. Pure: tool groups and artifact rows in,
// the artifacts each group shows under out.
// apps/mac/OmniKit/Sources/OmniKit/InlineArtifacts.swift ports it; packages/test-fixtures/inline-artifacts.json keeps them in step.

/** Every harness adapter reports a file write as one of these, with the file in `input.file_path`. */
const WRITES = new Set(['Write', 'Edit', 'MultiEdit']);

export interface InlineCall {
  name: string;
  input: unknown;
  result?: { is_error: boolean };
  /** ISO time of the tool_use row. */
  at: string;
}

/** One tool group: its key and every call in it, sub-agents' calls included. */
export interface InlineGroup {
  key: number;
  calls: InlineCall[];
}

export interface InlineCandidate {
  thread_id: string;
  path: string;
  kind: string;
  updated_at: string;
}

export const rendersInline = (a: Pick<InlineCandidate, 'kind'>) => a.kind === 'html';

/** The file inside the thread's folder (`<thread>/artifacts/x.html`), so a path through a symlink still matches. */
const threadTail = (a: InlineCandidate) => {
  const at = a.path.lastIndexOf(`/${a.thread_id}/`);
  return at < 0 ? a.path : a.path.slice(at);
};

function wrote(c: InlineCall, a: InlineCandidate) {
  if (!WRITES.has(c.name) || !c.result || c.result.is_error) return false;
  const file = (c.input as { file_path?: unknown } | null)?.file_path;
  return typeof file === 'string' && (file === a.path || file.endsWith(threadTail(a)));
}

/** The tallest an inline page grows before it scrolls inside its frame. A page that grows with its frame stops here. */
export const INLINE_MAX_HEIGHT = 6000;

const HEIGHT_MESSAGE = 'omni:artifact-height';
const THEME_MESSAGE = 'omni:artifact-theme';
const THEME_FRAGMENT = 'omni-theme';

export type Scheme = 'light' | 'dark';

// Runs first in a framed page. It posts the page's height to the frame around it, reading the root's box, not
// scrollHeight, which never drops below the frame's own height, so a page that shrinks gets a shorter frame.
// With a theme from Omni (the URL fragment on load, a message after), it pins the page's prefers-color-scheme rules
// and matchMedia queries to it, so a page follows a theme Ben forced in Omni and not only the system's.
const FRAME_SCRIPT = `<script>(function(H,T,F){
if(window.parent===window)return;
var h=-1,scheme=null,kept=new WeakMap(),Q=/\\(\\s*prefers-color-scheme\\s*:\\s*(light|dark)\\s*\\)/gi;
function size(){var v=Math.ceil(document.documentElement.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({type:H,height:v},"*");}
function pin(q){return scheme?q.replace(Q,function(_,s){return s.toLowerCase()===scheme?"(min-width:0px)":"((max-width:0px) and (min-width:1px))";}):q;}
function fix(o){if(!o.media)return;if(!kept.has(o)){if(!/prefers-color-scheme/i.test(o.media.mediaText))return;kept.set(o,o.media.mediaText);}o.media.mediaText=pin(kept.get(o));}
function walk(list){for(var i=0;i<list.length;i++){var r=list[i];if(r.cssRules){fix(r);walk(r.cssRules);}}}
function apply(){if(!scheme)return;document.documentElement.style.colorScheme=scheme;for(var i=0;i<document.styleSheets.length;i++){var s=document.styleSheets[i];try{fix(s);walk(s.cssRules);}catch(e){}}}
var mm=window.matchMedia.bind(window);window.matchMedia=function(q){return mm(pin(String(q)));};
try{var m=new RegExp("[#&]"+F+"=(light|dark)").exec(location.hash);if(m){scheme=m[1];history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}
window.addEventListener("message",function(e){var d=e.data;if(e.source===window.parent&&d&&d.type===T&&(d.theme==="light"||d.theme==="dark")){scheme=d.theme;apply();}});
if(window.ResizeObserver){var o=new ResizeObserver(size);o.observe(document.documentElement);}
apply();document.addEventListener("DOMContentLoaded",function(){apply();size();});window.addEventListener("load",function(){apply();size();});
})(${JSON.stringify(HEIGHT_MESSAGE)},${JSON.stringify(THEME_MESSAGE)},${JSON.stringify(THEME_FRAGMENT)});</script>`;

/** The fragment that gives a framed page Omni's theme before its first paint. */
export const frameThemeFragment = (scheme: Scheme) => `#${THEME_FRAGMENT}=${scheme}`;

/** The message that moves a framed page to Omni's new theme. */
export const frameThemeMessage = (scheme: Scheme) => ({ type: THEME_MESSAGE, theme: scheme });

/**
 * The page with the frame script first in its head. Comments are blanked before the search, so a `<head>` written in
 * one is skipped. A page with no head or html tag gets the script first.
 */
export function withFrameScript(html: string) {
  const scan = html.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => ' '.repeat(m.length));
  const open = /<head(?:\s[^>]*)?>/i.exec(scan) ?? /<html(?:\s[^>]*)?>/i.exec(scan) ?? /^\s*<!doctype[^>]*>/i.exec(scan);
  const at = open ? open.index + open[0].length : 0;
  return html.slice(0, at) + FRAME_SCRIPT + html.slice(at);
}

/** The height a framed page reported, or undefined for any other message. The page can send anything, so this clamps it. */
export function readFrameHeight(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const { type, height } = data as { type?: unknown; height?: unknown };
  if (type !== HEIGHT_MESSAGE || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return undefined;
  return Math.min(INLINE_MAX_HEIGHT, Math.ceil(height));
}

/**
 * Each HTML artifact under the last group that wrote it, so a rewrite moves the page down to where it changed.
 * A file no call wrote (a shell redirect, a copy) goes under the last group that started before its last change.
 * One that changed before any group is not shown inline.
 */
export function inlineArtifactsByGroup<A extends InlineCandidate>(groups: InlineGroup[], artifacts: A[]): Map<number, A[]> {
  const out = new Map<number, A[]>();
  for (const a of artifacts) {
    if (!rendersInline(a)) continue;
    const key =
      groups.findLast((g) => g.calls.some((c) => wrote(c, a)))?.key ??
      groups.findLast((g) => g.calls.length > 0 && g.calls[0].at <= a.updated_at)?.key;
    if (key !== undefined) out.set(key, [...(out.get(key) ?? []), a]);
  }
  return out;
}

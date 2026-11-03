// Pages an agent shows inline in its thread with Omni's html_render tool (apps/mcp/render.ts): a chart, diagram,
// table or mockup that sits in the transcript above the reply. The server saves each one as an artifact under
// artifacts/renders/, so it syncs and stays in the Library like any file, and serves it with `?frame=1` to the frame.
// packages/test-fixtures/html-render.json holds the call parsing's cases.

export const RENDER_SERVER = 'omni-render';
export const RENDER_TOOL = 'html_render';
export const RENDER_MAX_BYTES = 512_000;
export const RENDER_MAX_TITLE = 200;

/** Harnesses name it `mcp__omni-render__html_render`, or with an underscore for the dash (Codex). */
export const isRenderTool = (name: string) => /^mcp__omni[-_]render__html_render$/.test(name);

/** A rendered page's file: `<thread>/artifacts/renders/<name>.html`. */
export const isRenderPath = (path: string) => /[\\/]artifacts[\\/]renders[\\/][^\\/]+\.html$/i.test(path);

export interface Rendered {
  /** The artifact row the page was saved as. */
  artifact: number;
  title: string;
}

/** What html_render answers. `renderedFrom` reads the artifact id back out of it. */
export const renderedText = (r: Rendered) =>
  `Shown inline in the thread as "${r.title}" (artifact ${r.artifact}). Do not restate or describe the page: say what it means, or nothing.`;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The page an html_render call showed, or null when the call is something else, still runs, or failed. */
export function renderedFrom(name: string, input: unknown, result: { text: string; is_error: boolean } | undefined): Rendered | null {
  if (!isRenderTool(name) || !result || result.is_error) return null;
  const id = /\(artifact (\d+)\)/.exec(result.text)?.[1];
  if (!id) return null;
  const title = str((input as { title?: unknown } | null)?.title);
  return { artifact: Number(id), title: title?.slice(0, RENDER_MAX_TITLE) ?? 'Page' };
}

/**
 * The variables a rendered page reads, each set from an Omni token: shadcn's names, which agents already know.
 * The web reads each token's resolved value from its own CSS.
 */
export const RENDER_COLORS = {
  '--background': '--bg',
  '--foreground': '--fg',
  '--muted': '--surface-2',
  '--muted-foreground': '--fg-3',
  '--card': '--surface',
  '--card-foreground': '--fg',
  '--border': '--line-strong',
  '--primary': '--fg',
  '--primary-foreground': '--on-ink',
  '--accent': '--live',
  '--accent-foreground': '--on-live',
  '--destructive': '--needs',
  '--warning': '--warn',
  '--success': '--done',
  '--code-background': '--code-bg',
  '--chart-1': '--chart-1',
  '--chart-2': '--chart-2',
  '--chart-3': '--chart-3',
  '--chart-4': '--chart-4',
  '--chart-5': '--chart-5',
  '--chart-6': '--chart-6',
} as const;

export const RENDER_OTHER = { '--radius': '--r-md', '--font-sans': '--font-sans', '--font-mono': '--font-mono' } as const;

export const RENDER_GUIDE = [
  'Use the theme variables on :root, never fixed colours, so the page matches Omni in light and dark:',
  `${Object.keys(RENDER_COLORS).join(', ')}, ${Object.keys(RENDER_OTHER).join(', ')}.`,
  'The frame is the reply column (about 680px on desktop, 360px on a phone) on the thread background.',
  'Leave html and body with no background, outer card, border, page title banner or side padding: the base sheet sets text colour and font.',
  'A box that needs its own background gets var(--card), 16px padding and var(--radius) corners. Give charts a fixed pixel height and fluid width.',
  'Use --chart-1 to --chart-6 in that order for series, and label them or add a legend: never colour alone.',
  'Let the content set the height: no vh units and no height:100% on html or body.',
].join(' ');

export type Scheme = 'light' | 'dark';

/** Omni's theme as a framed page gets it: the scheme and the variables above with their values. */
export interface FrameTheme {
  scheme: Scheme;
  vars: Record<string, string>;
}

/** The tallest an inline page grows before it scrolls inside its frame. A page that grows with its frame stops here. */
export const INLINE_MAX_HEIGHT = 6000;

const HEIGHT_MESSAGE = 'omni:render-height';
const THEME_MESSAGE = 'omni:render-theme';
const THEME_FRAGMENT = 'omni-theme';

// Runs first in a framed page. It posts the page's height, reading the root's box rather than scrollHeight, which
// never drops below the frame's height, so a page that shrinks gets a shorter frame. With Omni's theme (the URL
// fragment on load, a message after), it writes the variables into a <style> first in the head, where the page can
// still override them, and pins prefers-color-scheme rules and matchMedia to Omni's scheme, which may be forced.
const FRAME_SCRIPT = `<script>(function(H,T,F){
if(window.parent===window)return;
var h=-1,scheme=null,vars={},kept=new WeakMap(),Q=/\\(\\s*prefers-color-scheme\\s*:\\s*(light|dark)\\s*\\)/gi;
var css=document.createElement("style");css.id="omni-theme";(document.head||document.documentElement).prepend(css);
var BASE=":where(html){color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}:where(body){margin:0}:where(code,pre,kbd,samp){font-family:var(--font-mono)}";
function size(){var v=Math.ceil(document.documentElement.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({type:H,height:v},"*");}
function pin(q){return scheme?q.replace(Q,function(_,s){return s.toLowerCase()===scheme?"(min-width:0px)":"((max-width:0px) and (min-width:1px))";}):q;}
function fix(o){if(!o.media)return;if(!kept.has(o)){if(!/prefers-color-scheme/i.test(o.media.mediaText))return;kept.set(o,o.media.mediaText);}o.media.mediaText=pin(kept.get(o));}
function walk(list){for(var i=0;i<list.length;i++){var r=list[i];if(r.cssRules){fix(r);walk(r.cssRules);}}}
function apply(){if(!scheme)return;var c=":root{color-scheme:"+scheme+";";for(var k in vars){if(/^--[a-z0-9-]+$/.test(k))c+=k+":"+String(vars[k]).replace(/[;{}<>]/g,"")+";";}css.textContent=c+"}"+BASE;for(var i=0;i<document.styleSheets.length;i++){var s=document.styleSheets[i];if(s.ownerNode===css)continue;try{fix(s);walk(s.cssRules);}catch(e){}}}
function take(t){if(t&&(t.scheme==="light"||t.scheme==="dark")){scheme=t.scheme;vars=t.vars&&typeof t.vars==="object"?t.vars:{};apply();}}
var mm=window.matchMedia.bind(window);window.matchMedia=function(q){return mm(pin(String(q)));};
try{var m=new RegExp("[#&]"+F+"=([^&]*)").exec(location.hash);if(m){take(JSON.parse(decodeURIComponent(m[1])));history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}
window.addEventListener("message",function(e){var d=e.data;if(e.source===window.parent&&d&&d.type===T)take(d.theme);});
if(window.ResizeObserver){var o=new ResizeObserver(size);o.observe(document.documentElement);}
document.addEventListener("DOMContentLoaded",function(){apply();size();});window.addEventListener("load",function(){apply();size();});
})(${JSON.stringify(HEIGHT_MESSAGE)},${JSON.stringify(THEME_MESSAGE)},${JSON.stringify(THEME_FRAGMENT)});</script>`;

/** The fragment that gives a framed page Omni's theme before its first paint. */
export const frameThemeFragment = (theme: FrameTheme) => `#${THEME_FRAGMENT}=${encodeURIComponent(JSON.stringify(theme))}`;

/** The message that moves a framed page to Omni's new theme. */
export const frameThemeMessage = (theme: FrameTheme) => ({ type: THEME_MESSAGE, theme });

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

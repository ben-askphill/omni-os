/**
 * What the app lets an artifact's web view do. The app fetches the file with the token in native code and hands the
 * web view only its content. The view gets no token, no message handler and no base URL, so a page has no way to
 * reach the app or the server as Ben.
 */

/** Pages may run scripts and load static files from https. They may not call out, frame, post forms or move the base. */
export const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'unsafe-inline' https:",
  'img-src https: data: blob:',
  'font-src https: data:',
  'media-src https: data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** Rendered text and drawings load no script at all. */
export const STATIC_CSP = ["default-src 'none'", "style-src 'unsafe-inline'", 'img-src https: data:', "base-uri 'none'", "form-action 'none'"].join('; ');

const cspMeta = (policy: string) => `<meta http-equiv="Content-Security-Policy" content="${policy}">`;

/** Whitespace, complete comments and the doctype: everything a document may hold before its first element. */
const PROLOGUE = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype[^>]*>)?/i;

/**
 * Puts the policy first in the document. It goes after the doctype, so the page keeps standards mode, and never inside
 * a comment or a tag. The browser's parser files the meta under the head, ahead of every script the page has.
 */
export function sandboxHtml(html: string): string {
  const source = html.replace(/^﻿/, '');
  const at = PROLOGUE.exec(source)?.[0].length ?? 0;
  return source.slice(0, at) + cspMeta(PAGE_CSP) + source.slice(at);
}

export interface DocumentColors {
  bg: string;
  fg: string;
  fg2: string;
  fg3: string;
  surface: string;
  line: string;
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';

/** An SVG drawn as an image. In an image a file runs no script and loads nothing else, whatever it contains. */
export function svgDocument(svg: string, colors: Pick<DocumentColors, 'bg'>): string {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return `<!doctype html><html><head>${cspMeta(STATIC_CSP)}${VIEWPORT}<style>html,body{margin:0;height:100%;background:${colors.bg}}img{display:block;width:100%;height:100%;object-fit:contain}</style></head><body><img alt="" src="${src}"></body></html>`;
}

/** A page of rendered text, styled with the app's colours. */
export function textDocument(bodyHtml: string, colors: DocumentColors): string {
  const css = `
    :root{color-scheme:light dark}
    html{-webkit-text-size-adjust:100%}
    body{margin:0;padding:16px 20px 48px;background:${colors.bg};color:${colors.fg};font:16px/1.55 -apple-system,system-ui,sans-serif;overflow-wrap:anywhere}
    h1,h2,h3,h4{line-height:1.25;margin:1.4em 0 .5em}h1{font-size:1.6em}h2{font-size:1.3em}h3{font-size:1.1em}
    p,ul,ol,pre,table,blockquote{margin:0 0 1em}
    a{color:${colors.fg};text-decoration:underline;text-decoration-color:${colors.fg3}}
    code{font:.88em ui-monospace,Menlo,monospace;background:${colors.surface};padding:.12em .35em;border-radius:6px}
    pre{background:${colors.surface};padding:12px 14px;border-radius:12px;overflow-x:auto}pre code{background:none;padding:0}
    blockquote{border-left:3px solid ${colors.line};padding-left:14px;color:${colors.fg2}}
    table{border-collapse:collapse;display:block;overflow-x:auto}th,td{border:1px solid ${colors.line};padding:6px 10px;text-align:left}
    img{max-width:100%;height:auto}hr{border:0;border-top:1px solid ${colors.line}}
  `;
  return `<!doctype html><html><head>${cspMeta(STATIC_CSP)}${VIEWPORT}<style>${css}</style></head><body>${bodyHtml}</body></html>`;
}

export interface NavigationRequest {
  url: string;
  /** iOS: 'click' for a tap on a link, 'other' for the initial load and script-driven moves. */
  navigationType?: string;
  isTopFrame?: boolean;
}

export type NavigationDecision = 'allow' | 'external' | 'block';

/**
 * Every move the web view makes. It stays on the document it was given. A tapped http(s) link opens in the system
 * browser instead. Redirects, meta refreshes, script navigation, frames and other schemes go nowhere.
 */
export function navigationDecision(request: NavigationRequest): NavigationDecision {
  const { url, navigationType, isTopFrame = true } = request;
  if (url === 'about:blank' || url.startsWith('about:blank#')) return 'allow';
  if (!isTopFrame || navigationType !== 'click') return 'block';
  return /^https?:\/\//i.test(url) ? 'external' : 'block';
}

/** The decision for a file shown from the cache, such as a PDF: only that file, and no link leaves it. */
export function fileNavigationDecision(request: NavigationRequest, fileUri: string): NavigationDecision {
  return request.url === fileUri || request.url.startsWith(`${fileUri}#`) ? 'allow' : 'block';
}

/**
 * Props every artifact web view takes. Not here, on purpose: `onMessage` (react-native-webview registers its message
 * handler and injects `window.ReactNativeWebView` only when `onMessage` is a function), `injectedJavaScript*`,
 * `source.baseUrl` and `source.headers`.
 *
 * `originWhitelist` is `*` so that `onShouldStartLoadWithRequest` alone decides. A URL outside the whitelist is opened
 * by the library through `Linking` before that callback runs, whatever its scheme and whoever started the move.
 */
export function sandboxProps(options: { scripts: boolean }) {
  return {
    javaScriptEnabled: options.scripts,
    originWhitelist: ['*'] as string[],
    incognito: true,
    cacheEnabled: false,
    sharedCookiesEnabled: false,
    thirdPartyCookiesEnabled: false,
    allowFileAccess: false,
    allowFileAccessFromFileURLs: false,
    allowUniversalAccessFromFileURLs: false,
    allowsLinkPreview: false,
    javaScriptCanOpenWindowsAutomatically: false,
    mediaPlaybackRequiresUserAction: true,
    geolocationEnabled: false,
    allowsAirPlayForMediaPlayback: false,
  } as const;
}

// Images in PR bodies and comments. GitHub serves them from URLs a plain <img> cannot always load: a private
// repo's files and every upload to a private repo need the viewer's GitHub session. The server rewrites those
// URLs to /api/channels/:id/prs/:n/image, which loads them with gh's login, and turns HTML <img> tags into
// markdown images, since neither client renders raw HTML.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Where a GitHub image lives: a file in a repo, or an upload ("user attachment") found by its asset id. */
export type GitHubImage = { kind: 'file'; repo: string; rest: string[] } | { kind: 'attachment'; key: string };

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The GitHub image a URL points at, or null for any other URL, which loads as it is. */
export function githubImage(src: string): GitHubImage | null {
  let u: URL;
  try {
    u = new URL(src);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (u.hostname === 'github.com') {
    if (parts[0] === 'user-attachments' && parts[1] === 'assets' && UUID.test(parts[2] ?? '')) return { kind: 'attachment', key: parts[2].toLowerCase() };
    // Older uploads: github.com/<owner>/<repo>/assets/<user id>/<uuid>
    if (parts[2] === 'assets' && UUID.test(parts[4] ?? '')) return { kind: 'attachment', key: parts[4].match(UUID)![0].toLowerCase() };
    if ((parts[2] === 'blob' || parts[2] === 'raw') && parts.length >= 5) return { kind: 'file', repo: `${parts[0]}/${parts[1]}`, rest: parts.slice(3) };
    return null;
  }
  if (u.hostname === 'raw.githubusercontent.com' && parts.length >= 4) return { kind: 'file', repo: `${parts[0]}/${parts[1]}`, rest: parts.slice(2) };
  if (u.hostname === 'private-user-images.githubusercontent.com') {
    const id = u.pathname.match(UUID);
    return id ? { kind: 'attachment', key: id[0].toLowerCase() } : null;
  }
  return null;
}

const mdAlt = (s: string) => s.replace(/[[\]\\]/g, '\\$&').replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  const v = m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  return v?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
};

/**
 * A PR body or comment with its images ready to show: `<img>` tags become `![alt](src)` and GitHub image URLs
 * point at `proxy` + the encoded URL. Code fences and inline code are left alone.
 */
export function proxyPRImages(md: string, proxy: string, seen?: (src: string) => void): string {
  const through = (src: string) => {
    if (!githubImage(src)) return src;
    seen?.(src);
    return proxy + encodeURIComponent(src);
  };
  return md
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((block, i) => {
      if (i % 2 === 1) return block;
      return block
        .split(/(`[^`\n]*`)/g)
        .map((seg, j) => {
          if (j % 2 === 1) return seg;
          return seg
            .replace(/<img\b[^>]*>/gi, (tag) => {
              const src = attr(tag, 'src');
              if (!src) return tag;
              return `![${mdAlt(attr(tag, 'alt') ?? '')}](<${through(src).replace(/[<>]/g, encodeURIComponent)}>)`;
            })
            .replace(/(!\[(?:\\.|[^\]\\])*\]\(\s*)(<[^>\n]*>|[^\s)]+)/g, (all, head: string, dest: string) => {
              const bare = dest.startsWith('<') ? dest.slice(1, -1) : dest;
              const out = through(bare);
              return out === bare ? all : `${head}${dest.startsWith('<') ? `<${out}>` : out}`;
            });
        })
        .join('');
    })
    .join('');
}

/** The GitHub image URLs a PR body or comment shows, the ones `proxyPRImages` points at the proxy. */
export function githubImageSources(md: string): string[] {
  const out: string[] = [];
  proxyPRImages(md, '', (src) => out.push(src));
  return out;
}

/** The signed, short-lived image URLs GitHub puts in rendered HTML (`body_html`) for uploads to a private repo. */
export function signedImageURLs(html: string): string[] {
  return [...html.matchAll(/https:\/\/private-user-images\.githubusercontent\.com\/[^"'\s<>)]+/g)].map((m) => m[0].replace(/&amp;/g, '&'));
}

export interface Fetched {
  bytes: Buffer;
  type: string;
}

const MAX = 25 * 1024 * 1024;

async function fetchImage(url: string): Promise<Fetched | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > MAX ? null : { bytes, type };
  } catch {
    return null;
  }
}

const gh = async (args: string[]) => (await run('gh', args, { encoding: 'buffer', maxBuffer: MAX })).stdout;

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

/** A repo file through the contents API. The ref can hold slashes, so each split of the path is tried. */
async function repoFile(repo: string, rest: string[]): Promise<Fetched | null> {
  const type = TYPES[rest.at(-1)!.split('.').pop()!.toLowerCase()];
  if (!type) return null;
  for (let k = 1; k < rest.length; k++) {
    const ref = rest.slice(0, k).map(decodeURIComponent).join('/');
    try {
      const bytes = await gh(['api', `repos/${repo}/contents/${rest.slice(k).join('/')}?ref=${encodeURIComponent(ref)}`, '-H', 'Accept: application/vnd.github.raw']);
      return { bytes, type };
    } catch {
      // Not this split; try a longer ref.
    }
  }
  return null;
}

const signedCache = new Map<string, { at: number; urls: string[] }>();

/** Every signed upload URL in a PR's description, comments and reviews. GitHub signs them for about five minutes. */
async function signedURLs(repo: string, n: number, fresh = false) {
  const key = `${repo}#${n}`;
  const hit = signedCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < 4 * 60_000) return hit.urls;
  const html = ['-H', 'Accept: application/vnd.github.full+json'];
  const parts = await Promise.all(
    [`repos/${repo}/pulls/${n}`, `repos/${repo}/issues/${n}/comments?per_page=100`, `repos/${repo}/pulls/${n}/reviews?per_page=100`].map((path) =>
      gh(['api', path, ...html])
        .then((b) => [JSON.parse(b.toString('utf8'))].flat().map((x: { body_html?: string }) => x.body_html ?? '').join('\n'))
        .catch(() => ''),
    ),
  );
  const urls = parts.flatMap(signedImageURLs);
  signedCache.set(key, { at: Date.now(), urls });
  return urls;
}

const shownCache = new Map<string, { at: number; srcs: Set<string> }>();

/**
 * The GitHub image URLs PR `n` of `repo` shows in its description, reviews and comments. The proxy serves only
 * these, so it cannot be used to read other files or uploads with gh's login.
 */
async function shownImages(repo: string, n: number, fresh = false) {
  const key = `${repo}#${n}`;
  const hit = shownCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < 5 * 60_000) return hit.srcs;
  const pr = JSON.parse((await gh(['pr', 'view', String(n), '--repo', repo, '--json', 'body,comments,reviews'])).toString('utf8'));
  const bodies: (string | undefined)[] = [pr.body, ...(pr.comments ?? []).map((c: { body?: string }) => c.body), ...(pr.reviews ?? []).map((r: { body?: string }) => r.body)];
  const srcs = new Set(bodies.flatMap((b) => (b ? githubImageSources(b) : [])));
  shownCache.set(key, { at: Date.now(), srcs });
  return srcs;
}

/** The image behind a GitHub image URL in PR `n` of `repo`: as is when it is public, else with gh's login. */
export async function fetchPRImage(repo: string, n: number, src: string): Promise<Fetched | null> {
  const img = githubImage(src);
  if (!img) return null;
  // A miss on a cached list can be an edit or comment since: ask GitHub once more.
  if (!(await shownImages(repo, n)).has(src) && !(await shownImages(repo, n, true)).has(src)) return null;
  const direct = await fetchImage(src);
  if (direct) return direct;
  if (img.kind === 'file') return repoFile(img.repo, img.rest);
  const find = (urls: string[]) => urls.find((u) => u.toLowerCase().includes(img.key));
  // A miss on a cached list can be a comment posted since: ask GitHub once more.
  const signed = find(await signedURLs(repo, n)) ?? find(await signedURLs(repo, n, true));
  return signed ? fetchImage(signed) : null;
}

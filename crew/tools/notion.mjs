#!/usr/bin/env node
// Notion for agents, through the REST API and the OMNI_NOTION_TOKEN integration token, so a headless thread never
// needs the Notion MCP plugin's OAuth sign-in. No dependencies: Node 18 or later. The token is read from the
// environment and never printed. Omni names this file in a thread's prompt when the token is set (runner/prompts.ts).
//
//   node notion.mjs me                              the integration's bot user and workspace
//   node notion.mjs search [query] [--type page|database] [--limit N]
//   node notion.mjs read <page or database id|url> [--depth N]   a page as Markdown, a database as its rows
//   node notion.mjs query <database id|url> [filter JSON] [--limit N]
//   node notion.mjs create <parent page or database id|url> <title> [Markdown | @file | -] [--props JSON]
//   node notion.mjs append <page or block id|url> <Markdown | @file | ->
//   node notion.mjs api <GET|POST|PATCH|DELETE> <path> [JSON | @file | -]   any endpoint, JSON out
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const API = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';
const TOKEN_ENV = 'OMNI_NOTION_TOKEN';

const ID_RE = /[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** A Notion id from a bare id (dashed or not) or any notion.so / notion.site / app.notion.com URL, dashed. */
export function notionId(ref) {
  const s = String(ref ?? '').trim();
  let hay = s;
  try {
    // The page is in the path; `?v=` is a view and `?p=` a peeked page, so only fall back to the query string.
    const u = new URL(s);
    hay = ID_RE.test(u.pathname) ? u.pathname : u.searchParams.get('p') ?? u.pathname;
  } catch {}
  const ids = [...hay.matchAll(new RegExp(ID_RE.source, 'gi'))];
  const raw = ids.at(-1)?.[0].replace(/-/g, '').toLowerCase();
  if (!raw) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

/** Rich text as Markdown-ish plain text: links kept, other annotations dropped except code and bold. */
export function richText(parts) {
  return (parts ?? [])
    .map((t) => {
      let text = t.plain_text ?? '';
      if (!text) return '';
      if (t.annotations?.code) text = `\`${text}\``;
      else if (t.annotations?.bold) text = `**${text}**`;
      return t.href ? `[${text}](${t.href})` : text;
    })
    .join('');
}

/** A page's or database's title. */
export function titleOf(obj) {
  if (Array.isArray(obj?.title)) return richText(obj.title);
  const prop = Object.values(obj?.properties ?? {}).find((p) => p?.type === 'title');
  return prop ? richText(prop.title) : '';
}

/** One property value as short text. */
export function propValue(p) {
  if (!p) return '';
  const v = p[p.type];
  switch (p.type) {
    case 'title':
    case 'rich_text':
      return richText(v);
    case 'number':
    case 'url':
    case 'email':
    case 'phone_number':
    case 'created_time':
    case 'last_edited_time':
      return v == null ? '' : String(v);
    case 'checkbox':
      return v ? 'yes' : 'no';
    case 'select':
    case 'status':
      return v?.name ?? '';
    case 'multi_select':
      return (v ?? []).map((o) => o.name).join(', ');
    case 'date':
      return v ? (v.end ? `${v.start} to ${v.end}` : v.start) : '';
    case 'people':
      return (v ?? []).map((u) => u.name ?? u.id).join(', ');
    case 'created_by':
    case 'last_edited_by':
      return v?.name ?? v?.id ?? '';
    case 'relation':
      return (v ?? []).map((r) => r.id).join(', ');
    case 'files':
      return (v ?? []).map((f) => f.name ?? f.external?.url ?? f.file?.url).join(', ');
    case 'formula':
      return v ? String(v[v.type] ?? '') : '';
    case 'rollup':
      if (!v) return '';
      if (v.type === 'array') return v.array.map(propValue).join(', ');
      return String(v[v.type] ?? '');
    case 'unique_id':
      return v ? `${v.prefix ? `${v.prefix}-` : ''}${v.number}` : '';
    case 'verification':
      return v?.state ?? '';
    default:
      return '';
  }
}

const fileUrl = (b) => b?.external?.url ?? b?.file?.url ?? b?.url ?? '';

/** One block as one Markdown line (children are rendered by the caller, indented). */
export function blockLine(block, index = 1) {
  const b = block[block.type] ?? {};
  const text = richText(b.rich_text);
  switch (block.type) {
    case 'paragraph':
      return text;
    case 'heading_1':
      return `# ${text}`;
    case 'heading_2':
      return `## ${text}`;
    case 'heading_3':
      return `### ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `${index}. ${text}`;
    case 'to_do':
      return `- [${b.checked ? 'x' : ' '}] ${text}`;
    case 'toggle':
      return `- ${text}`;
    case 'quote':
      return `> ${text}`;
    case 'callout':
      return `> ${b.icon?.emoji ? `${b.icon.emoji} ` : ''}${text}`;
    case 'code':
      return `\`\`\`${b.language ?? ''}\n${(b.rich_text ?? []).map((t) => t.plain_text).join('')}\n\`\`\``;
    case 'equation':
      return `$$${b.expression ?? ''}$$`;
    case 'divider':
      return '---';
    case 'child_page':
      return `[page: ${b.title ?? ''}] (id ${block.id})`;
    case 'child_database':
      return `[database: ${b.title ?? ''}] (id ${block.id})`;
    case 'link_to_page':
      return `[link to ${b.type}: ${b[b.type]}]`;
    case 'table_row':
      return `| ${(b.cells ?? []).map((c) => richText(c).replace(/\|/g, '\\|')).join(' | ')} |`;
    case 'image':
    case 'video':
    case 'file':
    case 'pdf':
    case 'audio':
      return `[${block.type}: ${richText(b.caption) || b.name || ''}](${fileUrl(b)})`;
    case 'bookmark':
    case 'embed':
    case 'link_preview':
      return `<${b.url ?? ''}>`;
    case 'table':
    case 'column_list':
    case 'column':
    case 'synced_block':
    case 'table_of_contents':
    case 'breadcrumb':
      return '';
    default:
      return text || `[${block.type}]`;
  }
}

/**
 * Blocks (each with `children` filled in when it has any) as Markdown. List numbering restarts after any other block,
 * a table gets its header rule under the first row, and children are indented two spaces a level.
 */
export function blocksToMarkdown(blocks, depth = 0) {
  const pad = '  '.repeat(depth);
  const out = [];
  let n = 0;
  for (const block of blocks) {
    n = block.type === 'numbered_list_item' ? n + 1 : 0;
    const line = blockLine(block, n);
    if (line) out.push(line.split('\n').map((l) => pad + l).join('\n'));
    const kids = block.children ?? [];
    if (block.type === 'table' && kids.length) {
      const rows = blocksToMarkdown(kids, depth).split('\n');
      const cols = kids[0].table_row?.cells?.length ?? 1;
      rows.splice(1, 0, `${pad}|${' --- |'.repeat(cols)}`);
      out.push(rows.join('\n'));
    } else if (kids.length) {
      // Columns and synced blocks only group their children, so those stay at this level.
      const flat = ['column_list', 'column', 'synced_block'].includes(block.type);
      out.push(blocksToMarkdown(kids, flat ? depth : depth + 1));
    }
  }
  return out.filter((l) => l !== '').join('\n');
}

// ---------- Markdown to blocks, for create and append ----------

const LANGS = new Set(['bash', 'c', 'c#', 'c++', 'css', 'diff', 'docker', 'go', 'graphql', 'html', 'java', 'javascript', 'json', 'kotlin', 'markdown', 'mermaid', 'php', 'plain text', 'python', 'ruby', 'rust', 'scss', 'shell', 'sql', 'swift', 'typescript', 'xml', 'yaml']);
const LANG_ALIAS = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sh: 'shell', zsh: 'shell', py: 'python', rb: 'ruby', yml: 'yaml', md: 'markdown', liquid: 'html' };
const MAX_TEXT = 2000;

/** Inline Markdown (**bold**, `code`, [text](url), *italic*) as Notion rich text, split under its 2000-character cap. */
export function inline(text) {
  const out = [];
  const push = (content, extra = {}) => {
    for (let i = 0; i < content.length; i += MAX_TEXT) {
      const { link, ...annotations } = extra;
      out.push({ type: 'text', text: { content: content.slice(i, i + MAX_TEXT), ...(link ? { link: { url: link } } : {}) }, ...(Object.keys(annotations).length ? { annotations } : {}) });
    }
  };
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![*\w])\*([^*\s][^*]*)\*(?!\w)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) push(text.slice(last, m.index));
    if (m[1] != null) push(m[1], { bold: true });
    else if (m[2] != null) push(m[2], { code: true });
    else if (m[3] != null) push(m[3], { link: m[4] });
    else push(m[5], { italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) push(text.slice(last));
  return out;
}

/** Text taken as it is (code), split under the cap. */
const plain = (text) => (text.match(new RegExp(`[\\s\\S]{1,${MAX_TEXT}}`, 'g')) ?? []).map((content) => ({ type: 'text', text: { content } }));

const textBlock = (type, text, extra = {}) => ({ object: 'block', type, [type]: { rich_text: inline(text), ...extra } });

/**
 * Markdown as Notion blocks: headings, paragraphs, bulleted, numbered and to-do lists (nested by indent, two levels,
 * as one request allows), quotes, fenced code, dividers and pipe tables.
 */
export function markdownToBlocks(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  /** Open list items by indent, so a deeper item becomes a child. */
  let stack = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push(textBlock('paragraph', para.join('\n')));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w#+.-]*)\s*$/);
    if (fence) {
      flush();
      stack = [];
      const body = [];
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i]);
      const lang = LANG_ALIAS[fence[1].toLowerCase()] ?? fence[1].toLowerCase();
      blocks.push({ object: 'block', type: 'code', code: { rich_text: plain(body.join('\n')), language: LANGS.has(lang) ? lang : 'plain text' } });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      stack = [];
      const rows = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) continue;
        rows.push(lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|'))));
      }
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({
        object: 'block',
        type: 'table',
        table: { table_width: width, has_column_header: true, has_row_header: false, children: rows.map((cells) => ({ object: 'block', type: 'table_row', table_row: { cells: [...cells, ...Array(width - cells.length).fill([])] } })) },
      });
      continue;
    }
    const item = line.match(/^(\s*)(?:([-*+])\s+\[([ xX])\]|([-*+])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      flush();
      const indent = item[1].replace(/\t/g, '  ').length;
      const block = item[2]
        ? textBlock('to_do', item[6], { checked: item[3].toLowerCase() === 'x' })
        : textBlock(item[4] ? 'bulleted_list_item' : 'numbered_list_item', item[6]);
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const parent = stack.at(-1);
      if (parent && stack.length < 3) {
        const holder = parent.block[parent.block.type];
        (holder.children ??= []).push(block);
      } else blocks.push(block);
      stack.push({ indent, block });
      continue;
    }
    if (!line.trim()) {
      flush();
      stack = [];
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      stack = [];
      blocks.push(textBlock(`heading_${Math.min(heading[1].length, 3)}`, heading[2]));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      stack = [];
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flush();
      stack = [];
      blocks.push(textBlock('quote', quote[1]));
      continue;
    }
    stack = [];
    para.push(line.trim());
  }
  flush();
  return blocks;
}

const chunks = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

function textArg(arg) {
  if (arg == null) return '';
  if (arg === '-') return readFileSync(0, 'utf8');
  if (arg.startsWith('@')) return readFileSync(arg.slice(1), 'utf8');
  return arg;
}

export class NotionError extends Error {
  constructor(status, body) {
    super(body?.message ?? `HTTP ${status}`);
    this.status = status;
    this.code = body?.code;
  }
}

/** The client: `call(method, path, body)` with retries on 429 and 5xx. `fetchImpl` is for tests. */
export function client(token, fetchImpl = globalThis.fetch) {
  async function call(method, path, body) {
    const url = path.startsWith('http') ? path : `${API}${path.startsWith('/v1/') ? path.slice(3) : path.startsWith('/') ? path : `/${path}`}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        body: body == null ? undefined : JSON.stringify(body),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const wait = Number(res.headers?.get?.('retry-after')) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      if (!res.ok) throw new NotionError(res.status, json);
      return json;
    }
  }

  /** Every result of a paginated list (GET block children, POST search or query), up to `limit`. */
  async function all(method, path, body = {}, limit = Infinity) {
    const results = [];
    let cursor;
    do {
      const size = Math.min(100, limit - results.length);
      const page =
        method === 'GET'
          ? await call('GET', `${path}${path.includes('?') ? '&' : '?'}page_size=${size}${cursor ? `&start_cursor=${cursor}` : ''}`)
          : await call(method, path, { ...body, page_size: size, ...(cursor ? { start_cursor: cursor } : {}) });
      results.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor && results.length < limit);
    return results;
  }

  /** A block's children, recursively to `depth` levels below it. */
  async function children(id, depth) {
    const blocks = await all('GET', `/blocks/${id}/children`);
    if (depth > 0) {
      for (const b of blocks) {
        // A child page or database is listed, not inlined: read it on its own.
        if (b.has_children && b.type !== 'child_page' && b.type !== 'child_database') b.children = await children(b.id, depth - 1);
      }
    }
    return blocks;
  }

  return { call, all, children };
}

const row = (page) =>
  [titleOf(page) || '(untitled)', ...Object.entries(page.properties ?? {}).filter(([, p]) => p.type !== 'title').map(([k, p]) => `${k}: ${propValue(p)}`).filter((s) => !s.endsWith(': '))].join(' · ');

function flag(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
}

function jsonArg(arg) {
  if (arg == null) return undefined;
  if (arg === '-') return JSON.parse(readFileSync(0, 'utf8'));
  if (arg.startsWith('@')) return JSON.parse(readFileSync(arg.slice(1), 'utf8'));
  return JSON.parse(arg);
}

/** Runs one command and returns what to print. `env` and `fetchImpl` are for tests. */
export async function run(argv, env = process.env, fetchImpl = globalThis.fetch) {
  const args = [...argv];
  const cmd = args.shift();
  if (!cmd || cmd === 'help' || cmd === '--help') return HELP;
  const token = env[TOKEN_ENV];
  if (!token) throw new Error(`${TOKEN_ENV} is not set. Add it under Settings > Secrets (global) on this machine.`);
  const n = client(token, fetchImpl);

  if (cmd === 'me') {
    const me = await n.call('GET', '/users/me');
    return `${me.name} (${me.type}, id ${me.id})${me.bot?.workspace_name ? `, workspace ${me.bot.workspace_name}` : ''}`;
  }
  if (cmd === 'search') {
    const type = flag(args, 'type');
    const limit = Number(flag(args, 'limit', 50));
    const body = { query: args.join(' '), sort: { direction: 'descending', timestamp: 'last_edited_time' } };
    if (type) body.filter = { property: 'object', value: type };
    const results = await n.all('POST', '/search', body, limit);
    if (!results.length) return 'Nothing found. The connection only sees pages and databases shared with it.';
    return results.map((r) => `${r.object}\t${r.id}\t${titleOf(r).replace(/\s+/g, ' ').trim() || '(untitled)'}\t${r.last_edited_time?.slice(0, 10) ?? ''}\t${r.url ?? ''}`).join('\n');
  }
  if (cmd === 'read') {
    const depth = Number(flag(args, 'depth', 3));
    const id = notionId(args[0]);
    if (!id) throw new Error('read needs a page or database id or URL');
    let page;
    try {
      page = await n.call('GET', `/pages/${id}`);
    } catch (err) {
      if (!(err instanceof NotionError) || (err.status !== 404 && err.status !== 400)) throw err;
      const db = await n.call('GET', `/databases/${id}`).catch(() => {
        throw err;
      });
      const rows = await n.all('POST', `/databases/${id}/query`, {}, Number(flag(args, 'limit', 100)));
      return [`# ${titleOf(db)}`, db.url, '', ...rows.map((r) => `- ${row(r)} (id ${r.id})`)].join('\n');
    }
    const props = Object.entries(page.properties ?? {})
      .filter(([, p]) => p.type !== 'title')
      .map(([k, p]) => [k, propValue(p)])
      .filter(([, v]) => v)
      .map(([k, v]) => `- ${k}: ${v}`);
    const body = blocksToMarkdown(await n.children(id, depth));
    return [`# ${titleOf(page) || '(untitled)'}`, page.url, ...(props.length ? ['', ...props] : []), '', body].join('\n');
  }
  if (cmd === 'query') {
    const limit = Number(flag(args, 'limit', 100));
    const id = notionId(args[0]);
    if (!id) throw new Error('query needs a database id or URL');
    const filter = jsonArg(args[1]);
    const rows = await n.all('POST', `/databases/${id}/query`, filter ? (filter.filter || filter.sorts ? filter : { filter }) : {}, limit);
    return rows.map((r) => `${r.id}\t${row(r)}`).join('\n') || 'No rows.';
  }
  if (cmd === 'create') {
    const props = jsonArg(flag(args, 'props'));
    const [parentRef, title, content] = args;
    const parentId = notionId(parentRef);
    if (!parentId || !title) throw new Error('create needs a parent page or database and a title');
    // A database parent names its own title property; a page parent's is always "title".
    const db = await n.call('GET', `/databases/${parentId}`).catch((err) => {
      if (err instanceof NotionError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    });
    const titleKey = db ? Object.entries(db.properties ?? {}).find(([, p]) => p.type === 'title')?.[0] ?? 'Name' : 'title';
    const [first = [], ...rest] = chunks(markdownToBlocks(textArg(content)), 100);
    const page = await n.call('POST', '/pages', {
      parent: db ? { database_id: parentId } : { page_id: parentId },
      properties: { ...(props ?? {}), [titleKey]: { title: inline(title) } },
      children: first,
    });
    for (const chunk of rest) await n.call('PATCH', `/blocks/${page.id}/children`, { children: chunk });
    return `Created ${page.url} (id ${page.id})`;
  }
  if (cmd === 'append') {
    const id = notionId(args[0]);
    if (!id) throw new Error('append needs a page or block id or URL');
    const blocks = markdownToBlocks(textArg(args[1]));
    if (!blocks.length) throw new Error('append needs Markdown to add');
    for (const chunk of chunks(blocks, 100)) await n.call('PATCH', `/blocks/${id}/children`, { children: chunk });
    return `Appended ${blocks.length} block${blocks.length === 1 ? '' : 's'} to ${id}`;
  }
  if (cmd === 'api') {
    const [method, path, body] = args;
    if (!method || !path) throw new Error('api needs a method and a path, such as: api GET /users/me');
    return JSON.stringify(await n.call(method.toUpperCase(), path, jsonArg(body)), null, 2);
  }
  throw new Error(`Unknown command ${cmd}. ${HELP}`);
}

export const HELP = `Usage: node notion.mjs <command>
  me                                       the integration's bot user
  search [query] [--type page|database] [--limit N]
  read <id|url> [--depth N]                a page as Markdown, or a database's rows
  query <database id|url> [filter JSON] [--limit N]
  create <parent page or database> <title> [Markdown | @file | -] [--props JSON]
  append <page or block> <Markdown | @file | ->
  api <METHOD> <path> [JSON | @file | -]   any endpoint (Notion-Version ${NOTION_VERSION}), JSON out
Reads ${TOKEN_ENV}. The connection only sees pages and databases shared with it in Notion.`;

/** Why a call failed, with what to do about it. Never includes the token. */
export function explain(err) {
  if (!(err instanceof NotionError)) return err.message;
  if (err.status === 401) return `Notion refused the token (401 ${err.code}). ${TOKEN_ENV} is wrong or the connection was removed.`;
  if (err.status === 404 || err.code === 'object_not_found')
    return `Notion: not found (404). Either the id is wrong or the page is not shared with the Omni connection: ask the user to open it in Notion, ••• > Connections, and add Omni.`;
  if (err.status === 403) return `Notion: the connection lacks the capability for this (403 ${err.code}). Its capabilities are set in Notion's integration settings.`;
  return `Notion ${err.status} ${err.code ?? ''}: ${err.message}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(
    (out) => console.log(out),
    (err) => {
      console.error(explain(err));
      process.exit(1);
    },
  );
}

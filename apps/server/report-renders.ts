// The pages a delegated thread showed with html_render, carried up on its crew report (runner/queue.ts reportToParent),
// so the thread it reports to shows them with the report, a Conductor's delegation card included. A report carries what
// the thread showed since its last report, and the pages the reports it got in that time carried, so a page from any
// depth reaches the top once. Pages are named by thread and file name, which every machine shares, so a report another
// machine files (run-on.ts) names them too. packages/shared/report-pages.ts ReportRender has the shape.
import { isRenderPath, renderedTitle, renderSlug, titleFromName } from '@omni/shared/html-render.ts';
import { REPORT_RENDERS_MAX, reportRenderKey, type ReportRender } from '@omni/shared/report-pages.ts';
import { ARTIFACT_COLUMNS, db, type ArtifactWithThread } from './db.ts';
import { now } from './db/connection.ts';
import { transcriptOf } from './db/repos/events.ts';

const at = (row: { at: string | null } | undefined) => row?.at ?? '';

/**
 * When the child last reported to this parent: the newest of its reports in the parent's transcript (synced from any
 * machine), those saved here that the parent has not read yet, and those sent to another machine that holds the parent.
 * A report from before reports said when (`through`) counts from when it landed. '' when it never reported.
 */
function lastReported(childId: string, parentId: string): string {
  const shown = db
    .prepare(
      `SELECT MAX(COALESCE(json_extract(payload, '$.through'), created_at)) AS at FROM events
       WHERE thread_id = ? AND kind = 'crew_report' AND json_extract(payload, '$.thread_id') = ?`,
    )
    .get(transcriptOf(parentId), childId) as { at: string | null } | undefined;
  const saved = db
    .prepare(`SELECT MAX(json_extract(payload, '$.through')) AS at FROM message_requests WHERE thread_id = ? AND kind = 'crew_report' AND json_extract(payload, '$.thread_id') = ?`)
    .get(parentId, childId) as { at: string | null } | undefined;
  const sent = db
    .prepare(`SELECT MAX(json_extract(report, '$.through')) AS at FROM remote_commands WHERE thread_id = ? AND kind = 'report' AND json_extract(report, '$.thread_id') = ?`)
    .get(parentId, childId) as { at: string | null } | undefined;
  return [at(shown), at(saved), at(sent)].reduce((a, b) => (b > a ? b : a), '');
}

/** The pages the thread showed itself after `since`: its own render files, and its seated agents' (ADR 0019). */
function ownPages(threadId: string, since: string): { at: string; r: ReportRender }[] {
  const files = (
    db
      .prepare(
        `SELECT thread_id, name, path, created_at FROM artifacts WHERE created_at > ?
         AND thread_id IN (SELECT ? UNION SELECT id FROM threads WHERE parent_id = ? AND source = 'member') ORDER BY created_at, id`,
      )
      .all(since, threadId, threadId) as { thread_id: string; name: string; path: string; created_at: string }[]
  ).filter((a) => isRenderPath(a.path));
  if (!files.length) return [];
  // Titles from the html_render answers in its transcript: whatever the harness, the answer names the page's title.
  const titles = (
    db
      .prepare(
        `SELECT json_extract(payload, '$.text') AS text FROM events WHERE thread_id = ? AND kind = 'tool_result' AND created_at > ?
         AND json_extract(payload, '$.text') LIKE 'Shown inline in the thread as %'`,
      )
      .all(transcriptOf(threadId), since) as { text: string | null }[]
  ).flatMap((row) => {
    const title = row.text ? renderedTitle(row.text) : null;
    return title ? [title] : [];
  });
  return files.map((a) => ({
    at: a.created_at,
    r: { thread_id: a.thread_id, name: a.name, title: titles.find((t) => a.name.startsWith(`${renderSlug(t)}-`)) ?? titleFromName(a.name) },
  }));
}

/** The pages the crew reports the thread got after `since` carried: its own crew's, from any depth. */
function passedOn(threadId: string, since: string): { at: string; r: ReportRender }[] {
  const rows = db
    .prepare(
      `SELECT json_extract(payload, '$.renders') AS renders, created_at FROM events WHERE thread_id = ? AND kind = 'crew_report' AND created_at > ?
       AND json_extract(payload, '$.renders') IS NOT NULL ORDER BY id`,
    )
    .all(transcriptOf(threadId), since) as { renders: string; created_at: string }[];
  return rows.flatMap((row) => readRenders(row.renders).map((r) => ({ at: row.created_at, r })));
}

/** A stored `renders` list, keeping only well-formed pages: a report can come from another machine. */
function readRenders(json: string): ReportRender[] {
  try {
    const list = JSON.parse(json) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((r) =>
      r && typeof r.thread_id === 'string' && typeof r.name === 'string' && typeof r.title === 'string' ? [{ thread_id: r.thread_id, name: r.name, title: r.title }] : [],
    );
  } catch {
    return [];
  }
}

/**
 * What a child's report to its parent carries of its pages: those since its last report there, oldest first, the newest
 * REPORT_RENDERS_MAX at most, and when it reported (`through`), where the next report starts.
 */
export function reportRenders(childId: string, parentId: string): { renders?: ReportRender[]; through: string } {
  const through = now();
  const since = lastReported(childId, parentId);
  const seen = new Set<string>();
  const pages = [...ownPages(childId, since), ...passedOn(childId, since)]
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((p) => p.r)
    .filter((r) => {
      const key = reportRenderKey(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-REPORT_RENDERS_MAX);
  return pages.length ? { renders: pages, through } : { through };
}

/**
 * The files of the pages a thread's crew reports carry, for its detail: the transcript draws each with its report
 * whatever the newest crew artifacts hold. A page whose file has not reached this machine yet is left out; it comes
 * on the stream as a crew artifact once it does.
 */
export function reportRenderRows(threadId: string): ArtifactWithThread[] {
  const rows = db
    .prepare(`SELECT json_extract(payload, '$.renders') AS renders FROM events WHERE thread_id = ? AND kind = 'crew_report' AND json_extract(payload, '$.renders') IS NOT NULL`)
    .all(threadId) as { renders: string }[];
  const find = db.prepare(
    `SELECT ${ARTIFACT_COLUMNS.split(', ').map((c) => `a.${c}`).join(', ')}, t.title AS thread_title, t.channel_id
     FROM artifacts a JOIN threads t ON t.id = a.thread_id WHERE a.thread_id = ? AND a.name = ? ORDER BY a.id DESC LIMIT 1`,
  );
  const out = new Map<string, ArtifactWithThread>();
  for (const r of rows.flatMap((row) => readRenders(row.renders))) {
    const key = reportRenderKey(r);
    if (out.has(key)) continue;
    const a = find.get(r.thread_id, r.name) as unknown as ArtifactWithThread | undefined;
    if (a && isRenderPath(a.path)) out.set(key, a);
  }
  return [...out.values()];
}

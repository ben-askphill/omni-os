// The pages a delegated thread showed with html_render (packages/shared/html-render.ts), as its crew report carries them
// up to the thread it reports to (apps/server/report-renders.ts). Kept out of html-render.ts, whose frame script names
// browser globals, so the transcript fold the iOS app imports can read them.

/**
 * A page a delegated thread showed, carried up on its crew report (packages/shared/report-shape.ts) so the thread it
 * reports to shows it with the report. Named by its thread and file name, which are the same on every machine.
 */
export interface ReportRender {
  /** The thread that showed it: the reporting thread, or one further down whose report it passed on. */
  thread_id: string;
  /** Its file under that thread's artifacts/renders/. */
  name: string;
  title: string;
}

/** The most pages one report carries: the newest. */
export const REPORT_RENDERS_MAX = 12;

export const reportRenderKey = (r: Pick<ReportRender, 'thread_id' | 'name'>) => `${r.thread_id}/${r.name}`;

/**
 * Each page once in a transcript: the pages of `renders` that no earlier report in it carried, recording them in `seen`.
 * The same list back when nothing was dropped.
 */
export function unseenRenders(renders: readonly ReportRender[] | undefined, seen: Set<string>): ReportRender[] | undefined {
  if (!renders?.length) return renders as ReportRender[] | undefined;
  const kept = renders.filter((r) => {
    const key = reportRenderKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return kept.length === renders.length ? (renders as ReportRender[]) : kept;
}

import { appendLive, applyHead, applyPage, boundHistory, detachHead, emptyHistory, historyQuery, openHistory, replaceRow, tailId, type History, type HistoryCursor, type HistoryHead, type HistoryPage, type HistoryRow } from '@omni/shared/history.ts';

export interface ThreadDetail<R extends HistoryRow> {
  events: R[];
  history?: HistoryHead;
}

export class ThreadHistory<R extends HistoryRow> {
  private current: History<R> = emptyHistory;
  private cursor = 0;

  get history(): History<R> { return this.current; }
  get after(): number { return this.cursor; }

  open(detail: ThreadDetail<R>): void {
    this.current = openHistory(detail.events, detail.history ?? { from: 0, to: null, results_below: 0 });
    this.cursor = tailId(this.current);
  }

  append(events: readonly R[], follows = true): void {
    this.current = boundHistory(appendLive(this.current, events), follows);
    for (const event of events) this.cursor = Math.max(this.cursor, event.id);
  }

  snapshot(detail: ThreadDetail<R>): void {
    this.current = applyHead(detachHead(this.current), detail.events, detail.history ?? { from: 0, to: null, results_below: 0 });
    this.cursor = tailId({ rows: detail.events });
  }

  async page(cursor: HistoryCursor, load: (query: string) => Promise<HistoryPage<R>>): Promise<void> {
    const page = await load(historyQuery(cursor));
    this.current = applyPage(this.current, page);
  }

  async fullRow(id: number, load: (id: number) => Promise<R>): Promise<void> {
    this.current = replaceRow(this.current, await load(id));
  }
}

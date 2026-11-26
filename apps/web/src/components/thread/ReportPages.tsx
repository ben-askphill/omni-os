import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { reportRenderRow } from '@omni/shared/html-render.ts';
import type { ReportRender } from '@omni/shared/report-pages.ts';
import type { Artifact } from '../../api.ts';
import { HtmlRender } from '../HtmlRender.tsx';

/**
 * The files a transcript's crew reports can name (packages/shared/report-pages.ts ReportRender): its crew's newest and
 * those its detail sent for its reports. `open`: the phone's full-screen viewer in place of the dialog.
 */
interface ReportPagesValue {
  rows: readonly Artifact[];
  open?: (a: Artifact) => void;
}

const Pages = createContext<ReportPagesValue>({ rows: [] });

export function ReportPagesProvider({ rows, open, children }: ReportPagesValue & { children: ReactNode }) {
  const value = useMemo(() => ({ rows, open }), [rows, open]);
  return <Pages.Provider value={value}>{children}</Pages.Provider>;
}

/**
 * The pages a delegated thread showed with html_render, above its report as above its reply in its own thread. A page
 * whose file has not reached this machine yet shows once it does.
 */
export function ReportPages({ renders }: { renders: readonly ReportRender[] | undefined }) {
  const { rows, open } = useContext(Pages);
  if (!renders?.length) return null;
  const shown = renders.flatMap((r) => {
    const a = reportRenderRow(r, rows);
    return a ? [{ r, a }] : [];
  });
  if (!shown.length) return null;
  return (
    <div data-find-skip className="flex flex-col gap-3">
      {shown.map(({ r, a }) => (
        <HtmlRender key={a.id} a={a} title={r.title} onOpen={open && (() => open(a))} />
      ))}
    </div>
  );
}

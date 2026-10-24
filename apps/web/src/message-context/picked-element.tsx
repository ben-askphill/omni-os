// What Ben picked on a page, as he sees it before sending and in the sent message (packages/shared/message-context-browser.ts
// `PickedElement`): the tag and selector, its text, and the bounded markup excerpt the agent will get. All of it is the
// page's own text, shown as text and never as markup.
import { useState } from 'react';
import type { PickedElement } from '@omni/shared/message-context-browser.ts';

const Row = ({ label, children }: { label: string; children: string }) => (
  <div className="mt-1.5">
    <div className="text-[10.5px] tracking-wide text-fg-4 uppercase">{label}</div>
    <div className="font-mono text-[11.5px] leading-[1.45] break-words whitespace-pre-wrap text-fg-2">{children}</div>
  </div>
);

export function PickedElementDetails({ element: e, defaultOpen = false }: { element: PickedElement; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { bounds } = e;
  return (
    <div className="mt-2 min-w-0 rounded-xl bg-surface-2 px-3 py-2 text-[12px]" data-picked-element>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 rounded-md bg-surface px-1.5 py-px font-mono text-[11.5px] text-fg">{`<${e.tag}>`}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-2" title={e.selector}>
          {e.selector}
        </span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="shrink-0 text-[11.5px] text-fg-3 underline-offset-2 hover:underline">
          {open ? 'Hide details' : 'Details'}
        </button>
      </div>
      {e.text && !open && <div className="mt-1 line-clamp-2 text-fg-2">{e.text}</div>}
      {e.opaque_frame && <div className="mt-1 text-fg-3">This is a frame from another site, so its contents cannot be read. Only the frame itself is described.</div>}
      {open && (
        <div className="min-w-0">
          <Row label="Selector">{e.selector}</Row>
          <Row label="Text">{e.text || '(none)'}</Row>
          <Row label="Markup">{e.html}</Row>
          {e.ancestors.length > 0 && <Row label="Parents, nearest first">{e.ancestors.join('\n')}</Row>}
          {e.frames.length > 0 && <Row label="Inside frames, outermost first">{e.frames.join('\n')}</Row>}
          <Row label="Box">{`${bounds.width}×${bounds.height} at ${bounds.x}, ${bounds.y} · picked at ${e.point.x}, ${e.point.y}`}</Row>
          {e.truncated && <div className="mt-1.5 text-[11px] text-fg-4">The text or markup was cut to a fixed size. The agent gets this excerpt, not the whole element.</div>}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { uploadUrl, type Attachment } from '../../api.ts';
import { bytes } from '../../format.ts';
import { Icon, Modal } from '../ui.tsx';

/**
 * What Ben attached to a message: images as thumbnails that open full size, everything else as a download.
 * `href` stands in for the server's copy while a message is still on its way (sending.ts).
 */
export function Attachments({ threadId, items, href }: { threadId: string; items: Attachment[]; href?: (a: Attachment) => string }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  if (!items.length) return null;
  const src = (a: Attachment, download = false) => href?.(a) ?? uploadUrl(threadId, a, download);
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {items.map((a) =>
        a.image ? (
          <button key={a.name} type="button" onClick={() => setOpen(a)} className="press overflow-hidden rounded-2xl bg-surface p-1" title={`${a.name} · ${bytes(a.size)}`}>
            <img src={src(a)} alt={a.name} loading="lazy" className="max-h-44 w-auto max-w-[14rem] rounded-xl object-cover shadow-[inset_0_0_0_1px_var(--line)]" />
          </button>
        ) : (
          <a
            key={a.name}
            href={src(a, true)}
            download={a.name}
            className="hov flex h-11 max-w-[16rem] items-center gap-2 rounded-2xl bg-surface px-2 text-[12.5px] [--hov:var(--surface-2)]"
            title={`${a.name} · ${bytes(a.size)}`}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg text-fg-3">
              <Icon name="file" size={15} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-medium text-fg-2">{a.name}</span>
              <span className="block font-num text-[10.5px] text-fg-4">{bytes(a.size)}</span>
            </span>
            <Icon name="download" size={14} className="text-fg-3" />
          </a>
        ),
      )}
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        wide
        title={
          open && (
            <span className="flex items-center gap-2">
              <span className="truncate">{open.name}</span>
              <span className="font-num text-[11px] text-fg-3">{bytes(open.size)}</span>
            </span>
          )
        }
      >
        {open && (
          <div className="bg-surface-2">
            <img src={src(open)} alt={open.name} className="mx-auto max-h-[78vh] w-auto" />
          </div>
        )}
      </Modal>
    </div>
  );
}

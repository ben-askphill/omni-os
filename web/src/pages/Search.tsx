import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useApi, type SearchHit } from '../api.ts';
import { Empty, ErrorNote, Icon, Loading, PageHeader, StatusDot } from '../components/ui.tsx';
import { plural, relTime, safeSnippet } from '../format.ts';
import { href, navigate } from '../router.ts';
import { useApp } from '../store.tsx';

export function SearchPage({ q }: { q: string }) {
  const { channel } = useApp();
  const [value, setValue] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const query = q.trim();
  const res = useApi<SearchHit[]>(query ? `/search?q=${encodeURIComponent(query)}` : null);

  useEffect(() => setValue(q), [q]);
  useEffect(() => {
    if (!q) input.current?.focus();
  }, [q]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(href.search(value.trim()).slice(1), { replace: true });
  };

  const hits = res.data ?? [];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <PageHeader width="max-w-3xl" title="Search" subtitle="Titles, prompts, replies and tool output across every channel." />
      <div className="mx-auto max-w-3xl px-4 pt-2 pb-16 md:px-8">
        <form onSubmit={submit} className="relative">
          <Icon name="search" size={17} className="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 text-fg-3" />
          <input
            ref={input}
            type="search"
            className="h-12 w-full rounded-full bg-surface pr-5 pl-11 text-[15px] shadow-[inset_0_0_0_1px_var(--line)] transition-[box-shadow,background-color] outline-none placeholder:text-fg-4 focus:bg-bg focus:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_5px_var(--wash)] focus-visible:outline-none"
            placeholder="Search threads"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Search threads"
          />
        </form>

        <div className="mt-5">
          {!query ? (
            <Empty icon="search" title="Search everything">
              Prefix matches work, so <span className="font-mono text-[12px]">checko</span> finds checkout.
            </Empty>
          ) : res.error ? (
            <ErrorNote onRetry={res.reload}>{res.error}</ErrorNote>
          ) : res.loading && !res.data ? (
            <Loading label="Searching" />
          ) : hits.length === 0 ? (
            <Empty icon="search" title={`No results for "${query}"`}>
              Try fewer or shorter words.
            </Empty>
          ) : (
            <>
              <div className="label-mono mb-2 px-3.5">
                {hits.length >= 40 ? 'Top 40 results' : plural(hits.length, 'result')}
              </div>
              <ul className="rise">
                {hits.map((h, i) => (
                  <li key={h.thread_id} style={{ '--i': i } as CSSProperties}>
                    <a href={href.thread(h.thread_id)} className="hov block rounded-[18px] px-3.5 py-3 [--hov:var(--surface)]">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusDot status={h.status} />
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{h.title}</span>
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[11.5px] leading-5 text-fg-2">#{channel(h.channel_id)?.name ?? h.channel_id}</span>
                        <span className="w-16 shrink-0 text-right font-num text-[11px] text-fg-4">{relTime(h.updated_at)}</span>
                      </div>
                      {h.snippet && (
                        <p
                          className="mt-1 line-clamp-2 pl-4 text-[12.5px] leading-relaxed break-words text-fg-2"
                          dangerouslySetInnerHTML={{ __html: safeSnippet(h.snippet) }}
                        />
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

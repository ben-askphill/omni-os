import { sortTemplates, type Template, type TemplateList } from '@omni/shared/templates.ts';
import { useApi } from './api.ts';
import { useFeed } from './store.tsx';

// The templates the menus offer (GET /api/templates, apps/server/templates.ts), fresh when the Shopify add-on is turned
// on or off here or on another machine. The `/` menu gets them inside the command list; the New flows and Settings
// read them here.

export function useTemplates() {
  const res = useApi<TemplateList>('/templates');
  useFeed((e) => {
    if (e.type === 'display' || e.type === 'reconnect') res.reload();
  });
  return res;
}

/**
 * The template chips under an empty new-thread box, in the look of Home's "Start in" chips: quick ones first. A tap
 * puts `/<name> ` in the box (`onPick`), so what is typed next becomes the template's input. `touch`: the phone's
 * taller chips.
 */
export function TemplateChips({
  templates,
  onPick,
  touch,
  className = '',
}: {
  templates: Template[];
  onPick: (t: Template) => void;
  touch?: boolean;
  className?: string;
}) {
  if (!templates.length) return null;
  return (
    <div role="group" aria-label="Templates" className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}>
      <span className="caption">Templates</span>
      {sortTemplates(templates).map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.description}
          onClick={() => onPick(t)}
          className={`inline-flex min-w-0 items-center rounded-full bg-surface text-fg-2 hover:text-fg ${touch ? 'mo-press h-9 px-3.5 text-[13.5px]' : 'press h-7 px-3 text-[12px]'}`}
        >
          <span className="truncate">{t.name}</span>
        </button>
      ))}
    </div>
  );
}

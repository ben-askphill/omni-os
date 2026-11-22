// The page tests/message-editor-browser.test.ts drives in Chromium: the composer's text box
// (components/composer/MessageEditor.tsx) with the `@` and `/` menus, against a stubbed /api.
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageEditor, type MessageEditorHandle } from '../../../src/components/composer/MessageEditor.tsx';
import { addDraftContext, useDraftContext } from '../../../src/message-context/draft.ts';
import type { FileMention } from '@omni/shared/mention-menu.ts';
import { agentMention, agentMentionBody } from '@omni/shared/message-context-agent.ts';
import { machineMention, mentionBody } from '@omni/shared/message-context-machine.ts';
import { newContext } from '@omni/shared/message-context.ts';
import type { CommandList } from '../../../src/api.ts';
import './page.css';

declare global {
  interface Window {
    state: { text: string; records: unknown[]; keys: string[]; errors: string[]; menu: boolean };
    editor: MessageEditorHandle | null;
    setText: (t: string) => void;
    mention: (kind: 'agent' | 'machine', id: string, name: string) => void;
  }
}

const DRAFT = 'fixture';
// The record a pick from the `@` menu adds, without the menu: then text set with `@<name>` shows that chip.
window.mention = (kind, id, name) => {
  addDraftContext(
    DRAFT,
    kind === 'agent' ? newContext(agentMention, agentMentionBody({ id, name }), '') : newContext(machineMention, mentionBody({ id, name, reachability: 'online', lastSeen: null }, new Date()), ''),
  );
};
const rows: FileMention[] = [
  { insert: 'omarchy', name: 'omarchy', detail: 'Online', kind: 'machine', machine: { id: 'dev-omarchy', here: false, reachability: 'online', lastSeen: null } },
  { insert: 'MacBook-Pro', name: 'MacBook-Pro', detail: 'Asleep', kind: 'machine', machine: { id: 'dev-mbp', here: false, reachability: 'offline', lastSeen: '2026-11-20T08:00:00.000Z' } },
  { insert: 'artifacts/report.html', name: 'report.html', detail: 'This thread', kind: 'artifact' },
  { insert: 'apps/web/src/main.tsx', name: 'main.tsx', detail: 'apps/web/src', kind: 'file' },
];
const commands: CommandList = {
  status: 'ready',
  fetchedAt: 1,
  commands: [
    { name: 'review', description: 'Review the diff', source: 'project', mentionable: true },
    { name: 'deploy', description: 'Deploy it', source: 'personal' },
  ],
} as unknown as CommandList;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith('/api/mentions')) {
    const q = new URL(url, location.href).searchParams.get('q')?.toLowerCase() ?? '';
    return Response.json(rows.filter((r) => r.insert.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
  }
  if (url.startsWith('/api/commands')) return Response.json(commands);
  return realFetch(input, init);
}) as typeof fetch;

window.state = { text: '', records: [], keys: [], errors: [], menu: false };

function Page() {
  const [text, setText] = useState('');
  const records = useDraftContext(DRAFT);
  const frame = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  window.setText = setText;
  window.state.text = text;
  window.state.records = [...records];
  const below = new URLSearchParams(location.search).has('below');
  // The phone composer's type (mobile/MoComposer.tsx), the tightest line a chip sits in.
  const tight = new URLSearchParams(location.search).has('tight');
  return (
    <div style={{ padding: below ? '16px' : '360px 16px 16px', maxWidth: 640 }}>
      <div
        ref={(el) => {
          frame.current = el;
          setAnchor(el);
        }}
        className="relative rounded-[20px] bg-surface"
      >
        <MessageEditor
          handle={(h) => {
            window.editor = h;
          }}
          text={text}
          onText={setText}
          draft={DRAFT}
          records={records}
          mentions="thread=t1"
          agents={{ members: [], others: [{ id: 'reviewer', name: 'Reviewer' }] }}
          commands={{ list: commands, load: () => {}, where: 'reply' }}
          anchor={anchor}
          below={below}
          reply
          onError={(why) => window.state.errors.push(why)}
          onMenuOpen={(open) => (window.state.menu = open)}
          onKeyDown={(e) => {
            window.state.keys.push(e.key);
            if (e.key === 'Enter' && !e.shiftKey) e.preventDefault();
          }}
          label="Message"
          placeholder="Reply · / commands, @ files"
          className={`max-h-[220px] min-h-[60px] w-full overflow-y-auto px-4 pt-3 pb-1 outline-none ${tight ? 'text-[16px] leading-[1.35]' : 'text-[14.5px] leading-[1.8]'}`}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

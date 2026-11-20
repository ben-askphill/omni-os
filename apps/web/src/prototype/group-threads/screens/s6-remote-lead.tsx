// PROTOTYPE, throwaway. Screen 6: a thread in #Volero led by Hermes, a remote agent. It talks; it never changes the
// thread's files. The bar's "Read on" switch flips the channel's worktree read: off (the default), Hermes cannot open
// the files; on, it reads three of them through the read tool, and each read shows as a row.
import type { ReactNode } from 'react';
import { AGENTS, CHANNELS, REMOTE_THREAD, type Msg } from '../data.ts';
import { Messages } from '../messages.tsx';
import { AgentAvatar, ComposerBox, DesktopThread, PhoneComposer, PhoneThread, QuickBottom, QuickCard, QuickRow, QuickTop, RemoteTag, TechRow, ThreadHead } from '../parts.tsx';
import { Button, Icon } from '../../../components/ui.tsx';
import { useParams } from '../url-state.ts';
import type { Screen } from './types.ts';

const ASK: Msg = { id: 1, author: 'ben', at: '15:40', text: 'On the product page the price shows the old value for a second, then jumps to the sale price. Why?' };

const OFF: Msg = {
  id: 2,
  author: 'hermes',
  at: '15:41',
  text:
    'Going by what you describe, the page renders the regular price on the server and a script swaps in the sale price after load. On Shopify themes that is usually the variant picker reading prices from JSON that arrives late.\n\n' +
    'I can’t open this thread’s files to confirm it. To change the theme, add a local agent such as Builder.',
};

const ON: Msg = {
  id: 2,
  author: 'hermes',
  at: '15:42',
  steps: 'Read 3 files · sections/main-product.liquid, assets/variant-picker.js, snippets/price.liquid',
  text:
    '`snippets/price.liquid` prints `product.price`, the regular price, on the server. `assets/variant-picker.js` then swaps in `variant.price` after `DOMContentLoaded`, once the variant JSON loads. That gap is the flash.\n\n' +
    'Fix: print the selected variant’s price in Liquid, so the server already sends the sale price. I can’t change files here. Add Builder to make the change.',
};

const useRead = () => useParams().get('read') === '1';

/** The note under a remote agent's reply when the channel keeps its files closed. */
function ClosedNote() {
  return (
    // pl-9: under the reply's text, past the 24px gutter avatar and its gap.
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-9 text-[12px] text-fg-3">
      <Icon name="lock" size={12} className="shrink-0" />
      <span>Remote agents can’t read files in #Volero.</span>
      <a href="#" className="font-medium text-fg-2 underline underline-offset-2">
        Channel settings
      </a>
    </div>
  );
}

function LedBy() {
  return (
    <span className="ml-1 inline-flex min-w-0 items-center gap-1 text-fg-3">
      <Icon name="chevronRight" size={12} className="shrink-0" />
      <AgentAvatar a={AGENTS.hermes} size={14} />
      <span>Hermes</span>
      <span className="text-fg-3">· talks only</span>
    </span>
  );
}

// ---------- A: quiet labels ----------

function TranscriptA({ phone }: { phone?: boolean }) {
  const read = useRead();
  return (
    <>
      <Messages list={[ASK]} phone={phone} />
      <div>
        <Messages list={[read ? ON : OFF]} phone={phone} />
        {!read && <ClosedNote />}
      </div>
    </>
  );
}

const placeholderA = 'Message Hermes. It talks; @ a local agent to change files';

const desktopA = () => (
  <DesktopThread
    head={<ThreadHead channel={CHANNELS.volero} title={REMOTE_THREAD.title} crumbs={<LedBy />} status="done" />}
    quick={<QuickRemote />}
    composer={<ComposerBox placeholder={placeholderA} />}
  >
    <TranscriptA />
  </DesktopThread>
);

const phoneA = () => (
  <PhoneThread
    title={REMOTE_THREAD.title}
    sub={
      <span className="inline-flex items-center gap-1.5">
        #Volero · <AgentAvatar a={AGENTS.hermes} size={14} /> Hermes · talks only
      </span>
    }
    composer={<PhoneComposer placeholder="Message Hermes" hint="Hermes talks only. @ a local agent to change files." />}
  >
    <TranscriptA phone />
  </PhoneThread>
);

/** The same rows a local thread's quick card has (Ben, 2026-11-20); machine, folder and branch stay empty here. */
function QuickRemote() {
  const read = useRead();
  return (
    <QuickCard>
      <QuickTop empty />
      <QuickRow icon="delegate">
        <span className="shrink-0 text-fg-3">Lead</span>
        <AgentAvatar a={AGENTS.hermes} size={18} />
        <span>Hermes</span>
        <RemoteTag />
      </QuickRow>
      <QuickRow icon="lock">
        <span className="shrink-0 text-fg-3">Files</span>
        <span className="truncate">{read ? 'Can read, can’t change' : 'Can’t read or change'}</span>
      </QuickRow>
      <TechRow id="hermes" />
      <QuickBottom status="Done · Hermes" branch="" />
    </QuickCard>
  );
}

// ---------- B: a notice card at the top ----------

function Notice({ phone }: { phone?: boolean }) {
  const read = useRead();
  const line = (icon: 'pencil' | 'file', text: ReactNode, action: ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line py-2.5 first:border-t-0">
      <Icon name={icon} size={15} className="shrink-0 text-fg-3" />
      <span className="min-w-0 flex-1 text-[13px] leading-[1.45] text-fg-2">{text}</span>
      {action}
    </div>
  );
  return (
    <section className={`rounded-[20px] bg-surface px-4 pt-3.5 pb-1.5 ${phone ? '' : ''}`}>
      <div className="mb-1.5 flex items-center gap-2.5">
        <AgentAvatar a={AGENTS.hermes} size={28} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
            Hermes leads this thread <RemoteTag />
          </div>
          <div className="text-[12px] text-fg-3">A remote agent: it answers here, on its own server.</div>
        </div>
      </div>
      {line('pencil', 'It can’t change this thread’s files.', <Button size="sm" icon="plus">Add Builder</Button>)}
      {line(
        'file',
        read ? 'It can read this thread’s files: #Volero allows it.' : 'It can’t read them either: #Volero keeps its files from remote agents.',
        <Button size="sm" variant="ghost">
          Channel settings
        </Button>,
      )}
    </section>
  );
}

function TranscriptB({ phone }: { phone?: boolean }) {
  const read = useRead();
  return (
    <>
      <Notice phone={phone} />
      <Messages list={[ASK, read ? ON : OFF]} phone={phone} />
    </>
  );
}

const desktopB = () => (
  <DesktopThread head={<ThreadHead channel={CHANNELS.volero} title={REMOTE_THREAD.title} crumbs={<LedBy />} status="done" />} composer={<ComposerBox placeholder="Message Hermes" />}>
    <TranscriptB />
  </DesktopThread>
);

const phoneB = () => (
  <PhoneThread
    title={REMOTE_THREAD.title}
    sub={
      <span className="inline-flex items-center gap-1.5">
        #Volero · <AgentAvatar a={AGENTS.hermes} size={14} /> Hermes
      </span>
    }
    composer={<PhoneComposer placeholder="Message Hermes" />}
  >
    <TranscriptB phone />
  </PhoneThread>
);

export const remoteLead: Screen = {
  id: 6,
  name: 'Remote lead, talk only',
  place: { kind: 'channel', channel: 'volero', hash: `#/t/${REMOTE_THREAD.id}` },
  pick: 'A',
  toggle: { key: 'read', label: 'Read on' },
  variants: [
    { key: 'A', name: 'Quiet labels', idea: '“talks only” in the crumbs and the composer, a lock line under a reply that could not read files, Files in the quick card.', desktop: desktopA, phone: phoneA },
    { key: 'B', name: 'Notice card', idea: 'A card on top of the thread says what Hermes can and can’t do, with Add Builder and Channel settings.', desktop: desktopB, phone: phoneB },
  ],
};

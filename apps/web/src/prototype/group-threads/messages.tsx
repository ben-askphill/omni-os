// PROTOTYPE, throwaway: three ways an agent's reply can say who wrote it (screen 1). Ben picked the gutter (A), with
// smaller avatars than first drawn (24px, was 30), so every screen draws its messages that way.
import type { ReactNode } from 'react';
import { AGENTS, type AgentId, type Msg } from './data.ts';
import { AgentAvatar, BenBubble, JoinedLine, Prose, RemoteTag, StepsFold, TechLine, Thinking } from './parts.tsx';

export type Style = 'gutter' | 'byline' | 'card';

/** Name, Remote tag, harness and model (technical only) and time: the author line every style shares. */
function Meta({ id, at, phone, strong }: { id: AgentId; at: string; phone?: boolean; strong?: boolean }) {
  const a = AGENTS[id];
  return (
    <>
      <span className={`shrink-0 ${strong ? 'font-semibold text-fg' : 'font-medium text-fg-2'} ${phone ? 'text-[13px]' : ''}`}>{a.name}</span>
      {a.kind === 'remote' && <RemoteTag />}
      <TechLine a={a} className="min-w-0 text-[11.5px]" />
      <span className="shrink-0 font-num text-[11px] text-fg-3">{at}</span>
    </>
  );
}

function Body({ m, phone }: { m: Msg; phone?: boolean }) {
  return (
    <>
      {m.steps && <StepsFold text={m.steps} />}
      {m.text && (
        <div className={phone ? 'text-[15px] leading-[1.5]' : undefined}>
          <Prose text={m.text} />
        </div>
      )}
      {m.running && <Thinking label={m.running} className="mt-1 text-[12.5px]" />}
    </>
  );
}

/** A: the avatar in a gutter beside the reply, the name over it. Consecutive replies from one agent share one head. */
function Gutter({ m, phone, first }: { m: Msg; phone?: boolean; first: boolean }) {
  const a = AGENTS[m.author as AgentId];
  const size = 24;
  return (
    <div className="flex gap-3">
      <div className="shrink-0" style={{ width: size }}>
        {first && <AgentAvatar a={a} size={size} ring={!!m.running} />}
      </div>
      <div className="min-w-0 flex-1">
        {first && (
          <div className="mb-0.5 flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
            <Meta id={a.id} at={m.at} phone={phone} strong />
          </div>
        )}
        <Body m={m} phone={phone} />
      </div>
    </div>
  );
}

/** B: a small byline over the reply, the phone's Conductor line for every agent. The reply keeps the full width. */
function Byline({ m, phone }: { m: Msg; phone?: boolean }) {
  const a = AGENTS[m.author as AgentId];
  return (
    <div>
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-none text-fg-3">
        <AgentAvatar a={a} size={20} ring={!!m.running} />
        <Meta id={a.id} at={m.at} phone={phone} />
      </div>
      <Body m={m} phone={phone} />
    </div>
  );
}

/** C: each agent's turn in a card of its own, its face and name heading it. */
function Card({ m, phone }: { m: Msg; phone?: boolean }) {
  const a = AGENTS[m.author as AgentId];
  return (
    <div className={`rounded-[22px] bg-surface ${phone ? 'px-3.5 pt-3 pb-2.5' : 'px-4 pt-3 pb-3'}`}>
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] leading-none text-fg-3">
        <AgentAvatar a={a} size={24} ring={!!m.running} />
        <Meta id={a.id} at={m.at} phone={phone} strong />
      </div>
      <Body m={m} phone={phone} />
    </div>
  );
}

/** One message in the style asked for. Ben's stay the right-hand bubble in every style. */
export function Message({ m, prev, style, phone, fresh }: { m: Msg; prev?: Msg; style: Style; phone?: boolean; fresh?: AgentId[] }): ReactNode {
  if (m.author === 'ben')
    return (
      <>
        <BenBubble m={m} phone={phone} fresh={fresh} />
        {m.joined && (
          <div className="mt-4">
            <JoinedLine ids={m.joined} />
          </div>
        )}
      </>
    );
  if (style === 'gutter') return <Gutter m={m} phone={phone} first={prev?.author !== m.author} />;
  if (style === 'card') return <Card m={m} phone={phone} />;
  return <Byline m={m} phone={phone} />;
}

export function Messages({ list, style = 'gutter', phone, fresh }: { list: Msg[]; style?: Style; phone?: boolean; fresh?: AgentId[] }) {
  return (
    <>
      {list.map((m, i) => (
        <div key={m.id}>
          <Message m={m} prev={list[i - 1]} style={style} phone={phone} fresh={fresh} />
        </div>
      ))}
    </>
  );
}

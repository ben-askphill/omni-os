import type { ComponentType } from 'react';
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { BodyOf, KindName } from '@omni/shared/message-context-kinds.ts';
import type { IconName } from '../components/ui.tsx';

/** How the Web UI shows one kind of message context: its chip's icon, and what the chip opens to. */
export interface ContextView<B> {
  icon: IconName;
  Detail: ComponentType<{ body: B; record: MessageContext }>;
}

/** A view for every kind in CONTEXT_KINDS: a kind listed there without one here fails typecheck. */
export type WebViews = { [K in KindName]: ContextView<BodyOf<K>> };

// The entry of the Mac app's slash engine: the same shared/ modules the Web UI runs, behind one global.
// It imports from shared/ only, never from web/, so a Web UI change cannot reach the Mac bundle.
// Every call takes and returns JSON text, and every offset is a UTF-16 unit, like JavaScript's own.
// Build with `npm run build:slash`; the bundle is checked in (see docs/adr/0002-mac-app-is-a-client.md).
import { OMNI_COMMANDS, type CommandList, type SlashCommand, type SlashRecord } from '../../shared/slash.ts';
import { menuCommands, newThreadHint, replySlash } from '../../shared/composer-slash.ts';
import { mentionSections, menuSections, pickCommand, slashQuery, type SlashQuery } from '../../shared/slash-menu.ts';
import { slashPieces } from '../../shared/slash-pills.ts';

const call =
  <A, R>(f: (a: A) => R) =>
  (json: string): string =>
    JSON.stringify(f(JSON.parse(json) as A) ?? null);

(globalThis as Record<string, unknown>).OmniSlash = {
  query: call(({ text, caret }: { text: string; caret: number }) => slashQuery(text, caret)),
  sections: call(({ commands, where, query, mention, recent }: { commands?: SlashCommand[]; where: 'reply' | 'new-thread'; query: string; mention?: boolean; recent?: string[] }) =>
    (mention ? mentionSections : menuSections)(menuCommands(commands, where), query, recent),
  ),
  pick: call(({ text, at, name }: { text: string; at: SlashQuery; name: string }) => pickCommand(text, at, name)),
  reply: call(({ text, list, harness }: { text: string; list: CommandList | null; harness: string }) => replySlash(text, list, harness)),
  newThreadHint: call(({ text, list, harness }: { text: string; list: CommandList | null; harness: string }) => newThreadHint(text, list, harness)),
  pieces: call(({ text, slash, visible }: { text: string; slash?: SlashRecord; visible?: number }) => slashPieces(text, slash, visible)),
  omniCommands: call(() => OMNI_COMMANDS),
};

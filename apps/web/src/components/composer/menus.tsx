import { useEffect, useMemo, useRef } from 'react';
import { useCommands } from './use-commands.ts';
import { newThreadHint } from '@omni/shared/composer-slash.ts';
import { parseSlash } from '@omni/shared/slash.ts';
import { asksAuto } from '@omni/shared/thread-run.ts';
import type { DraftRun } from '@omni/shared/draft-run.ts';

/**
 * The new-thread composer's `/` commands: the harness in its picker's, for the channel it will run in, and the hint
 * under the box. The menus themselves are the composer's MessageEditor.
 */
export function useNewThreadCommands({ text, choice, channel }: { text: string; choice: DraftRun['choice']; channel: string }) {
  // Auto picks the harness only once the prompt is sent, so its menu is Claude Code's.
  const auto = asksAuto(choice);
  const menuHarness = auto ? 'claude-code' : choice.harness;
  const commands = useCommands(`harness=${encodeURIComponent(menuHarness)}&channel=${encodeURIComponent(channel)}`);
  const hint = useMemo(() => newThreadHint(text, commands.list, menuHarness), [text, commands.list, menuHarness]);
  // Another harness or channel has its own list: fetch it for what is typed, so the hint re-checks it.
  const latest = useRef(text);
  latest.current = text;
  const { load } = commands;
  useEffect(() => {
    const { lead, mentions } = parseSlash(latest.current);
    if (lead || mentions.length) void load();
  }, [load]);
  return { commands, hint };
}

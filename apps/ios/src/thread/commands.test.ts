import { describe, expect, it } from 'vitest';
import { replySlash } from '@omni/shared/composer-slash.ts';
import type { CommandList } from '@omni/client-core';

import { commandStep } from './commands';

// What the app's Send does with a message that starts with a command, from the rules the Web UI's reply box uses.

const thread = { channel_id: 'acme', role: null, harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high', auto_reason: null };
const list: CommandList = { status: 'ready', fetchedAt: 1, commands: [{ name: 'tdd', source: 'personal', description: 'Test first', mentionable: true }] };
const step = (text: string) => commandStep(replySlash(text, list, thread.harness).action, thread);

describe('commandStep', () => {
  it('sends a harness command, or plain text, to the thread as typed', () => {
    expect(step('/tdd write the test')).toEqual({ kind: 'send' });
    expect(step('fix the cart')).toEqual({ kind: 'send' });
  });

  it('renames with the title after /rename, on one line', () => {
    expect(step('/rename  Release\nnotes ')).toEqual({ kind: 'rename', title: 'Release notes' });
  });

  it('opens the run sheet for /model, /effort and /fast', () => {
    for (const c of ['/model', '/effort', '/fast']) expect(step(c)).toEqual({ kind: 'pick-model' });
  });

  it('opens the New screen on this channel and run for /clear or /new on its own', () => {
    const open = { kind: 'open-new', channel: 'acme', run: { choice: { harness: 'claude-code', model: 'claude-opus-5-5' }, effort: 'high' } };
    expect(step('/clear')).toEqual(open);
    expect(step('/new')).toEqual(open);
  });

  it('starts the next thread at once for /clear with a prompt', () => {
    expect(step('/clear start over')).toEqual({ kind: 'start', body: { channel: 'acme', prompt: 'start over', role: undefined, harness: 'claude-code', model: 'claude-opus-5-5', effort: 'high' } });
  });
});

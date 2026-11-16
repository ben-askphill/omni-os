import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// Threads without the Conductor's MCP tools learn about the `omni` command, but only when the desktop app's shim is
// what the harnesses' PATH finds (ADR 0014).
const r = await startRunner();
const { buildSystemPrompt, hasOmniCommand } = await import('../runner/prompts.ts');
const { getCrew } = await import('../crew.ts');

const dirs: string[] = [];
function binWith(text: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'omni-cli-prompt-'));
  dirs.push(dir);
  if (text !== null) writeFileSync(join(dir, 'omni'), text, { mode: 0o755 });
  return dir;
}
const original = process.env.PATH;
afterEach(() => {
  process.env.PATH = original;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const SECTION = '## Omni from the shell';

describe('the omni command in the system prompt', () => {
  it("is offered to a local thread without the omni MCP when the app's shim is on PATH", async () => {
    const t = await r.start('THINK:1', { role: 'builder' });
    await r.untilResults(t.id, 1);
    const thread = r.thread(t.id);
    const channel = r.db.channels.get('scratch')!;
    process.env.PATH = [binWith('#!/bin/sh\n# omni-cli-shim 1\nexit 0\n'), original].join(delimiter);
    const prompt = buildSystemPrompt(thread, channel, getCrew('builder'));
    expect(prompt).toContain(SECTION);
    expect(prompt).toContain('omni send parent');
    // The Conductor has the same through its MCP tools, and Hermes runs on another server.
    expect(buildSystemPrompt(thread, channel, getCrew('conductor'))).not.toContain(SECTION);
    expect(buildSystemPrompt({ ...thread, harness: 'hermes' }, channel)).not.toContain(SECTION);
  });

  it('is left out when no omni is on PATH, or the omni there is another program', () => {
    expect(hasOmniCommand([binWith(null)].join(delimiter))).toBe(false);
    expect(hasOmniCommand([binWith('#!/usr/bin/env bash\nSERVICE=omni-os\n')].join(delimiter))).toBe(false);
    expect(hasOmniCommand(['', binWith('#!/bin/sh\n# omni-cli-shim 1\n')].join(delimiter))).toBe(true);
  });
});

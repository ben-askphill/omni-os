import { describe, expect, it } from 'vitest';

import { machineOf } from '../../src/machine/facts';
import { threadDeviceName, threadStatusLabel } from '../../src/thread/title';
import { device, sync, takeover } from '../machine/fixtures';

const idle = { status: 'done', blocked: null, handoff: null, takeover: null };

describe('threadDeviceName', () => {
  it('names the machine that holds the thread when another machine has it', () => {
    const t = takeover({ running: true });
    expect(threadDeviceName({ takeover: t, machine: null, hereName: 'Laptop' })).toBe('Studio');
  });

  it("names the picker's selected machine, this one under its own name", () => {
    const holds = machineOf({ sync: sync(), devices: [device()], hereName: 'Laptop' }, idle);
    expect(threadDeviceName({ takeover: null, machine: holds, hereName: null })).toBe('Laptop');
  });

  it("falls back to the server's name, and to nothing when none is known", () => {
    expect(threadDeviceName({ takeover: null, machine: null, hereName: 'MacBook Pro' })).toBe('MacBook Pro');
    expect(threadDeviceName({ takeover: null, machine: null, hereName: '' })).toBeNull();
    expect(threadDeviceName({ takeover: null, machine: null, hereName: undefined })).toBeNull();
  });
});

describe('threadStatusLabel', () => {
  it('words each status and leaves an unknown one empty', () => {
    expect(threadStatusLabel('running')).toBe('Running');
    expect(threadStatusLabel('failed')).toBe('Failed');
    expect(threadStatusLabel(undefined)).toBe('');
  });
});

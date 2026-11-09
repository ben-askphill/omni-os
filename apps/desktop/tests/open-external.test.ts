import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getApplicationNameForProtocol: () => 'Claude' }, shell: {} }));

const { externalTargets, openFirst } = await import('../src/open-external.ts');

const ARTIFACT = 'https://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a';

describe('externalTargets', () => {
  it('tries the Claude app, then the browser, for an artifact when the app is installed', () => {
    expect(externalTargets(ARTIFACT, () => true)).toEqual(['claude://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a', ARTIFACT]);
  });

  it('opens the browser when no app handles claude: links', () => {
    expect(externalTargets(ARTIFACT, () => false)).toEqual([ARTIFACT]);
  });

  it('asks the OS only for artifact links', () => {
    const installed = vi.fn(() => true);
    expect(externalTargets('https://github.com/x', installed)).toEqual(['https://github.com/x']);
    expect(installed).not.toHaveBeenCalled();
  });

  it('asks Electron by default', () => {
    expect(externalTargets(ARTIFACT)[0]).toBe('claude://claude.ai/artifact/XYTPbBk9xkJor7Xz1DtD2a');
  });
});

describe('openFirst', () => {
  it('stops at the first target the system takes', async () => {
    const open = vi.fn(async () => {});
    await expect(openFirst(['claude://a', 'https://a'], open)).resolves.toBe('claude://a');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('falls back to https when the Claude app hand-off fails', async () => {
    const open = vi.fn(async (u: string) => {
      if (u.startsWith('claude:')) throw new Error('no handler');
    });
    await expect(openFirst(['claude://a', 'https://a'], open)).resolves.toBe('https://a');
    expect(open.mock.calls.map((c) => c[0])).toEqual(['claude://a', 'https://a']);
  });

  it('throws when every target fails', async () => {
    await expect(openFirst(['https://a'], async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
  });
});

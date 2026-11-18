import type { RawResponse } from '@omni/client-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { artifactFile, shareableFile, startArtifactSession } from '../src/artifacts/files';
import { resetDisk, writtenTexts, type File } from './fake-file-system';

vi.mock('expo-file-system', () => import('./fake-file-system'));

const report = { id: 7, name: 'report.html', size: 6, updated_at: '2026-11-18T10:00:00.000Z' };

/** A session's hub whose downloads wait until the test answers them, each with `text`. */
function hubFor(text: string) {
  const answers: (() => void)[] = [];
  const fetchArtifactFile = vi.fn(
    () =>
      new Promise<RawResponse>((resolve) => {
        answers.push(() => resolve({ bytes: new TextEncoder().encode(text), contentType: 'text/html' }));
      }),
  );
  return { fetchArtifactFile, answer: () => answers.shift()?.() };
}

const text = (file: unknown) => (file as File).textSync();

beforeEach(() => {
  resetDisk();
});

describe('the artifact cache within one session', () => {
  it('downloads once for every viewer, and opens the cached copy after that', async () => {
    const hub = hubFor('mac v1');
    startArtifactSession(hub);
    const first = artifactFile(hub, report);
    const second = artifactFile(hub, report);
    await vi.waitFor(() => expect(hub.fetchArtifactFile).toHaveBeenCalledTimes(1));
    hub.answer();
    expect(text(await first)).toBe('mac v1');
    expect(text(await second)).toBe('mac v1');
    expect(text(await artifactFile(hub, report))).toBe('mac v1');
    expect(hub.fetchArtifactFile).toHaveBeenCalledTimes(1);
  });

  it('shares a copy under the artifact’s own name', async () => {
    const hub = hubFor('mac v1');
    startArtifactSession(hub);
    const loading = artifactFile(hub, report);
    await vi.waitFor(() => expect(hub.fetchArtifactFile).toHaveBeenCalled());
    hub.answer();
    await loading;
    const copy = await shareableFile(hub, report);
    expect(copy.uri.endsWith('/report.html')).toBe(true);
    expect(text(copy)).toBe('mac v1');
  });
});

describe('the artifact cache across a server switch', () => {
  it('never hands the new session a download the last one started', async () => {
    const mac = hubFor('mac v1');
    const clone = hubFor('clone v1');
    startArtifactSession(mac);
    const onMac = artifactFile(mac, report);
    onMac.catch(() => {});
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalled());

    startArtifactSession(clone);
    const onClone = artifactFile(clone, report);
    await vi.waitFor(() => expect(clone.fetchArtifactFile).toHaveBeenCalledTimes(1));
    clone.answer();
    expect(text(await onClone)).toBe('clone v1');
    mac.answer();
    await expect(onMac).rejects.toThrow();
  });

  it('refuses a download from the last session that finishes after the switch, and caches none of its bytes', async () => {
    const mac = hubFor('mac v1');
    const clone = hubFor('clone v1');
    startArtifactSession(mac);
    const onMac = artifactFile(mac, report);
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalled());

    startArtifactSession(clone);
    mac.answer();
    await expect(onMac).rejects.toThrow();
    expect(writtenTexts()).not.toContain('mac v1');

    const onClone = artifactFile(clone, report);
    await vi.waitFor(() => expect(clone.fetchArtifactFile).toHaveBeenCalledTimes(1));
    clone.answer();
    expect(text(await onClone)).toBe('clone v1');
  });

  it('forgets the last session’s files and share copies when the next one starts', async () => {
    const mac = hubFor('mac v1');
    startArtifactSession(mac);
    const loading = artifactFile(mac, report);
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalled());
    mac.answer();
    const file = await loading;
    const copy = await shareableFile(mac, report);

    startArtifactSession(hubFor('clone v1'));
    expect((file as unknown as File).exists).toBe(false);
    expect(copy.exists).toBe(false);
    expect(writtenTexts()).not.toContain('mac v1');
  });

  it('gives a hub from an ended session no file and no share copy', async () => {
    const mac = hubFor('mac v1');
    startArtifactSession(mac);
    const loading = artifactFile(mac, report);
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalled());
    mac.answer();
    await loading;

    startArtifactSession(hubFor('clone v1'));
    await expect(artifactFile(mac, report)).rejects.toThrow();
    await expect(shareableFile(mac, report)).rejects.toThrow();
    expect(mac.fetchArtifactFile).toHaveBeenCalledTimes(1);
  });
});

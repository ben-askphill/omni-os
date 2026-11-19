import type { RawResponse } from '@omni/client-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { artifactFile, shareableFile, startArtifactSession } from '../src/artifacts/files';
import {
  copiesSoFar,
  failDeletes,
  filesUnder,
  holdCopies,
  holdWrites,
  leaveFile,
  resetDisk,
  writesSoFar,
  writtenTexts,
  type File,
} from './fake-file-system';

vi.mock('expo-file-system', () => import('./fake-file-system'));

const report = { id: 7, name: 'report.html', size: 6, updated_at: '2026-11-18T10:00:00.000Z' };

/** A session's hub whose downloads wait until the test answers them, each with `text`. An aborted one fails. */
function hubFor(text: string) {
  const answers: (() => void)[] = [];
  const fetchArtifactFile = vi.fn(
    (_artifact: unknown, signal?: AbortSignal) =>
      new Promise<RawResponse>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
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
    const file = await loading;
    const copy = await shareableFile(hub, file, report);
    expect(copy.uri.endsWith('/report.html')).toBe(true);
    expect(text(copy)).toBe('mac v1');
  });

  it('shares the file the viewer opened, with no second download', async () => {
    const hub = hubFor('a longer body than the row says');
    startArtifactSession(hub);
    const loading = artifactFile(hub, report);
    await vi.waitFor(() => expect(hub.fetchArtifactFile).toHaveBeenCalled());
    hub.answer();
    const copy = await shareableFile(hub, await loading, report);
    expect(text(copy)).toBe('a longer body than the row says');
    expect(hub.fetchArtifactFile).toHaveBeenCalledTimes(1);
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
    const copy = await shareableFile(mac, file, report);

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
    const file = await loading;

    startArtifactSession(hubFor('clone v1'));
    await expect(artifactFile(mac, report)).rejects.toThrow();
    await expect(shareableFile(mac, file, report)).rejects.toThrow();
    expect(mac.fetchArtifactFile).toHaveBeenCalledTimes(1);
  });

  it('will not share a file from another session’s folder, even one a failed clear left behind', async () => {
    const mac = hubFor('mac v1');
    startArtifactSession(mac);
    const loading = artifactFile(mac, report);
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalled());
    mac.answer();
    const macFile = await loading;

    failDeletes(true);
    const clone = hubFor('clone v1');
    startArtifactSession(clone);
    expect((macFile as unknown as File).exists).toBe(true);
    await expect(shareableFile(clone, macFile, report)).rejects.toThrow();
    expect(writtenTexts().filter((t) => t === 'mac v1')).toHaveLength(1);
  });

  it('refuses a share copy still landing at the switch, and keeps none of it, even when the cache will not clear', async () => {
    const mac = hubFor('mac v1');
    startArtifactSession(mac);
    const loading = artifactFile(mac, report);
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalled());
    mac.answer();
    const macFile = await loading;

    const release = holdCopies();
    const sharing = shareableFile(mac, macFile, report);
    sharing.catch(() => {});
    await vi.waitFor(() => expect(copiesSoFar()).toBe(1));

    failDeletes(true);
    startArtifactSession(hubFor('clone v1'));
    release();
    await expect(sharing).rejects.toThrow('The server changed while this file loaded.');
    expect(filesUnder('file:///cache/omni-artifacts').filter((f) => f.includes('/share/'))).toEqual([]);
    expect(writtenTexts().filter((t) => t === 'mac v1')).toHaveLength(1);
  });

  it('aborts the last session’s downloads, so the new server’s files do not wait behind them', async () => {
    const mac = hubFor('mac v1');
    startArtifactSession(mac);
    const loads = [1, 2, 3].map((id) => artifactFile(mac, { ...report, id }));
    for (const load of loads) load.catch(() => {});
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalledTimes(3));

    const clone = hubFor('clone v1');
    startArtifactSession(clone);
    const onClone = artifactFile(clone, report);
    await vi.waitFor(() => expect(clone.fetchArtifactFile).toHaveBeenCalledTimes(1));
    clone.answer();
    expect(text(await onClone)).toBe('clone v1');
    for (const load of loads) await expect(load).rejects.toThrow();
  });

  it('refuses a download whose write was still landing at the switch, as an ended session', async () => {
    const mac = hubFor('mac v1');
    startArtifactSession(mac);
    const release = holdWrites();
    const onMac = artifactFile(mac, report);
    await vi.waitFor(() => expect(mac.fetchArtifactFile).toHaveBeenCalled());
    mac.answer();
    await vi.waitFor(() => expect(writesSoFar()).toBe(1));

    startArtifactSession(hubFor('clone v1'));
    release();
    await expect(onMac).rejects.toThrow('The server changed while this file loaded.');
    expect(writtenTexts()).not.toContain('mac v1');
  });

  it('never opens a folder an earlier launch of the app left, even when the cache will not clear', async () => {
    // What launch 1 cached for the first server, in the folder its first session used.
    leaveFile('file:///cache/omni-artifacts/1/7-20261118T100000000Z.html', 'old v1');
    failDeletes(true);
    vi.resetModules();
    const launch = await import('../src/artifacts/files');
    const hub = hubFor('new v1');
    launch.startArtifactSession(hub);
    const loading = launch.artifactFile(hub, report);
    await vi.waitFor(() => expect(hub.fetchArtifactFile).toHaveBeenCalledTimes(1));
    hub.answer();
    expect(text(await loading)).toBe('new v1');
  });
});

import { apiPath, type HttpClient, type RawResponse } from '../http.ts';
import type { Artifact } from './events.ts';

/** A row of GET /artifacts: the file and the thread and channel that made it. */
export type ArtifactWithThread = Artifact & { thread_title: string; channel_id: string };

/** The largest file the phone fetches. Past it the viewer offers no preview, so one stray download cannot fill memory. */
export const ARTIFACT_MAX_BYTES = 25 * 1024 * 1024;

export function artifactsApi(http: HttpClient) {
  return {
    /** The 60 files written last, in every channel, newest first. Screenshots are left out. */
    artifacts: () => http.request<ArtifactWithThread[]>('GET', apiPath`/artifacts`),
    /**
     * The file itself, fetched with the token. The version in the query is a cache buster: the server never caches the
     * file, but a proxy might.
     */
    artifactFile: (artifact: Pick<Artifact, 'id' | 'updated_at'>, signal?: AbortSignal): Promise<RawResponse> =>
      http.requestBytes(apiPath`/artifacts/${artifact.id}/raw`, { query: { v: artifact.updated_at }, signal, maxBytes: ARTIFACT_MAX_BYTES }),
  };
}

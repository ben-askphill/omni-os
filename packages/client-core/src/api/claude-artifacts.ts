import type { ClaudeArtifactsResponse, ClaudeArtifactsSchedule, ClaudeArtifactsState } from '@omni/shared/claude-artifacts.ts';
import { apiPath, type HttpClient } from '../http.ts';

export type {
  ClaudeArtifact,
  ClaudeArtifactScope,
  ClaudeArtifactsErrorCode,
  ClaudeArtifactsResponse,
  ClaudeArtifactsSchedule,
  ClaudeArtifactsState,
} from '@omni/shared/claude-artifacts.ts';

/** The feed message a refresh sends when it starts and ends, and when the schedule changes (apps/server/bus.ts). */
export interface ClaudeArtifactsFeedEvent {
  type: 'claude_artifacts';
  state: ClaudeArtifactsState;
}

export const isClaudeArtifactsFeedEvent = (m: unknown): m is ClaudeArtifactsFeedEvent =>
  !!m && typeof m === 'object' && (m as { type?: unknown }).type === 'claude_artifacts' && typeof (m as { state?: unknown }).state === 'object' && (m as { state?: unknown }).state !== null;

export function claudeArtifactsApi(http: HttpClient) {
  return {
    /** Ben's claude.ai Artifacts as the server's last good listing left them, and the state of its refreshes. */
    claudeArtifacts: () => http.request<ClaudeArtifactsResponse>('GET', apiPath`/claude-artifacts`),
    /**
     * Starts a listing on the server. Without `force` the server skips it when the last attempt is under ten minutes
     * old, so opening the screen often costs nothing. Answers at once (202) with the state; the feed says when it ends.
     */
    refreshClaudeArtifacts: (opts: { force?: boolean } = {}) =>
      http.request<{ state: ClaudeArtifactsState }>('POST', apiPath`/claude-artifacts/refresh`, { body: { force: opts.force === true } }),
    setClaudeArtifactsSchedule: (schedule: ClaudeArtifactsSchedule) =>
      http.request<{ state: ClaudeArtifactsState }>('PUT', apiPath`/claude-artifacts/schedule`, { body: { schedule } }),
  };
}

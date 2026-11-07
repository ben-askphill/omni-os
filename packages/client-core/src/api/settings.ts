import type { ServerOptionsState, SetupState, UserConfigPatch } from '@omni/shared/settings.ts';
import type { CleanupState, RetentionPolicy } from '@omni/shared/worktree-cleanup.ts';
import { apiPath, type HttpClient } from '../http.ts';

export type { ServerOption, ServerOptionsState, SetupState, UserConfig, UserConfigPatch } from '@omni/shared/settings.ts';
export type { CleanupState, RetentionPolicy } from '@omni/shared/worktree-cleanup.ts';

/** A secret's name and where it applies. The value never leaves the server's secret store. */
export interface SecretRow {
  /** `global`, or `channel:<id>`. */
  scope: string;
  name: string;
  updated_at: string;
}

/** The part of GET /worktrees/scan the phone reads: the retention policy and what it would remove. */
export interface WorktreesView {
  cleanup: Pick<CleanupState, 'policy'> & Partial<CleanupState>;
}

/** The server's config behind Settings: the same calls the Web UI's Settings page makes. */
export function settingsApi(http: HttpClient) {
  return {
    /** The saved config (data/omni.config.json), what each default resolves to, and the fields .env overrides. */
    setup: () => http.request<SetupState>('GET', apiPath`/setup`),
    /** Saves any subset of fields and answers with the config as it is now. A 400 names the first refused field. */
    updateSetup: (patch: UserConfigPatch) => http.request<SetupState>('PUT', apiPath`/setup`, { body: patch }),
    /** The .env options, read-only: the server reads them when it starts. */
    serverOptions: () => http.request<ServerOptionsState>('GET', apiPath`/setup/server`),
    /** Every secret's name and scope. Values are never sent. */
    secrets: () => http.request<SecretRow[]>('GET', apiPath`/secrets`),
    /** Adds a secret, or replaces the value of one with the same scope and name. */
    setSecret: (scope: string, name: string, value: string) => http.request<{ ok: true }>('POST', apiPath`/secrets`, { body: { scope, name, value } }),
    deleteSecret: (scope: string, name: string) => http.request<{ ok: true }>('DELETE', apiPath`/secrets`, { body: { scope, name } }),
    worktrees: () => http.request<WorktreesView>('GET', apiPath`/worktrees/scan`),
    /** This machine's worktree retention. Saved on the server's machine only, never synced. */
    setRetention: (patch: Partial<RetentionPolicy>) => http.request<WorktreesView>('PUT', apiPath`/worktrees/retention`, { body: patch }),
  };
}

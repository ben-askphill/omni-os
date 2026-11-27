// OpenCode's profile (harness/profile.ts): what it does beyond running a session (spec docs/plans/2026-11-27-opencode-harness.md).
import type { HarnessProfile } from '../profile.ts';

export const opencodeProfile: HarnessProfile = {
  // `compact` is an ACP command on OpenCode, but nothing has proved what it does over ACP, so Omni never sends one.
  compact: null,
  // The window OpenCode reports on usage_update, with the turn's tokens as spend. Nothing shows before its first one.
  meter: 'estimate',
  // An agent's skills are not loaded on it yet.
  skills: null,
  // Sessions live in OpenCode's own per-machine database. A thread handed to another machine starts a new session
  // there with a handover, as a switch of harness does.
  sessionFiles: null,
  // OpenCode names its session in its session/new answer.
  namesSessionLate: true,
  confirmsByReplay: false,
  claudeAi: false,
  goalCommand: false,
  inlineImageMax: null,
  pushesBranch: false,
};

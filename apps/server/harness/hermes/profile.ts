// Hermes's profile (harness/profile.ts): the Runs API on the Hermes server. Custom harnesses share all of it but the
// words (RUNS_API_PROFILE).
import type { HarnessProfile } from '../profile.ts';

export const hermesProfile: HarnessProfile = {
  compact: null,
  meter: null,
  skills: null,
  sessionFiles: null,
  namesSessionLate: false,
  confirmsByReplay: false,
  claudeAi: false,
  goalCommand: false,
  inlineImageMax: null,
  pushesBranch: false,
  where: 'on the Hermes server',
  switchRefusal: "Hermes runs on its own server without this thread's worktree. Start a new thread to move work to or from Hermes.",
};

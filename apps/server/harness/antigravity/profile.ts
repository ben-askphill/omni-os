// Antigravity's profile (harness/profile.ts): what it does beyond running a session (spec #977).
import type { HarnessProfile } from '../profile.ts';

export const antigravityProfile: HarnessProfile = {
  // ACP treats /compact as plain model input, so Omni never sends one.
  compact: null,
  // The window agy reports on usage_update, with the turn's tokens as spend. Nothing shows before its first usage_update.
  meter: 'estimate',
  // No turns run on it yet, so an agent's skills are not loaded on it. #979 adds them with its turns.
  skills: null,
  // agy keeps its conversations in the user's Antigravity home on each machine. A thread handed to another machine
  // starts a new agy session there with a handover, as a switch of harness does.
  sessionFiles: null,
  // agy names its session in its session/new answer.
  namesSessionLate: true,
  confirmsByReplay: false,
  claudeAi: false,
  goalCommand: false,
  inlineImageMax: null,
  pushesBranch: false,
};

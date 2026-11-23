// Cursor Cloud's profile (harness/profile.ts): a Cursor cloud agent on Cursor's own Linux machines.
import type { HarnessProfile } from '../profile.ts';

export const cursorCloudProfile: HarnessProfile = {
  compact: null,
  meter: null,
  skills: null,
  sessionFiles: null,
  namesSessionLate: false,
  confirmsByReplay: false,
  claudeAi: false,
  goalCommand: false,
  inlineImageMax: null,
  apiKeySecret: 'CURSOR_API_KEY',
  pushesBranch: true,
  where: 'as a Cursor cloud agent',
  // A cloud agent keeps the model it was created with (a run cannot change it) and has no worktree on this machine.
  switchRefusal:
    'A Cursor cloud agent keeps its model and works on its own clone of the repo. Start a new thread to change the model or move work to or from Cursor Cloud.',
  fixedRun: true,
  prompt: {
    intro: (owner) =>
      `You are a Cursor cloud agent that Omni OS, ${owner} agent workspace on their own machine, started through the Cursor API. You run on a Linux machine of Cursor's, on your own clone of the repo; Omni, its tools, files and secrets are not here. Nobody watches live, so finish the task or clearly state what is blocking you.`,
    lines: [
      '',
      '## Cursor cloud agent',
      'Commit and push your work: Cursor opens the pull request from your branch when the run ends. Put the PR body in the shape the repo asks for (a PR template or a pr-writer skill).',
      'This machine runs Linux. You cannot build or run macOS apps, run Swift or Xcode tests, or take screenshots of a Mac app or a browser. Do what you can, and list what you could not verify in your reply and in the PR body instead of claiming it.',
    ],
  },
};

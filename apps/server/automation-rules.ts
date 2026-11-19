// What an automation's settings add to its run's prompt, so they hold on every harness: `quiet` (say a fixed word when
// there is nothing to report, and the run is marked done with no alert: automation-quiet.ts), `approve` (draft, then ask
// on the question card before anything leaves Omni; automation-drafts.ts expires an unanswered one) and a dry run (Run
// now's Dry run: say what it would do, do none of it). The rules go after the automation's own prompt.
import { spanWords } from '@omni/shared/cron.ts';
import type { Automation } from './automations.ts';

/** The whole reply of a quiet run with nothing to report. */
export const QUIET_REPLY = 'NOTHING_TO_REPORT';

/** The title prefix of a dry run's thread. */
export const DRY_RUN_TITLE = 'Dry run';

/** The approval question's options. The card shows them; the agent acts only on the first. */
export const APPROVE = 'Approve';
export const SKIP = 'Skip';

/** The rules a run follows, one bullet each, or none. A dry run always reports, since someone started it to watch. */
export function runRules(a: Pick<Automation, 'quiet' | 'approve' | 'expiresAfter'>, dry = false): string[] {
  const rules: string[] = [];
  if (dry)
    rules.push(
      'This is a dry run. Do everything up to the point of acting, then stop: send, post, book, change or delete nothing outside this thread, and ask no approval question. List what you would have done, each item with what it would say or change.',
    );
  if (a.quiet && !dry)
    rules.push(`If there is nothing worth reporting, reply with exactly ${QUIET_REPLY} and nothing else. Omni then files this run away without telling the user.`);
  if (a.approve && !dry)
    rules.push(
      `Send, post, book, change or delete nothing outside this thread until the user approves. Put each draft in full in your reply, then ask once with ask_user_question: one question, "Approve and go ahead?", single choice, options "${APPROVE}" and "${SKIP}"` +
        (a.expiresAfter ? `, and say in the question that it expires in ${spanWords(a.expiresAfter)} if nobody answers` : '') +
        `. Act only on ${APPROVE}. On ${SKIP} or anything else, do nothing and end in one line.`,
    );
  return rules;
}

/** The prompt a run sends: the automation's own, then its rules under a heading, when it has any. */
export function withRunRules(a: Pick<Automation, 'quiet' | 'approve' | 'expiresAfter'>, prompt: string, dry = false): string {
  const rules = runRules(a, dry);
  return rules.length ? `${prompt.trimEnd()}\n\nHow this run works:\n${rules.map((r) => `- ${r}`).join('\n')}` : prompt;
}

/** Whether a run's reply says there is nothing to report: the word alone, give or take case, quotes and a full stop. */
export const isQuietReply = (reply: string | null | undefined) =>
  !!reply && reply.trim().replace(/^[`"'*_\s]+|[`"'*_.\s]+$/g, '').toUpperCase() === QUIET_REPLY;

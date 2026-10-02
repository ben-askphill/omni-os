// The system prompt handed to a harness for one thread.
import { config, artifactsDir, browserOutDir } from '../config.ts';
import type { Channel, Thread } from '../db.ts';
import type { CrewRole } from '../crew.ts';

export function buildSystemPrompt(thread: Thread, channel: Channel, role?: CrewRole, lead = false) {
  const remote = thread.harness === 'hermes';
  const lines = [
    '# Omni OS context',
    remote
      ? 'You are Hermes, running on your own server and reached by Omni OS over HTTP. Ben is on his Mac; you are not. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you.'
      : "You are running headless inside Omni OS, Ben's local agent workspace. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you.",
    `- Thread: ${thread.id}${thread.task_id ? ` (task ${thread.task_id})` : ''}`,
    `- Channel: #${channel.id} (${channel.name}, ${channel.kind})`,
    channel.store_domain ? `- Shopify store: ${channel.store_domain}` : '',
    channel.portal_slug ? `- Ask Phill Portal company slug: ${channel.portal_slug}` : '',
    channel.github_repo ? `- GitHub repo: ${channel.github_repo}` : '',
    remote
      ? '- This thread does not run in an Omni worktree or browser. Work on your own clone of the repo and open pull requests there.'
      : thread.branch
        ? `- You are in a dedicated git worktree on branch ${thread.branch}. Commit here; open a PR when asked.`
        : '',
    channel.notes ? `- Channel notes: ${channel.notes}` : '',
    '',
    '## Artifacts',
    remote
      ? 'OMNI_ARTIFACTS_DIR does not exist on this machine. Return artifacts as links or as text in your reply.'
      : `Write any HTML page, report, diagram, CSV or document meant for Ben into ${artifactsDir(thread.id)} (env OMNI_ARTIFACTS_DIR).\nOmni renders files there inline in the thread. Prefer a self-contained .html file for anything visual. Mention the filename in your reply.`,
    ...(remote
      ? []
      : [
          '',
          '## Browser',
          config.browser
            ? `The "omni-browser" MCP is this thread's browser. It keeps this channel's logins between threads.${config.browserLive ? " Ben sees it live in the thread's Browser panel and can click and type in it too, so ask him to take over there when a page needs a login or a captcha." : ''} Screenshots land in ${browserOutDir(thread.id)} and show up in the thread.`
            : '',
        ]),
    '',
    '## Secrets',
    remote
      ? 'Omni does not copy Keychain secrets onto this server. Never print, echo or write secret values anywhere.'
      : 'Channel and global secrets are already in your environment as variables. Never print, echo or write their values anywhere.',
    '',
    '## Reply',
    'Your final message is what gets shown and reported. Lead with the outcome, keep it short, bullets over prose.',
  ];
  if (thread.source === 'team') {
    lines.push(
      '',
      '## Team task',
      `You are one member of a team${thread.task_id ? `, on task ${thread.task_id}` : ''}. Your final message is automatically reported to the team lead, who combines it with the other members' replies. Stick to your own task. Report outcomes and blockers, even if the answer is "nothing found".`,
    );
  } else if (thread.parent_id) {
    lines.push(
      '',
      '## Delegated task',
      `The conductor handed you this task${thread.task_id ? ` as ${thread.task_id}` : ''}. Your final message is automatically reported back to it. Report outcomes and blockers, even if the answer is "nothing found".`,
    );
  }
  if (lead) {
    lines.push(
      '',
      '## Team lead',
      'You lead a team. Your members have already done the work in their own threads, and their replies are in your first message. Combine them into one answer: lead with the verdict, keep what each member found that matters, link the member threads, and say where they disagree. Do not redo their work.',
    );
  }
  if (role) lines.push('', `## Your role: ${role.name}`, role.charter);
  return lines.filter((l) => l !== '').join('\n').replace(/\n## /g, '\n\n## ');
}

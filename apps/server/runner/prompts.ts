// The system prompt handed to a harness for one thread.
import { config, artifactsDir, browserOutDir, designSystemFile } from '../config.ts';
import { artifacts, type Channel, type Thread } from '../db.ts';
import type { CrewRole } from '../crew.ts';
import { isProviderHarness } from '../harness/types.ts';
import { getProfile, objectPronoun, userName, userPossessive } from '../profile.ts';
import { TOOL_FAILURE_POLICY } from '../tool-failure-policy.ts';
import { accessSync, closeSync, constants, openSync, readSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Claude Code's Artifact tool publishes to claude.ai. Omni links a publish to its file and keeps the URL per channel. */
function publishedLines(channelId: string) {
  const pages = artifacts.published(channelId, 10);
  return [
    '',
    '## Published artifacts',
    'When you publish a page with the Artifact tool, write it into OMNI_ARTIFACTS_DIR and publish it from there, so Omni links the file to its claude.ai URL. To change a page that is already published, republish it to its url rather than creating a new one.',
    ...(pages.length
    ? ['Pages this channel already published, newest first:', ...pages.map((a) => `- ${a.name}: ${a.url} (thread "${a.thread_title}")`)]
    : []),
  ];
}

/** On the shim the desktop app writes for the `omni` command (apps/desktop/src/cli-shim.ts SHIM_MARK). */
const OMNI_SHIM_MARK = '# omni-cli-shim';

function isOmniShim(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(512);
    return head.subarray(0, readSync(fd, head, 0, head.length, 0)).toString('utf8').includes(OMNI_SHIM_MARK);
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** The `omni` a shell runs from this PATH: the first executable file by that name, or null. */
function resolveOmni(path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, 'omni');
    try {
      if (!statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not there, or not executable: a shell looks further too.
    }
  }
  return null;
}

let omniCommand: { path: string; found: boolean } | null = null;

/**
 * Whether threads have the `omni` command (apps/cli): the desktop app writes it into its bin folder, which is on
 * this server's PATH and so on the harnesses' (ADR 0014). It counts only when it is the `omni` PATH resolves to: the
 * app appends its folder last (apps/desktop/src/backend/index.ts), so another program named omni earlier wins.
 */
export function hasOmniCommand(path = process.env.PATH ?? ''): boolean {
  if (omniCommand?.path !== path) {
    const file = resolveOmni(path);
    omniCommand = { path, found: !!file && isOmniShim(file) };
  }
  return omniCommand.found;
}

/**
 * The `omni` command for a thread without the Conductor's MCP tools, so an agent in any local harness messages and
 * starts threads with one command instead of curl.
 */
function commandLineLines(thread: Thread, role?: CrewRole) {
  if (isProviderHarness(thread.harness) || role?.mcp.includes('omni') || !hasOmniCommand()) return [];
  return [
    '',
    '## Omni from the shell',
    `The \`omni\` command reaches this Omni from your shell in any harness. \`omni send parent "…"\` messages the thread that started you (or any thread by id), \`omni new "…" -c <channel> -r <role>\` starts a thread under yours, \`omni show <id>\` reads one and \`omni threads --needs-you\` lists what waits on ${userName()}. Use it instead of curl against OMNI_URL; \`omni --help\` has the rest.`,
  ];
}

/** The channel's design system, as a file the agent reads before it writes a page. Local harnesses only. */
function designSystemLines(thread: Thread, channel: Channel) {
  if (!channel.design_system || isProviderHarness(thread.harness)) return [];
  return [
    '',
    '## Design system',
    `This channel has a design system${channel.design_system_name ? ` (${channel.design_system_name})` : ''}, a standalone HTML file at ${designSystemFile(thread.id)}.`,
    `Read it before you write any HTML page, report, dashboard or diagram for this channel. It can be larger than one Read allows, so read it in parts or search it for the tokens and components you need. Build the page on its tokens, type, spacing, components and tone, with the CSS inline so the page stays self-contained, and do not approximate or invent a style of your own. Skip it only when ${userName()} names a different style. Never copy the file itself into the artifacts folder.`,
  ];
}

/** Where to put files and pages, and the browser: only for a role that does work itself. */
function workspaceLines(thread: Thread, channel: Channel) {
  const remote = isProviderHarness(thread.harness);
  const name = userName();
  return [
      '',
      '## Artifacts',
      remote
        ? 'OMNI_ARTIFACTS_DIR does not exist on this machine. Return artifacts as links or as text in your reply.'
        : `Write any HTML page, report, diagram, CSV or document meant for ${name} into ${artifactsDir(thread.id)} (env OMNI_ARTIFACTS_DIR).\nOmni lists files there in the thread. To show a chart, diagram, table or mockup in the thread itself, above your reply, call html_render instead. Write a page, report, dashboard or diagram as a self-contained .html file (inline CSS, readable in light and dark mode, table cells that wrap). A guide, how-to or note can be .md: Omni renders it like a reply. Mention the filename in your reply.`,
      ...designSystemLines(thread, channel),
      ...(thread.harness === 'claude-code' ? publishedLines(channel.id) : []),
      ...(remote
        ? []
        : [
            '',
            '## Browser',
            config.browser
              ? `The "omni-browser" MCP is this thread's browser. It keeps this channel's logins between threads.${config.browserLive ? ` ${name} sees it live in the thread's Browser panel and can click and type in it too, so ask ${objectPronoun()} to take over there when a page needs a login or a captcha.` : ''} Omit the screenshot filename to save in ${browserOutDir(thread.id)} and show it in the thread. An explicit relative filename saves in the working directory instead. Read or copy the exact path returned by the tool; do not assume a named screenshot is in the browser folder. The browser refuses paths outside its output folder and working directory, including the artifacts folder and /tmp, so copy the file afterwards if you need it elsewhere. It blocks file: URLs too: to look at a local HTML file, serve its folder over http on a free port and open that. Start that server in the background and stop it by its PID: \`pkill -f\` with its command line also matches your own shell and kills it. browser_find searches for a \`text\` substring or a \`regex\`; it ignores any other argument name and then fails. browser_click, browser_type, browser_hover and browser_select_option take the snapshot ref as \`target\`, not \`ref\`.`
              : '',
          ]),
  ];
}

/** The Conductor's rule, in place of the usual "delegate when asked": delegation comes first, always. */
const delegateOnlyRule = (name: string) =>
  `You route work; you never do it. Every request that needs work (code, files, commands, browsing, research, store or inbox changes) goes to a crew role with Omni's delegate tool before anything else, however small it looks. You have no shell, file editing, browser or subagent tools, by design: if you catch yourself planning to do the work, delegate it instead. Answer directly only what you can from the omni tools and the conversation: status, a crew report, a question about Omni itself, or a decision ${name} has to make.`;

/** Every thread that can delegate follows up on its child threads with the prompt cache in mind (session-warmth.ts). */
const SESSION_CACHE_RULE =
  "Before you message a thread you already have, check get_thread's session.warm. A warm thread (running, or its model active within the hour) gets message_thread. " +
  'A cold one you do not wake: open a new session with continue_thread on its own harness and a message that carries the follow-up, or delegate a fresh thread whose brief stands alone and links the old one, then say which thread replaced which. ' +
  'message_thread refuses a cold thread unless you pass wake_cold: true, which is only for when you were asked to resume that thread itself. Never wake a cold thread to ask how it went: read it with get_thread.';

export function buildSystemPrompt(thread: Thread, channel: Channel, role?: CrewRole, lead = false) {
  const remote = isProviderHarness(thread.harness);
  const cloud = thread.harness === 'cursor-cloud';
  const name = userName();
  // A delegate-only role has no browser or file tools, so the sections on using them would only mislead it.
  const hands = !role?.delegateOnly;
  const lines = [
    '# Omni OS context',
    TOOL_FAILURE_POLICY,
    cloud
      ? `You are a Cursor cloud agent that Omni OS, ${userPossessive()} agent workspace on their own machine, started through the Cursor API. You run on a Linux machine of Cursor's, on your own clone of the repo; Omni, its tools, files and secrets are not here. Nobody watches live, so finish the task or clearly state what is blocking you.`
      : remote
      ? `You are Hermes, running on your own server and reached by Omni OS over HTTP. ${name} is on their own machine; you are not. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you.`
      : `You are running headless inside Omni OS, ${userPossessive()} local agent workspace. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you. When a choice only ${name} can make blocks you, ask with the ask_user_question tool: it waits for the answer.`,
    getProfile().name ? `- You work for ${name}. Charters and automations that say "the user" mean them.` : '',
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
    // zsh slips recur in every harness's shell calls: an unquoted glob that matches nothing, a word that starts with =.
    !remote && /zsh$/.test(process.env.SHELL ?? '')
      ? `- Shell commands run in zsh: quote glob arguments (--include='*.ts'), and never start a word with = (zsh reads echo === as a command lookup).${process.platform === 'darwin' ? ' The command-line tools are BSD, not GNU.' : ''}`
      : '',
    channel.notes ? `- Channel notes: ${channel.notes}` : '',
    ...(role?.mcp.includes('omni')
      ? [
          '',
          '## Thread delegation',
          `${role.delegateOnly ? delegateOnlyRule(name) : `Use Omni's delegate tool when ${name} asks you to hand work to another crew role.`} First call list_crew and list_channels when you need valid ids. Write each brief as Goal, Done when and Proof back; the delegated thread cannot see this conversation. Delegated threads appear in Omni as separate, linked threads, and their reports return here automatically; do not poll for them.`,
          SESSION_CACHE_RULE,
        ]
      : []),
    ...(hands ? workspaceLines(thread, channel) : []),
    ...commandLineLines(thread, role),
    '',
    ...(cloud
      ? [
          '',
          '## Cursor cloud agent',
          'Commit and push your work: Cursor opens the pull request from your branch when the run ends. Put the PR body in the shape the repo asks for (a PR template or a pr-writer skill).',
          'This machine runs Linux. You cannot build or run macOS apps, run Swift or Xcode tests, or take screenshots of a Mac app or a browser. Do what you can, and list what you could not verify in your reply and in the PR body instead of claiming it.',
        ]
      : []),
    '',
    '## Secrets',
    remote
      ? 'Omni does not copy Keychain secrets onto this server. Never print, echo or write secret values anywhere.'
      : 'Channel and global secrets are already in your environment as variables. Never print, echo or write their values anywhere.',
    '',
    '## Reply',
    'Your final message is what gets shown and reported. Lead with the outcome, keep it short, bullets over prose.',
    'Omni renders standard GitHub-flavored Markdown, not Slack mrkdwn. Bold is **double asterisks**, italics are _underscores_, section titles are ## headings, tables are pipe tables, links are [label](url). Start every numbered item on its own line. This overrides any Slack or terminal formatting rule from a project CLAUDE.md or rules file.',
    'Keep table cells short. Put reasons and explanations in bullets under the table.',
    // Hermes and Cursor cloud get no local MCP servers, so no html_render.
    remote
      ? ''
      : `When ${name} asks you to "show me", "list out" or "visualize" something, or a brief passes that ask on, show the result with html_render as cards, a table or a chart above your reply instead of a wall of text. A short answer stays plain text.`,
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
      'You lead a team. Your members have already done the work in their own threads, and their replies are in your first message. Combine them into one answer: lead with the verdict, keep what each member found that matters, link the member threads, and say where they disagree. Do not redo their work. Their replies are all you get: read_referenced_thread cannot open member threads.',
    );
  }
  if (role) lines.push('', `## Your role: ${role.name}`, role.charter);
  return lines.filter((l) => l !== '').join('\n').replace(/\n## /g, '\n\n## ');
}

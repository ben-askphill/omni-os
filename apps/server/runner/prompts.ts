// The system prompt handed to a harness for one thread. It runs from what is the same for every thread to what is
// this thread's own, so a harness's prompt cache reuses the longest prefix across threads (#1013): the install's
// rules, then the agent's (its charter and skills), then the thread's kind (delegated, team, group), then the
// channel's (notes, lessons, design system, published pages), and last the thread's lines (id, branch, folders).
import { quickAskRule, readsOnly } from '@omni/shared/quick-ask.ts';
import { SCAN_ROLE } from '../usage-scan/asks.ts';
import { config, artifactsDir, browserOutDir, designSystemFile, paths } from '../config.ts';
import { artifacts, events, kv, memories, threads, type Channel, type Thread } from '../db.ts';
import { chatRules, resumeRules, type ChatRules } from '../harness/resume-rules.ts';
import { learningsPrompt, roleMemoryLines } from '@omni/shared/memory.ts';
import { doesOwnWork, getCrew, type CrewRole } from '../crew.ts';
import { crewRoleName, isConductor } from '@omni/shared/crew-role.ts';
import { skillLines, type ThreadSkills } from '../skills.ts';
import { isProviderHarness } from '../harness/types.ts';
import { isRemoteAgentHarness } from '@omni/shared/remote-agent.ts';
import { writtenCharter } from '../remote-agents.ts';
import { READ_TOOL } from '../harness/read-tool.ts';
import { harnessName } from '../harness/registry.ts';
import { profileOf } from '../harness/profile.ts';
import { getProfile, objectPronoun, userName, userPossessive } from '../profile.ts';
import { userConfig } from '../user-config.ts';
import { TOOL_FAILURE_POLICY } from '../tool-failure-policy.ts';
import { displayPrefs } from '../display.ts';
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
 * Whether threads have the `omni` command (crates/omni-cli): the desktop app writes it into its bin folder, which is on
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
    `The \`omni\` command reaches this Omni from your shell in any harness. \`omni send parent "…"\` messages the thread that started you (or any thread by id), \`omni new "…" -c <channel> -a <agent>\` starts a thread under yours, \`omni show <id>\` reads one and \`omni threads --needs-you\` lists what waits on ${userName()}. Use it instead of curl against OMNI_URL; \`omni --help\` has the rest.`,
  ];
}

/** The channel's design system, as a file the agent reads before it writes a page. Local harnesses only. */
function designSystemLines(thread: Thread, channel: Channel) {
  if (!channel.design_system || isProviderHarness(thread.harness)) return [];
  return [
    '',
    '## Design system',
    `This channel has a design system${channel.design_system_name ? ` (${channel.design_system_name})` : ''}, a standalone HTML file: its path is the Design system line under This thread.`,
    `Read it before you write any HTML page, report, dashboard or diagram for this channel. It can be larger than one Read allows, so read it in parts or search it for the tokens and components you need. Build the page on its tokens, type, spacing, components and tone, with the CSS inline so the page stays self-contained, and do not approximate or invent a style of your own. Skip it only when ${userName()} names a different style. Never copy the file itself into the artifacts folder.`,
  ];
}

/** Where to put files and pages, and the browser: only for a role that does work itself. The folders' paths are this thread's own (threadLines). */
function workspaceLines(thread: Thread) {
  const remote = isProviderHarness(thread.harness);
  const name = userName();
  return [
      '',
      '## Artifacts',
      remote
        ? 'OMNI_ARTIFACTS_DIR does not exist on this machine. Return artifacts as links or as text in your reply.'
        : `Write any HTML page, report, diagram, CSV or document meant for ${name} into OMNI_ARTIFACTS_DIR, the Artifacts folder under This thread.\nOmni lists files there in the thread. To show a chart, diagram, table or mockup in the thread itself, above your reply, call html_render instead. Write a page, report, dashboard or diagram as a self-contained .html file (inline CSS, readable in light and dark mode, table cells that wrap). A guide, how-to or note can be .md: Omni renders it like a reply. Mention the filename in your reply.`,
      ...(remote
        ? []
        : [
            '',
            '## Browser',
            config.browser
              ? `The "omni-browser" MCP is this thread's browser. It keeps this channel's logins between threads.${config.browserLive ? ` ${name} sees it live in the thread's Browser panel and can click and type in it too, so ask ${objectPronoun()} to take over there when a page needs a login or a captcha.` : ''} Omit the screenshot filename to save in the Browser folder under This thread and show it in the thread. An explicit relative filename saves in the working directory instead. Read or copy the exact path returned by the tool; do not assume a named screenshot is in the browser folder. The browser refuses paths outside its output folder and working directory, including the artifacts folder and /tmp, so copy the file afterwards if you need it elsewhere. It blocks file: URLs too: to look at a local HTML file, serve its folder over http on a free port and open that. Start that server in the background and stop it by its PID: \`pkill -f\` with its command line also matches your own shell and kills it. browser_find searches for a \`text\` substring or a \`regex\`; it ignores any other argument name and then fails. browser_click, browser_type, browser_hover and browser_select_option take the snapshot ref as \`target\`, not \`ref\`. To reload or open another page, call browser_navigate: a browser_evaluate script that reloads or navigates loses its page before it returns. browser_run_code_unsafe runs Playwright page code without Node's require, fs or process, so read a file with your own tools and put its value in the script.`
              : '',
          ]),
  ];
}

/** The channel's pages for a thread that does its own work: its design system, and the pages it published on claude.ai. */
function channelPageLines(thread: Thread, channel: Channel) {
  return [...designSystemLines(thread, channel), ...(profileOf(thread.harness).claudeAi ? publishedLines(channel.id) : [])];
}

/** The secret holding the "Omni" Notion connection's integration token (docs/user/notion.md). */
export const NOTION_TOKEN_SECRET = 'OMNI_NOTION_TOKEN';
/** The REST helper shipped beside the charters, so it is there in a checkout and in the desktop app alike. */
export const notionHelper = () => join(paths.crew, 'tools', 'notion.mjs');

/**
 * Notion through the integration token, for a thread whose environment has it. The Notion MCP plugin signs in with
 * OAuth, which a headless thread cannot do, so threads use the REST API instead.
 */
function notionLines(thread: Thread, secretNames: readonly string[]) {
  if (isProviderHarness(thread.harness) || !secretNames.includes(NOTION_TOKEN_SECRET)) return [];
  const helper = notionHelper();
  return [
    '',
    '## Notion',
    `${NOTION_TOKEN_SECRET} is the token of ${userPossessive()} "Omni" Notion connection. Use it for every Notion read and write instead of the Notion MCP plugin and its Notion:* skills, which need an OAuth sign-in this thread cannot do.`,
    `Helper: \`node ${helper} me | search [query] | read <id|url> | query <database> [filter] | api <METHOD> <path> [json]\`. \`read\` prints a page as Markdown; \`api\` reaches any endpoint (create pages, append blocks, update properties). Without it, call https://api.notion.com/v1 with the headers \`Authorization: Bearer $${NOTION_TOKEN_SECRET}\` and \`Notion-Version: 2022-06-28\`.`,
    `The connection sees only pages and databases shared with it. A 404 object_not_found on a page that exists means it is not shared: ask ${userName()} to add the Omni connection to it in Notion (••• > Connections) rather than looking for another way in.`,
  ];
}

const QUICK_ASKS =
  "Answer quick asks yourself, in this thread, and start no thread for them: anything you can answer from the conversation, Omni's own state (the omni tools) or a light lookup with the tools you have (a fact you know, a page or doc read in a call or two, a connector read).";
const REAL_WORK = 'the work writes or edits files, runs commands, browses at length, changes code, a store, an inbox, a calendar or Notion, or will clearly grow past a few lookups';
const NO_HANDS = 'You have no shell, file editing, browser or subagent tools, by design: when a quick ask turns out to need them,';
const plainAnswers = (name: string) => `A plain question gets a plain answer: no brief, no folder question. Ask ${name} only for decisions that are theirs to make.`;

/**
 * A delegate-only agent's rule, in place of the usual "delegate when asked": a quick ask it answers itself, real work
 * goes to another agent's thread first.
 */
const delegateOnlyRule = (name: string) =>
  `${QUICK_ASKS} Delegate with Omni's delegate tool, before anything else, when ${REAL_WORK}. ${NO_HANDS} delegate it instead of working around that. ${plainAnswers(name)}`;

/**
 * How a thread with the conductor tools hands work on, ahead of the rest of its delegation section. The Conductor gets
 * nothing here: what it does with real work (seat the agent first, delegate only for the exceptions) is its charter's
 * alone (crew/conductor.md), which its prompt carries in full. Any other delegate-only agent delegates first.
 */
const delegationRule = (role: CrewRole, name: string) =>
  !role.delegateOnly ? `Use Omni's delegate tool when ${name} asks you to hand work to another agent. ` : isConductor(role.id) ? '' : `${delegateOnlyRule(name)} `;

/**
 * A no-edits role (the reviewer): what it is without, and that the shell is not a way around it. Omni takes the edit
 * tools away on Claude Code, Codex and Cursor (crew.ts NO_EDITS_DENIED); on Hermes and Cursor Cloud it cannot, so
 * there the rule is this text alone.
 */
function noEditsLines(thread: Thread, role?: CrewRole) {
  if (role?.tools !== 'no-edits' || readsOnly(thread)) return [];
  return [
    '',
    '## No file edits',
    isProviderHarness(thread.harness)
      ? 'This agent does not edit files. Omni cannot take the edit tools away on this harness, so the rule is yours to keep: do not change, create or delete files, and do not commit or push.'
      : 'This agent does not edit files: your file-edit tools are off. The shell is still yours for reading, `gh`, git and running checks. Do not use it to change, create or delete files, or to commit or push, either.',
    'Report what you found instead, and leave the changes to the thread that owns the work.',
  ];
}

/**
 * A crew role's memory (crew plan S6): the lessons the user approved for it, the untagged ones and this channel's, and
 * how to propose one where the thread has a tool for it. A role with `memory: off` gets none. Remote harnesses get
 * the lessons but no tool: they run no Omni MCP server.
 */
function roleMemorySection(thread: Thread, channel: Channel, role?: CrewRole) {
  if (!role || role.memory === 'off' || readsOnly(thread)) return [];
  const name = userName();
  const facts = roleMemoryLines(memories.approvedForRole(role.id, channel.id));
  const tool = role.memory === 'read-write' && !isProviderHarness(thread.harness);
  const conductor = role.mcp.includes('omni');
  const kept = role.memoryWrites === 'auto' ? 'It applies to later threads at once' : `It waits for ${name}'s approval`;
  const how = !tool
    ? ''
    : conductor
      ? `To keep a lesson about how an agent works (a correction ${name} made, a step one of its threads missed), propose it with remember for that agent. It waits for ${name}'s approval unless they let that agent keep its lessons at once. A lesson about a client or channel goes to propose_learning instead.`
      : `When ${name} corrects how you work, or you find a step every later ${role.name} thread should take, propose it with remember: one short sentence about how to work, never about this one task, and never a secret. ${kept}, and it holds in this channel only unless you pass everywhere: true.`;
  if (!facts.length && !how) return [];
  return [
    '',
    `## Your memory as ${role.name}`,
    facts.length ? `Lessons ${name} approved for this agent, from earlier threads. Follow them unless the task says otherwise.` : '',
    ...facts,
    how,
  ];
}

/** What the user said about their work and tools in onboarding or Settings > General, when they said anything. */
function profileLines(name: string) {
  const { work, tools } = userConfig().user;
  return [work ? `- What ${name} does: ${work}` : '', tools ? `- Tools ${name} uses: ${tools}. Reach for these first when they are connected.` : ''];
}

/** Every thread that can delegate follows up on its child threads with the prompt cache in mind (session-warmth.ts). */
const SESSION_CACHE_RULE =
  "Before you message a thread you already have, check get_thread's session.warm (pass include_reply: false: you need its warmth, not its reply again). A warm thread (running, or its model active within the hour) gets message_thread. " +
  'A cold one you do not wake: open a new session with continue_thread on its own harness and a message that carries the follow-up, or delegate a fresh thread whose brief stands alone and links the old one, then say which thread replaced which. ' +
  'message_thread refuses a cold thread unless you pass wake_cold: true, which is only for when you were asked to resume that thread itself. Never wake a cold thread to ask how it went: read it with get_thread.';

/**
 * Every thread that can delegate: how a team works and where it may seat agents (ADR 0019, slice 6). The server holds it
 * to the seating part (thread-routes-api.ts seatingRefusal).
 */
const TEAM_RULE =
  'delegate_team makes one thread in the channel: its lead plans on your brief, then gives each member its part, the members work at once, and the lead reports once they have all finished. ' +
  'An agent with two parts gets one seat. You seat agents in your own #conductor thread with seat_agents, and in a thread you delegate with delegate_team, members on delegate, or agents on message_thread. Never in any other #conductor thread.';

/**
 * A member seated in a #conductor thread, by the Conductor in its own or by the user (ADR 0019, amended): it talks with the user there and
 * takes the work on, opening its own thread in the client channel once the work needs one. That thread's report comes
 * back to this member's session, so it relays the outcome in the #conductor thread.
 */
function conductorSeatLines(name: string, role: CrewRole | undefined, command: boolean) {
  const self = role?.id ?? '<your agent id>';
  return [
    `This is a #conductor thread: you were seated to take this work on, and ${name} talks with you here. It has no repo and no worktree, so there are no files here to edit.`,
    `Answer what you can here: questions, a plan, a light lookup. When the work needs files, a repo, a browser, a long run or a report, open your own thread for it in the client's channel and keep it out of this one.`,
    command
      ? `Open it with \`omni new "<brief>" -c <channel> -a ${self}\`: the channel (and folder) the Conductor named, else the one the work belongs in. Write the brief so it stands alone: that thread cannot see this one.`
      : 'You have no way to open a thread from here: do the work here as far as your tools reach, and say what is left.',
    ...(command ? [`Then end your turn saying which thread has it. Its report comes back to you here: relay what matters to ${name} in a short update, and do not redo the work.`] : []),
  ];
}

/**
 * The `## Reply` block. A thread that has html_render (crates/omni-mcp render.rs) shows an answer as a page when the
 * answer's shape suits one, whatever words the user asked with. Remote harnesses (Hermes, Cursor cloud, custom ones)
 * get no local MCP servers, so no html_render, and a thread that only reads (a quick ask, whose answer shows in place
 * as text, or one kept from it) gets none either (sandbox.ts buildMcpConfig): both keep the text-only block.
 * `reports`: the final message goes to another agent as text (reportsUp), which reads none of the pages.
 * Cursor sends this block again when it resumes a chat (replyBlock, harness/resume-rules.ts), so it stays one section.
 */
function replyLines(name: string, renders: boolean, reports: boolean): string[] {
  const head = 'Your final message is what gets shown and reported.';
  const markdown = 'Omni renders standard GitHub-flavored Markdown, not Slack mrkdwn. Bold is **double asterisks**, italics are _underscores_, section titles are ## headings';
  const override = 'This overrides any Slack or terminal formatting rule from a project CLAUDE.md or rules file.';
  if (!renders) {
    return [
      '## Reply',
      `${head} Lead with the outcome, keep it short, bullets over prose.`,
      `${markdown}, tables are pipe tables, links are [label](url). Start every numbered item on its own line. ${override}`,
      'Keep table cells short. Put reasons and explanations in bullets under the table.',
    ];
  }
  return [
    '## Reply',
    `${head} Lead with the outcome and keep it short.`,
    `Pick the form by what the answer holds, not by how ${name} asked. When it has one of these shapes, call html_render first, so a page shows above your reply. A simple table or a row of cards is enough:`,
    '- 3 or more items with 2 or more attributes each (threads, PRs, machines, options): a table or cards',
    '- the status or an overview of running work: status cards',
    '- numbers, usage, counts or trends: a chart or stat tiles',
    '- dates, schedules or release history: a timeline',
    '- a comparison, a before and after, or options with a recommendation: side by side, the recommendation marked',
    '- a flow, an architecture or routing: a diagram',
    `"Show me", "list out" or "visualize" from ${name}, or passed on in a brief, always gets a page, except when what is asked for is code or a command.`,
    `Keep plain text, with no page, for a yes or no, a single fact, a question for ${name}, and any answer with none of those shapes.`,
    `Code and commands always stay text in a code block, even when ${name} says "show me": "show me the command to run" gets the command, not a page.`,
    'Under a page, say what it means in a line or two. Do not repeat its rows.',
    ...(reports
      ? [`Your final message also goes as text to the agent that handed you this work, which reads none of your pages. When your results take one of those shapes, show them with html_render before it, for ${name} to see in this thread, and still put the outcome and the results that matter in the final message as short bullets.`]
      : []),
    `${markdown}, links are [label](url). Use bullets over prose. A pipe table is only for 2 or 3 rows, with short cells and the reasons in bullets under it. Start every numbered item on its own line. ${override}`,
  ];
}

/**
 * Whether a thread's final message goes to another agent as text: a delegated thread's report (runner/queue.ts
 * reportToParent), a legacy team member's, and the reply of a member seated in a team, which its lead reads
 * (runner/team.ts). A member seated in a group thread that is no team talks with the user there, so it reports to no one.
 */
function reportsUp(thread: Thread): boolean {
  if (!thread.parent_id) return false;
  if (thread.source === 'member') return events.teamOf(thread.parent_id) !== null;
  return true;
}

/** A team thread's lead (runner/team.ts): plan, give out the parts with message_members, then report once woken. */
function teamLeadLines(name: string): string[] {
  return [
    '',
    '## Team lead',
    `You lead a team in this thread. The agents your brief gives parts to are seated here, each in a session of its own, and they work only when you message them. ` +
      'Plan first: read the brief, decide what each member does and what done looks like, then give each member its whole part with message_members, one call per member, both parts in one message when a member has two. ' +
      `Do any parts the brief gives you, then end your turn. The members work at the same time in this worktree and never commit: you commit and open the pull request. ` +
      `Omni wakes you once every member you messaged has finished, a failed or stopped one included, with their replies; a member waiting on ${name} keeps you waiting. ` +
      'Then combine them into one answer: lead with the outcome, keep what each member found that matters, say where they disagree and what failed. That answer is your report. Do not redo their work.',
  ];
}

/** Pages with html_render: every local thread but one that only reads (replyLines). */
const rendersPages = (thread: Thread) => !isProviderHarness(thread.harness) && !readsOnly(thread);

/** The thread's `## Reply` block, as its system prompt has it. */
export function replyBlock(thread: Thread): string[] {
  return replyLines(userName(), rendersPages(thread), reportsUp(thread));
}

/**
 * What a harness that takes the system prompt only with a new chat sends again when it resumes one: the Reply block,
 * once per change, with the fingerprint of what the chat last read kept in kv (AdapterContext.chatRules).
 */
export function threadChatRules(thread: Thread): ChatRules {
  const key = `chat-rules:${thread.id}`;
  return chatRules(resumeRules(replyBlock(thread)), { get: () => kv.get<string>(key), set: (print) => kv.set(key, print) });
}

/**
 * Whether the thread gets the tool-failure policy. A delegate-only agent (the Conductor) runs no shell, subagent or
 * wrapper whose failures Omni could miss, and its own calls are recorded, so the policy only costs it tokens (#1013).
 */
const getsToolFailurePolicy = (role?: CrewRole) => !role?.delegateOnly;

/**
 * Whether the role's charter is the shipped Conductor charter (crew/conductor.md), which states every delegation rule
 * (seat first, briefs, teams, seating, warmth, reports): as shipped, or with the user's text after it (`charter_mode:
 * append`). An overlay that replaces it may predate those rules, so that one keeps the prompt's copy.
 */
const chartersDelegation = (role: CrewRole) => isConductor(role.id) && role.charterMode !== 'replace';

/**
 * The thread's delegation rules, for an agent with the conductor tools. The Conductor gets none where its charter
 * carries them (chartersDelegation): saying them twice cost every Conductor thread ~1K tokens and let the copies drift
 * (#1013). A usage scan's lead gets the omni tools to save what the user picks, not to route work: it never delegates.
 */
function delegationLines(role: CrewRole | undefined, name: string): string[] {
  if (!role?.mcp.includes('omni') || role.id === SCAN_ROLE || chartersDelegation(role)) return [];
  return [
    '',
    '## Thread delegation',
    `${delegationRule(role, name)}First call list_crew and list_channels when you need valid ids. Write each brief as Goal, Done when and Proof back; the delegated thread cannot see this conversation. Delegated threads appear in Omni as separate, linked threads, and their reports return here automatically; do not poll for them.${role.delegateOnly ? ` Each report shows in this thread for ${name} as it lands, so a report wakes you only when you passed follow_up: true on delegate (to act on it: the next step of a chain, combining reports); otherwise you read it with ${name}'s next message.` : ''}`,
    TEAM_RULE,
    SESSION_CACHE_RULE,
  ];
}

/** What kind of thread this is: a team member, a seated member, a delegated task or a team lead. */
function sourceLines(thread: Thread, role: CrewRole | undefined, lead: boolean, name: string): string[] {
  const remote = isProviderHarness(thread.harness);
  const remoteAgent = isRemoteAgentHarness(thread.harness);
  const lines: string[] = [];
  if (thread.source === 'team') {
    lines.push(
      '',
      '## Team task',
      `You are one member of a team, on the task on the Thread line under This thread. Your final message is automatically reported to the team lead, who combines it with the other members' replies. Stick to your own task. Report outcomes and blockers, even if the answer is "nothing found".`,
    );
  } else if (thread.source === 'member') {
    // A seated member (ADR 0019): the lead commits, and several agents edit one worktree at once (Q24). A remote agent
    // seated here talks only, and where a remote agent leads, the user commits what the local members change (ADR 0020).
    const leadThread = thread.parent_id ? threads.get(thread.parent_id) : undefined;
    const leadName = crewRoleName(leadThread?.role, getCrew) ?? 'The lead';
    const team = !!leadThread && events.teamOf(leadThread.id) !== null;
    const committer = isRemoteAgentHarness(leadThread?.harness) ? `${leadName} is a remote agent and talks only, so ${name}` : leadName;
    lines.push(
      '',
      '## Group thread',
      `You are seated in a group thread with ${name} and other agents. ${leadName} leads this thread. Its messages go to the agents they name, and agents named in one message work at the same time in this one worktree.`,
      ...(team ? [`This thread is a team: ${leadName} gives you your part. Stick to it, and end your turn with what you did and found: your final message goes back to ${leadName}.`] : []),
      ...(leadThread?.channel_id === 'conductor' && !remoteAgent ? conductorSeatLines(name, role, !remote && hasOmniCommand()) : []),
      remoteAgent
        ? 'You talk only: the local agents seated here change the files.'
        : leadThread?.channel_id === 'conductor'
          ? ''
          : remote
          ? `You work in your own checkout on a branch of your own, not in this thread's worktree. Push your work to that branch and do not open a pull request: when you finish, ${leadName} pulls your branch into the thread's branch.`
          : `Edit files only. ${committer} commits and opens the pull request: never run git commit, git push, git rebase, git reset, git stash or git checkout, and never open a pull request. When another agent changed a file you changed, Omni tells you which files: read them again before you edit them and keep their changes.`,
    );
  } else if (thread.parent_id) {
    lines.push(
      '',
      '## Delegated task',
      'The conductor handed you this task: its id is on the Thread line under This thread. Your final message is automatically reported back to it. Report outcomes and blockers, even if the answer is "nothing found".',
      // The report card (packages/shared/report-shape.ts) leads with what comes before the first heading and folds each heading.
      'That final message is the whole report; what you said while working is not part of it. Put the outcome in its first one to three lines, then the details under ## headings (such as Checks, Changes, Open items), as bullet lists rather than tables.',
    );
  }
  if (events.teamOf(thread.id) !== null) lines.push(...teamLeadLines(name));
  else if (lead) {
    // A team made before one-thread teams: its members ran in threads of their own under this one.
    lines.push(
      '',
      '## Team lead',
      'You lead a team. Your members have already done the work in their own threads, and their replies are in your first message. Combine them into one answer: lead with the verdict, keep what each member found that matters, link the member threads, and say where they disagree. Do not redo their work. Their replies are all you get: read_referenced_thread cannot open member threads.',
    );
  }
  return lines;
}

/**
 * The lines that are this thread's own, last in the prompt so everything above them can cache across threads: where
 * it runs, its task, its branch and its folders. The sections above name these lines (This thread) instead of a path.
 */
function threadLines(thread: Thread, channel: Channel, hands: boolean): string[] {
  const remote = isProviderHarness(thread.harness);
  const { shopify } = displayPrefs();
  const local = hands && !remote;
  return [
    '',
    '## This thread',
    `- Channel: #${channel.id} (${channel.name}, ${channel.kind})`,
    // The Shopify pack (display.ts): its store and portal lines go out only while it is on.
    shopify && channel.store_domain ? `- Shopify store: ${channel.store_domain}` : '',
    shopify && channel.portal_slug ? `- Client portal slug: ${channel.portal_slug}` : '',
    channel.github_repo ? `- GitHub repo: ${channel.github_repo}` : '',
    `- Thread: ${thread.id}${thread.task_id ? ` (task ${thread.task_id})` : ''}`,
    !remote && thread.branch ? `- You are in a dedicated git worktree on branch ${thread.branch}. Commit here; open a PR when asked.` : '',
    local ? `- Artifacts folder: ${artifactsDir(thread.id)}` : '',
    local && config.browser ? `- Browser folder: ${browserOutDir(thread.id)}` : '',
    local && channel.design_system ? `- Design system: ${designSystemFile(thread.id)}` : '',
  ];
}

/**
 * `secretNames` are the names of the secrets in the thread's environment, never their values. `skills`: what the
 * thread's harness loads of its agent's skills (skills.ts), resolved when it starts.
 */
export function buildSystemPrompt(thread: Thread, channel: Channel, role?: CrewRole, lead = false, secretNames: readonly string[] = [], skills: ThreadSkills | null = null) {
  const remote = isProviderHarness(thread.harness);
  const remoteAgent = isRemoteAgentHarness(thread.harness);
  const own = profileOf(thread.harness).prompt;
  const name = userName();
  // A delegate-only role has no browser or file tools, so the sections on using them would only mislead it.
  // A quick ask only reads, and turns into a task for the rest (packages/shared/quick-ask.ts).
  const hands = doesOwnWork(thread, role);
  // A remote agent gets a charter only when Ben wrote one in its file; otherwise its server's own instructions lead (Q28).
  const charter = role ? (remoteAgent ? writtenCharter(role) : role.charter) : '';
  const lines = [
    // The install's rules: the same for every thread of this harness and agent.
    '# Omni OS context',
    getsToolFailurePolicy(role) ? TOOL_FAILURE_POLICY : '',
    own
      ? own.intro(userPossessive())
      : remote
      ? `You are ${role?.name ?? harnessName(thread.harness)}, running on your own server and reached by Omni OS over HTTP. ${name} is on their own machine; you are not. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you.`
      : `You are running headless inside Omni OS, ${userPossessive()} local agent workspace. Nobody can answer permission prompts, so finish the task or clearly state what is blocking you. When a choice only ${name} can make blocks you, ask with the ask_user_question tool: it waits for the answer.`,
    getProfile().name ? `- You work for ${name}. Charters and automations that say "the user" mean them.` : '',
    ...profileLines(name),
    remoteAgent
      ? `- You talk only in this thread. Its files are in Omni's checkout on ${name}'s machine, which you cannot change from your server: local agents seated in the thread change them, and ${name} commits. Where ${name} opens a channel's work to remote agents, Omni offers you its ${READ_TOOL} tool on each turn, to list, read and search the thread's git-tracked files and read its diff; elsewhere you cannot read them. What you do with your own tools on your own server is up to you, as before.`
      : remote
      ? '- This thread does not run in an Omni worktree or browser. Work on your own clone of the repo and open pull requests there.'
      : '',
    // zsh slips recur in every harness's shell calls: an unquoted glob that matches nothing, a word that starts with =.
    !remote && /zsh$/.test(process.env.SHELL ?? '')
      ? `- Shell commands run in zsh: quote glob arguments (--include='*.ts'), and never start a word with = (zsh reads echo === as a command lookup).${process.platform === 'darwin' ? ' The command-line tools are BSD, not GNU.' : ''}`
      : '',
    ...(readsOnly(thread) ? ['', ...quickAskRule(name)] : []),
    ...delegationLines(role, name),
    ...noEditsLines(thread, role),
    ...(hands ? workspaceLines(thread) : []),
    ...(hands ? notionLines(thread, secretNames) : []),
    ...commandLineLines(thread, role),
    '',
    ...(own?.lines ?? []),
    '',
    '## Secrets',
    remote
      ? 'Omni does not copy Keychain secrets onto this server. Never print, echo or write secret values anywhere.'
      : 'Channel and global secrets are already in your environment as variables. Never print, echo or write their values anywhere.',
    '',
    ...replyBlock(thread),
    // The thread's step view (@omni/shared/steps.ts). set_steps is on omni-mcp, which remote harnesses do not get.
    ...(remote
      ? []
      : [
          '',
          '## Progress',
          `For a task with more than one stage, call set_steps before you start, with 3 to 6 steps in the plain words ${name} would use ("Find candidate apps", "Compare prices"), then again each time a step starts or finishes. Omni shows the list as the thread's progress. Skip it for a quick answer.`,
          // Spelled out because a harness that defers MCP tools (Claude Code) has the model call it before it has
          // seen the schema, and it guessed step objects or left out current.
          'set_steps takes `steps`, the list as plain strings, and `current`, the index (from 0) of the step you are on: `{"steps": ["Find candidate apps", "Compare prices"], "current": 0}`. Pass the number of steps as `current` once all are done.',
          // A Cursor model sent its progress sentences to its own thread with `omni send`, which queued them as turns.
          `Text you write between tool calls shows in the thread as you work, so a progress update is plain text in your reply. Never post one to this thread with \`omni send\` or another tool.`,
        ]),
    // The agent's: its charter, then the skills it loads in every thread, which belong with it.
    ...(role && charter ? ['', `## Your agent: ${role.name}`, charter] : []),
    ...(role && skills ? skillLines(skills, role.name) : []),
    // The thread's kind.
    ...sourceLines(thread, role, lead, name),
    // The channel's: its notes, what the user approved as lessons for it (memory-api.ts; only this channel's, so one
    // client's never reaches another's), the role's own lessons (untagged ones and this channel's), and its pages.
    ...(channel.notes ? ['', '## Channel notes', channel.notes] : []),
    ...learningsPrompt(memories.approvedIn(channel.id)),
    ...roleMemorySection(thread, channel, role),
    ...(hands ? channelPageLines(thread, channel) : []),
    // The thread's own lines, last.
    ...threadLines(thread, channel, hands),
  ];
  return lines.filter((l) => l !== '').join('\n').replace(/\n## /g, '\n\n## ');
}

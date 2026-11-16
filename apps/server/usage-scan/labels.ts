// Haiku names what each usage-scan group is about, on this machine through Ben's own Claude Code login (runner/aux.ts),
// like thread titles. Adapted from the reader prompt of Cloudroom's workflow scan (github.com/davidondrej/cloudroom,
// gui/plugins/automations/skills/workflow-scan/reader.md, Apache 2.0): one line per group instead of one per chat,
// since Omni has grouped the asks already. A label for a group id Haiku made up is dropped, as Cloudroom's readers do.

/** A group as Haiku sees it: its id, what its asks share and a few of them, already masked and trimmed. */
export interface LabelInput {
  id: string;
  key: string;
  samples: string[];
}

export interface Label {
  /** What Ben keeps asking for, at most 12 words. */
  what: string;
  tags: string[];
  /** Haiku thought another agent or an automation wrote these asks. */
  agentWritten: boolean;
}

const TAGS =
  'bug-fix, feature-build, code-review, security, release-ship, push-merge, deploy-ops, prod-debug, data-query, research, ui-design, docs, ' +
  'planning-decision, refactor-simplify, testing, setup-config, agent-orchestration, thread-handoff, feedback-triage, marketing-content, ' +
  'email-outreach, customer-support, billing, personal-admin';

export function labelPrompt(groups: readonly LabelInput[]): string {
  const body = groups
    .map((g) => [`### ${g.id} · shared: ${g.key}`, ...g.samples.map((s) => `> ${s}`)].join('\n'))
    .join('\n\n');
  return (
    'You label groups in a usage scan. Do not run any commands or tools. Answer only from the text below.\n' +
    "Below are groups of one person's past requests to their AI coding agents. Each group shows its id, what its requests share, " +
    'and a few of the requests (trimmed; [masked] is a removed secret).\n' +
    'For EVERY group, write exactly one line:\n' +
    '`<id> | <what they keep asking for, max 12 words> | <1-3 workflow tags, comma-separated>`\n' +
    `Use these tags when they fit, else a short new one: ${TAGS}.\n` +
    'Tag `agent-written` when the requests were clearly written by another agent or an automation, not a person.\n' +
    'No other text.\n\n' +
    body
  );
}

/** Haiku's lines by group id. Lines for an id not in `ids`, and lines not in the format, are dropped and counted. */
export function parseLabels(out: string, ids: ReadonlySet<string>): { labels: Map<string, Label>; dropped: number } {
  const labels = new Map<string, Label>();
  let dropped = 0;
  for (const raw of out.split('\n')) {
    const line = raw.trim().replace(/^[-*`\s]+|`+$/g, '');
    if (!line.includes('|')) continue;
    const [id, what, tags = ''] = line.split('|').map((s) => s.trim());
    if (!ids.has(id) || !what) {
      dropped++;
      continue;
    }
    const tagList = tags
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 3);
    labels.set(id, { what: what.split(/\s+/).slice(0, 12).join(' '), tags: tagList.filter((t) => t !== 'agent-written'), agentWritten: tagList.includes('agent-written') });
  }
  return { labels, dropped };
}

/** Label every group in one Haiku call. Null when the call failed or timed out: the scan goes on without labels. */
export async function labelGroups(
  groups: readonly LabelInput[],
  ask: (prompt: string) => Promise<string | null>,
): Promise<{ labels: Map<string, Label>; dropped: number } | null> {
  if (!groups.length) return { labels: new Map(), dropped: 0 };
  const out = await ask(labelPrompt(groups));
  return out ? parseLabels(out, new Set(groups.map((g) => g.id))) : null;
}

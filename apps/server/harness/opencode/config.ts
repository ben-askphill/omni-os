// The per-process config an OpenCode thread gets in OPENCODE_CONFIG_CONTENT, so nothing is written to the user's own
// files (spec section 6, 10). Pure.
//
// - `permissions` is an ordered list and the last matching rule wins. Omni's order: every action asks (Omni's gate
//   answers), or is allowed when nothing is held; `read` is allowed; then the denials, which remove a tool from the
//   model altogether (verified on 2.3.0: the model answers "there is no shell tool").
// - `execute` (Code Mode) is always denied. With it on, MCP calls run inside one built-in `execute` tool that takes
//   JavaScript, and Omni's gate would never see `mcp__<server>__<tool>`. With it denied they are direct tools.
// - A delegate-only agent loses shell, edit, subagent and browser, as on Claude (DELEGATE_ONLY_DENIED); a read-only
//   thread also loses web fetch and search; a no-edits agent loses edit.
export interface Rule {
  action: string;
  resource: string;
  effect: 'allow' | 'deny' | 'ask';
}

export interface Held {
  /** The channel is below Full access, or a limit below applies: every request goes through the gate. */
  held: boolean;
  delegateOnly: boolean;
  noEdits: boolean;
  readOnly: boolean;
}

const rule = (action: string, effect: Rule['effect']): Rule => ({ action, resource: '*', effect });

/** The permission rules for one thread. */
export function permissionRules(h: Held): Rule[] {
  const rules: Rule[] = [rule('*', h.held ? 'ask' : 'allow')];
  if (h.held) rules.push(rule('read', 'allow'));
  rules.push(rule('execute', 'deny'));
  if (h.delegateOnly) for (const a of ['shell', 'edit', 'subagent', 'browser']) rules.push(rule(a, 'deny'));
  if (h.noEdits) rules.push(rule('edit', 'deny'));
  if (h.readOnly) for (const a of ['shell', 'edit', 'subagent', 'webfetch', 'websearch']) rules.push(rule(a, 'deny'));
  return rules;
}

/** The OPENCODE_CONFIG_CONTENT string. `instructions` names Omni's context file when OpenCode takes it that way. */
export function configContent(h: Held, instructions?: string): string {
  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    autoupdate: false,
    permissions: permissionRules(h),
    ...(instructions && { instructions: [instructions] }),
  });
}

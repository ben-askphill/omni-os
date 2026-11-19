// What the first run asks about someone's work (Onboarding's Work step, `npm run setup`), and what their answer turns
// on. The tools are saved as one comma-separated line (`user.tools`, packages/shared/settings.ts) that every agent's
// system prompt carries; two of them open an add-on: repo folders and a GitHub owner for code, a store for Shopify.

export type AddOn = 'code' | 'store';

/** The tools the "Which tools do you use?" question offers, in order. `addOn` names what picking one opens. */
export const ONBOARDING_TOOLS = [
  { id: 'Email', label: 'Email' },
  { id: 'Calendar', label: 'Calendar' },
  { id: 'Google Drive', label: 'Google Drive' },
  { id: 'Notion', label: 'Notion' },
  { id: 'Slack', label: 'Slack' },
  { id: 'Linear', label: 'Linear' },
  { id: 'Jira', label: 'Jira' },
  { id: 'Figma', label: 'Figma' },
  { id: 'GitHub', label: 'GitHub and code', addOn: 'code' },
  { id: 'Shopify', label: 'Shopify', addOn: 'store' },
] as const satisfies readonly { id: string; label: string; addOn?: AddOn }[];

/** The tools line as a list: trimmed, empty ones dropped, each once (case aside), in the order given. */
export function toolList(tools: string): string[] {
  const seen = new Set<string>();
  return tools
    .split(',')
    .map((t) => t.trim().replace(/\s+/g, ' '))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/** A list back to the line `user.tools` keeps. */
export const toolLine = (list: readonly string[]) => toolList(list.join(',')).join(', ');

/** Whether the tools line turns on an add-on: the repo fields for `code`, the store field for `store`. */
export function toolsAddOn(tools: string, addOn: AddOn): boolean {
  const ids = new Set(toolList(tools).map((t) => t.toLowerCase()));
  return ONBOARDING_TOOLS.some((t) => 'addOn' in t && t.addOn === addOn && ids.has(t.id.toLowerCase()));
}

/** The tools in the line that are not among ONBOARDING_TOOLS: what the user typed under Other. */
export function otherTools(tools: string): string {
  const known = new Set(ONBOARDING_TOOLS.map((t) => t.id.toLowerCase()));
  return toolList(tools)
    .filter((t) => !known.has(t.toLowerCase()))
    .join(', ');
}

/** The line with its Other part replaced by `other`, the picked tools kept. */
export function withOtherTools(tools: string, other: string): string {
  const known = new Set(ONBOARDING_TOOLS.map((t) => t.id.toLowerCase()));
  return toolLine([...toolList(tools).filter((t) => known.has(t.toLowerCase())), ...toolList(other)]);
}

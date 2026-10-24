// Text as the context block may carry it. The fence already holds backtick runs, so the one thing left in quoted text
// that could pass for Omni's own framing is its tag: `<omni-context` and `</omni-context` are written with `&lt;`.
// A file of its own because the kinds that call it are imported by project.ts.
export const defang = (s: string) => s.replace(/<(\/?omni-context)/gi, '&lt;$1');

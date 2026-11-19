/**
 * For a field that holds an identifier, not prose: a slug, repo, path, domain, URL, code or token. A phone keyboard
 * leaves its first letter lowercase and does not autocorrect it, and no spellchecker underlines it. Spread it before a
 * field's own props, so one of them can still differ (Secrets' name field capitalizes).
 */
export const IDENTIFIER = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

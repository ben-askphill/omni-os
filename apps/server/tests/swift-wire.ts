// Reads the Mac app's wire types from their Swift source, so a TS test can hold them to the @omni/shared contracts
// without a Swift compiler: a struct's JSON keys (stored properties, renamed by its CodingKeys), an OpenEnum's values
// and a switch's string cases.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAC = resolve(import.meta.dirname, '../../mac');

export const omniKitSource = (file: string) => readFileSync(join(MAC, 'OmniKit/Sources/OmniKit', file), 'utf8');
export const macAppSource = (file: string) => readFileSync(join(MAC, 'Omni', file), 'utf8');

/** The text between the braces of `struct name` (or `enum`), the first one with that name. */
function body(src: string, name: string): string {
  const m = new RegExp(`\\b(?:struct|enum)\\s+${name}\\b[^{]*\\{`).exec(src);
  if (!m) throw new Error(`no struct ${name} in the Swift source`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  return src.slice(start, i - 1);
}

/** The lines of a body at its own level, with nested types and computed properties left out. */
function topLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (const line of text.split('\n')) {
    if (depth === 0) out.push(line);
    for (const ch of line) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
  }
  return out;
}

/** The JSON keys a Decodable struct reads: its stored properties, each renamed by its CodingKeys case when it has one. */
export function swiftKeys(src: string, struct: string): string[] {
  const text = body(src, struct);
  const lines = topLevel(text);
  const stored = lines
    .map((l) => /^\s*public (?:let|var) (\w+)\s*(?::[^{=]*)?(?:=[^{]*)?$/.exec(l)?.[1])
    .filter((x): x is string => !!x);
  const renames = new Map<string, string>();
  if (/\benum CodingKeys\b/.test(text)) {
    for (const m of body(text, 'CodingKeys').matchAll(/case ([^\n}]+)/g)) {
      for (const part of m[1].split(',')) {
        const r = /(\w+)\s*=\s*"([^"]+)"/.exec(part);
        if (r) renames.set(r[1], r[2]);
      }
    }
  }
  return stored.map((p) => renames.get(p) ?? p);
}

/** The values of an OpenEnum: its `public static let x: Self = "value"` lines. */
export function swiftEnumValues(src: string, type: string): string[] {
  return [...body(src, type).matchAll(/public static let \w+: Self = "([^"]+)"/g)].map((m) => m[1]);
}

/** The string cases of a computed property's switch, like `case "added": "A"`. */
export function swiftSwitchCases(src: string, type: string, property: string): string[] {
  const text = body(src, type);
  const at = text.search(new RegExp(`\\bvar ${property}\\b`));
  if (at < 0) throw new Error(`no var ${property} in ${type}`);
  const from = text.indexOf('{', at);
  let depth = 1;
  let i = from + 1;
  for (; i < text.length && depth > 0; i++) depth += text[i] === '{' ? 1 : text[i] === '}' ? -1 : 0;
  return [...text.slice(from, i).matchAll(/case "([^"]+)"/g)].map((m) => m[1]);
}

// Writing custom harnesses (custom.ts) from Ben's clients: create or change one file, or remove it, here and on the
// other machines (sync/handlers/harness-file.ts). A save changes only the keys it names and keeps the rest, so a key a
// later build writes (pairing details, a `git` block) survives an edit from this one. The file is checked as a whole
// before it is written: a save that would leave a harness that cannot run is refused with the reason.
import YAML, { Document, isMap } from 'yaml';
import { z } from 'zod';
import { CUSTOM_HARNESS_SLUG } from '@omni/shared/custom-harness.ts';
import { record } from '../db/sync.ts';
import { customHarnessText, parseHarnessFile, removeCustomHarness, writeCustomHarness, type CustomHarness } from './custom.ts';

const refused = (message: string, status: 400 | 404 | 409 = 400) => Object.assign(new Error(message), { status });

/** What a client sets. The file's `auth` is a bearer key read from the secret named `secret`. */
export const customHarnessSave = z
  .object({
    name: z.string().trim().min(1, 'Give the harness a name.').max(80),
    url: z.string().trim().min(1, "Give the server's URL.").max(500),
    secret: z.string().trim().max(64),
    bills: z.string().trim().max(160).optional(),
    family: z.string().trim().max(40).optional(),
    cap: z.number().int().min(1).max(64).optional(),
    capabilities: z.object({ steer: z.boolean().optional(), interrupt: z.boolean().optional() }).strict().optional(),
  })
  .strict();
export type CustomHarnessSave = z.infer<typeof customHarnessSave>;

/** The text a save leaves: the old file with the save's keys set. An empty optional field removes its key. */
function savedText(old: string | null, save: CustomHarnessSave): string {
  const doc = old?.trim() ? YAML.parseDocument(old) : new Document({});
  if (doc.errors.length || !isMap(doc.contents)) throw refused('The harness file is not a list of keys. Fix it in data/harnesses/ first, or remove it.');
  doc.set('name', save.name);
  doc.set('kind', 'runs-api');
  doc.set('url', save.url.replace(/\/+$/, ''));
  doc.setIn(['auth', 'scheme'], 'bearer');
  doc.setIn(['auth', 'secret'], save.secret);
  const optional = { bills: save.bills, family: save.family, cap: save.cap } as const;
  for (const [key, value] of Object.entries(optional)) {
    if (value === undefined) continue;
    if (value === '') doc.delete(key);
    else doc.set(key, value);
  }
  if (save.capabilities) {
    // A file only ever turns a capability off, so `true` is the same as leaving it out.
    for (const [key, on] of Object.entries(save.capabilities)) {
      if (on === false) doc.setIn(['capabilities', key], false);
      else doc.deleteIn(['capabilities', key]);
    }
    const caps = doc.get('capabilities');
    if (isMap(caps) && !caps.items.length) doc.delete('capabilities');
  }
  return doc.toString({ lineWidth: 0 });
}

/**
 * Create a custom harness (`create`) or change one. Refused when the slug is not one, when `create` finds a file or an
 * edit finds none, and when the result could not run (an insecure URL, a missing or reserved secret name).
 */
export function saveCustomHarness(slug: string, save: CustomHarnessSave, opts: { create?: boolean } = {}): CustomHarness {
  if (!CUSTOM_HARNESS_SLUG.test(slug)) throw refused('A harness id is lowercase letters, digits and dashes, up to 48 characters.');
  const old = customHarnessText(slug);
  if (opts.create && old !== null) throw refused(`A custom harness "${slug}" already exists.`, 409);
  if (!opts.create && old === null) throw refused(`No custom harness "${slug}".`, 404);
  const text = savedText(old, save);
  const harness = parseHarnessFile(slug, text);
  if (harness.error) throw refused(harness.error);
  writeCustomHarness(slug, text);
  record('harness_file', slug);
  return harness;
}

/** Remove a custom harness here and on the other machines. Its threads then refuse to run (registry.ts missingHarness). */
export function deleteCustomHarness(slug: string) {
  if (!CUSTOM_HARNESS_SLUG.test(slug) || !removeCustomHarness(slug)) throw refused(`No custom harness "${slug}".`, 404);
  record('harness_file', slug, 'delete');
}

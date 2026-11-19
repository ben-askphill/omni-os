import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startRunner } from './runner-boot.ts';

// A precheck may use {{user}}, {{reposDir}} and the other placeholders. Their values come from the profile and setup,
// which any signed-in device may change, while only the install token (or a session paired with it) may write the
// precheck itself (automation-precheck-credentials.test.ts). So a value must reach the command as data: a name like
// `x; touch marker` must not run `touch`. The login shell is a stub that writes down the command it was handed and
// then really runs it with /bin/sh, so each case is checked by what the shell did.

const r = await startRunner();
const LAUNCHES = join(r.tmp, 'launches.log');
const STUB_SHELL = join(r.tmp, 'bin', 'stub-login-shell');
writeFileSync(STUB_SHELL, `#!/bin/sh\n[ "$1" = "-lc" ] && printf '%s\\n' "$2" >> '${LAUNCHES}'\nexec /bin/sh -c "$2"\n`, { mode: 0o755 });
process.env.SHELL = STUB_SHELL;

const { app } = await import('../app.ts');
const automations = await import('../automations.ts');
const { personalFile } = await import('../automation-store.ts');
const { sessionCookieName, cookieName } = await import('../api-token.ts');
const { fillShellPlaceholders, shellPlaceholderEnv } = await import('../user-config.ts');
const auth = await import('../google-auth.ts');

auth.linkOwner({ issuer: 'https://clerk.test', sub: 'user_ben', email: 'ben@example.com', name: 'Ben' });

const cookie = (token: string) => ({ authorization: '', cookie: `${sessionCookieName()}=${token}` });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
// Every credential that may change the profile and setup. The restricted ones are the point: they may not write a
// precheck, so they must not be able to change what one runs either.
const CREDENTIALS = {
  'install token': bearer(process.env.OMNI_TOKEN!),
  'browser paired with the token': cookie(auth.createSession('Chrome', 'browser', '', 'token').token),
  "an older build's raw-token cookie": { authorization: '', cookie: `${cookieName()}=${process.env.OMNI_TOKEN}` },
  'Google browser session (and Omni Connect)': cookie(auth.createSession('Chrome', 'browser', 'user_ben', 'google').token),
  'Google app session': bearer(auth.createSession('iPhone', 'app', 'user_ben', 'google').token),
  'paired app (pairing code)': bearer(auth.createSession('iPhone', 'app', '', 'pairing').token),
} satisfies Record<string, Record<string, string>>;
type Who = keyof typeof CREDENTIALS;

const call = async (who: Who, method: string, path: string, body: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json', ...CREDENTIALS[who] }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

let n = 0;
const OUT = join(r.tmp, 'precheck-out.txt');
const loaded = (id: string) => automations.loadAutomations().find((a) => a.id === id)!;

/** A precheck the install token wrote by hand, run on a scheduled tick. Returns what it printed. */
async function runPrecheck(command: string) {
  const id = `placeholders-${++n}`;
  rmSync(OUT, { force: true });
  mkdirSync(dirname(personalFile(id)), { recursive: true });
  writeFileSync(personalFile(id), `name: P\nenabled: true\ncron: "0 2 * * *"\nchannel: scratch\nprompt: look\nprecheck: |\n  cd '${r.tmp}' && ${command}\n`);
  await automations.fireScheduled(loaded(id));
  return existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
}

describe('a placeholder value set by any signed-in device', () => {
  for (const who of Object.keys(CREDENTIALS) as Who[])
    it(`${who}: a profile name or repos folder with shell in it is printed, never run`, async () => {
      // The precheck runs in r.tmp, so a bare name lands there. A name is 60 characters at most; a folder may not
      // hold $ or backticks, so it tries the quotes.
      const ran = `ran${++n}`;
      const marker = join(r.tmp, ran);
      const name = `x;touch ${ran};echo '$(touch ${ran})'"\`touch ${ran}\`"`;
      const folder = `/tmp/y'; touch ${ran}; echo "; touch ${ran}; #`;
      const profile = await call(who, 'PUT', '/profile', { name });
      expect(profile.status, JSON.stringify(profile.body)).toBe(200);
      const setup = await call(who, 'PUT', '/setup', { workspace: { reposDir: folder } });
      expect(setup.status, JSON.stringify(setup.body)).toBe(200);
      // The token's prechecks use them outside quotes, in double quotes, and inside a single-quoted command an inner
      // shell runs.
      const byName = await runPrecheck(`printf '%s\\n' {{user}} "by {{user}}" > ${OUT}; sh -c 'printf "%s\\n" "{{user}}" {{user}}' >> ${OUT}`);
      expect(existsSync(marker), `${ran} exists: the name ran as shell`).toBe(false);
      const byFolder = await runPrecheck(`printf '%s\\n' "in {{reposDir}}" > ${OUT}; sh -c 'printf "%s\\n" "{{reposDir}}" {{reposDir}}' >> ${OUT}`);
      expect(existsSync(marker), `${ran} exists: the folder ran as shell`).toBe(false);
      const words = (v: string) => v.split(' ').join('\n');
      expect(byName).toBe(`${words(name)}\nby ${name}\n${name}\n${words(name)}\n`);
      expect(byFolder).toBe(`in ${folder}\n${folder}\n${words(folder)}\n`);
    });
});

describe('fillShellPlaceholders', () => {
  const run = (command: string) => runPrecheck(`${command} > ${OUT}`);

  it('reads as the value wherever the shell expands it, and as data when it does not', async () => {
    expect(await call('install token', 'PUT', '/profile', { name: `Ann "O'Brien" \\ $HOME` })).toMatchObject({ status: 200 });
    const user = `Ann "O'Brien" \\ $HOME`;
    // Outside quotes it splits on spaces, as a pasted value did, but nothing in it is expanded again.
    expect(await run(`printf '[%s]' {{user}}`)).toBe(`[Ann]["O'Brien"][\\][$HOME]`);
    expect(await run(`printf '[%s]' "a {{user}} b"`)).toBe(`[a ${user} b]`);
    expect(await run(`printf '[%s]' "x{{user}}y"`)).toBe(`[x${user}y]`);
    expect(await run(`printf '[%s]' "$(printf '%s' "in {{user}}")"`)).toBe(`[in ${user}]`);
    // In single quotes it stays a reference, which an inner shell expands from the environment.
    expect(await run(`printf '[%s]' 'a {{user}} b'`)).toBe('[a $OMNI_PLACEHOLDER_USER b]');
    expect(await run(`sh -c 'printf "[%s]" "{{user}}"'`)).toBe(`[${user}]`);
    // Comments, heredocs and case patterns need nothing special.
    expect(await run(`# there's nothing to track\n  printf '[%s]' "{{user}}"`)).toBe(`[${user}]`);
    expect(await runPrecheck(`cat > ${OUT} <<EOF\n  hi {{user}}\n  EOF`)).toBe(`hi ${user}\n`);
    expect(await run(`printf '[%s]' "$(case a in a) printf '%s' "{{user}}";; esac)"`)).toBe(`[${user}]`);
    // An unknown placeholder, or one named after an Object method, stays as written.
    expect(await run(`printf '[%s]' '{{nope}}' "{{constructor}}"`)).toBe('[{{nope}}][{{constructor}}]');
  });

  it('gives folders as absolute paths, which a shell reads the same in or out of quotes', () => {
    const env = shellPlaceholderEnv(fillShellPlaceholders('{{reposDir}} {{workspace}}'));
    expect(env.OMNI_PLACEHOLDER_REPOSDIR).not.toMatch(/^~/);
    expect(env.OMNI_PLACEHOLDER_WORKSPACE).toMatch(/^\//);
    expect(fillShellPlaceholders('cd {{workspace}} && test -d "{{reposDir}}/x" && echo {{user}}s')).toBe('cd $OMNI_PLACEHOLDER_WORKSPACE && test -d "$OMNI_PLACEHOLDER_REPOSDIR/x" && echo ${OMNI_PLACEHOLDER_USER}s');
    // Only the variables the command refers to.
    expect(Object.keys(shellPlaceholderEnv(fillShellPlaceholders('echo {{user}} {{timezone}}')))).toEqual(['OMNI_PLACEHOLDER_USER', 'OMNI_PLACEHOLDER_TIMEZONE']);
  });

  it('puts no value in the command the gate compares, so a profile change does not look like a new precheck', async () => {
    const before = fillShellPlaceholders('echo {{user}}');
    expect((await call('Google app session', 'PUT', '/profile', { name: 'Someone else' })).status).toBe(200);
    expect(fillShellPlaceholders('echo {{user}}')).toBe(before);
    expect(readFileSync(LAUNCHES, 'utf8')).not.toContain('Someone else');
  });
});

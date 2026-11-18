import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { scriptProblem, workflowProblems } from '../scripts/release-policy.ts';

const REPO = resolve(import.meta.dirname, '../../..');
const WORKFLOW = join(REPO, '.github/workflows/desktop-release.yml');

describe('the desktop release workflow', () => {
  it('runs no package code where a signing secret or a write token is', () => {
    expect(workflowProblems(parse(readFileSync(WORKFLOW, 'utf8')), REPO)).toEqual([]);
  });
});

/** A scratch repo with the given files, for the script rules. */
const scratch = mkdtempSync(join(tmpdir(), 'omni-release-policy-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(scratch, 'repo-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const checkout = { uses: 'actions/checkout@v5', with: { 'persist-credentials': false } };
const read = { contents: 'read' };

function problems(jobs: Record<string, unknown>, extra: Record<string, unknown> = {}, repo = scratch): string[] {
  return workflowProblems({ permissions: read, ...extra, jobs }, repo);
}

describe('workflowProblems', () => {
  it('passes a build that holds nothing and a publish that runs nothing', () => {
    const repo = repoWith({ 'v.ts': "import { readFileSync } from 'node:fs';\nimport './w.ts';\n", 'w.ts': "export { join } from 'node:path';\n" });
    const jobs = {
      build: {
        steps: [
          checkout,
          { run: 'npm ci --include=dev --ignore-scripts\nnpm rebuild node-pty\nnpx --no-install tsx scripts/dist.ts' },
          { uses: 'actions/upload-artifact@v4' },
        ],
      },
      publish: {
        permissions: { contents: 'write' },
        env: { GH_TOKEN: '${{ github.token }}' },
        steps: [
          { uses: 'actions/checkout@v5' },
          { uses: 'actions/download-artifact@v8', with: { name: 'release.tar', 'skip-decompress': true } },
          { run: 'echo "$SUM  release.tar" | sha256sum -c\nversion="$(node v.ts patch)"' },
        ],
      },
    };
    expect(problems(jobs, {}, repo)).toEqual([]);
  });

  it('needs read-only default permissions and an env without secrets', () => {
    expect(workflowProblems({ jobs: {} }, scratch)).toEqual(['workflow: its default permissions must be read-only (permissions: contents: read)']);
    expect(problems({}, { permissions: { contents: 'write' } })[0]).toMatch(/default permissions must be read-only/);
    expect(problems({}, { permissions: 'write-all' })[0]).toMatch(/default permissions must be read-only/);
    expect(problems({}, { env: { KEY: '${{ secrets.MAC_CERTIFICATE_P12 }}' } })).toEqual([
      'workflow: its env must hold no secret or token, which every job would get',
    ]);
  });

  it('refuses package code beside a secret, the token or a write permission', () => {
    const steps = [checkout, { run: 'npm ci --ignore-scripts' }];
    expect(problems({ mac: { env: { CSC_LINK: '${{ secrets.MAC_CERTIFICATE_P12 }}' }, steps } })).toEqual([
      'mac: runs package code with secrets MAC_CERTIFICATE_P12',
    ]);
    expect(problems({ linux: { env: { GH_TOKEN: '${{ github.token }}' }, steps } })).toEqual(['linux: runs package code with the GitHub token']);
    expect(problems({ mac: { env: { KEY: "${{ secrets['APPLE_API_KEY_P8'] }}" }, steps } })).toEqual(['mac: runs package code with secrets APPLE_API_KEY_P8']);
    // Only expressions read secrets: a script that names scripts/desktop-release-secrets.sh holds none.
    expect(problems({ mac: { steps: [...steps, { run: 'echo "Run scripts/desktop-release-secrets.sh"' }] } })).toEqual([]);
    expect(problems({ linux: { permissions: { contents: 'write' }, steps } })).toEqual(['linux: runs package code with write permissions']);
  });

  it('counts a job without its own permissions as having the default', () => {
    const steps = [checkout, { run: 'npm ci --ignore-scripts' }];
    expect(problems({ linux: { steps } }, { permissions: { contents: 'write' } })).toContain('linux: runs package code with write permissions');
  });

  it('holds installs to --ignore-scripts, rebuilds to the allowed list and npx to what is installed', () => {
    const run = (text: string) => problems({ build: { steps: [checkout, { run: text }] } });
    expect(run('npm ci --include=dev')).toEqual(["build: installs with dependencies' install scripts on: npm ci --include=dev"]);
    expect(run('npm install --ignore-scripts=false')).toHaveLength(1);
    expect(run('npm rebuild')).toEqual(['build: rebuilds more than node-pty: npm rebuild']);
    expect(run('npm rebuild node-pty esbuild')).toEqual(['build: rebuilds more than node-pty: npm rebuild node-pty esbuild']);
    expect(run('npx tsx scripts/dist.ts')).toEqual(['build: can fetch a package that is not installed (use npx --no-install): npx tsx scripts/dist.ts']);
    expect(run('# npm ci runs in the next step\necho ok')).toEqual([]);
  });

  it('wants the checkout token left out of a job that runs package code', () => {
    expect(problems({ build: { steps: [{ uses: 'actions/checkout@v5' }, { run: 'npm ci --ignore-scripts' }] } })).toEqual([
      'build: checks out with the token kept in .git/config (set persist-credentials: false)',
    ]);
  });

  it('keeps secrets and writes apart, and lets one job write', () => {
    const sign = { env: { P12: '${{ secrets.MAC_CERTIFICATE_P12 }}' }, permissions: { contents: 'write' }, steps: [] };
    expect(problems({ sign })).toEqual(['sign: has secrets MAC_CERTIFICATE_P12 and write permissions']);
    const writer = { permissions: { contents: 'write' }, steps: [] };
    expect(problems({ prepare: writer, publish: writer })).toEqual(['workflow: only one job may write, and prepare, publish can']);
  });

  it('lets a job with a secret or a write token run only dependency-free repo scripts and GitHub actions', () => {
    const repo = repoWith({
      'ok.ts': "import { join } from 'node:path';\nconst { a } = require('./retry.cjs');\n",
      'retry.cjs': 'module.exports = { a: 1 };\n',
      'bad.ts': "import './deep.ts';\n",
      'deep.ts': "const plist = require('plist');\n",
    });
    const job = (run: string, uses?: string) => ({ env: { P12: '${{ secrets.MAC_CERTIFICATE_P12 }}' }, steps: [...(uses ? [{ uses }] : []), { run }] });
    expect(problems({ sign: job('node ok.ts --app Omni.app') }, {}, repo)).toEqual([]);
    expect(problems({ sign: job('node bad.ts') }, {}, repo)).toEqual(['sign: has secrets or write permissions and runs node on deep.ts imports plist']);
    expect(problems({ sign: job('node missing.ts') }, {}, repo)).toEqual(['sign: has secrets or write permissions and runs node on missing.ts is not a file in the repo']);
    expect(problems({ sign: job('node -e "require(1)"') }, {}, repo)).toHaveLength(1);
    expect(problems({ sign: job('npx --no-install tsx sign.ts') }, {}, repo)).toEqual(['sign: runs package code with secrets MAC_CERTIFICATE_P12']);
    expect(problems({ sign: job('echo ok', 'someone/action@v1') }, {}, repo)).toEqual(['sign: has secrets or write permissions and runs someone/action@v1']);
  });

  it('wants a downloaded artifact left packed and checked before a job with a secret or a write token uses it', () => {
    const publish = (steps: unknown[]) => ({ publish: { permissions: { contents: 'write' }, steps } });
    const download = { uses: 'actions/download-artifact@v8', with: { 'skip-decompress': true } };
    expect(problems(publish([download, { run: 'gh release upload v1 *' }]))).toEqual(['publish: takes an artifact without checking it against a checksum']);
    expect(problems(publish([download, { run: 'sha256sum --check SUMS' }]))).toEqual([]);
    expect(problems(publish([{ uses: 'actions/download-artifact@v8' }, { run: 'sha256sum --check SUMS' }]))).toEqual([
      'publish: lets actions/download-artifact unpack an artifact another job made (set skip-decompress: true)',
    ]);
  });
});

describe('scriptProblem', () => {
  it('follows relative imports and stops at the first package', () => {
    const repo = repoWith({ 'a.ts': "export * from './b.ts';\n", 'b.ts': "const x = await import('yaml');\n" });
    expect(scriptProblem(repo, 'a.ts')).toBe('b.ts imports yaml');
    expect(scriptProblem(repo, '../outside.ts')).toBe('../outside.ts is not a file in the repo');
    expect(scriptProblem(repo, '$SCRIPT')).toBe('$SCRIPT is not a file in the repo');
  });
});

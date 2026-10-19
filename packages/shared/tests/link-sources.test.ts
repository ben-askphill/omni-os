import { describe, expect, it } from 'vitest';
import { parseLink, previewOf, slugTitle } from '../link-sources.ts';

const at = (url: string) => {
  const r = parseLink(url);
  if (!r) throw new Error(`no ref for ${url}`);
  return r;
};

describe('parseLink', () => {
  it('reads GitHub pulls, issues, commits, files and repos', () => {
    expect(at('https://github.com/ben-askphill/omni-os/pull/7723')).toMatchObject({ source: 'github', kind: 'pull', ref: '#7723', context: 'ben-askphill/omni-os', params: { owner: 'ben-askphill', repo: 'omni-os', number: '7723' } });
    expect(at('https://github.com/a/b/issues/5#issuecomment-1')).toMatchObject({ kind: 'issue', ref: '#5' });
    expect(at('https://github.com/a/b/commit/dea01b1aa')).toMatchObject({ kind: 'commit', ref: 'dea01b1' });
    expect(at('https://github.com/a/b/blob/main/server/links.ts#L12')).toMatchObject({ kind: 'file', title: 'server/links.ts:12', context: 'a/b@main' });
    expect(at('https://github.com/a/b')).toMatchObject({ kind: 'repo', title: 'a/b' });
    expect(at('https://github.com/a/b/actions/runs/99')).toMatchObject({ kind: 'run', params: { id: '99' } });
  });

  it('reads Azure DevOps work items, pull requests and builds on both hosts', () => {
    expect(at('https://dev.azure.com/acne/Web/_workitems/edit/29549')).toMatchObject({ source: 'azure-devops', kind: 'work-item', ref: '29549', params: { org: 'acne', project: 'Web', id: '29549' } });
    expect(at('https://acne.visualstudio.com/Web/_workitems/edit/29844/')).toMatchObject({ kind: 'work-item', params: { org: 'acne', id: '29844' } });
    expect(at('https://dev.azure.com/acne/Web/_boards/board/t/Team?workitem=12')).toMatchObject({ kind: 'work-item', ref: '12' });
    expect(at('https://dev.azure.com/acne/Web/_git/storefront/pullrequest/321')).toMatchObject({ kind: 'pull', ref: '!321', params: { repo: 'storefront', id: '321' } });
    expect(at('https://dev.azure.com/acne/Web/_build/results?buildId=77')).toMatchObject({ kind: 'build', ref: '77' });
  });

  it('reads Jira keys and Confluence page slugs', () => {
    expect(at('https://askphill.atlassian.net/browse/KE-142')).toMatchObject({ source: 'jira', ref: 'KE-142', params: { site: 'askphill.atlassian.net', key: 'KE-142' } });
    expect(at('https://askphill.atlassian.net/jira/software/projects/KE/boards/1?selectedIssue=KE-9')).toMatchObject({ ref: 'KE-9' });
    expect(at('https://askphill.atlassian.net/wiki/spaces/ENG/pages/12345/Release+checklist')).toMatchObject({ source: 'confluence', title: 'Release checklist', params: { id: '12345' } });
  });

  it('takes titles from Notion, Figma and Linear slugs', () => {
    expect(at('https://www.notion.so/askphill/Volero-Migration-Plan-0123456789abcdef0123456789abcdef')).toMatchObject({ source: 'notion', title: 'Volero Migration Plan', params: { id: '0123456789abcdef0123456789abcdef' } });
    expect(at('https://www.figma.com/design/AbC123/Volero-Design-System?node-id=1-2')).toMatchObject({ source: 'figma', title: 'Volero Design System', params: { key: 'AbC123' } });
    expect(at('https://linear.app/acme/issue/ENG-12/fix-the-cart')).toMatchObject({ source: 'linear', ref: 'ENG-12', title: 'Fix the cart' });
  });

  it('reads Productive, Shopify admin and Slack', () => {
    expect(at('https://app.productive.io/21562-ask-phill/task/19711159')).toMatchObject({ source: 'productive', kind: 'task', params: { org: '21562', id: '19711159' } });
    expect(at('https://app.productive.io/21562-ask-phill/projects/902419/tasks')).toMatchObject({ kind: 'project', params: { id: '902419' } });
    expect(at('https://admin.shopify.com/store/volero-dev/products/8123')).toMatchObject({ source: 'shopify', kind: 'product', ref: '8123', context: 'volero-dev', params: { type: 'Product' } });
    expect(at('https://admin.shopify.com/store/pg/themes/202126033227/editor')).toMatchObject({ kind: 'theme-editor', ref: '202126033227' });
    expect(at('https://pg.myshopify.com/?preview_theme_id=55')).toMatchObject({ kind: 'preview', ref: '55' });
    expect(at('https://askphill.slack.com/archives/C123/p1700000000123456')).toMatchObject({ source: 'slack', kind: 'message', params: { channel: 'C123', ts: '1700000000.123456' } });
  });

  it('knows Google, video and docs hosts, and leaves the rest to the web', () => {
    expect(at('https://docs.google.com/spreadsheets/d/abc/edit#gid=0')).toMatchObject({ source: 'google-sheets', fallback: 'Google Sheet' });
    expect(at('https://youtu.be/xyz')).toMatchObject({ source: 'youtube', kind: 'video' });
    expect(at('https://www.loom.com/share/abc')).toMatchObject({ source: 'loom', kind: 'video' });
    expect(at('https://shopify.dev/docs/api')).toMatchObject({ source: 'shopify', fetchTitle: true });
    expect(at('https://www.example.com/a/b')).toMatchObject({ source: 'web', fallback: 'example.com/a/b', fetchTitle: true });
    expect(parseLink('mailto:ben@example.com')).toBeNull();
    expect(parseLink('not a url')).toBeNull();
  });
});

describe('previewOf', () => {
  it('leads with the id when there is a title, and reads as words when there is not', () => {
    const ref = at('https://github.com/a/b/pull/7');
    expect(previewOf(ref.params.owner!, ref, { title: 'Fix it', state: 'merged' })).toMatchObject({ ref: '#7', text: 'Fix it', resolved: true, state: 'Merged', name: 'GitHub', icon: 'github' });
    const wi = at('https://dev.azure.com/o/p/_workitems/edit/9');
    expect(previewOf('u', wi, { needs: 'AZURE_DEVOPS_PAT' })).toMatchObject({ text: 'Work item 9', resolved: false, needs: 'AZURE_DEVOPS_PAT', icon: 'microsoft' });
    expect(previewOf('u', wi)).not.toHaveProperty('ref');
  });

  it('keeps a tracker state and a version as they are', () => {
    const ref = at('https://www.npmjs.com/package/hono');
    expect(previewOf('u', ref, { state: 'v4.1.0' }).state).toBe('v4.1.0');
    expect(previewOf('u', ref, { state: 'In Progress' }).state).toBe('In Progress');
    expect(previewOf('u', ref, { state: 'in_progress' }).state).toBe('In progress');
  });
});

describe('slugTitle', () => {
  it('turns slugs into words and drops ones with none', () => {
    expect(slugTitle('fix+the%20cart')).toBe('Fix the cart');
    expect(slugTitle('123-456')).toBeUndefined();
    expect(slugTitle(undefined)).toBeUndefined();
  });
});

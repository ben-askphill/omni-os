import { describe, expect, it } from 'vitest';
import { lastReply, offersPR, prOffered, type PRSummary } from '../thread-glance.ts';

const ev = (kind: string, payload: unknown) => ({ kind, payload: JSON.stringify(payload) });
const user = (text: string) => ev('user', { text });
const text = (t: string) => ev('assistant_text', { text: t });
const tool = () => ev('tool_use', { id: 'a', name: 'Bash', input: {} });
const result = () => ev('result', { ok: true });
const pr: PRSummary = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: null, checks: { passed: 1, failed: 0, pending: 0 } };

describe('offersPR', () => {
  it.each([
    'Tests pass. Want me to open a PR?',
    'Done.\n\nShould I commit, push and open a pull request?',
    'Shall I raise a PR for this change?',
    'Ready when you are. Do you want me to create the PR now, or keep iterating?',
  ])('reads %j as an offer', (reply) => expect(offersPR(reply)).toBe(true));

  it.each([
    'Opened the PR: https://github.com/o/r/pull/1',
    'Want me to open a PR?\n\nActually I went ahead and fixed the lint too.',
    'Did the PR checks pass on CI?',
    'Should I also update the docs?',
    '',
    null,
  ])('does not read %j as an offer', (reply) => expect(offersPR(reply)).toBe(false));
});

describe('lastReply', () => {
  it('joins the text after the last tool call, past the result', () => {
    expect(lastReply([user('fix it'), tool(), text('Fixed. '), text('Open a PR?'), result()])).toBe('Fixed. Open a PR?');
  });

  it('is null when Ben spoke last or the turn ended on a tool call', () => {
    expect(lastReply([text('Open a PR?'), result(), user('no, keep going')])).toBeNull();
    expect(lastReply([text('Open a PR?'), tool()])).toBeNull();
  });
});

describe('prOffered', () => {
  const asked = [user('fix it'), tool(), text('All green. Want me to open a PR?'), result()];

  it('offers Open PR once the idle branch is known to have no PR', () => {
    expect(prOffered(asked, true, null)).toBe(true);
  });

  it('stays hidden while running, while the PR is unknown, or when a PR exists', () => {
    expect(prOffered(asked, false, null)).toBe(false);
    expect(prOffered(asked, true, undefined)).toBe(false);
    expect(prOffered(asked, true, pr)).toBe(false);
  });
});

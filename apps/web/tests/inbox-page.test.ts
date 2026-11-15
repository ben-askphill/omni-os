import { describe, expect, it } from 'vitest';
import { href, pageTitle, parseHash } from '../src/router.ts';
import { inboxSummary } from '../src/pages/Inbox.tsx';

describe('the Inbox and Overview pages', () => {
  it('give the Inbox an address of its own and leave #/ to Overview', () => {
    expect(parseHash(href.inbox())).toEqual({ name: 'inbox' });
    expect(parseHash(href.home())).toEqual({ name: 'home' });
    expect(pageTitle(parseHash('#/inbox'), () => undefined)).toBe('Inbox');
    expect(pageTitle(parseHash('#/'), () => undefined)).toBe('Overview');
  });

  it('sums up the shelves under the title, and says when nothing waits', () => {
    expect(inboxSummary({ needs: 2, finished: 3, working: 1 })).toBe('2 need you · 3 finished · 1 working');
    expect(inboxSummary({ needs: 1, finished: 0, working: 0 })).toBe('1 needs you');
    expect(inboxSummary({ needs: 0, finished: 0, working: 0 })).toBe('Nothing is waiting on you.');
  });
});

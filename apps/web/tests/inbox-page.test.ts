import { describe, expect, it } from 'vitest';
import { href, pageTitle, parseHash } from '../src/router.ts';

describe('the Inbox and Overview pages', () => {
  it('give the Inbox an address of its own and leave #/ to Overview', () => {
    expect(parseHash(href.inbox())).toEqual({ name: 'inbox' });
    expect(parseHash(href.home())).toEqual({ name: 'home' });
    expect(pageTitle(parseHash('#/inbox'), () => undefined)).toBe('Inbox');
    expect(pageTitle(parseHash('#/'), () => undefined)).toBe('Overview');
  });
});

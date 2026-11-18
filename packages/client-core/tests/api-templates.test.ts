import { describe, expect, it } from 'vitest';
import { api, at } from './api-helpers.ts';

describe('templates', () => {
  it('reads the templates the New box offers', async () => {
    const list = { templates: [{ id: 'client-qa', name: 'Client question', description: 'Answer with sources', kind: 'quick', pack: 'core', body: 'Answer: $ARGUMENTS' }], shopify: false, hidden: 2 };
    const call = api({ json: list });
    expect(await call.api.templates()).toEqual(list);
    expect(call.sent).toEqual([{ method: 'GET', url: at('/templates') }]);
  });
});

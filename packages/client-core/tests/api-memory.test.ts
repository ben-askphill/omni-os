import { describe, expect, it } from 'vitest';
import { api, at } from './api-helpers.ts';

describe('channel learnings', () => {
  it('lists, adds, approves, edits and removes', async () => {
    const call = api({ json: {} });
    await call.api.learnings('acme');
    await call.api.addLearning('acme', 'Quote prices without VAT.');
    await call.api.updateLearning('m1', { approve: true });
    await call.api.updateLearning('m1', { text: 'Quote prices with VAT.' });
    await call.api.removeLearning('m1');
    expect(call.sent).toEqual([
      { method: 'GET', url: at('/memory?channel=acme') },
      { method: 'POST', url: at('/memory'), body: { channel: 'acme', text: 'Quote prices without VAT.' } },
      { method: 'PATCH', url: at('/memory/m1'), body: { approve: true } },
      { method: 'PATCH', url: at('/memory/m1'), body: { text: 'Quote prices with VAT.' } },
      { method: 'DELETE', url: at('/memory/m1') },
    ]);
  });
});

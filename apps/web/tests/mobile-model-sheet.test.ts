import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HarnessWithRunning } from '../src/api.ts';
import { ModelSheet, runLabel } from '../src/mobile/ModelSheet.tsx';
import { AUTO_CHOICE } from '@omni/shared/thread-run.ts';

const harnesses = [{
  id: 'cursor', name: 'Cursor Agent', available: true, models: [
    { id: 'auto', label: 'Cursor Auto', efforts: ['high'], defaultEffort: 'high', default: true },
  ],
}] as HarnessWithRunning[];

describe('phone Auto picker', () => {
  it('names Omni Auto without inventing a harness name or effort, and keeps Cursor Auto distinct', () => {
    expect(runLabel(harnesses, AUTO_CHOICE, 'high')).toBe('Auto');
    expect(runLabel(harnesses, { harness: 'cursor', model: 'auto' }, '')).toBe('Cursor Auto · high');
  });

  it('offers Omni Auto alongside harness models and hides effort while Auto is selected', () => {
    const html = renderToStaticMarkup(createElement(ModelSheet, {
      harnesses, choice: AUTO_CHOICE, effort: '', onChange: () => {}, onClose: () => {},
    }));
    expect(html).toContain('Picks the model and effort for your task');
    expect(html).toContain('Cursor Auto');
    expect(html).not.toContain('Effort for');
  });
});

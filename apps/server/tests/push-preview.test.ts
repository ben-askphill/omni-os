import { describe, expect, it } from 'vitest';
import { clip, plainText, PREVIEW_MAX, pushPreview } from '../push-preview.ts';

describe('the preview of a reply', () => {
  it('drops markdown marks and keeps the words', () => {
    expect(
      pushPreview('## Done\n\nShipped **PR #612**: the alert now shows _a preview_ of the `last` reply. See [the PR](https://github.com/x/y/pull/612).'),
    ).toBe('Done Shipped PR #612: the alert now shows a preview of the last reply. See the PR.');
  });

  it('keeps list items, quotes and table cells as text on one line', () => {
    expect(plainText('- **Clients**: web\n- [x] phone\n1. desktop\n> quoted\n\n| Surface | State |\n|---|:--:|\n| iOS | done |')).toBe(
      'Clients: web phone desktop quoted Surface · State iOS · done',
    );
  });

  it('leaves code blocks, rules and HTML tags out', () => {
    expect(plainText('Before\n```ts\nconst secret = 1;\n```\n---\n<details><summary>More</summary>after</details>')).toBe('Before Moreafter');
  });

  it('collapses newlines and runs of spaces', () => {
    expect(pushPreview('one\n\n\ntwo\t  three\r\nfour')).toBe('one two three four');
  });

  it('leaves arithmetic and snake_case words alone', () => {
    expect(plainText('2 * 3 * 4 is 24 in my_var_name')).toBe('2 * 3 * 4 is 24 in my_var_name');
  });

  it('clips a long reply at a word and closes it with an ellipsis', () => {
    const preview = pushPreview(`${'word '.repeat(60)}end`)!;
    expect(Array.from(preview).length).toBeLessThanOrEqual(PREVIEW_MAX);
    expect(preview.endsWith('word…')).toBe(true);
  });

  it('cuts a long word mid-word rather than leaving too little', () => {
    expect(clip('a'.repeat(200), 10)).toBe(`${'a'.repeat(9)}…`);
  });

  it('never cuts an emoji in half', () => {
    expect(clip('🎉'.repeat(20), 5)).toBe('🎉🎉🎉🎉…');
  });

  it('leaves text that fits as it is', () => {
    expect(clip('Short reply.', 150)).toBe('Short reply.');
  });

  it('is null when nothing readable is left', () => {
    expect(pushPreview(null)).toBeNull();
    expect(pushPreview('')).toBeNull();
    expect(pushPreview('  \n\n ')).toBeNull();
    expect(pushPreview('```sh\nnpm test\n```')).toBeNull();
  });
});

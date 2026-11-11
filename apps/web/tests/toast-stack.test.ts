import { describe, expect, it } from 'vitest';
import { pushToast, VISIBLE_TOASTS, type ToastItem } from '../src/components/Toaster.tsx';

const toast = (id: number): ToastItem => ({ id, title: `t${id}` });

describe('the toast stack', () => {
  it('shows the newest three and counts the ones that left', () => {
    let s = { items: [] as ToastItem[], more: 0 };
    for (let id = 1; id <= 5; id++) s = pushToast(s, toast(id));
    expect(VISIBLE_TOASTS).toBe(3);
    expect(s.items.map((t) => t.id)).toEqual([3, 4, 5]);
    expect(s.more).toBe(2);
  });

  it('counts nothing while the stack has room', () => {
    const s = pushToast(pushToast({ items: [], more: 0 }, toast(1)), toast(2));
    expect(s).toMatchObject({ items: [{ id: 1 }, { id: 2 }], more: 0 });
  });
});

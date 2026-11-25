import { createChange, createReorder, definePrimitive, type ChangeDetails, type ReorderDraft, type ReorderReason } from '@ui-sdk/core';

// A list whose items are reordered by dragging a handle, or from the keyboard on that handle: Space or Enter picks the
// item up, the arrows, Home and End move it, Space or Enter drops it and Escape puts it back. Items keep their own
// controls (a switch), so the handlers sit on the handle, not the item, as ui-sdk's reorder guide says for nested
// controls.

export type SortableListOptions = {
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[], details: ChangeDetails<ReorderReason>) => void;
  /** What a screen reader calls an item when it is picked up and moved. */
  itemLabel?: (key: string) => string | undefined;
};

export const sortableList = definePrimitive({
  name: 'sortable-list',
  options: { value: 'list', defaultValue: 'list', onValueChange: 'callback', itemLabel: 'value' },
  controlled: ['value'],
  state: (options: SortableListOptions) => ({
    value: options.value ?? options.defaultValue ?? [],
    moving: null as ReorderDraft | null,
  }),
  sync: (options) => (options.value === undefined ? {} : { value: options.value }),
  api: (context) => {
    const change = createChange(context);
    const reorder = createReorder(context, {
      slot: 'item',
      key: 'value',
      draft: 'moving',
      set: (value, details) => change('value', value, details),
      label: (key) => context.options().itemLabel?.(key),
    });
    return { reorder, move: (key: string, index: number) => reorder.move(key, index) };
  },
  slots: (slot) => ({
    root: slot<object, { order: string[] }>({
      role: 'list',
      state: (state, part) => ({ order: part.api.reorder.order(state) }),
      attrs: (state) => ({ 'data-moving': state.moving ? '' : undefined }),
    }),
    item: slot<{ value: string }, { grabbed: boolean }>({
      role: 'listitem',
      props: { value: 'string' },
      state: (state, part) => ({ grabbed: part.api.reorder.moving(state, part.key) }),
      attrs: (state, part) => ({
        'data-grabbed': part.api.reorder.moving(state, part.key) ? '' : undefined,
        'data-dragging': part.api.reorder.dragging(state, part.key) ? '' : undefined,
      }),
      bind: (el, part) => part.api.reorder.bind(el, part),
    }),
    handle: slot<{ value: string }>({
      role: 'button',
      focus: 'native',
      press: { none: 'Space and Enter pick the item up in keydown, and a pointer drags it.' },
      props: { value: { kind: 'string', from: 'item', required: true } },
      attrs: (state, part) => ({ type: 'button', 'aria-pressed': String(part.api.reorder.moving(state, part.key)) }),
      on: {
        keydown: (event, { api, key }) => void api.reorder.keydown(event as KeyboardEvent, key),
        pointerdown: (event, { api, key }) => api.reorder.pointerdown(event as PointerEvent, key),
      },
    }),
  }),
  agent: { actions: ['move'] },
});

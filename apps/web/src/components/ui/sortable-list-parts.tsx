import { createParts } from '@ui-sdk/react/primitive';
import { sortableList } from './sortable-list.ts';

export const { Root: SortableList, Item: SortableItem, Handle: SortableHandle } = createParts(sortableList, { root: 'ul', item: 'li', handle: 'button' });

import type { ReactNode } from 'react';

/**
 * Open threads / artifacts along the top of the main pane. The latest `visible` render as pill tabs on a sliding
 * soft thumb; older ones collapse into a surface-2 pill of 3px leaves (colored only by status) that grow on hover
 * and fan into a popover card list.
 * @startingPoint section="Navigation" subtitle="Pill tabs that stack overflow into leaves" viewport="900x300"
 */
export interface StackTab {
  id: string;
  title: string;
  kind?: 'thread' | 'artifact' | 'panel';
  taskId?: string;
  state?: 'idle' | 'settled' | 'running' | 'needs' | 'done';
}
export interface TabStackProps {
  tabs?: StackTab[];
  activeId?: string;
  visible?: number;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
  children?: ReactNode;
}
export function TabStack(props: TabStackProps): JSX.Element;

import type { ReactNode } from 'react';

/**
 * Round letter avatar for channels and roles (web/src Avatar), SF Pro Rounded, neutral surface — no per-channel hue.
 * Pass `code` for two letters or `name` for the first letter; `icon` for Conductor (target) etc.
 */
export interface MonogramProps {
  code?: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | number;
  selected?: boolean;
  icon?: string;
  title?: string;
}
export function Monogram(props: MonogramProps): JSX.Element;

/** Task id in SF Mono, e.g. T-4F2A. */
export interface TaskIdProps {
  id: string;
  onClick?: () => void;
  href?: string;
}
export function TaskId(props: TaskIdProps): JSX.Element;

/** 20px pill chip (web/src Chip). tone: default · outline · ink · needs · done · live. */
export interface ChipProps {
  children: ReactNode;
  tone?: 'default' | 'outline' | 'ink' | 'needs' | 'done' | 'live';
  title?: string;
  className?: string;
}
export function Chip(props: ChipProps): JSX.Element;

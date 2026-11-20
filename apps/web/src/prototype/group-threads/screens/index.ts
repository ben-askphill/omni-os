// PROTOTYPE, throwaway: the screens, in the order of the brief.
import { groupThread } from './s1-group-thread.tsx';
import { mention } from './s2-mention.tsx';
import { members } from './s3-members.tsx';
import { parallel } from './s4-parallel.tsx';
import { listMark } from './s5-list-mark.tsx';
import { remoteLead } from './s6-remote-lead.tsx';
import { settings } from './s7-settings.tsx';
import type { Screen } from './types.ts';

export const SCREENS: Screen[] = [groupThread, mention, members, parallel, listMark, remoteLead, settings];

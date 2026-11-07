import { RETENTION_DAYS, type RetentionPolicy } from '@omni/shared/worktree-cleanup.ts';

/** The idle days the picker offers, as the Web UI's Worktrees section does, with the saved value added when it is another. */
const DAY_CHOICES = [3, 7, 14, 30, 60, 90];

export function dayChoices(policy: RetentionPolicy): number[] {
  const days = DAY_CHOICES.includes(policy.idleDays) ? DAY_CHOICES : [...DAY_CHOICES, policy.idleDays].sort((a, b) => a - b);
  return days.filter((d) => d >= RETENTION_DAYS.min && d <= RETENTION_DAYS.max);
}

export const daysLabel = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

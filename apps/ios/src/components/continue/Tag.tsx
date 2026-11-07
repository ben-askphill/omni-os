import { Chip } from '../../ui/Chip';

/** A word beside a row: a file's change, a check's result, "Shortened", "Too big". A pass or fail reads in bold ink. */
export function Tag({ label, tone }: { label: string; tone?: 'pass' | 'fail' }) {
  return <Chip label={label} strong={tone !== undefined} />;
}

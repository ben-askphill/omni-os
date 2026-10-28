import type { Device } from '../api.ts';
import { deviceHint } from '../device.ts';
import { Chip, Icon } from './ui.tsx';

/** The Mac this Omni runs on, with a Remote chip when this browser is not at it. */
export function DeviceLabel({ device, className = '' }: { device: Device; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle ${className}`} title={deviceHint(device)}>
      <Icon name="monitor" size={13} className="shrink-0 text-fg-4" />
      <span className="min-w-0 truncate">{device.name}</span>
      {!device.here && <Chip tone="live">Remote</Chip>}
    </span>
  );
}

export type PermissionState = 'undetermined' | 'denied' | 'granted';

/** expo-notifications' status, narrowed to the three states the app acts on. Provisional and ephemeral count as granted. */
export function permissionOf(status: { status: string; granted: boolean }): PermissionState {
  if (status.granted) return 'granted';
  return status.status === 'undetermined' ? 'undetermined' : 'denied';
}

/**
 * The explanation sheet that comes before iOS's own prompt appears once: when the phone first has a paired server and
 * iOS has not been asked. After that, Settings is where the person turns notifications on. Asking out of the blue, or
 * on every launch, would burn the one system prompt iOS allows.
 */
export function shouldShowPrimer(input: { permission: PermissionState | null; pairedServers: number; seen: boolean | null }): boolean {
  return input.permission === 'undetermined' && input.pairedServers > 0 && input.seen === false;
}

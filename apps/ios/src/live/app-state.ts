/**
 * What an AppState change means for the hub: true for the foreground, false for the background, null to leave it be.
 * `inactive` is a pause in the foreground (Control Center, Notification Center, the app switcher, a call banner, Face
 * ID): the app keeps running and its streams stay open. Treating it as the background closed every stream and, on
 * the way back, refetched every list just as Ben tapped a thread.
 */
export function foregroundOf(state: string): boolean | null {
  if (state === 'active') return true;
  if (state === 'background') return false;
  return null;
}

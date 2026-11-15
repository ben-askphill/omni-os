import { useEffect } from 'react';

import { useLiveHub } from '../live/react';
import { useNotifications } from './NotificationsProvider';

/**
 * Needs you changes when a result is read or a question answered, here or on another device: each change asks the
 * servers which alerts are settled, and clears them. Renders nothing. Sits inside the live provider.
 */
export function SettledAlerts() {
  const { needsYou } = useLiveHub();
  const { clearer } = useNotifications();
  useEffect(() => needsYou.subscribe(() => void clearer.sweep()), [needsYou, clearer]);
  return null;
}

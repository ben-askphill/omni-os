import { useEffect, useState } from 'react';

import { deliveryNote } from './delivery';
import type { PushServer } from './registration';
import { useNotifications } from './NotificationsProvider';

/** The note a server's section shows when that server cannot send alerts. Null until its capabilities load, and if they fail. */
export function usePushDeliveryNote(server: PushServer): string | null {
  const { api } = useNotifications();
  const [note, setNote] = useState<string | null>(null);
  const { id, origin } = server;

  useEffect(() => {
    let cancelled = false;
    api.capabilities({ id, origin }).then(
      (capabilities) => !cancelled && setNote(deliveryNote(capabilities.push)),
      () => !cancelled && setNote(null),
    );
    return () => {
      cancelled = true;
    };
  }, [api, id, origin]);

  return note;
}

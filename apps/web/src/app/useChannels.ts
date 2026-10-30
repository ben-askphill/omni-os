import { useCallback, useState } from 'react';
import { api, errorText, type ChannelWithRunning, type Thread, type ThreadStub } from '../api.ts';
import { withPin, type PinnedThread } from '../pins.ts';

/** The channel list and the sidebar's pinned threads, which reload together. */
export function useChannels() {
  const [channels, setChannels] = useState<ChannelWithRunning[]>([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [pinned, setPinnedList] = useState<PinnedThread[]>([]);

  const reloadPinned = useCallback(
    () =>
      api
        .get<PinnedThread[]>('/pinned')
        .then(setPinnedList)
        .catch(() => {}),
    [],
  );

  const reloadChannels = useCallback(async () => {
    // Pins name threads in any channel, so they change whenever the channels' threads do.
    const pins = reloadPinned();
    try {
      const list = await api.get<ChannelWithRunning[]>('/channels');
      setChannels(list);
      setChannelsError(null);
    } catch (e) {
      setChannelsError(errorText(e));
    } finally {
      setChannelsLoaded(true);
    }
    await pins;
  }, [reloadPinned]);

  const setPinned = useCallback(
    async (t: ThreadStub, on: boolean) => {
      setPinnedList((prev) => withPin(prev, t, on));
      try {
        return await api.patch<Thread>(`/threads/${encodeURIComponent(t.id)}`, { pinned: on });
      } finally {
        // Refused or not, the server's list is the truth.
        void reloadPinned();
      }
    },
    [reloadPinned],
  );

  return { channels, setChannels, channelsLoaded, channelsError, pinned, reloadChannels, setPinned };
}

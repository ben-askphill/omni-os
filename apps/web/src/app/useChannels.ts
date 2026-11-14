import { useCallback, useRef, useState, type SetStateAction } from 'react';
import { latestOnly } from '@omni/shared/latest.ts';
import { api, errorText, type ChannelWithRunning, type Thread, type ThreadStub } from '../api.ts';
import { withPin, type PinnedThread } from '../pins.ts';

/**
 * The channel list and the sidebar's pinned threads, which reload together. A reload that started before a local edit
 * (a folder rename, collapse or pin) or before a newer reload is dropped, so it cannot put the old list back.
 */
export function useChannels() {
  const [channels, setChannelsState] = useState<ChannelWithRunning[]>([]);
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [pinned, setPinnedList] = useState<PinnedThread[]>([]);
  const channelReads = useRef(latestOnly()).current;
  const pinReads = useRef(latestOnly()).current;

  /** A local edit to the channel list: reloads already in flight are stale. */
  const setChannels = useCallback(
    (next: SetStateAction<ChannelWithRunning[]>) => {
      channelReads.edit();
      setChannelsState(next);
    },
    [channelReads],
  );

  const reloadPinned = useCallback(() => {
    const token = pinReads.begin();
    return api
      .get<PinnedThread[]>('/pinned')
      .then((list) => void (pinReads.holds(token) && setPinnedList(list)))
      .catch(() => {});
  }, [pinReads]);

  const reloadChannels = useCallback(async () => {
    // Pins name threads in any channel, so they change whenever the channels' threads do.
    const pins = reloadPinned();
    const token = channelReads.begin();
    try {
      const list = await api.get<ChannelWithRunning[]>('/channels');
      if (channelReads.holds(token)) {
        setChannelsState(list);
        setChannelsError(null);
        setChannelsLoaded(true);
      }
    } catch (e) {
      if (channelReads.holds(token)) {
        setChannelsError(errorText(e));
        setChannelsLoaded(true);
      }
    }
    await pins;
  }, [reloadPinned, channelReads]);

  const setPinned = useCallback(
    async (t: ThreadStub, on: boolean) => {
      pinReads.edit();
      setPinnedList((prev) => withPin(prev, t, on));
      try {
        return await api.patch<Thread>(`/threads/${encodeURIComponent(t.id)}`, { pinned: on });
      } finally {
        // Refused or not, the server's list is the truth.
        void reloadPinned();
      }
    },
    [reloadPinned, pinReads],
  );

  return { channels, setChannels, channelsLoaded, channelsError, pinned, reloadChannels, setPinned };
}

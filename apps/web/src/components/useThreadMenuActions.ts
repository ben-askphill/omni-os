import { useRef, useState } from 'react';
import { api, errorText, type Thread } from '../api.ts';
import { sendThreadToGrokBot } from '../grokbot.ts';
import { navigate, href, useRoute } from '../router.ts';
import { useApp } from '../store.tsx';
import { handOff } from './thread/Handoff.tsx';
import { useToast } from './Toaster.tsx';

/** What the thread menu's items do. Each closes the menu when it works and leaves its message in `error` when it does not. */
export function useThreadMenuActions({ id, row, archived, current, onClose }: { id: string; row: Thread | null; archived: boolean | null; current: string | null; onClose: () => void }) {
  const { reloadChannels, setPinned, setDone } = useApp();
  const route = useRoute();
  const toast = useToast();
  const [error, setError] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const sendingGrok = useRef(false);

  const toggleArchive = async () => {
    const next = !archived;
    try {
      const t = await api.patch<Thread>(`/threads/${encodeURIComponent(id)}`, { archived: next });
      await reloadChannels();
      // Archiving the thread you are reading leaves its channel's list.
      if (next && route.name === 'thread' && route.id === id) navigate(href.channel(t.channel_id));
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const rename = async (draft: string | null) => {
    const next = (draft ?? '').replace(/\s+/g, ' ').trim();
    if (!next || next === current) return onClose();
    try {
      await api.patch<Thread>(`/threads/${encodeURIComponent(id)}`, { title: next });
      await reloadChannels();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const togglePin = async () => {
    if (!row) return;
    try {
      await setPinned(row, !row.pinned_at);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggleDone = async () => {
    if (!row) return;
    try {
      await setDone(row.id, !row.done_at);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const sendGrok = async () => {
    if (sendingGrok.current) return;
    sendingGrok.current = true;
    setError('');
    const result = await sendThreadToGrokBot(id);
    sendingGrok.current = false;
    if (result.ok) {
      toast({ title: 'Sent to Grok Bot', icon: 'external' });
      onClose();
      return;
    }
    setError(result.error);
  };

  const sendTo = async (to: string) => {
    if (!row) return;
    setSending(to);
    setError('');
    try {
      await handOff(row.id, to);
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSending(null);
    }
  };

  return { error, sending, toggleArchive, rename, togglePin, toggleDone, sendGrok, sendTo };
}

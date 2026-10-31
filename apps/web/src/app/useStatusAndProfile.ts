import { useCallback, useState } from 'react';
import { api, type HarnessUsage, type Profile, type Status } from '../api.ts';
import { secretStoreKind, type SecretStoreKind } from '@omni/shared/secret-store.ts';

/** GET /api/status (running counts, limits, usage) and the profile it carries, plus the onboarding wizard's open state. */
export function useStatusAndProfile() {
  const [usage, setUsage] = useState<HarnessUsage>({});
  const [status, setStatus] = useState<(Omit<Status, 'usage' | 'server'> & { secretStore: SecretStoreKind }) | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [setupWanted, setSetupWanted] = useState(false);

  const reloadStatus = useCallback(async () => {
    try {
      const s = await api.get<Status>('/status');
      setStatus({ running: s.running, queued: s.queued, maxConcurrent: s.maxConcurrent, maxUploadMb: s.maxUploadMb, slots: s.slots ?? {}, device: s.device, grokBot: !!s.grokBot, secretStore: secretStoreKind(s.server?.secretStore) });
      setProfile(s.profile ?? { name: '' });
      if (s.usage) setUsage((prev) => ({ ...prev, ...s.usage }));
    } catch {
      /* the channel list already surfaces connection errors */
    }
  }, []);

  const saveProfile = useCallback(async (p: Partial<Profile>) => {
    const saved = await api.put<Profile>('/profile', p);
    setProfile(saved);
    return saved;
  }, []);
  const reloadProfile = useCallback(async () => {
    setProfile(await api.get<Profile>('/profile'));
  }, []);
  // An older server sends no `onboarded`: treat it as set up, as before.
  const setupOpen = setupWanted || (!!profile && profile.onboarded === false);
  const openSetup = useCallback(() => setSetupWanted(true), []);
  const closeSetup = useCallback(() => setSetupWanted(false), []);

  return { usage, setUsage, status, profile, setupOpen, openSetup, closeSetup, reloadStatus, saveProfile, reloadProfile };
}

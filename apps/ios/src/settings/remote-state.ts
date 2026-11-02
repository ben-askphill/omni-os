export type RemoteView = 'loading' | 'error' | 'empty' | 'list';

export interface RemoteSnapshot {
  data: readonly unknown[] | null;
  error: string | null;
  loading: boolean;
}

export function remoteView({ data, error, loading }: RemoteSnapshot): RemoteView {
  if (data) return data.length ? 'list' : 'empty';
  if (loading || !error) return 'loading';
  return 'error';
}

export function refreshNote({ data, error, loading }: RemoteSnapshot): string | null {
  return data && error && !loading ? 'Last refresh failed. Pull down to try again.' : null;
}

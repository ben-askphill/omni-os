import { OmniHttpError } from '@omni/client-core';

// A settings piece that an older server does not have: its GET answers 404, and the piece hides instead of showing an
// error. `useRemote` keeps `data` null while it loads and after a failure, so "the server has no such route" travels as
// its own value.

export type Optional<T> = { missing: true } | { missing: false; value: T };

export function isNotFound(error: unknown): boolean {
  return error instanceof OmniHttpError && error.failure.kind === 'http' && error.failure.status === 404;
}

/** Resolves a 404 to `{ missing: true }`; any other failure still rejects. */
export async function loadOptional<T>(load: Promise<T>): Promise<Optional<T>> {
  try {
    return { missing: false, value: await load };
  } catch (e) {
    if (isNotFound(e)) return { missing: true };
    throw e;
  }
}

export type OptionalView = 'hidden' | 'loading' | 'error' | 'ready';

/** What an optional piece shows: nothing on an older server, a spinner, the failure, or its content. */
export function optionalView<T>({ data, error, loading }: { data: Optional<T> | null; error: string | null; loading: boolean }): OptionalView {
  if (data) return data.missing ? 'hidden' : 'ready';
  if (loading || !error) return 'loading';
  return 'error';
}

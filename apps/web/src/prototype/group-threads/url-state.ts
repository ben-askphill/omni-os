// PROTOTYPE, throwaway: the prototype's state lives in the address (?s=1&v=B&tech=1), so every variant is a link.
import { useSyncExternalStore } from 'react';

const EVENT = 'proto-url';
const subscribe = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener('popstate', fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('popstate', fn);
  };
};
const read = () => location.search;

export function useParams() {
  const search = useSyncExternalStore(subscribe, read, read);
  return new URLSearchParams(search);
}

export function setParams(patch: Record<string, string | null>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  history.replaceState(history.state, '', `${location.pathname}?${q}${location.hash}`);
  window.dispatchEvent(new Event(EVENT));
}

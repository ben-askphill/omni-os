/** A load that runs one at a time: a call while one is out asks for one more pass after it, however many calls came. */
export function coalesced(load: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await load();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

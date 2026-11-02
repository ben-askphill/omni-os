/**
 * A load that runs one at a time. A call while one is out runs it once more after, however many calls came, so the
 * last state wins. Each call's promise settles once the pass that covers it has.
 */
export function serial(load: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await load();
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  };
}

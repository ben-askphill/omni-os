/**
 * Latest-only reads of one resource. Each read and each local edit bumps a generation; a read applies its result only
 * if nothing started or changed since it began. A slow reload that started before Ben renamed a folder then cannot put
 * the old name back, and an older read cannot land after a newer one.
 */
export interface Latest {
  /** A read starts: keep the token it returns and pass it to `holds` when the answer comes. */
  begin(): number;
  /** A local edit was applied: every read already in flight is stale. */
  edit(): void;
  /** Whether the read that got `token` may still apply its result. */
  holds(token: number): boolean;
}

export function latestOnly(): Latest {
  let generation = 0;
  return {
    begin: () => ++generation,
    edit: () => {
      generation++;
    },
    holds: (token) => token === generation,
  };
}

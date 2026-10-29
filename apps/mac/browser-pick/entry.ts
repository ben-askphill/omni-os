// The entry of the Mac app's page reader for the Web tab: the scripts that read the page for Annotate and the readers
// that make an element of their answers, the very packages/shared/ modules the server uses for the channel's Chrome.
// The app runs the scripts in its web view (an isolated content world) and the readers here, in JavaScriptCore, so both
// browsers give the same fields. Every call takes and returns JSON text.
// Build with `npm run build:pick`; the bundle is checked in (see docs/adr/0002-mac-app-is-a-client.md).
import { inspectScript, pickScript, type RawInspect, type RawPick } from '@omni/shared/browser-pick-script.ts';
import { inspectReply, pickReply } from '@omni/shared/browser-pick-read.ts';

type Point = { x: number; y: number };

const call =
  <A, R>(f: (a: A) => R) =>
  (json: string): string =>
    JSON.stringify(f(JSON.parse(json) as A) ?? null);

(globalThis as Record<string, unknown>).OmniPick = {
  inspectScript: call(({ x, y }: Point) => inspectScript(x, y)),
  pickScript: call(({ x, y }: Point) => pickScript(x, y)),
  inspectReply: call(({ raw }: { raw: RawInspect | null }) => inspectReply(raw)),
  pickReply: call(({ raw, point, viewport }: { raw: RawPick | null; point: Point; viewport: { width: number; height: number } }) => pickReply(raw, point, viewport)),
};

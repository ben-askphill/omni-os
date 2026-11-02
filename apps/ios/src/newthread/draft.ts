import type { ChannelWithRunning, CreateThreadRequest, CrewRole, HarnessInfo, Thread } from '@omni/client-core';
import { draftRun, draftRunRequest, type DraftRun } from '@omni/shared/draft-run.ts';
import type { Device } from '@omni/shared/handoff.ts';
import { HERE, runOnRequest, runOnRows, type RunOnRow } from '@omni/shared/thread-machine.ts';
import { AUTO_CHOICE, asksAuto } from '@omni/shared/thread-run.ts';

import { filesKey, type Staged } from '../attachments/model';
import { classifyFailure, type SendFailure } from '../send/outbox';
import { runChipLabel, runSheetModel, type RunSheetModel, type RunThread } from '../thread/run-model';

export const CONDUCTOR = 'conductor';

export interface Target {
  id: string;
  name: string;
}

export function targetsOf(channels: readonly ChannelWithRunning[] | null): Target[] {
  const live = (channels ?? []).filter((c) => !c.archived && c.id !== CONDUCTOR);
  return [{ id: CONDUCTOR, name: 'Conductor' }, ...live.map((c) => ({ id: c.id, name: c.name }))];
}

/** The Conductor's threads run as its crew role. Another channel's start with none. */
export function roleOf(target: string, crew: readonly CrewRole[]): CrewRole | undefined {
  return target === CONDUCTOR ? crew.find((r) => r.id === CONDUCTOR) : undefined;
}

/** Where the new thread runs. `pick` is null until one is made, and then the server's default (Settings on the computer) applies. */
export interface RunOnInputs {
  pick: string | null;
  /** The other synced machines, or null with none (no Run on then). */
  devices: Device[] | null;
}

/**
 * The request's `device`: only for a machine the list still has, and only once one was picked, so a phone that cannot
 * read Settings never overrides its default. This machine is always listed.
 */
export function runOnBody({ pick, devices }: RunOnInputs): { device?: string } {
  if (!pick || !devices?.length) return {};
  return pick === HERE || devices.some((d) => d.id === pick) ? runOnRequest(pick, devices) : {};
}

/** The machine list for the picker, this machine first under its own name. */
export const runOnList = (devices: Device[], hereName: string | null): RunOnRow[] => runOnRows(devices, { hereName });

/** A pick belongs to the target it was made for. */
export interface DraftInputs {
  target: string;
  text: string;
  /** Null until a model or effort is picked: the run then follows the role's and the channel's defaults. */
  picked: DraftRun | null;
  channels: readonly ChannelWithRunning[];
  crew: readonly CrewRole[];
  /** Null until `/harnesses` loads. */
  harnesses: readonly HarnessInfo[] | null;
  runOn?: RunOnInputs;
}

export function shownDraftRun({ target, picked, channels, crew, harnesses }: DraftInputs): DraftRun | null {
  if (!harnesses) return null;
  return draftRun(picked, roleOf(target, crew), channels.find((c) => c.id === target), [...harnesses]);
}

/** Only a deliberate pick goes in the run. */
export function createRequest(inputs: DraftInputs): Omit<CreateThreadRequest, 'id'> | null {
  const prompt = inputs.text.trim();
  if (!prompt) return null;
  const shown = shownDraftRun(inputs);
  return {
    channel: inputs.target,
    prompt,
    role: roleOf(inputs.target, inputs.crew)?.id,
    ...draftRunRequest(inputs.picked ? (shown ?? inputs.picked) : null),
    ...(inputs.runOn ? runOnBody(inputs.runOn) : {}),
  };
}

export type DraftPick = 'auto' | { harness: string; model: string } | { effort: string };

/** Another model starts at its default effort, as in the thread's own switch. */
export function applyPick(shown: DraftRun, pick: DraftPick): DraftRun {
  if (pick === 'auto') return { choice: AUTO_CHOICE, effort: '' };
  if ('effort' in pick) return { choice: shown.choice, effort: pick.effort };
  const same = pick.harness === shown.choice.harness && pick.model === shown.choice.model;
  return same ? shown : { choice: pick, effort: '' };
}

const asThread = (run: DraftRun): RunThread => ({
  harness: run.choice.harness,
  model: run.choice.model,
  effort: run.effort,
  auto_reason: null,
  queued_harness: null,
  queued_model: null,
  queued_effort: null,
});

export function draftChipLabel(run: DraftRun, harnesses: readonly HarnessInfo[]): string | null {
  return asksAuto(run.choice) ? 'Auto' : runChipLabel(asThread(run), [...harnesses]);
}

export interface DraftSheetModel extends RunSheetModel {
  auto: boolean;
}

export function draftSheetModel(run: DraftRun, harnesses: readonly HarnessInfo[]): DraftSheetModel {
  const auto = asksAuto(run.choice);
  const rows = runSheetModel(asThread(run), [...harnesses]);
  if (!auto) return { ...rows, auto };
  return { auto, effortTitle: null, efforts: [], harnesses: rows.harnesses.map((h) => ({ ...h, models: h.models.map((m) => ({ ...m, selected: false })) })) };
}

export interface Attempt {
  key: string;
  id: string;
}

/**
 * The id to send. The same request keeps its id across tries, so a reply lost on the way cannot leave two threads. Any change
 * to the request (the text, the channel, the model, the files) is a different thread and takes a new id.
 */
export function attemptFor(prev: Attempt | null, request: Omit<CreateThreadRequest, 'id'>, newId: () => string, files: readonly Staged[] = []): Attempt {
  const key = JSON.stringify([request, filesKey(files)]);
  return prev?.key === key ? prev : { key, id: newId() };
}

/** A version 4 uuid, which is what the server takes as a thread id. */
export function newThreadId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return uuidV4(bytes);
}

export function uuidV4(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface CreateFailure {
  kind: SendFailure['kind'];
  message: string;
}

export type CreateOutcome = { kind: 'created'; thread: Thread } | { kind: 'failed'; failure: CreateFailure };

const ONCE = 'A second try will not start a second thread.';
const OFFLINE = `Cannot reach the server. Try again when you are connected. ${ONCE}`;
const SIGNED_OUT = 'The server no longer accepts this phone, so the thread was not started.';
const CANCELLED = 'Upload cancelled, so the thread was not started. Try again, or remove a file.';

/** A failure that may have reached the server says a retry is safe, because the request keeps its id. */
export function createFailure(error: unknown): CreateFailure {
  const f = classifyFailure(error);
  if (f.kind === 'offline') return { kind: f.kind, message: OFFLINE };
  if (f.kind === 'signed-out') return { kind: f.kind, message: SIGNED_OUT };
  if (f.kind === 'cancelled') return { kind: f.kind, message: CANCELLED };
  return { kind: f.kind, message: f.ambiguous ? `${f.message} ${ONCE}` : f.message };
}

/** Never rejects: a failure comes back as an outcome. */
export async function startThread(create: (body: CreateThreadRequest) => Promise<Thread>, body: CreateThreadRequest): Promise<CreateOutcome> {
  try {
    return { kind: 'created', thread: await create(body) };
  } catch (e) {
    return { kind: 'failed', failure: createFailure(e) };
  }
}

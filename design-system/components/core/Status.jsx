import React from 'react';

/* One status vocabulary for every thread state (Mark in packages/shared/status.ts, StatusDot in
   apps/web/src/components/ui/status.tsx, PR #755). Shape says who has the ball: a circle the agent, a square a system
   outside Omni (checks, a usage limit), a diamond Ben, a cross or a triangle that it broke. Colour repeats it:
   ultramarine, amber, vermilion, red, then volt for done and grey where nothing happens. Fill says how far along:
   hollow, half, filled. A satellite dot says the state belongs to a thread under this one. Two motions only: a halo
   leaves the mark while the agent's own turn works (ping), and it breathes while it waits on other work. Nothing
   spins; reduced motion stops both, and the shapes still tell every state apart. */
const h = React.createElement;
export const MARK = {
  queued: { label: 'Queued', hint: 'It waits for a free slot', family: 'quiet', glyph: 'queued', motion: 'still', look: 'Grey dashed ring' },
  starting: { label: 'Starting', hint: 'Its folder is being prepared, or the agent has not picked the message up yet', family: 'agent', glyph: 'running', motion: 'ping', look: 'Half-filled blue circle, halo' },
  working: { label: 'Running', hint: 'Its own turn runs', family: 'agent', glyph: 'running', motion: 'ping', look: 'Filled blue disc, halo' },
  tool: { label: 'Running a tool', hint: 'A tool call in its turn has not returned yet', family: 'agent', glyph: 'running', motion: 'ping', look: 'Blue dot inside a thin ring, halo' },
  delegating: { label: 'Waiting on crew', hint: 'Its own turn ended; threads or sub-agents it delegated still work', family: 'agent', glyph: 'running', motion: 'breathe', look: 'Blue disc with a satellite, breathes' },
  checking: { label: 'Checks running', hint: 'Checks on its pull request have not finished', family: 'system', glyph: 'running', motion: 'breathe', look: 'Filled amber square, breathes' },
  resuming: { label: 'Resumes at reset', hint: 'It hit the usage limit and continues by itself when the limit resets', family: 'system', glyph: 'limited', motion: 'breathe', look: 'Half-filled amber square, breathes' },
  limited: { label: 'Usage limit', hint: "Its harness stopped the turn at the plan's usage limit", family: 'system', glyph: 'limited', motion: 'still', look: 'Hollow amber square' },
  question: { label: 'Waiting on you', hint: 'Its agent asked you a question and waits', family: 'you', glyph: 'needs', motion: 'still', look: 'Filled vermilion diamond' },
  crew_question: { label: 'Crew waits on you', hint: 'A thread under this one asked you a question and waits', family: 'you', glyph: 'needs', motion: 'still', look: 'Vermilion diamond with a satellite' },
  review: { label: 'Ready for review', hint: 'It finished and its pull request is open', family: 'you', glyph: 'done', motion: 'still', look: 'Half-filled vermilion diamond' },
  held: { label: 'Message held', hint: 'A restart kept a message back: it is sent when you say so', family: 'you', glyph: 'needs', motion: 'still', look: 'Hollow vermilion diamond' },
  failed: { label: 'Failed', hint: 'Its turn ended in an error', family: 'broken', glyph: 'failed', motion: 'still', look: 'Red cross' },
  crew_failed: { label: 'Crew failed', hint: 'A thread under this one failed and you have not opened it', family: 'broken', glyph: 'failed', motion: 'still', look: 'Red cross with a satellite' },
  setup_failed: { label: 'Setup failed', hint: 'Its folder could not be prepared, so it never started', family: 'broken', glyph: 'failed', motion: 'still', look: 'Hollow red triangle' },
  done: { label: 'Done', hint: 'Its turn finished', family: 'settled', glyph: 'done', motion: 'still', look: 'Volt disc with a tick' },
  stopped: { label: 'Stopped', hint: 'Its turn was stopped', family: 'quiet', glyph: 'settled', motion: 'still', look: 'Grey bar' },
  idle: { label: 'Idle', hint: 'It has not run', family: 'quiet', glyph: 'idle', motion: 'still', look: 'Small grey dot' }
};
/* The order the legend reads in: who has the ball, then how far along. */
export const MARK_ORDER = Object.keys(MARK);
/* Not built: each needs data the server does not send yet (PR #755). Shown in the legend only, marked "needs data". */
export const MARK_NEEDS_DATA = [
  { label: 'Asked permission', why: 'Threads run headless, so no permission prompt reaches Omni.' },
  { label: 'Finishing', why: 'Nothing arrives before the result.' },
  { label: 'Stalled', why: 'There is no heartbeat, and a long tool call looks the same.' },
  { label: 'Running a tool, in list rows', why: 'Lists carry no transcript rows; this needs an activity field from the server.' }
];
/* A thread's plain status word (Glyph) to its mark, so older call sites keep working. */
const GLYPH_MARK = { running: 'working', needs: 'question', limited: 'limited', failed: 'failed', done: 'done', settled: 'stopped', stopped: 'stopped', queued: 'queued', idle: 'idle', reconnecting: 'starting', review: 'review' };
export const STATUS_LABEL = { running: 'Running', needs: 'Needs you', limited: 'Limited', failed: 'Failed', done: 'Done', settled: 'Stopped', stopped: 'Stopped', idle: 'Idle', queued: 'Queued', reconnecting: 'Reconnecting' };
const markOf = (state) => (MARK[state] ? state : GLYPH_MARK[state] || 'stopped');

const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };
const SAT = () => h('circle', { cx: 13.25, cy: 2.75, r: 2.6 });
/* Every mark on a 16 unit box, in the mark's own colour. */
const SHAPE = {
  queued: () => h('circle', { cx: 8, cy: 8, r: 5.75, ...line, strokeLinecap: 'butt', strokeWidth: 2.5, strokeDasharray: '5.5 3.53' }),
  starting: () => [h('circle', { key: 'r', cx: 8, cy: 8, r: 6.25, ...line, strokeWidth: 2.5 }), h('path', { key: 'f', d: 'M8 .5A7.5 7.5 0 0 0 8 15.5Z' })],
  working: () => h('circle', { cx: 8, cy: 8, r: 7 }),
  tool: () => [h('circle', { key: 'd', cx: 8, cy: 8, r: 3.75 }), h('circle', { key: 'r', cx: 8, cy: 8, r: 6.9, ...line, strokeWidth: 1.6 })],
  delegating: () => [h('circle', { key: 'd', cx: 6, cy: 10, r: 5.5 }), h(SAT, { key: 's' })],
  loading: () => h('circle', { cx: 8, cy: 8, r: 4 }),
  checking: () => h('rect', { x: 1.5, y: 1.5, width: 13, height: 13, rx: 3 }),
  limited: () => h('rect', { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5, ...line, strokeWidth: 2.5 }),
  resuming: () => [h('rect', { key: 'r', x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5, ...line, strokeWidth: 2.5 }), h('path', { key: 'f', d: 'M8 2.5H5A2.5 2.5 0 0 0 2.5 5v6A2.5 2.5 0 0 0 5 13.5h3Z' })],
  question: () => h('path', { d: 'M8 1.2 14.8 8 8 14.8 1.2 8Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
  crew_question: () => [h('path', { key: 'd', d: 'M6.5 3.9 12.1 9.5 6.5 15.1.9 9.5Z', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }), h(SAT, { key: 's' })],
  held: () => h('path', { d: 'M8 2 14 8 8 14 2 8Z', ...line, strokeWidth: 2.4 }),
  review: () => [h('path', { key: 'o', d: 'M8 2 14 8 8 14 2 8Z', ...line, strokeWidth: 2.4 }), h('path', { key: 'f', d: 'M8 2 2 8 8 14Z' })],
  failed: () => h('path', { d: 'M3 3 13 13M13 3 3 13', ...line, strokeWidth: 3 }),
  crew_failed: () => [h('path', { key: 'x', d: 'M1.6 6 10 14.4M10 6 1.6 14.4', ...line, strokeWidth: 2.8 }), h(SAT, { key: 's' })],
  setup_failed: () => h('path', { d: 'M8 2.8 14 13.2H2Z', ...line, strokeWidth: 2.4 }),
  done: () => [h('circle', { key: 'd', cx: 8, cy: 8, r: 6.8, className: 'om-glyph__done' }), h('path', { key: 't', d: 'M4.7 8.4 7 10.6 11.3 5.7', ...line, strokeWidth: 2, className: 'om-glyph__tick' })],
  stopped: () => h('rect', { x: 1.5, y: 5.5, width: 13, height: 5, rx: 2.5 }),
  idle: () => h('circle', { cx: 8, cy: 8, r: 3.25 })
};
/* A shape that is not a plain dot loses itself below 8px, and one with a satellite below 9. */
const PLAIN = { working: 1, idle: 1, starting: 1 };
const CREW = { delegating: 1, crew_question: 1, crew_failed: 1 };
const boxOf = (m, size) => (CREW[m] ? Math.max(size, 9) : PLAIN[m] ? size : Math.max(size, 8));

/* StatusDot: the one status mark. `mark` names the state outright; `state` takes the plain status words. */
export function StatusDot({ mark, state, size = 8, title, className = '' }) {
  const m = mark && MARK[mark] ? mark : markOf(state);
  const def = MARK[m];
  const label = title || (mark ? def.label : STATUS_LABEL[state] || def.label);
  const box = boxOf(m, size);
  return h('span', {
    className: 'om-glyph' + (className ? ' ' + className : ''),
    role: 'img',
    'aria-label': label,
    title: mark ? def.label + '. ' + def.hint + '.' : label,
    'data-mark': m,
    'data-family': def.family,
    'data-s': def.glyph,
    style: { width: box, height: box }
  },
    def.motion === 'ping' ? h('i', { className: 'om-glyph__ping' }) : null,
    h('svg', { viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true', className: def.motion === 'breathe' ? 'om-glyph__breathe' : undefined }, SHAPE[m]()));
}

/* StatusGlyph: the older name, kept so every list, row and kit draws the same marks. */
export function StatusGlyph({ state = 'settled', mark, size = 8, className = '' }) {
  return h(StatusDot, { state, mark, size, className });
}

/* Status: the pill. Needs and done fill with their pop and carry ink text; failed announces itself (role="alert"). */
export function Status({ state = 'settled', mark, label, showLabel = true }) {
  const m = mark && MARK[mark] ? mark : markOf(state);
  const s = MARK[m].glyph;
  const text = label ?? (mark ? MARK[m].label : STATUS_LABEL[state] ?? MARK[m].label);
  if (!showLabel) return h(StatusDot, { mark: mark || undefined, state, size: 8 });
  return h('span', { className: 'om-spill om-spill--' + s, 'data-mark': m, role: s === 'failed' ? 'alert' : 'status' },
    h(StatusDot, { mark: m, size: 7, title: text }), text);
}


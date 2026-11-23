import { describe, expect, it } from 'vitest';
import { movingFace, type FaceAgent, type FaceOptions } from '../agent-avatar.ts';
import { BODY_LOOPS, CREW_HOP, CREW_POP, crewStep, type CrewChange, type CrewStep } from '../crew-motion.ts';
import type { EyeState } from '../crew-shapes.ts';

// The crew characters' player (ADR 0021, Motion): movingFace() and crewStep() decide what a moving avatar draws and
// plays, and the Web UI (Web Animations) and the iOS app (Reanimated) only play it.

const builder: FaceAgent = { id: 'builder' };
type Opts = Omit<FaceOptions, 'from'>;
const at = (eyes: EyeState, o: Partial<Opts> = {}): Opts => ({ size: 32, shows: { eyes }, placement: 'focus', ...o });

/**
 * A player as both clients run it, without the engine: it keeps the eyes on screen and the change a squeeze handed
 * over, and steps until something plays, as the clients' effects run again on each new eyes. A squeeze ends at once.
 */
function player(agent: FaceAgent, opts: Opts) {
  let drawn = movingFace(agent, opts, null).eyes;
  let handed: CrewChange | null = null;
  const steps: CrewStep[] = [];
  const show = (next: Opts = opts, who: FaceAgent = agent) => {
    for (let i = 0; i < 4; i++) {
      const plan = movingFace(who, next, drawn);
      const step = crewStep(plan.eyes, drawn, plan.motion, handed);
      handed = null;
      steps.push(step);
      if (step.kind === 'play') return step;
      if (step.kind === 'squeeze') handed = step.change;
      drawn = step.eyes;
    }
    throw new Error('the player never settled');
  };
  return { show, steps, drawn: () => drawn };
}

describe('movingFace: what a moving avatar draws', () => {
  it('draws the face as it is before anything changes, and plays no change on first render', () => {
    const plan = movingFace(builder, at('idle'), null);
    expect(plan).toMatchObject({ face: { kind: 'character', eyes: 'idle' }, eyes: 'idle', motion: { change: null } });
    expect(movingFace(builder, at('idle'), 'idle').motion.change).toBeNull();
  });

  it('keeps drawing the eyes on screen while a change squeezes them, and holds the change into the new ones', () => {
    const plan = movingFace(builder, at('needs'), 'working');
    expect(plan.face).toMatchObject({ kind: 'character', eyes: 'working' });
    expect(plan.eyes).toBe('needs');
    expect(plan.motion.change?.squeeze.frames[0][0].pose).toBe('work_c');
    expect(plan.motion.change?.open.frames[0][0].pose).toBe('needs');
  });

  it('restarts what plays for another shape, size, placement or reduced motion, never for a new color or name', () => {
    const key = (agent: FaceAgent, opts: Opts) => movingFace(agent, opts, null).key;
    const base = key(builder, at('idle'));
    expect(key({ id: 'builder', avatar: { bg: '#52cdfe' } }, at('idle'))).toBe(base);
    expect(key(builder, at('working'))).toBe(base);
    for (const [agent, opts] of [
      [{ id: 'builder', avatar: { shape: 'cloud' } }, at('idle')],
      [builder, at('idle', { size: 48 })],
      [builder, at('idle', { placement: 'row' })],
      [builder, at('idle', { reducedMotion: true })],
    ] as const)
      expect(key(agent, opts)).not.toBe(base);
  });

  it('pops for another agent, shape or color in the same place, not for new eyes or a new place (D17)', () => {
    const look = (agent: FaceAgent, opts: Opts = at('idle')) => movingFace(agent, opts, null).look;
    const base = look(builder);
    expect(look(builder, at('working', { placement: 'row' }))).toBe(base);
    for (const other of [{ id: 'reviewer' }, { id: 'builder', avatar: { shape: 'cloud' } }, { id: 'builder', avatar: { bg: '#52cdfe' } }]) expect(look(other)).not.toBe(base);
    // In focus the pop plays; in a row, still or under reduced motion nothing does.
    expect(movingFace(builder, at('idle'), null).motion.pop).toBe(CREW_POP);
    for (const opts of [at('idle', { placement: 'row' }), at('idle', { placement: 'still' }), at('idle', { reducedMotion: true })]) expect(movingFace(builder, opts, null).motion.pop).toBeNull();
  });

  it('has no eyes, motion or look for a photo or an icon', () => {
    for (const avatar of [{ image: '/api/crew/builder/avatar?v=0123456789ab' }, { icon: '🛠️' }])
      expect(movingFace({ id: 'builder', avatar }, at('working'), null)).toMatchObject({ eyes: null, motion: { body: null, eyes: null, change: null, pop: null }, key: '', look: '' });
  });
});

describe('crewStep: what the player does next', () => {
  it("starts the state's loops at once on first render, in focus", () => {
    const p = player(builder, at('idle'));
    expect(p.show()).toMatchObject({ kind: 'play', open: null, body: BODY_LOOPS.idle, eyes: { ms: 7000, loop: true } });
    expect(p.steps).toHaveLength(1);
  });

  it('squeezes the eyes on screen, draws the new ones once it ends, then opens them and starts the loops', () => {
    const p = player(builder, at('idle'));
    p.show();
    const step = p.show(at('working'));
    const [squeeze] = p.steps.slice(1);
    expect(squeeze).toMatchObject({ kind: 'squeeze', eyes: 'working', squeeze: { ms: 110 } });
    if (squeeze.kind !== 'squeeze') throw new Error('no squeeze');
    expect(step).toEqual({ kind: 'play', open: { eyes: squeeze.change.open, body: null, last: 'eyes' }, body: BODY_LOOPS.working, eyes: expect.objectContaining({ ms: 800, loop: true }) });
    expect(p.drawn()).toBe('working');
  });

  it('starts the loops once the one of the open and the hop that ends last does: the hop into done', () => {
    const p = player(builder, at('working'));
    p.show();
    expect(p.show(at('done'))).toMatchObject({ kind: 'play', open: { body: CREW_HOP, last: 'body' }, body: null, eyes: null });
  });

  it('opens through the wide beat from idle to thinking, which ends last', () => {
    const p = player(builder, at('idle'));
    p.show();
    expect(p.show(at('thinking'))).toMatchObject({ kind: 'play', open: { eyes: { ms: 820 }, body: null, last: 'eyes' }, body: BODY_LOOPS.thinking });
  });

  it('plays a change in a list row with no loop after it, and the working loop once a row works (D10, D29)', () => {
    const p = player(builder, at('working', { placement: 'row' }));
    expect(p.show()).toMatchObject({ body: BODY_LOOPS.working });
    expect(p.show(at('waiting', { placement: 'row' }))).toMatchObject({ kind: 'play', open: { last: 'eyes' }, body: null, eyes: null });
    expect(p.steps.map((s) => s.kind)).toEqual(['play', 'squeeze', 'play']);
  });

  it('swaps the eyes at once under reduced motion or on a still avatar, with nothing played', () => {
    for (const o of [{ reducedMotion: true }, { placement: 'still' as const }]) {
      const p = player(builder, at('idle', o));
      p.show();
      expect(p.show(at('needs', o)), JSON.stringify(o)).toEqual({ kind: 'play', open: null, body: null, eyes: null });
      expect(p.steps.map((s) => s.kind)).toEqual(['play', 'swap', 'play']);
      expect(p.drawn()).toBe('needs');
    }
  });

  it('swaps between a photo or an icon and a character, never squeezing eyes that are not there', () => {
    const icon = { id: 'builder', avatar: { icon: '🛠️' } };
    const p = player(icon, at('working'));
    expect(p.show()).toEqual({ kind: 'play', open: null, body: null, eyes: null });
    p.show(at('working'), builder);
    expect(p.steps[1]).toEqual({ kind: 'swap', eyes: 'working' });
    p.show(at('working'), icon);
    expect(p.steps.at(-2)).toEqual({ kind: 'swap', eyes: null });
  });

  it('opens a handed-over change only once, and drops it when the eyes change again before it opens', () => {
    const handed = movingFace(builder, at('needs'), 'working').motion.change!;
    const settled = movingFace(builder, at('needs'), 'needs');
    expect(crewStep('needs', 'needs', settled.motion, handed)).toMatchObject({ kind: 'play', open: { eyes: handed.open } });
    expect(crewStep('needs', 'needs', settled.motion, null)).toMatchObject({ kind: 'play', open: null });
    // Needs you went on to done before the new eyes opened: squeeze again from the eyes on screen.
    const again = movingFace(builder, at('done'), 'needs');
    expect(crewStep('done', 'needs', again.motion, handed)).toEqual({ kind: 'squeeze', squeeze: again.motion.change!.squeeze, change: again.motion.change, eyes: 'done' });
  });
});

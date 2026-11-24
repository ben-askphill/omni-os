// Antigravity's adapter before its turns are built (spec #977, ticket #979). A thread on it checks agy with the
// environment the thread's agy will get (its channel's secrets, behind the guard), so the harness state refreshes as
// the spec asks when a session starts. Then the turn fails and says why: agy's fix when it cannot run here, or that
// this version of Omni cannot run turns on it yet. Nothing else starts, and no other harness runs in its place.
import type { HarnessAdapter } from '../adapter.ts';
import { detachedSession } from '../session.ts';
import { CAPABILITIES } from '../types.ts';
import { antigravityProfile } from './profile.ts';
import { refreshAntigravity } from './state.ts';

export const NOT_BUILT = 'agy is ready on this machine, but this version of Omni cannot run threads on Antigravity yet. Pick another harness for now.';

export const antigravityAdapter: HarnessAdapter = {
  id: 'antigravity',
  capabilities: CAPABILITIES.antigravity,
  profile: antigravityProfile,
  freshSessionId: (t) => t.id,
  spawn(ctx, cb) {
    let busy = false;
    const session = detachedSession(cb, {
      send(m) {
        if (busy) return false;
        busy = true;
        cb.record({ kind: 'replay', payload: { uuid: m.uuid, text: m.text } });
        void refreshAntigravity({ secrets: ctx.secretEnv }).then((s) => {
          if (!session.alive) return;
          cb.record({ kind: 'error', payload: { text: s.state === 'ready' ? NOT_BUILT : `Antigravity cannot run here. ${s.fix}.` } });
          cb.record({ kind: 'result', payload: { ok: false, subtype: 'error', turns: 1 } });
          session.end('terminate');
        });
        return true;
      },
      interrupt: () => true,
    });
    return session;
  },
};

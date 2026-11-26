// Which server each of omni.ts's tools is on. `omni` keeps the routing core a Conductor turn uses most: pick the channel
// and agent, brief and steer threads, read what came back. Every other tool is on `omni-admin`, which the same threads get
// beside it (apps/server/sandbox.ts buildMcpConfig) and which starts at its first call where this install can do that.
import { ADMIN_SERVER } from '@omni/shared/access.ts';

/** The tools on `omni`, each with why it is core. */
export const CORE_TOOLS: ReadonlySet<string> = new Set([
  // Pick where work goes.
  'list_channels', // the channel and folder of every delegation
  'list_crew', // the agent for it
  'list_devices', // the machine a delegate or seat names
  'list_templates', // a `/<id>` start in a brief
  // Read what is there before briefing or relaying.
  'list_threads', // find the thread to read or steer
  'get_thread', // a report, and session warmth before writing to a thread
  'search_history', // earlier work to link in a brief
  'read_referenced_thread', // a thread the user attached to their message
  // Hand work off and steer it.
  'seat_agents', // the Conductor's first action for real work
  'delegate',
  'delegate_team',
  'message_thread', // steer a warm thread
  'continue_thread', // follow up on a cold one
  'file_thread', // the folder the user agreed to
  // What delegated threads wait on or made.
  'crew_questions',
  'crew_prs',
  // Lessons: every thread with these tools is told to propose them (runner/prompts.ts).
  'remember',
  'crew_memory', // read before remember
  'propose_learning',
  'list_learnings', // read before propose_learning
]);

/** The server a tool of omni.ts is on. */
export const serverOf = (tool: string) => (CORE_TOOLS.has(tool) ? 'omni' : ADMIN_SERVER);

// The omni command (docs/user/cli.md, ADR 0014). Six commands over Omni's HTTP API through @omni/client-core, the
// client the iOS app uses. Everything else stays with the Conductor's MCP tools: a feature does not grow a command.
//
// The desktop app's shim runs the bundle (apps/cli/scripts/bundle.ts) and calls `run` (apps/desktop/src/cli-shim.ts
// names it). `node`/`tsx` running this file directly, as scripts/omni.sh does, runs it too.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { OmniHttpError } from '@omni/client-core';
import { describeSource, connection } from './connection.ts';
import { doctorCommand } from './commands/doctor.ts';
import { openCommand } from './commands/open.ts';
import { showCommand, threadsCommand } from './commands/read.ts';
import { statusCommand } from './commands/status.ts';
import { newCommand, sendCommand } from './commands/write.ts';
import { COMMANDS, commandUsage, usage, type Command } from './help.ts';
import { CliError, EXIT, UsageError, type Io } from './io.ts';
import { nodeIo } from './node-io.ts';
import { VERSION } from './version.ts';

const HANDLERS: Record<Command, (argv: string[], io: Io) => Promise<number>> = {
  new: newCommand,
  send: sendCommand,
  threads: threadsCommand,
  show: showCommand,
  status: statusCommand,
  doctor: doctorCommand,
  open: openCommand,
};

const isCommand = (s: string): s is Command => (COMMANDS as readonly string[]).includes(s);

/** What a failed request means for someone at a terminal, and what to try. */
function httpMessage(err: OmniHttpError, io: Io): string {
  const f = err.failure;
  let conn: ReturnType<typeof connection> | null = null;
  try {
    conn = connection(io);
  } catch {
    conn = null;
  }
  const at = conn?.baseUrl ?? 'the server';
  if (f.kind === 'unreachable') return `cannot reach Omni at ${at} (${f.detail}). Is it running? omni doctor says why not.`;
  if (f.kind === 'http' && f.status === 401) return `Omni at ${at} refused the token from ${conn ? describeSource(conn.tokenSource) : 'the environment'}. omni doctor checks it.`;
  if (f.kind === 'http' && f.status === 404) return `${f.message}: Omni at ${at} has nothing by that id. Check it, or update Omni if it is older than this command.`;
  if (f.kind === 'not-json') return `${at} answered, but not as Omni's API (${f.status} ${f.contentType ?? ''}). Is OMNI_URL right?`;
  return err.message;
}

export async function run(argv: string[], io: Io = nodeIo()): Promise<number> {
  const [first, ...rest] = argv;
  if (!first || first === '-h' || first === '--help' || first === 'help') {
    const topic = first === 'help' ? rest[0] : undefined;
    io.out(topic && isCommand(topic) ? commandUsage(topic) : usage());
    return first ? EXIT.ok : EXIT.usage;
  }
  if (first === '--version' || first === '-v') {
    io.out(`omni ${VERSION}\n`);
    return EXIT.ok;
  }
  if (!isCommand(first)) {
    io.err(`omni: unknown command ${first}\n\n${usage()}`);
    return EXIT.usage;
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    io.out(commandUsage(first));
    return EXIT.ok;
  }
  try {
    return await HANDLERS[first](rest, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`omni ${first}: ${err.message}\n\n${commandUsage(first)}`);
      return EXIT.usage;
    }
    if (err instanceof CliError) {
      io.err(`omni ${first}: ${err.message}\n`);
      return EXIT.error;
    }
    if (err instanceof OmniHttpError) {
      io.err(`omni ${first}: ${httpMessage(err, io)}\n`);
      return EXIT.error;
    }
    io.err(`omni ${first}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return EXIT.error;
  }
}

/** True when Node runs this file itself, not when it is imported (the shim imports the bundle and calls `run`). */
function isEntry(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}

if (isEntry()) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

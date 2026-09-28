// Pure translation of `claude -p --output-format stream-json` events into the
// small set of records Omni stores and renders. No I/O here so it is testable.

export type Record =
  | { kind: 'init'; payload: { model: string; cwd: string; tools: number; mcp: string[] } }
  | { kind: 'assistant_text'; payload: { text: string } }
  | { kind: 'tool_use'; payload: { id: string; name: string; input: unknown; parent?: string | null } }
  | { kind: 'tool_result'; payload: { tool_use_id: string; text: string; is_error: boolean; truncated: boolean } }
  | { kind: 'status'; payload: { text: string } }
  /** Why a turn failed, shown in the transcript. A harness adapter's own; Claude's errors arrive as text. */
  | { kind: 'error'; payload: { text: string } }
  /** One of our own stdin messages, echoed when the CLI adds it to the conversation (--replay-user-messages). */
  | { kind: 'replay'; payload: { uuid: string; text: string } }
  | { kind: 'control'; payload: { request_id: string; subtype: string; still_queued: string[] } }
  | {
      kind: 'result';
      payload: {
        ok: boolean;
        subtype: string;
        duration_ms?: number;
        turns?: number;
        cost_usd?: number;
        text?: string;
        /** Hermes reports the serving model and token counts on the run. Plan harnesses leave these off. */
        model?: string;
        input_tokens?: number;
        output_tokens?: number;
        cache_read_tokens?: number;
        cache_write_tokens?: number;
      };
    };

export interface Usage {
  five_hour?: { utilization: number; resetsAt: number };
  seven_day?: { utilization: number; resetsAt: number };
  status?: string;
  updated_at: string;
}

export interface Parsed {
  records: Record[];
  usage?: Usage;
  sessionId?: string;
}

const MAX_RESULT = 16_000;

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: Block) => (c.type === 'text' ? c.text ?? '' : c.type === 'image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
}

export function parseEvent(evt: any): Parsed {
  const out: Parsed = { records: [] };
  if (!evt || typeof evt !== 'object') return out;
  if (evt.session_id) out.sessionId = evt.session_id;

  switch (evt.type) {
    case 'system': {
      if (evt.subtype === 'init') {
        out.records.push({
          kind: 'init',
          payload: {
            model: evt.model ?? '',
            cwd: evt.cwd ?? '',
            tools: Array.isArray(evt.tools) ? evt.tools.length : 0,
            mcp: Array.isArray(evt.mcp_servers) ? evt.mcp_servers.map((m: any) => `${m.name}:${m.status}`) : [],
          },
        });
      } else if (evt.subtype === 'task_summary' && evt.detail) {
        out.records.push({ kind: 'status', payload: { text: String(evt.detail) } });
      }
      break;
    }
    case 'assistant': {
      const parent = evt.parent_tool_use_id ?? null;
      for (const b of (evt.message?.content ?? []) as Block[]) {
        if (b.type === 'text' && b.text?.trim()) {
          // Sub-agent chatter stays inside its tool call; only top-level text is the answer.
          if (!parent) out.records.push({ kind: 'assistant_text', payload: { text: b.text } });
        } else if (b.type === 'tool_use') {
          out.records.push({ kind: 'tool_use', payload: { id: b.id!, name: b.name!, input: b.input, parent } });
        }
      }
      break;
    }
    case 'user': {
      const content = evt.message?.content;
      if (evt.isReplay) {
        const text = typeof content === 'string' ? content : Array.isArray(content)
          ? content.filter((b: Block) => b.type === 'text').map((b: Block) => b.text ?? '').join('\n')
          : '';
        out.records.push({ kind: 'replay', payload: { uuid: String(evt.uuid ?? ''), text } });
        break;
      }
      // Tool results only. Interrupt markers ("[Request interrupted by user...]") are plain text blocks and drop out here.
      if (!Array.isArray(content)) break;
      for (const b of content as Block[]) {
        if (b.type !== 'tool_result') continue;
        const text = blockText(b.content);
        out.records.push({
          kind: 'tool_result',
          payload: {
            tool_use_id: b.tool_use_id!,
            text: text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) : text,
            is_error: !!b.is_error,
            truncated: text.length > MAX_RESULT,
          },
        });
      }
      break;
    }
    case 'rate_limit_event': {
      const info = evt.rate_limit_info ?? {};
      const w = info.unifiedWindows ?? {};
      out.usage = {
        five_hour: w.five_hour,
        seven_day: w.seven_day,
        status: info.status,
        updated_at: new Date().toISOString(),
      };
      break;
    }
    case 'control_response': {
      const r = evt.response ?? {};
      const queued = r.response?.still_queued;
      out.records.push({
        kind: 'control',
        payload: {
          request_id: String(r.request_id ?? ''),
          subtype: String(r.subtype ?? 'unknown'),
          still_queued: Array.isArray(queued) ? queued.map(String) : [],
        },
      });
      break;
    }
    case 'result': {
      out.records.push({
        kind: 'result',
        payload: {
          ok: evt.subtype === 'success' && !evt.is_error,
          subtype: evt.subtype ?? 'unknown',
          duration_ms: evt.duration_ms,
          turns: evt.num_turns,
          cost_usd: evt.total_cost_usd,
          text: typeof evt.result === 'string' ? evt.result : undefined,
        },
      });
      break;
    }
  }
  return out;
}

/** Splits a stdout chunk stream into complete JSON lines. */
export class LineSplitter {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) lines.push(line);
    }
    return lines;
  }
  flush(): string[] {
    const rest = this.buf.trim();
    this.buf = '';
    return rest ? [rest] : [];
  }
}

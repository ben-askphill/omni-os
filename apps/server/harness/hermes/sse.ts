// Incremental parser for Hermes' event stream. The server sends comment lines
// (": open", ": keepalive" about every 10s, ": stream closed") that are not records.
// No I/O here so a chunk split mid-line is testable.

export interface SseEvent {
  id?: string;
  data: string;
}

/** Comment lines and dispatch-on-blank-line, per the SSE spec. */
export class SseParser {
  private buf = '';
  private id: string | undefined;
  private data: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buf += chunk;
    // A CRLF split across chunks must stay one break, so hold a trailing CR.
    let held = '';
    if (this.buf.endsWith('\r')) {
      held = '\r';
      this.buf = this.buf.slice(0, -1);
    }
    this.buf = this.buf.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const out: SseEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.consume(line, out);
    }
    this.buf += held;
    return out;
  }

  /** Dispatch a trailing event that the stream ended without a blank line. */
  flush(): SseEvent[] {
    if (this.buf === '\r') this.buf = '';
    if (!this.buf && !this.data.length && !this.id) return [];
    return this.push('\n\n');
  }

  private consume(line: string, out: SseEvent[]) {
    if (line === '') {
      if (this.data.length) out.push({ ...(this.id ? { id: this.id } : {}), data: this.data.join('\n') });
      this.id = undefined;
      this.data = [];
      return;
    }
    // ": keepalive" and the rest of the comment channel.
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'id') this.id = value;
    else if (field === 'data') this.data.push(value);
  }
}

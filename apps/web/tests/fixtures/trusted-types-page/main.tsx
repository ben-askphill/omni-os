// The page tests/trusted-types-browser.test.ts drives in Chromium, under the shell's Trusted Types directives enforced
// (index.html): Markdown with character references and Mermaid diagrams of each common kind, a search snippet and a
// terminal, each from the app's own code. `window.violations` collects every CSP violation; `window.stray(html)` writes
// a plain string to innerHTML.
import '../../../src/trusted-html.ts';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Markdown } from '../../../src/components/Markdown.tsx';
import { Snippet } from '../../../src/components/command-palette/items.tsx';
import { THEME } from '../../../src/components/terminal-session.ts';

declare global {
  interface Window {
    violations: string[];
    stray: (html: string) => string;
  }
}
window.violations = [];
document.addEventListener('securitypolicyviolation', (e) => window.violations.push(`${e.violatedDirective}: ${e.sample}`));
window.stray = (html) => {
  try {
    document.createElement('div').innerHTML = html;
    return 'written';
  } catch {
    return 'refused';
  }
};

const fence = (source: string) => '```mermaid\n' + source + '\n```';
const diagrams = [
  'flowchart LR\n  Air["`Air **bold**`"] --> Relay{Relay?}\n  Relay -->|yes| Mac[(Mac)]\n  Relay -.-> Phone([Phone])',
  'sequenceDiagram\n  participant A as Air\n  A->>B: pair<br/>again\n  Note over A,B: a note\n  B-->>A: ok',
  'classDiagram\n  class Thread {\n    +id string\n    +send() void\n  }\n  Thread <|-- Job',
  'stateDiagram-v2\n  [*] --> Running\n  Running --> Done\n  Done --> [*]',
  'erDiagram\n  THREAD ||--o{ EVENT : has',
  'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section W17\n  Policy :a1, 2026-11-19, 1d',
  'pie title Hits\n  "Search" : 3\n  "Mermaid" : 2',
];
const text = [
  '# Trusted Types',
  'Some **Markdown** with `code`, a [link](https://example.com), &copy; 2026 &amp; co, &nbsp;&notin; and &notit; &bogus;.',
  ...diagrams.map(fence),
].join('\n\n');

function Page() {
  return (
    <div>
      <Markdown text={text} />
      <p id="snippet">
        <Snippet text={'before <mark>match</mark> after <img src=x onerror="window.pwned=1"> <mark>two</mark>'} />
      </p>
      <div
        id="terminal"
        style={{ width: 600, height: 200 }}
        ref={(el) => {
          if (!el || el.childElementCount) return;
          const term = new Terminal({ theme: THEME, fontSize: 12, scrollback: 5000 });
          term.open(el);
          term.write('\x1b[32m$\x1b[0m echo <b>hi</b>\r\n<b>hi</b>\r\n');
        }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);

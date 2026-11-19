// The page tests/layers-browser.test.ts drives in Chromium: overlays stacked on each other, each from the app's own
// components, to check that Escape and a press outside close only the top one. `window.events` records what closed.
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { HarnessWithRunning } from '../../../src/api.ts';
import { Modal } from '../../../src/components/ui/modal.tsx';
import { Picker } from '../../../src/components/ui/picker.tsx';
import { InlineConfirm } from '../../../src/components/ui/inline-confirm.tsx';
import { ModelPicker, type ModelChoice } from '../../../src/components/ModelPicker.tsx';
import { MarkToolbar, type Tool } from '../../../src/components/BrowserMarkToolbar.tsx';
import { SteerButton } from '../../../src/components/composer/ReplyControls.tsx';
import { useDismissLayer } from '../../../src/components/ui/dismiss-stack.ts';
import type { MarkShape } from '@omni/shared/message-context-marks.ts';
import '../../../src/index.css';

declare global {
  interface Window {
    events: string[];
  }
}
window.events = [];
const log = (e: string) => window.events.push(e);

const harnesses = [
  {
    id: 'claude',
    name: 'Claude Code',
    plan: 'Max plan',
    available: true,
    running: 0,
    models: [
      { id: 'opus', label: 'Opus', efforts: [], default: true },
      { id: 'sonnet', label: 'Sonnet', efforts: [] },
    ],
  },
] as unknown as HarnessWithRunning[];

const machines = ['Omarchy', 'MacBook', 'Mini', 'Server', 'Laptop', 'Desktop', 'Spare', 'Old'].map((m) => ({ value: m.toLowerCase(), label: m, avatar: false as const }));

/** The Fork thread modal's shape: a model list, a machine picker and an inline confirm, inside a Modal. */
function Fork() {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<ModelChoice>({ harness: 'claude', model: 'opus' });
  const [machine, setMachine] = useState('omarchy');
  return (
    <>
      <button id="open-fork" onClick={() => setOpen(true)}>
        Fork
      </button>
      <Modal
        open={open}
        onClose={() => {
          log('fork closed');
          setOpen(false);
        }}
        title="Fork thread"
      >
        <div className="space-y-3 px-6 pb-6">
          <ModelPicker harnesses={harnesses} value={model} onChange={setModel} />
          <Picker label="Machine" value={machine} options={machines} onChange={setMachine} searchable />
          <InlineConfirm label="Delete role" confirmLabel="Delete role" onConfirm={() => void log('deleted')} />
        </div>
      </Modal>
    </>
  );
}

/** The annotation view's shape: a layer that Escape closes, with the drawing toolbar's popups over it. */
function Annotate() {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>('pen');
  const [shape, setShape] = useState<MarkShape>('rect');
  const [color, setColor] = useState('#ff3b30');
  const [stroke, setStroke] = useState(4);
  const root = useRef<HTMLDivElement>(null);
  useDismissLayer(open, {
    roots: () => [root.current],
    escape: () => {
      log('annotate closed');
      setOpen(false);
    },
  });
  return (
    <>
      <button id="open-annotate" onClick={() => setOpen(true)}>
        Annotate
      </button>
      {open && (
        <div ref={root} role="dialog" aria-label="Annotate the page" className="w-[480px]">
          <MarkToolbar
            tool={tool}
            shape={shape}
            color={color}
            stroke={stroke}
            canUndo={false}
            canDelete={false}
            onTool={setTool}
            onShape={(s) => (setShape(s), log(`shape ${s}`))}
            onColor={setColor}
            onStroke={setStroke}
            onUndo={() => {}}
            onDelete={() => {}}
          />
        </div>
      )}
    </>
  );
}

function Page() {
  return (
    <main className="space-y-4 p-6">
      <button id="behind" onClick={() => log('behind')}>
        Behind
      </button>
      <Fork />
      <Annotate />
      <div className="flex justify-end pt-40 pr-20">
        <SteerButton disabled={false} busy={false} onSend={(m) => log(`send ${m}`)} />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

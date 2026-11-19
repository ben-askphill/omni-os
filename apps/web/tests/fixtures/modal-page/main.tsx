// The page tests/modal-browser.test.ts drives in Chromium: the real Modal and ConfirmDialog over a page with a button
// behind them. `window.events` records what each control heard.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmDialog, Modal, useUnsavedChanges } from '../../../src/components/ui/modal.tsx';
import '../../../src/index.css';

declare global {
  interface Window {
    events: string[];
  }
}
window.events = [];
const log = (e: string) => window.events.push(e);

function FormBody() {
  const [text, setText] = useState('');
  useUnsavedChanges(text !== '');
  return (
    <div className="space-y-3 px-6 pb-6">
      <input id="form-text" className="field" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
    </div>
  );
}

function Page() {
  const [plain, setPlain] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [form, setForm] = useState(false);
  return (
    <main className="p-6">
      <button id="behind" onClick={() => log('behind')}>
        Behind
      </button>
      <button id="open-plain" onClick={() => setPlain(true)}>
        Open plain
      </button>
      <button id="open-form" onClick={() => setForm(true)}>
        Open form
      </button>
      <Modal
        open={plain}
        onClose={() => {
          log('plain closed');
          setPlain(false);
        }}
        title="Plain"
      >
        <div className="space-y-3 px-6 pb-6">
          <input id="plain-a" className="field" />
          <input id="plain-b" className="field" />
          <button id="open-confirm" onClick={() => setConfirm(true)}>
            Delete
          </button>
        </div>
        <ConfirmDialog
          open={confirm}
          title="Delete it?"
          confirmLabel="Delete"
          danger
          onConfirm={() => log('confirmed')}
          onCancel={() => {
            log('confirm cancelled');
            setConfirm(false);
          }}
        >
          Gone for good.
        </ConfirmDialog>
      </Modal>
      <Modal
        open={form}
        onClose={() => {
          log('form closed');
          setForm(false);
        }}
        title="Form"
        dismiss="confirm"
      >
        <FormBody />
      </Modal>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);

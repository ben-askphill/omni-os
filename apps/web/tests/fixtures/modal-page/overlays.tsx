// The page tests/modal-browser.test.ts drives for what sits over a modal: the real ToastProvider over the real Modal,
// and the phone's MoSheet in a stand-in for the phone shell (its screens, a tab bar and the sheet host, wired to a
// SheetStack as MobileShell wires them). `window.events` records what each control heard.
import { StrictMode, useCallback, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal } from '../../../src/components/ui/modal.tsx';
import { ToastProvider, useToast } from '../../../src/components/Toaster.tsx';
import { MoSheet } from '../../../src/mobile/parts.tsx';
import { SheetHostCtx, SheetStack } from '../../../src/mobile/sheet-stack.ts';
import './overlays.css';

declare global {
  interface Window {
    events: string[];
  }
}
window.events = [];
const log = (e: string) => window.events.push(e);

function Desktop() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const fire = (timeout?: number) => toast({ title: 'Thread finished', body: 'Done in #omni-os', href: '#/t/x', action: 'Open', timeout });
  return (
    <section className="p-6">
      <button id="toast-now" onClick={() => fire(400)}>
        Toast
      </button>
      <button id="open-modal" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Settings">
        <div className="space-y-3 px-6 pb-6">
          <input id="modal-field" className="field" autoFocus />
          <button id="modal-toast" onClick={() => fire()}>
            Toast from here
          </button>
        </div>
      </Modal>
    </section>
  );
}

function Phone() {
  const [stack] = useState(() => new SheetStack());
  const [el, setEl] = useState<HTMLElement | null>(null);
  const host = useMemo(() => (el ? { el, stack } : null), [el, stack]);
  const onScreens = useCallback((e: HTMLElement | null) => stack.base('screens', e), [stack]);
  const onTabs = useCallback((e: HTMLElement | null) => stack.base('tabs', e), [stack]);
  const [sheet, setSheet] = useState(false);
  const [inner, setInner] = useState(false);
  const toast = useToast();
  return (
    <SheetHostCtx.Provider value={host}>
      <div id="phone" className="relative h-[480px] w-[390px] overflow-hidden border">
        <main id="screens" ref={onScreens} className="absolute inset-0 p-4">
          <button id="open-sheet" onClick={() => setSheet(true)}>
            Open sheet
          </button>
          <button id="screen-button" onClick={() => log('screen')}>
            On the screen
          </button>
          {sheet && (
            <MoSheet label="Outer" onClose={() => (log('outer closed'), setSheet(false))}>
              <div className="p-4">
                <button id="open-inner" onClick={() => setInner(true)}>
                  Open inner
                </button>
                <button id="sheet-toast" onClick={() => toast({ title: 'Renamed', body: 'From the sheet' })}>
                  Toast from the sheet
                </button>
              </div>
              {inner && (
                <MoSheet label="Inner" onClose={() => (log('inner closed'), setInner(false))}>
                  <div className="p-4">
                    <input id="inner-field" autoFocus />
                  </div>
                </MoSheet>
              )}
            </MoSheet>
          )}
        </main>
        <nav id="tabs" ref={onTabs} className="absolute inset-x-0 bottom-0">
          <button id="tab-button" onClick={() => log('tab')}>
            Tab
          </button>
        </nav>
        <div ref={setEl} />
      </div>
    </SheetHostCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <Desktop />
      <Phone />
    </ToastProvider>
  </StrictMode>,
);

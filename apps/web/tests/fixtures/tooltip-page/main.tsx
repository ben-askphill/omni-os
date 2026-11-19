// The page tests/tooltip-browser.test.ts drives in Chromium: the shared Tooltip (components/ui/tooltip.tsx) on a link
// and a button, over a layer of its own so Escape can be seen closing the tip alone. `?mode=fallback` hides interest
// invokers, as Safari and Firefox lack them; `?mode=placed` hides anchor positioning too, as iOS Safari 18 does.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDismissLayer } from '../../../src/components/ui/dismiss-stack.ts';
import { useTooltip } from '../../../src/components/ui/tooltip.tsx';
import '../../../src/index.css';

declare global {
  interface Window {
    events: string[];
  }
}
window.events = [];
const log = (e: string) => window.events.push(e);

const mode = new URLSearchParams(location.search).get('mode');
if (mode === 'fallback' || mode === 'placed') delete (HTMLButtonElement.prototype as { interestForElement?: unknown }).interestForElement;
if (mode === 'placed') {
  const supports = CSS.supports.bind(CSS);
  CSS.supports = ((a: string, b?: string) => (/position-area|anchor/.test(a) ? false : b === undefined ? supports(a) : supports(a, b))) as typeof CSS.supports;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') log('page escape');
});

function Link() {
  const { triggerProps, tip } = useTooltip('GitHub · ben-askphill/omni-os\nhttps://github.com/ben-askphill/omni-os');
  return (
    <>
      <a {...triggerProps} id="link" href="#x">
        omni-os
      </a>
      {tip}
    </>
  );
}

function RailDisc() {
  const { triggerProps, tip } = useTooltip('Volero', { side: 'right', describes: false });
  return (
    <>
      <a {...triggerProps} id="disc" href="#volero" aria-label="Volero" style={{ display: 'inline-grid', width: 48, height: 48, placeItems: 'center' }}>
        V
      </a>
      {tip}
    </>
  );
}

/** A menu-like layer under the tips: Escape over a tip must close the tip, not this. */
function Menu() {
  const [open, setOpen] = useState(false);
  useDismissLayer(open, { roots: () => [document.getElementById('menu')], escape: () => void (setOpen(false), log('menu closed')) });
  return (
    <>
      <button id="open-menu" onClick={() => setOpen(true)}>
        Open menu
      </button>
      {open && <div id="menu">Menu</div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main style={{ padding: 120, display: 'flex', gap: 40, alignItems: 'center' }}>
      <Menu />
      <Link />
      <RailDisc />
      <button id="other">Other</button>
    </main>
  </StrictMode>,
);

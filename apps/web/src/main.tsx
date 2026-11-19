// First: the Trusted Types default policy has to exist before anything writes to the DOM.
import './trusted-html.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { PairGate } from './components/Pair.tsx';
import { takeApiParam } from './api-base.ts';
import { desktop } from './desktop.ts';
import './index.css';
// The channel rail's faces (index.css :root[data-layout="rail"]). Each @font-face downloads only when used.
import '@fontsource/adwaita-sans/400.css';
import '@fontsource/adwaita-sans/500.css';
import '@fontsource/adwaita-sans/500-italic.css';
import '@fontsource/adwaita-sans/600.css';
import '@fontsource/adwaita-sans/700.css';
import '@fontsource/adwaita-sans/700-italic.css';
import '@fontsource/adwaita-sans/800.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';

// The desktop app's window arrives as /?api=<path>: keep where this browser's requests go, and drop it from the address.
const clean = takeApiParam(window.location, undefined, !!desktop);
if (clean !== null) history.replaceState(history.state, '', clean);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PairGate>
      <App />
    </PairGate>
  </StrictMode>,
);

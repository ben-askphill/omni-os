import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { PairGate } from './components/Pair.tsx';
import './index.css';
// The channel rail Beta's faces (index.css :root[data-layout="rail"]). Each @font-face downloads only when used.
import '@fontsource/adwaita-sans/400.css';
import '@fontsource/adwaita-sans/500.css';
import '@fontsource/adwaita-sans/500-italic.css';
import '@fontsource/adwaita-sans/600.css';
import '@fontsource/adwaita-sans/700.css';
import '@fontsource/adwaita-sans/700-italic.css';
import '@fontsource/adwaita-sans/800.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PairGate>
      <App />
    </PairGate>
  </StrictMode>,
);

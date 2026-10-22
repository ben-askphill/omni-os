import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { PairGate } from './components/Pair.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PairGate>
      <App />
    </PairGate>
  </StrictMode>,
);

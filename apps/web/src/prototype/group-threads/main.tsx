// PROTOTYPE, throwaway: the prototype page's entry (prototype-group-threads.html). See README.md here.
import '../../trusted-html.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import '@fontsource/adwaita-sans/400.css';
import '@fontsource/adwaita-sans/500.css';
import '@fontsource/adwaita-sans/600.css';
import '@fontsource/adwaita-sans/700.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import { installFakeApi } from './fake-api.ts';
import { ProtoApp } from './ProtoApp.tsx';

installFakeApi();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProtoApp />
  </StrictMode>,
);

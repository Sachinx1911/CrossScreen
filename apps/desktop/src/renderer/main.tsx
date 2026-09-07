import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { initSentry } from './sentry.ts';
import './theme.css';

// Before anything else renders, so a crash in the very first render is still
// reported (phase-2-reliability.md §2.6).
initSentry();

const container = document.querySelector('#root');
if (container === null) throw new Error('Expected #root to exist in the page');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

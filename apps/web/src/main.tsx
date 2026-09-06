import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './styles/theme.css';

const container = document.querySelector('#root');
if (container === null) throw new Error('Expected #root to exist in the page');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

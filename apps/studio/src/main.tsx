import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { session, useStore } from './state/store.js';
import './styles.css';

/**
 * Debug handle. End-to-end tests drive the app through real pointer events and
 * then assert against the document here, rather than reaching into React
 * internals. Handy in the browser console too.
 */
declare global {
  interface Window {
    __wisp: { session: typeof session; store: typeof useStore };
  }
}
window.__wisp = { session, store: useStore };

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

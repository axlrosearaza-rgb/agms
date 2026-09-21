import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Caches the app shell so it still loads — and survives a refresh — with no
// internet connection. See serviceWorkerRegistration.js / public/service-worker.js.
serviceWorkerRegistration.register();

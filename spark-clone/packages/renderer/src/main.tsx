import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ComposerWindow } from './components/composer/ComposerWindow';
import './app.css';

// A popped-out composer loads this same bundle at #composer.
const Root = window.location.hash === '#composer' ? ComposerWindow : App;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

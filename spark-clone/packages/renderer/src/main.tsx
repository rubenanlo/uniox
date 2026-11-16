import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ComposerWindow } from './components/composer/ComposerWindow';
import { QuickReplyWindow } from './components/quickreply/QuickReplyWindow';
import './app.css';

// A popped-out composer loads this same bundle at #composer, the quick-reply
// overlay (notification list + reply widget) at #quick-reply.
const Root =
  window.location.hash === '#composer'
    ? ComposerWindow
    : window.location.hash === '#quick-reply'
      ? QuickReplyWindow
      : App;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

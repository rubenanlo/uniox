import { Toaster } from 'sonner';

/** The app's toasts, shared by the main window and popped-out composers. */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-left"
      // Toasts wear the app's own surface tokens, so they sit naturally on
      // the backdrop and flip with the light/dark theme.
      toastOptions={{
        style: {
          fontSize: '12.5px',
          borderRadius: '12px',
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
          border: '1px solid var(--color-hairline)',
          boxShadow: '0 8px 28px rgb(0 0 0 / 0.28)',
        },
        actionButtonStyle: {
          background: 'var(--color-accent)',
          color: '#fff',
        },
      }}
    />
  );
}

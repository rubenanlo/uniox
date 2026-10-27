import { create } from 'zustand';

/** ⌘⇧G: open state of the calendar's Go to date dialog (mounted once in App). */
export const useGoToDate = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

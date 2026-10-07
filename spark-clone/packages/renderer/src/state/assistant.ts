import { create } from 'zustand';
import type { AiMessage } from '@app/shared';
import { api } from '../lib/api';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Set on an assistant message whose turn failed, so the UI can style it. */
  error?: boolean;
}

const BASE_SYSTEM =
  'You are the assistant inside Uniox, a fast email client. Be concise, direct, ' +
  'and practical. When given email or task context, ground every answer in it and ' +
  'never invent details. Lead with the answer.';

interface AssistantState {
  open: boolean;
  configured: boolean;
  model: string;
  messages: ChatMessage[];
  /** The assistant message id currently streaming, or null when idle. */
  streamingId: string | null;
  setOpen(open: boolean): void;
  refreshStatus(): void;
  /** Stream a user turn into the visible conversation. */
  send(text: string, system?: string): void;
  /** One-shot completion that does not touch the visible chat (for the composer). */
  complete(prompt: string, system?: string): Promise<string>;
  stop(): void;
  reset(): void;
  /** Internal: dispatch an incoming stream chunk. */
  _ingest(id: string, chunk: { type: 'delta' | 'done' | 'error'; text?: string }): void;
}

/** Pending one-shot `complete()` calls, keyed by request id. */
const pending = new Map<string, { text: string; resolve: (s: string) => void; reject: (e: Error) => void }>();

function newId(): string {
  return crypto.randomUUID();
}

export const useAssistant = create<AssistantState>((set, get) => ({
  open: false,
  configured: false,
  model: 'claude-opus-4-8',
  messages: [],
  streamingId: null,

  setOpen: (open) => {
    set({ open });
    if (open) get().refreshStatus();
  },

  refreshStatus: () => {
    void api
      .query('ai:status', undefined)
      .then((s) => set({ configured: s.configured, model: s.model }))
      .catch(() => {});
  },

  send: (text, system) => {
    const trimmed = text.trim();
    if (!trimmed || get().streamingId) return;
    const history = get().messages.map((m): AiMessage => ({ role: m.role, content: m.content }));
    const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed };
    const assistantId = newId();
    set((s) => ({
      messages: [...s.messages, userMsg, { id: assistantId, role: 'assistant', content: '' }],
      streamingId: assistantId,
    }));
    void api
      .command('ai:chat', {
        id: assistantId,
        messages: [...history, { role: 'user', content: trimmed }],
        system: BASE_SYSTEM + (system ? `\n\n${system}` : ''),
      })
      .then((res) => {
        if (!res.ok) get()._ingest(assistantId, { type: 'error', text: res.error });
      })
      .catch((e) => get()._ingest(assistantId, { type: 'error', text: String(e) }));
  },

  complete: (prompt, system) =>
    new Promise<string>((resolve, reject) => {
      const id = newId();
      pending.set(id, { text: '', resolve, reject });
      void api
        .command('ai:chat', {
          id,
          messages: [{ role: 'user', content: prompt }],
          system: BASE_SYSTEM + (system ? `\n\n${system}` : ''),
        })
        .then((res) => {
          if (!res.ok) get()._ingest(id, { type: 'error', text: res.error });
        })
        .catch((e) => get()._ingest(id, { type: 'error', text: String(e) }));
    }),

  stop: () => {
    const id = get().streamingId;
    if (!id) return;
    void api.command('ai:stop', { id });
    set({ streamingId: null });
  },

  reset: () => {
    get().stop();
    set({ messages: [] });
  },

  _ingest: (id, chunk) => {
    const p = pending.get(id);
    if (p) {
      if (chunk.type === 'delta') p.text += chunk.text ?? '';
      else if (chunk.type === 'done') {
        pending.delete(id);
        p.resolve(p.text);
      } else {
        pending.delete(id);
        p.reject(new Error(chunk.text || 'Assistant request failed.'));
      }
      return;
    }
    // Visible-chat stream.
    if (chunk.type === 'delta') {
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === id ? { ...m, content: m.content + (chunk.text ?? '') } : m,
        ),
      }));
    } else if (chunk.type === 'done') {
      if (get().streamingId === id) set({ streamingId: null });
    } else {
      set((s) => ({
        streamingId: s.streamingId === id ? null : s.streamingId,
        messages: s.messages.map((m) =>
          m.id === id
            ? { ...m, error: true, content: m.content || (chunk.text ?? 'Something went wrong.') }
            : m,
        ),
      }));
    }
  },
}));

/** Wire the streaming push channel once, app-level (call from App effect). */
export function wireAssistant(): () => void {
  useAssistant.getState().refreshStatus();
  return api.onAiChunk((chunk) => {
    useAssistant.getState()._ingest(chunk.id, chunk);
  });
}

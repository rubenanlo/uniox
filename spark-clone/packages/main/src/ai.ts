import Anthropic from '@anthropic-ai/sdk';
import type { AiChunk, AiMessage } from '@app/shared';
import type { CredentialStore } from './credentials';

const DEFAULT_MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 4096;

/**
 * Claude-backed assistant, living in the main process so the API key (from the
 * safeStorage-backed CredentialStore) never reaches the renderer. Turns stream
 * token-by-token; the caller forwards each `AiChunk` to the renderer over the
 * `ai:chunk` push channel. In-flight turns are abortable by request id.
 */
export class AiService {
  private client: Anthropic | null = null;
  /** The key the current client was built with, so we rebuild on rotation. */
  private clientKey: string | null = null;
  private readonly aborts = new Map<string, AbortController>();

  constructor(private readonly credentials: CredentialStore) {}

  status(): { configured: boolean; model: string } {
    return {
      configured: !!this.credentials.getAiKey(),
      model: this.credentials.getAiModel() || DEFAULT_MODEL,
    };
  }

  config({ key, model }: { key?: string; model?: string }): { ok: boolean; error?: string } {
    if (typeof key === 'string' && key.trim()) {
      this.credentials.setAiKey(key.trim());
      this.client = null; // force rebuild with the new key
    }
    if (typeof model === 'string' && model.trim()) {
      this.credentials.setAiModel(model.trim());
    }
    return { ok: true };
  }

  private ensureClient(): Anthropic | null {
    const key = this.credentials.getAiKey();
    if (!key) return null;
    if (!this.client || this.clientKey !== key) {
      this.client = new Anthropic({ apiKey: key });
      this.clientKey = key;
    }
    return this.client;
  }

  /**
   * Stream a turn, forwarding deltas via `onChunk`. Resolves once the turn is
   * accepted; completion/errors arrive as `done`/`error` chunks, not the promise.
   */
  chat(
    { id, messages, system }: { id: string; messages: AiMessage[]; system?: string },
    onChunk: (chunk: AiChunk) => void,
  ): { ok: boolean; error?: string } {
    const client = this.ensureClient();
    if (!client) return { ok: false, error: 'No Claude API key — add one in Settings.' };

    const controller = new AbortController();
    this.aborts.set(id, controller);
    const model = this.credentials.getAiModel() || DEFAULT_MODEL;

    void (async () => {
      try {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            ...(system ? { system } : {}),
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
          },
          { signal: controller.signal },
        );
        stream.on('text', (delta) => onChunk({ id, type: 'delta', text: delta }));
        await stream.finalMessage();
        onChunk({ id, type: 'done' });
      } catch (err) {
        // An aborted turn is intentional — close it quietly.
        if (controller.signal.aborted) onChunk({ id, type: 'done' });
        else onChunk({ id, type: 'error', text: errorText(err) });
      } finally {
        this.aborts.delete(id);
      }
    })();

    return { ok: true };
  }

  stop(id: string): { ok: boolean } {
    this.aborts.get(id)?.abort();
    this.aborts.delete(id);
    return { ok: true };
  }
}

function errorText(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return 'Claude rejected the API key — check it in Settings.';
    if (err.status === 429) return 'Claude is rate-limiting — try again in a moment.';
    return `Claude error ${err.status ?? ''}: ${err.message}`.trim();
  }
  return err instanceof Error ? err.message : 'Assistant request failed.';
}

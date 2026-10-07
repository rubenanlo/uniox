# Orb AI Assistant — Design

**Date:** 2026-08-19
**Status:** Approved (design + key decisions confirmed with user)

## Goal

Give the bottom-right assistant orb real AI capabilities. Today its hover menu
lists actions (summarize new emails/tasks, translate, rewrite, summarize thread,
create reply, …) but most are stubs that toast "coming soon". Make them work, and
add a conversational chat modal behind the orb.

## Decisions

- **Shape:** chat panel + quick actions. Quick actions seed the *same* conversation
  so results are refinable ("shorter", "in Spanish").
- **Provider:** Claude via `@anthropic-ai/sdk`, model `claude-opus-4-8`, streaming.
- **API key:** entered in Settings, stored via Electron `safeStorage` (same
  `CredentialStore` that holds email/Notion creds — see [[safestorage-name-pinned]]).
- **Orb interaction:** hover keeps the (now-functional) quick menu; clicking the
  orb opens the full chat modal, with the actions also as chips inside it.
- **Compose output:** rewrite/reply/write results go into the email composer draft.

## Architecture

State-based, no URL router. Two process boundaries:

### Main process (`packages/main`)
- `ai.ts` — `AiService` wrapping the Anthropic client. Key/model read from
  `CredentialStore` (`_ai_key`, `_ai_model`). Streaming turns via
  `client.messages.stream(...)`.
- `credentials.ts` — add `setAiKey`/`getAiKey`, `setAiModel`/`getAiModel`
  (mirror the `_notion_token` pattern).
- `index.ts` — register alongside the `notion:*` handlers:
  - query `ai:status` → `{ configured, model }`
  - command `ai:config` → save `{ key?, model? }`
  - command `ai:chat` → start a streaming turn `{ id, messages }`
  - command `ai:stop` → abort turn `{ id }` (stored `AbortController` per id)

### Streaming over IPC
`invoke` can't stream, so mirror the existing `onDelta` push channel:
- main pushes `webContents.send('ai:chunk', { id, type: 'delta'|'done'|'error', text })`.
- preload adds `onAiChunk(cb)`; `RendererApi` in `@app/shared` gains the method +
  an `AiChunk` type and `ai:*` `Queries`/`Commands` entries.

### Renderer
- `state/assistant.ts` — Zustand store: `open`, `messages[]`, `streaming`,
  `send()`, `runAction()`, `stop()`, `reset()`. Subscribes to `onAiChunk`.
- `lib/assistantContext.ts` — assembles inline context from current view/thread/
  composer (unread thread summaries, kanban tasks, open email text, draft text).
  **MVP: no tool-calling loop** — context is fetched client-side and sent inline.
- `components/orb/AssistantModal.tsx` — chat panel (message list + input + quick
  chips). Opened by orb click; closed via `useEscapeClose`.
- `OrbCorner.tsx` — click opens the modal; hover menu stays and its items call
  `runAction`. Compose actions (write/reply/rewrite) fill the composer.
- `ComposerState` gains optional `initialBody`; the composer seeds its editor with
  it. Compose actions gather the AI result, then open/fill the composer.
- `SettingsSheet` — new "AI" section: API key (password field → `ai:config`) +
  model dropdown (default Opus 4.8). Actions prompt "Add your API key in Settings"
  when unconfigured.

## New dependency
`@anthropic-ai/sdk` at the workspace root.

## Out of scope (YAGNI, MVP)
- Agentic tool-calling loop (assistant fetching data on demand).
- Cross-session chat persistence (conversation resets on reload).
- Provider choice beyond Claude.

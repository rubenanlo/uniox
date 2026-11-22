/**
 * r / ⇧R / f while the chat reading layout shows a thread: the open chat
 * answers in place (the full composer docked where its reply box is) instead
 * of the floating composer. ChatThreadView registers itself here while mounted.
 */
type ChatReplyMode = 'reply' | 'reply-all' | 'forward';
type Handler = (mode: ChatReplyMode) => void;

let active: { threadId: string; handler: Handler } | null = null;

export function registerChatReply(threadId: string, handler: Handler): () => void {
  const entry = { threadId, handler };
  active = entry;
  return () => {
    if (active === entry) active = null;
  };
}

/** True when the chat open on `threadId` took the reply. */
export function replyInChat(threadId: string, mode: ChatReplyMode): boolean {
  if (!active || active.threadId !== threadId) return false;
  active.handler(mode);
  return true;
}

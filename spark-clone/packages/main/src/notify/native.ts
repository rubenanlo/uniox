import type { NotifyPayload } from "@app/shared";
import type { CardAction } from "./card";

/**
 * The macOS Notification Center entry for a Uniox notification ("A · Mail
 * style", Ruben 2026-11-16): sender as the title, subject as the subtitle,
 * the preview as the body. Mail gets an inline Reply plus Mark read and Done;
 * meetings get Join and Snooze. Plain data, so it can be tested without
 * Electron.
 */
export interface NativeEntry {
  title: string;
  subtitle?: string;
  body: string;
  /** Buttons in order; macOS shows them under the entry's Options menu. */
  actions: { action: CardAction; text: string }[];
  hasReply: boolean;
  replyPlaceholder?: string;
}

function hhmm(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function firstName(title: string): string {
  const name = title.trim().split(/\s+/)[0] ?? "";
  return name.includes("@") ? name.split("@")[0]! : name;
}

export function nativeEntry(p: NotifyPayload): NativeEntry {
  if (p.category === "event") {
    const when = p.startMs ? hhmm(p.startMs) : "";
    const where = p.location || (p.meetingUrl ? "Video call" : "");
    const actions: NativeEntry["actions"] = [];
    if (p.meetingUrl) actions.push({ action: "join", text: "Join" });
    actions.push({ action: "snooze", text: "Snooze" });
    return {
      title: p.title,
      body: [when, where].filter(Boolean).join(" · ") || p.body,
      actions,
      hasReply: false,
    };
  }
  const canReply = !!p.threadId && !!p.accountId;
  const actions: NativeEntry["actions"] = [];
  if (p.threadId && p.accountId && p.messageId)
    actions.push({ action: "read", text: "Mark read" });
  if (p.threadId && p.accountId)
    actions.push({ action: "archive", text: "Done" });
  const name = firstName(p.title || p.fromEmail || "");
  const snippet = (p.snippet ?? "").replace(/\s+/g, " ").trim();
  return {
    title: p.title || p.fromEmail || "New email",
    subtitle: p.body || undefined,
    // An empty body hides the line on macOS; fall back to the subject when there's no preview yet.
    body: snippet || (p.body ? "" : "New email"),
    actions,
    hasReply: canReply,
    replyPlaceholder: canReply
      ? name
        ? `Reply to ${name}…`
        : "Reply…"
      : undefined,
  };
}

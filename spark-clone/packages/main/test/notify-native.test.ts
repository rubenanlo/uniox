import { describe, expect, it } from "vitest";
import { nativeEntry } from "../src/notify/native";

const mail = {
  title: "Ana García",
  body: "Q4 budget review",
  snippet: "  Hi Ruben,\n  numbers attached ",
  threadId: "t1",
  accountId: "a1",
  messageId: "m1",
  fromEmail: "ana@x.com",
};

describe("Notification Center entries", () => {
  it("lists mail as sender, subject and preview with Reply, Mark read and Done", () => {
    expect(nativeEntry(mail)).toEqual({
      title: "Ana García",
      subtitle: "Q4 budget review",
      body: "Hi Ruben, numbers attached",
      actions: [
        { action: "read", text: "Mark read" },
        { action: "archive", text: "Done" },
      ],
      hasReply: true,
      replyPlaceholder: "Reply to Ana…",
    });
  });

  it("drops actions it cannot carry out", () => {
    const e = nativeEntry({ title: "x@y.com", body: "", fromEmail: "x@y.com" });
    expect(e.actions).toEqual([]);
    expect(e.hasReply).toBe(false);
    expect(e.body).toBe("New email");
    expect(
      nativeEntry({ ...mail, messageId: undefined }).actions.map(
        (a) => a.action,
      ),
    ).toEqual(["archive"]);
    expect(nativeEntry({ ...mail, title: "ana@x.com" }).replyPlaceholder).toBe(
      "Reply to ana…",
    );
  });

  it("gives meetings Join and Snooze, and the time and place", () => {
    const startMs = new Date("2026-11-16T10:30:00").getTime();
    const e = nativeEntry({
      title: "Weekly sync",
      body: "in 5 min",
      category: "event",
      startMs,
      meetingUrl: "https://meet.google.com/x",
    });
    expect(e.actions.map((a) => a.action)).toEqual(["join", "snooze"]);
    expect(e.body).toMatch(/10:30.*· Video call$/);
    expect(e.hasReply).toBe(false);
    expect(
      nativeEntry({
        title: "Lunch",
        body: "Lunch soon",
        category: "event",
      }).actions.map((a) => a.action),
    ).toEqual(["snooze"]);
  });
});

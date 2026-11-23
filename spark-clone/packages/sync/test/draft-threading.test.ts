import { describe, expect, it } from "vitest";
import { MailDb, type MessageInsert } from "@app/db";
import type { Account, OutgoingDraft } from "@app/shared";
import { composeRaw } from "../src/send";

const account: Account = {
  id: "acc1",
  email: "me@dev.local",
  displayName: "Me",
  authType: "password",
  imap: { host: "localhost", port: 1143, secure: false },
  smtp: { host: "localhost", port: 1025, secure: false },
};

function msg(over: Partial<MessageInsert>): MessageInsert {
  return {
    id: "m1",
    accountId: "acc1",
    threadId: "t1",
    folderId: "f-inbox",
    uid: 1,
    messageIdHdr: "<orig@x>",
    inReplyTo: null,
    references: [],
    subject: "FABLE-C ISE",
    from: { name: "Aline", email: "aline@partner.example" },
    to: [{ email: "me@dev.local" }],
    cc: [],
    date: 1000,
    snippet: "",
    seen: true,
    flagged: false,
    answered: false,
    draft: false,
    hasAttachments: false,
    size: 1,
    ...over,
  };
}

function setup(): MailDb {
  const db = new MailDb(":memory:");
  db.insertAccount(account);
  db.upsertFolder({
    id: "f-inbox",
    accountId: "acc1",
    path: "INBOX",
    role: "inbox",
    delimiter: "/",
  });
  db.upsertFolder({
    id: "f-drafts",
    accountId: "acc1",
    path: "Drafts",
    role: "drafts",
    delimiter: "/",
  });
  db.createThread("t1", "acc1", "FABLE-C ISE");
  db.insertMessage(msg({}));
  return db;
}

const edited = (deleteDraftMessageId: string): OutgoingDraft => ({
  accountId: "acc1",
  to: [{ email: "aline@partner.example" }],
  cc: [],
  bcc: [],
  subject: "Re: FABLE-C ISE",
  html: "<p>v2</p>",
  text: "v2",
  deleteDraftMessageId,
  attachments: [],
});

describe("edited drafts keep their place in the conversation", () => {
  it("carries the stored draft In-Reply-To / References into the re-save", async () => {
    const db = setup();
    db.createThread("t2", "acc1", "Re: FABLE-C ISE");
    db.insertMessage(
      msg({
        id: "d1",
        threadId: "t1",
        folderId: "f-drafts",
        uid: 5,
        messageIdHdr: "<d1@x>",
        inReplyTo: "<orig@x>",
        references: ["<orig@x>"],
        subject: "Re: FABLE-C ISE",
        draft: true,
      }),
    );
    const raw = (await composeRaw(db, account, edited("d1"))).toString();
    expect(raw).toMatch(/In-Reply-To: <orig@x>/i);
    expect(raw).toMatch(/References: <orig@x>/i);
  });

  it('re-links a draft that already lost its headers by its "Re:" subject', async () => {
    const db = setup();
    db.createThread("t2", "acc1", "Re: FABLE-C ISE");
    db.insertMessage(
      msg({
        id: "d2",
        threadId: "t2",
        folderId: "f-drafts",
        uid: 6,
        messageIdHdr: "<d2@x>",
        subject: "Re: FABLE-C ISE",
        draft: true,
        from: { email: "me@dev.local" },
      }),
    );
    const raw = (await composeRaw(db, account, edited("d2"))).toString();
    expect(raw).toMatch(/In-Reply-To: <orig@x>/i);
  });

  it("leaves a brand-new draft without a reply target alone", async () => {
    const db = setup();
    const raw = (
      await composeRaw(db, account, { ...edited("nope"), subject: "Hello" })
    ).toString();
    expect(raw).not.toMatch(/In-Reply-To:/i);
  });
});

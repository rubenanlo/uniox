import { describe, expect, it } from 'vitest';
import { composeRaw, inlineDataImages } from '../src/send';
import type { Account, OutgoingDraft } from '@app/shared';
import type { MailDb } from '@app/db';

const B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('inlineDataImages', () => {
  it('turns data: images into cid: inline parts, sharing identical images', () => {
    const { html, images } = inlineDataImages(
      `<p>Hi</p><img width="10" src="data:image/png;base64,${B64}"><img src='data:image/png;base64,${B64}'>`,
    );
    expect(images).toHaveLength(1);
    expect(images[0]!.contentType).toBe('image/png');
    expect(images[0]!.filename).toBe('image-1.png');
    expect(images[0]!.content.subarray(1, 4).toString()).toBe('PNG');
    expect(html).toBe(
      `<p>Hi</p><img width="10" src="cid:${images[0]!.cid}"><img src='cid:${images[0]!.cid}'>`,
    );
  });

  it('leaves remote and cid images alone', () => {
    const src = '<img src="https://x.org/a.png"><img src="cid:a@b">';
    expect(inlineDataImages(src)).toEqual({ html: src, images: [] });
  });

  it('sends a pasted signature image as an inline related part', async () => {
    const draft = {
      accountId: 'a',
      to: [{ email: 'to@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Hi',
      text: 'Hi',
      html: `<p>Hi</p><img src="data:image/png;base64,${B64}">`,
      attachments: [],
    } as OutgoingDraft;
    const account = { email: 'me@example.com', displayName: 'Me' } as Account;
    const raw = (await composeRaw({} as MailDb, account, draft)).toString();
    expect(raw).toContain('multipart/related');
    const cid = /src=3D"cid:([^"]+)"|src="cid:([^"]+)"/.exec(raw);
    expect(cid).not.toBeNull();
    expect(raw).toMatch(/Content-Id: <sig-[0-9a-f]+@uniox>/i);
    expect(raw).not.toContain('data:image');
  });
});

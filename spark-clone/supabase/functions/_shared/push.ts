import webpush from 'npm:web-push@3.6.7';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import { env } from './db.ts';

let configured = false;

/** Sends a Web Push to every device the user registered; prunes dead ones. */
export async function pushToUser(
  db: SupabaseClient,
  userId: string,
  payload: { title: string; body: string; url: string; tag?: string; threadId?: string },
): Promise<void> {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  if (!publicKey) return; // push not set up yet
  if (!configured) {
    webpush.setVapidDetails(env('VAPID_SUBJECT', 'mailto:uniox@localhost'), publicKey, env('VAPID_PRIVATE_KEY'));
    configured = true;
  }
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, keys').eq('user_id', userId);
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600 });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push failed', status, (e as Error).message);
    }
  }
}

import type { MailDb } from '@app/db';

export type SchedulerFire =
  | { kind: 'snooze'; threadId: string; accountId: string; alert: boolean }
  | { kind: 'send'; scheduledId: string }
  | { kind: 'reminder'; threadId: string; accountId: string };

/**
 * Single durable scheduler (report §5.4): a next-deadline timer over the
 * wake_at / send_at / remind_at columns. fireDue consumes the due rows
 * (delete / status flip) before handing them to onFire, so a slow consumer
 * can never cause a refire loop.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: MailDb,
    private readonly onFire: (fire: SchedulerFire) => void,
  ) {}

  /** Call on boot and after any schedule mutation. */
  reschedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.nextDeadline();
    if (process.env['SPARKCLONE_SCHED_DEBUG']) console.log('[sched] reschedule next=', next && next - Date.now());
    if (next === null) return;
    const delay = Math.max(0, Math.min(next - Date.now(), 2 ** 31 - 1));
    this.timer = setTimeout(() => this.fireDue(), delay);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private nextDeadline(): number | null {
    const r = this.db.raw
      .prepare(
        `SELECT min(t) AS t FROM (
           SELECT min(wake_at) AS t FROM snoozes WHERE wake_at IS NOT NULL
           UNION ALL SELECT min(send_at) FROM scheduled_sends WHERE status = 'pending'
           UNION ALL SELECT min(remind_at) FROM reminders
         )`,
      )
      .get() as { t: number | null };
    return r?.t ?? null;
  }

  fireDue(): void {
    const now = Date.now();
    const fires: SchedulerFire[] = [];

    this.db.transaction(() => {
      const dueSnoozes = this.db.raw
        .prepare(
          `SELECT s.thread_id, s.alert, t.account_id FROM snoozes s
           JOIN threads t ON t.id = s.thread_id
           WHERE s.wake_at IS NOT NULL AND s.wake_at <= ?`,
        )
        .all(now) as { thread_id: string; alert: number; account_id: string }[];
      for (const s of dueSnoozes) {
        this.db.deleteSnooze(s.thread_id);
        fires.push({ kind: 'snooze', threadId: s.thread_id, accountId: s.account_id, alert: !!s.alert });
      }

      const dueSends = this.db.raw
        .prepare(`SELECT id FROM scheduled_sends WHERE status = 'pending' AND send_at <= ?`)
        .all(now) as { id: string }[];
      for (const s of dueSends) {
        this.db.setScheduledStatus(s.id, 'sending');
        fires.push({ kind: 'send', scheduledId: s.id });
      }

      const dueReminders = this.db.raw
        .prepare(
          `SELECT r.thread_id, t.account_id FROM reminders r
           JOIN threads t ON t.id = r.thread_id WHERE r.remind_at <= ?`,
        )
        .all(now) as { thread_id: string; account_id: string }[];
      for (const r of dueReminders) {
        this.db.deleteReminder(r.thread_id);
        fires.push({ kind: 'reminder', threadId: r.thread_id, accountId: r.account_id });
      }
    });

    if (process.env['SPARKCLONE_SCHED_DEBUG']) console.log('[sched] fireDue fires=', JSON.stringify(fires));
    for (const fire of fires) this.onFire(fire);
    this.reschedule();
  }
}

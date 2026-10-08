import { AlarmClock, Bell, CalendarClock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SchedulingPresets } from '@app/shared';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { loadPresets, presetOptions, fmtDay } from '../lib/schedule';

export interface SchedulePickerProps {
  title: string;
  icon: 'snooze' | 'remind' | 'send';
  /** offer the timerless "Someday" option (snooze only) */
  someday?: boolean;
  /** offer the "Notify me" toggle (snooze) */
  notifyToggle?: boolean;
  onPick(when: number | null, notify: boolean): void;
  onClose(): void;
}

const ICONS = { snooze: AlarmClock, remind: Bell, send: CalendarClock };

export function SchedulePicker({ title, icon, someday, notifyToggle, onPick, onClose }: SchedulePickerProps) {
  const [presets, setPresets] = useState<SchedulingPresets | null>(null);
  const [notify, setNotify] = useState(true);
  const [custom, setCustom] = useState('');
  const Icon = ICONS[icon];

  useEffect(() => {
    void loadPresets((key) => api.query('settings:get', { key })).then((p) => {
      setPresets(p);
      setNotify(p.notify);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  if (!presets) return null;
  const options = presetOptions(presets, { someday: !!someday });

  return (
    <div
      className="no-drag pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="border-hairline bg-surface w-[340px] max-w-[92vw] rounded-2xl border p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <Icon size={15} className="text-accent" />
          <h2 className="flex-1 text-[13.5px] font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink">
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          {options.map((opt) => (
            <button
              key={opt.id}
              autoFocus={opt.id === 'later'}
              onClick={() => onPick(opt.when, notify)}
              className="hover:bg-accent-soft hover:text-accent flex items-center justify-between rounded-lg px-3 py-2 text-left text-[12.5px]"
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-ink-faint text-[11.5px]">{opt.detail}</span>
            </button>
          ))}
        </div>

        <div className="border-hairline mt-3 border-t pt-3">
          <div className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Pick a date and time"
              className={cn(
                'border-hairline bg-sunken flex-1 rounded-lg border px-2 py-1.5 text-[12px]',
                'focus:ring-accent focus:outline-none focus:ring-2',
              )}
            />
            <button
              disabled={!custom}
              onClick={() => {
                const t = new Date(custom).getTime();
                if (Number.isFinite(t)) onPick(t, notify);
              }}
              className="bg-accent rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              Set
            </button>
          </div>
          {custom && Number.isFinite(new Date(custom).getTime()) && (
            <p className="text-ink-faint mt-1 text-[11px]">{fmtDay(new Date(custom))}</p>
          )}
          {notifyToggle && (
            <label className="text-ink-muted mt-2 flex items-center gap-1.5 text-[12px]">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              Notify me when it returns
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

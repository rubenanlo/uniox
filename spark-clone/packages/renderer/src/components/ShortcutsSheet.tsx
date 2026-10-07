import { X } from 'lucide-react';
import { ACTIONS, comboLabel } from '../actions/registry';
import { useEscapeClose } from '../hooks/useEscapeClose';
import { useUi } from '../state/store';
import { Keycaps } from './ui/Keycap';

export function ShortcutsSheet() {
  const { shortcutsOpen, setShortcutsOpen } = useUi();
  useEscapeClose(shortcutsOpen, () => setShortcutsOpen(false));
  if (!shortcutsOpen) return null;
  const sections = [...new Set(ACTIONS.map((a) => a.section))];

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={() => setShortcutsOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
        className="border-hairline bg-surface max-h-[80vh] w-[520px] max-w-[92vw] overflow-y-auto rounded-2xl border p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-bold">Keyboard shortcuts</h2>
          <button onClick={() => setShortcutsOpen(false)} aria-label="Close" className="text-ink-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <p className="text-ink-muted mb-4 text-[12px]">
          Spark Desktop’s default map. Actions apply to the hovered email — the row with the cobalt rail.
        </p>
        <div className="grid grid-cols-2 gap-x-6">
          {sections.map((section) => (
            <div key={section} className="mb-4">
              <h3 className="text-ink-faint mb-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
                {section}
              </h3>
              {ACTIONS.filter((a) => a.section === section).map((a) => (
                <div key={a.id} className="flex items-center justify-between py-1 text-[12.5px]">
                  <span className={a.disabledReason ? 'text-ink-faint' : ''}>{a.label}</span>
                  <span className="flex items-center gap-1.5">
                    <Keycaps keys={comboLabel(a.combo)} />
                    {a.altCombo && (
                      <>
                        <span className="text-ink-faint text-[10px]">or</span>
                        <Keycaps keys={comboLabel(a.altCombo)} />
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

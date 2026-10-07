import { Check } from 'lucide-react';
import { cn, COLOR_SWATCHES } from '../../lib/utils';

/**
 * A curated row of color swatches with a custom-color escape hatch. `value` is
 * the chosen custom color, or null to follow `defaultColor` (selecting the
 * leading swatch calls onReset). The selected swatch carries a ring in its own
 * color, so the choice reads at a glance.
 */
export function ColorPicker({
  value,
  defaultColor,
  onSelect,
  onReset,
  ariaLabel,
  swatches = COLOR_SWATCHES,
}: {
  value: string | null;
  defaultColor: string;
  onSelect: (hex: string) => void;
  onReset: () => void;
  ariaLabel: string;
  swatches?: { name: string; hex: string }[];
}) {
  const custom = value && !swatches.some((s) => s.hex.toLowerCase() === value.toLowerCase());

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      <Swatch color={defaultColor} selected={value === null} onClick={onReset} label="Default" />
      {swatches.map((s) => (
        <Swatch
          key={s.hex}
          color={s.hex}
          selected={value?.toLowerCase() === s.hex.toLowerCase()}
          onClick={() => onSelect(s.hex)}
          label={s.name}
        />
      ))}
      <label
        title="Pick a custom color"
        className={cn(
          'relative grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-full',
          'ring-offset-surface focus-within:ring-ink focus-within:ring-2 focus-within:ring-offset-2',
        )}
        style={{
          background: custom
            ? (value as string)
            : 'conic-gradient(from 0deg, #e11d48, #d97706, #059669, #0891b2, #4f46e5, #c026d3, #e11d48)',
          boxShadow: custom ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${value}` : undefined,
        }}
      >
        {custom && <Check size={11} strokeWidth={3} className="text-white drop-shadow" />}
        <input
          type="color"
          aria-label="Custom color"
          value={custom ? (value as string) : defaultColor}
          onChange={(e) => onSelect(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

function Swatch({
  color,
  selected,
  onClick,
  label,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="ring-offset-surface focus-visible:ring-ink grid h-5 w-5 shrink-0 place-items-center rounded-full transition-transform focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      style={{
        background: color,
        boxShadow: selected ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${color}` : undefined,
      }}
    >
      {selected && <Check size={11} strokeWidth={3} className="text-white drop-shadow" />}
    </button>
  );
}

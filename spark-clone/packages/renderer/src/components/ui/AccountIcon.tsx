import { cn, defaultAccountColor, initials } from '../../lib/utils';

/**
 * Account picture when one is set (Settings → Accounts), otherwise a
 * colored-initials fallback in the account's identity color. `color` overrides
 * the default; `index` (list position) supplies that default when it doesn't.
 */
export function AccountIcon({
  label,
  index,
  avatar,
  color,
  className,
}: {
  label: string;
  index: number;
  avatar?: string;
  color?: string;
  className?: string;
}) {
  if (avatar) {
    return <img src={avatar} alt="" className={cn('rounded-lg object-cover', className)} />;
  }
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-lg font-bold text-white',
        className,
      )}
      style={{ background: color ?? defaultAccountColor(index) }}
    >
      {initials(label)}
    </span>
  );
}

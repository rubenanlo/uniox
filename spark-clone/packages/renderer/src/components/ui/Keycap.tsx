export function Keycaps({ keys }: { keys: string[] }) {
  if (!keys.length) return null;
  return (
    <span className="inline-flex gap-[3px]" aria-hidden>
      {keys.map((k, i) => (
        <kbd key={i} className="keycap">
          {k}
        </kbd>
      ))}
    </span>
  );
}

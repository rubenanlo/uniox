import { Fragment, type ReactNode } from 'react';

/**
 * A small, safe Markdown renderer for Assistant answers: paragraphs, line
 * breaks, headings, bullet and numbered lists, **bold**, *italic*, `code` and
 * [links](https://…). It builds React nodes (never HTML strings), so model
 * output can't inject markup. `animate` wraps each word in `.assistant-word`
 * so a streaming answer keeps its ease-in.
 */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[]; start: number };

const BULLET = /^\s*[-*+•]\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { kind: 'ul' | 'ol' }> | null = null;
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', lines: para });
    para = [];
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    const n = NUMBER.exec(line);
    if (h) {
      flush();
      blocks.push({ kind: 'h', level: h[1]!.length, text: h[2]! });
    } else if (b || n) {
      const kind = b ? 'ul' : 'ol';
      if (para.length) {
        blocks.push({ kind: 'p', lines: para });
        para = [];
      }
      if (!list || list.kind !== kind) {
        if (list) blocks.push(list);
        list = { kind, items: [], start: n ? Number(n[1]) : 1 };
      }
      list.items.push(b ? b[1]! : n![2]!);
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // An indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) {
        blocks.push(list);
        list = null;
      }
      para.push(line);
    }
  }
  flush();
  return blocks;
}

// Longest-first so `**` wins over `*`. Links only allow http(s) and mailto.
const INLINE =
  /(\*\*([^*]+?)\*\*|__([^_]+?)__|`([^`]+?)`|\[([^\]]+?)\]\(((?:https?:|mailto:)[^)\s]+)\)|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w]))/g;

function words(text: string, animate: boolean, key: string): ReactNode {
  if (!animate) return text;
  return (text.match(/\s*\S+\s*|\s+/g) ?? []).map((w, i) => (
    <span key={`${key}-${i}`} className="assistant-word">
      {w}
    </span>
  ));
}

export function renderInline(text: string, animate = false, key = 'i'): ReactNode[] {
  // While streaming, a lone trailing `**` would flash literally; hide it.
  const src = animate
    ? text.replace(/(\*\*|__|`)([^*_`]*)$/, (m, mark: string, rest: string) => {
        const count = text.split(mark).length - 1;
        return count % 2 === 1 ? rest : m;
      })
    : text;
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of src.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last)
      out.push(
        <Fragment key={`${key}t${n}`}>
          {words(src.slice(last, at), animate, `${key}t${n}`)}
        </Fragment>,
      );
    const k = `${key}m${n++}`;
    if (m[2] ?? m[3])
      out.push(
        <strong key={k} className="font-semibold">
          {renderInline(m[2] ?? m[3]!, animate, k)}
        </strong>,
      );
    else if (m[4])
      out.push(
        <code key={k} className="bg-sunken rounded px-1 py-px font-mono text-[11.5px]">
          {m[4]}
        </code>,
      );
    else if (m[5]) {
      const href = m[6]!;
      out.push(
        <a
          key={k}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            window.open(href, '_blank', 'noopener');
          }}
          className="text-accent underline decoration-current/30 underline-offset-2 hover:decoration-current"
        >
          {renderInline(m[5], animate, k)}
        </a>,
      );
    } else out.push(<em key={k}>{renderInline(m[7] ?? m[8]!, animate, k)}</em>);
    last = at + m[0].length;
  }
  if (last < src.length)
    out.push(<Fragment key={`${key}end`}>{words(src.slice(last), animate, `${key}end`)}</Fragment>);
  return out;
}

export function Markdown({ text, animate = false }: { text: string; animate?: boolean }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.kind === 'h')
          return (
            <p key={k} className={b.level <= 2 ? 'text-[13.5px] font-semibold' : 'font-semibold'}>
              {renderInline(b.text, animate, k)}
            </p>
          );
        if (b.kind === 'p')
          return (
            <p key={k}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {renderInline(l, animate, `${k}l${j}`)}
                </Fragment>
              ))}
            </p>
          );
        const List = b.kind;
        return (
          <List
            key={k}
            start={b.kind === 'ol' && b.start !== 1 ? b.start : undefined}
            className={
              b.kind === 'ul'
                ? 'marker:text-ink-faint flex list-disc flex-col gap-1 pl-4'
                : 'marker:text-ink-faint flex list-decimal flex-col gap-1 pl-5'
            }
          >
            {b.items.map((it, j) => (
              <li key={j} className="pl-0.5">
                {renderInline(it, animate, `${k}i${j}`)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

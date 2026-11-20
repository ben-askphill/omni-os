// The tool row over the screenshot an annotation is drawn on: select, pen, shapes, text, color and line width. It holds
// no state of its own; BrowserAnnotate's Draw owns the tool and the style.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { MARK_COLORS, MARK_STROKES, type MarkShape, type MarkTool } from '@omni/shared/message-context-marks.ts';
import { Icon, IconButton, type IconName } from './ui.tsx';
import { useDismissLayer } from './ui/dismiss-stack.ts';
import { useExit } from './ui/use-exit.ts';
import { ROVING_ITEM, useRovingFocus } from './ui/use-roving-focus.ts';

export type Tool = 'select' | MarkTool;

export const SHAPES: { shape: MarkShape; label: string; icon: IconName }[] = [
  { shape: 'rect', label: 'Rectangle', icon: 'square' },
  { shape: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
  { shape: 'arrow', label: 'Arrow', icon: 'arrowUpRight' },
  { shape: 'line', label: 'Line', icon: 'line' },
];
const SHAPE_NAMES: string[] = SHAPES.map((s) => s.shape);
export const isShape = (t: Tool): t is MarkShape => SHAPE_NAMES.includes(t);

/** The keys that walk a popup's items: it is a row, so Left and Right, and Up and Down too. */
const STEP: Record<string, 1 | -1 | 'first' | 'last'> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };

/**
 * A button with a small menu under it. It opens on the checked item, the arrow keys, Home and End walk its items, Enter
 * or Space picks, and Escape closes only it (the annotation view stays) and puts the focus back on the button. Tab
 * closes it and moves on.
 */
function Menu({ label, face, active, children }: { label: string; face: ReactNode; active?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const exit = useExit(open, list);
  const items = () => [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  useDismissLayer(open, {
    roots: () => [root.current],
    escape: () => close(!!list.current?.contains(document.activeElement)),
    outside: () => close(false),
  });
  useEffect(() => {
    if (!open) return;
    const all = items();
    (all.find((el) => el.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
  }, [open]);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Tab') return close(false);
    const step = STEP[e.key];
    if (!step) return;
    e.preventDefault();
    // The toolbar's own arrow keys stay out of it.
    e.stopPropagation();
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to = step === 'first' ? 0 : step === 'last' ? all.length - 1 : (at + step + all.length) % all.length;
    all[to]?.focus();
  };
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-on={active || undefined}
        {...ROVING_ITEM}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (open || e.key !== 'ArrowDown') return;
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="hov press inline-flex h-8 items-center gap-0.5 rounded-full pr-1.5 pl-2 text-fg-3 transition-colors hover:text-fg data-[on=true]:text-fg"
      >
        {face}
        <Icon name="chevronDown" size={11} />
      </button>
      {exit.shown && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          aria-orientation="horizontal"
          data-closing={exit.closing || undefined}
          onKeyDown={onKey}
          className="menu-pop pop-in absolute top-full left-0 z-30 mt-1 flex gap-1 rounded-xl bg-surface-2 p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.35),0_0_0_1px_var(--line)]"
        >
          {children(() => close(true))}
        </div>
      )}
    </div>
  );
}

export function MarkToolbar({
  tool,
  shape,
  color,
  stroke,
  canUndo,
  canDelete,
  onTool,
  onShape,
  onColor,
  onStroke,
  onUndo,
  onDelete,
  onClear,
}: {
  tool: Tool;
  shape: MarkShape;
  color: string;
  stroke: number;
  canUndo: boolean;
  canDelete: boolean;
  onTool: (t: Tool) => void;
  onShape: (s: MarkShape) => void;
  onColor: (hex: string) => void;
  onStroke: (n: number) => void;
  onUndo: () => void;
  onDelete: () => void;
  /** Clear: every mark goes. Offered where there is no picked area to keep (an image file). Enabled with `canUndo`. */
  onClear?: () => void;
}) {
  const current = SHAPES.find((s) => s.shape === shape)!;
  // One Tab stop: the arrow keys, Home and End move between the tools, and Tab comes back to the last one used.
  const roving = useRovingFocus();
  return (
    <div ref={roving.ref} onKeyDown={roving.onKeyDown} onFocus={roving.onFocus} role="toolbar" aria-label="Annotation tools" className="flex shrink-0 flex-wrap items-center gap-0.5 px-2 pb-1">
      <IconButton {...ROVING_ITEM} icon="pointer" label="Select" size={15} pressed={tool === 'select'} onClick={() => onTool('select')} />
      <IconButton {...ROVING_ITEM} icon="pencil" label="Pen" size={15} pressed={tool === 'pen'} onClick={() => onTool('pen')} />
      <Menu label={isShape(tool) ? `Shapes, ${current.label} on` : 'Shapes'} active={isShape(tool)} face={<Icon name={current.icon} size={15} />}>
        {(close) =>
          SHAPES.map((s) => (
            <IconButton
              key={s.shape}
              icon={s.icon}
              label={s.label}
              size={15}
              role="menuitemradio"
              aria-checked={shape === s.shape}
              active={shape === s.shape}
              onClick={() => {
                onShape(s.shape);
                onTool(s.shape);
                close();
              }}
            />
          ))
        }
      </Menu>
      <IconButton {...ROVING_ITEM} icon="type" label="Text" size={15} pressed={tool === 'text'} onClick={() => onTool('text')} />
      <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
      <Menu label="Color" face={<span className="h-4 w-4 rounded-full shadow-[0_0_0_1px_var(--line-strong)]" style={{ background: color }} />}>
        {(close) =>
          MARK_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              role="menuitemradio"
              aria-checked={c.hex === color}
              aria-label={c.name}
              title={c.name}
              onClick={() => {
                onColor(c.hex);
                close();
              }}
              className="grid h-7 w-7 place-items-center rounded-full"
            >
              <span className="h-5 w-5 rounded-full" style={{ background: c.hex, boxShadow: c.hex === color ? '0 0 0 2px var(--bg), 0 0 0 3.5px var(--fg-2)' : '0 0 0 1px var(--line-strong)' }} />
            </button>
          ))
        }
      </Menu>
      <Menu label="Line width" face={<span className="block w-4 rounded-full bg-current" style={{ height: Math.max(2, stroke) }} />}>
        {(close) =>
          MARK_STROKES.map((n) => (
            <button
              key={n}
              type="button"
              role="menuitemradio"
              aria-checked={n === stroke}
              aria-label={`${n} pixels`}
              title={`${n} px`}
              onClick={() => {
                onStroke(n);
                close();
              }}
              data-on={n === stroke || undefined}
              className="hov grid h-8 w-10 place-items-center rounded-lg text-fg-3 data-[on=true]:text-fg"
            >
              <span className="block w-6 rounded-full bg-current" style={{ height: n }} />
            </button>
          ))
        }
      </Menu>
      <span className="flex-1" />
      <IconButton {...ROVING_ITEM} icon="undo" label="Undo the last mark" size={15} disabled={!canUndo} onClick={onUndo} />
      <IconButton {...ROVING_ITEM} icon="trash" label="Delete the selected mark" size={15} disabled={!canDelete} onClick={onDelete} />
      {onClear && (
        <button
          type="button"
          {...ROVING_ITEM}
          aria-label="Clear all marks"
          title="Clear all marks"
          disabled={!canUndo}
          onClick={onClear}
          className="hov press h-8 rounded-full px-2.5 text-[12px] font-medium text-fg-3 transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-40"
        >
          Clear
        </button>
      )}
    </div>
  );
}

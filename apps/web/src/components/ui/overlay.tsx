import type { ReactNode } from 'react';
import { Kbd } from './feedback.tsx';

// One overlay language for the palette, the slash menu and the context menus: the surface, the row at two densities,
// and the keyboard hints. Modals take ModalFooter (modal.tsx).

/** A menu's surface: the slash menu and context menus. The palette and modals sit on --r-3xl. */
export const MENU_SURFACE = 'rounded-[var(--r-2xl)] bg-elev shadow-[var(--shadow-menu)]';

/**
 * A row in an overlay. `lg`: the palette and slash menu, 48px with a lead or two lines. `sm`: context menus, 32px.
 * The cursor (`data-active="true"`), a hover and keyboard focus all take the one selected fill, --wash. `fill: false`
 * for a list whose sliding thumb draws that fill (the palette), or a row that cannot run.
 */
export function overlayRow(density: 'lg' | 'sm', fill = true): string {
  const size = density === 'lg' ? 'min-h-12 gap-3 rounded-[var(--r-md)] px-3' : 'min-h-8 gap-2.5 rounded-[var(--r-sm)] px-2.5';
  const wash = fill ? 'hover:bg-[var(--wash)] focus-visible:bg-[var(--wash)] data-[active=true]:bg-[var(--wash)]' : '';
  return `flex w-full items-center text-left text-[13px] text-fg outline-none ${wash} ${size}`;
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** The platform's command key, as a keycap. */
export const MOD_KEY = mac ? '⌘' : 'Ctrl';

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex gap-[3px]">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}

/** The keys a menu row answers to, on its right edge. */
export function RowKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="ml-auto shrink-0 pl-3" aria-hidden="true">
      <Keys keys={keys} />
    </span>
  );
}

export type KbdHint = readonly [keys: readonly string[], label: string];

/** The keys an overlay answers to, along its bottom edge. Hidden at phone width, where no keyboard is assumed. */
export function KbdFooter({ hints, className = '' }: { hints: readonly KbdHint[]; className?: string }) {
  return (
    <div className={`hidden shrink-0 items-center gap-4 border-t border-line px-4 py-2.5 text-[11.5px] text-fg-3 sm:flex ${className}`}>
      {hints.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-1.5 whitespace-nowrap">
          <Keys keys={keys} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** One key hint inline, as a modal footer leads with. */
export function KbdHintText({ keys, children }: { keys: readonly string[]; children: ReactNode }) {
  return (
    <span className="hidden items-center gap-1.5 text-[12px] text-fg-3 sm:inline-flex">
      <Keys keys={keys} />
      {children}
    </span>
  );
}

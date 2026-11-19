// The phone's sheets as modals: which layer is on screen, and the stack of open sheets that keeps what is behind the
// top one inert. MobileShell provides both; MoSheet (parts.tsx) reads them.
import { createContext } from 'react';

/** Whether the layer this sits in (a tab root or a pushed screen) is the one on screen. */
export const LayerShownCtx = createContext(true);

/**
 * The open sheets, the top one last, and what sits behind them. While a sheet is open the screens and the tab bar
 * behind it are inert, and so is every sheet under the top one. Set straight on the elements, not through a render,
 * so a sheet that closes can hand the focus back to its trigger in the same step.
 */
export class SheetStack {
  private sheets: HTMLElement[] = [];
  private behind = new Map<string, HTMLElement>();

  /** A part of the page that goes inert under a sheet: the screens, the tab bar. `null` when it unmounts. */
  base(name: string, el: HTMLElement | null) {
    if (el) this.behind.set(name, el);
    else this.behind.delete(name);
    this.apply();
  }

  open(el: HTMLElement) {
    if (!this.sheets.includes(el)) this.sheets.push(el);
    this.apply();
  }

  close(el: HTMLElement) {
    this.sheets = this.sheets.filter((s) => s !== el);
    el.inert = false;
    this.apply();
  }

  top(): HTMLElement | null {
    return this.sheets.at(-1) ?? null;
  }

  private apply() {
    const covered = this.sheets.length > 0;
    for (const el of this.behind.values()) el.inert = covered;
    this.sheets.forEach((s, i) => (s.inert = i < this.sheets.length - 1));
  }
}

/** Where the shell's sheets render, over every screen and the tab bar, and their stack. Null outside the phone shell. */
export const SheetHostCtx = createContext<{ el: HTMLElement; stack: SheetStack } | null>(null);

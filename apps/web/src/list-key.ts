/**
 * The key that collapses and expands the rail's list panel: ⌘\ on macOS, Ctrl+\ elsewhere. `e.code` as well as `e.key`,
 * so a layout where Backslash types another character still has it. Left alone: while an IME composes, and Ctrl+\ in
 * the terminal (`.xterm`), which is SIGQUIT there. The caller checks the layout, that a list shows and that no layer is
 * open (App.tsx).
 */
export function isListToggleKey(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'target'>, mac: boolean): boolean {
  if (e.key !== '\\' && e.code !== 'Backslash') return false;
  if (e.isComposing || e.altKey || e.shiftKey) return false;
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return false;
  if (e.ctrlKey && e.target instanceof HTMLElement && e.target.closest('.xterm')) return false;
  return true;
}

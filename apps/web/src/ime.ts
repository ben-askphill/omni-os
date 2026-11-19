/**
 * A key press that belongs to an IME composition (Japanese, Chinese or Korean input): the Enter that confirms a
 * candidate must not send, save, rename or pick. Safari fires that confirming keydown with keyCode 229 after the
 * composition has ended, without `isComposing`, so both signals count. Takes a React or a DOM keyboard event.
 *
 * Every Enter handler on a text field checks it first; tests/ime-enter.test.ts fails on one that doesn't.
 */
export function isImeEnter(e: { keyCode?: number; isComposing?: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  return !!(e.isComposing || e.nativeEvent?.isComposing) || e.keyCode === 229;
}

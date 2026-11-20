import { act } from 'react';

// The composer's text box (components/composer/MessageEditor.tsx) is a ui-sdk Token Input, a contenteditable. happy-dom
// can't type into it with key events, but the editor reads the text back from an `input` event, as after a paste.

export const messageBox = (root: ParentNode = document) => root.querySelector<HTMLElement>('[data-slot="token-input-editor"]');

/** Replaces the box's text with `text`, as an edit Ben made. */
export async function typeIn(box: HTMLElement, text: string) {
  await act(async () => {
    box.focus();
    box.textContent = text;
    box.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
  });
}

import { describe, expect, it } from 'vitest';
import { ANNOTATE_WIDTH, annotatedName, annotationCanvas, annotationPrompt, annotationTarget, markInImage } from '../image-annotation.ts';
import type { Mark } from '../message-context-marks.ts';

// Sending an annotated image from the Files panel: where it goes, the size marks are drawn at, the attachment's name
// and the words the agent reads with it.

const box: Mark = { type: 'rect', color: '#ff4420', stroke: 4, x: 10, y: 20, width: 100, height: 50 };
const arrow: Mark = { type: 'arrow', color: '#3b82f6', stroke: 4, x0: 200, y0: 200, x1: 120, y1: 60 };
const note: Mark = { type: 'text', color: '#ff4420', stroke: 4, x: 130, y: 30, text: 'Make this bigger' };
const second: Mark = { type: 'text', color: '#2ec27e', stroke: 2, x: 5, y: 300, text: 'Wrong color' };

describe('annotationTarget', () => {
  it('sends a delegated thread file to that thread, and the panel thread own file to it', () => {
    expect(annotationTarget({ thread_id: 'child' }, 'parent')).toBe('child');
    expect(annotationTarget({ thread_id: 'parent' }, 'parent')).toBe('parent');
    expect(annotationTarget({ thread_id: '' }, 'parent')).toBe('parent');
  });
});

describe('annotationCanvas', () => {
  it('draws a wide image at ANNOTATE_WIDTH and a small one at its own size', () => {
    expect(annotationCanvas({ width: 2560, height: 1600 })).toEqual({ width: ANNOTATE_WIDTH, height: 800, k: 2 });
    expect(annotationCanvas({ width: 800, height: 600 })).toEqual({ width: 800, height: 600, k: 1 });
  });
});

describe('annotatedName', () => {
  it('keeps the base name and names the type it was rendered as', () => {
    expect(annotatedName('hero-shot.png', 'image/png')).toBe('hero-shot-annotated.png');
    expect(annotatedName('photo.jpeg', 'image/jpeg')).toBe('photo-annotated.jpg');
    expect(annotatedName('.png', 'image/png')).toBe('image-annotated.png');
  });
});

describe('markInImage', () => {
  it('scales a mark into the image pixels', () => {
    expect(markInImage(box, 2)).toEqual({ ...box, stroke: 8, x: 20, y: 40, width: 200, height: 100 });
    expect(markInImage(arrow, 1)).toBe(arrow);
  });
});

describe('annotationPrompt', () => {
  it('leads with the message, numbers the text notes and lists the other marks in image pixels', () => {
    const text = annotationPrompt({ message: '  Tighten the header  ', source: 'hero.png', marks: [box, note, arrow, second], k: 2 });
    expect(text).toBe(
      [
        'Tighten the header',
        '',
        "The attached image is hero.png, marked up. Positions are in the image's pixels from its top left.",
        '',
        'Notes on the image:',
        '1. "Make this bigger" (red, at x 260, y 60)',
        '2. "Wrong color" (green, at x 10, y 600)',
        '',
        'Marks:',
        '- red rectangle at x 20, y 40, 200×100',
        '- blue arrow from x 400, y 400 to x 240, y 120 (the head is at the end)',
      ].join('\n'),
    );
  });

  it('names the delegated thread a file came from when it goes elsewhere, and works with no message or marks', () => {
    const text = annotationPrompt({ message: '', source: 'a.png', from: 'Build the hero', marks: [], k: 1 });
    expect(text).toBe(`The attached image is a.png from "Build the hero", marked up. Positions are in the image's pixels from its top left.`);
  });
});

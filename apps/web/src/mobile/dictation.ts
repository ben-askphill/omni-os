// The mic button: the browser's own speech recognition, where it has one (Safari and Chrome do). The words land in
// the input for Ben to read before he sends them.
import { useEffect, useRef, useState } from 'react';

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/** `onText` gets each finished phrase. `supported` is false where the browser has no recognition. */
export function useDictation(onText: (text: string) => void) {
  const [on, setOn] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => rec.current?.abort(), []);
  const Ctor = ctor();
  const toggle = () => {
    if (rec.current) return rec.current.stop();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = navigator.language;
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results, (x) => x[0]?.transcript ?? '').join(' ').trim();
      if (text) cb.current(text);
    };
    r.onend = r.onerror = () => {
      rec.current = null;
      setOn(false);
    };
    rec.current = r;
    r.start();
    setOn(true);
  };
  return { supported: !!Ctor, on, toggle };
}

/** Text with a dictated phrase added after it. */
export const withPhrase = (text: string, phrase: string) => (text.trim() ? `${text.replace(/\s+$/, '')} ${phrase}` : phrase);

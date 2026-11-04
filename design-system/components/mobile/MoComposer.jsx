import React from 'react';
import { MoActionChip, MoRoundButton } from './MoButtons.jsx';

/* Composer pinned above the keyboard: action chips for this thread, then one line with + (attach, model, effort),
   the field, and mic until there is text, then send. Stop replaces mic while a turn runs and the box is empty.
   The placeholder names who you are talking to. */
export function MoComposer({ placeholder = 'Message', value, onChangeText, actions = [], onSend, onPlus, onStop, onDictate, children }) {
  const [own, setOwn] = React.useState('');
  const v = value ?? own;
  const set = onChangeText ?? setOwn;
  const send = () => { const t = v.trim(); if (!t) return; onSend && onSend(t); if (value == null) setOwn(''); };
  return (
    <div className="om-mo-composer">
      {actions.length > 0 && <div className="om-mo-composer__chips">{actions.map((a) => <MoActionChip key={a.label} {...a} />)}</div>}
      {children}
      <div className="om-mo-composer__box">
        <MoRoundButton icon="plus" label="Attach, model and effort" onPress={onPlus} />
        <input className="om-mo-composer__input" value={v} placeholder={placeholder} onChange={(e) => set(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        {v.trim() ? <MoRoundButton tone="ink" icon="send" label="Send" onPress={send} />
          : onStop ? <MoRoundButton tone="ink" icon="stop" label="Stop" onPress={onStop} />
          : <MoRoundButton tone="quiet" icon="mic" label="Dictate" onPress={onDictate} />}
      </div>
    </div>
  );
}

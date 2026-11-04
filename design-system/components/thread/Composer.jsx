import React, { useState } from 'react';
import { Icon } from '../icons/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';
import { CrewMark } from '../icons/CrewMark.jsx';
import { Picker } from '../forms/Picker.jsx';
import { HarnessLogo } from '../icons/HarnessMark.jsx';

const ROLES = [
  { value: 'conductor', label: 'Conductor', sub: 'Delegates to the crew' },
  { value: 'researcher', label: 'Researcher', sub: 'Reads, measures, reports' },
  { value: 'builder', label: 'Builder', sub: 'Changes code, opens PRs' },
  { value: 'store-ops', label: 'Store ops', sub: 'Shopify admin, automations' },
  { value: 'inbox', label: 'Inbox', sub: 'Drafts replies' }
];
const HARN = [
  { value: 'claude-code', label: 'Claude Code', sub: 'Claude plan' },
  { value: 'codex', label: 'Codex', sub: 'ChatGPT plan' },
  { value: 'cursor', label: 'Cursor', sub: 'Cursor plan' }
];

/* Composer (web/src Composer.tsx): 26px-radius surface shell, Bencho pickers for role / channel / harness, round ink send. */
export function Composer({ placeholder = 'Ask the Conductor. It delegates to the crew.', role = 'conductor', channel, channels, harness = 'claude-code', model, onSend, hints = true, big = false, value, onChange, up = true }) {
  const [inner, setInner] = useState('');
  const [r, setR] = useState(role);
  const [h, setH] = useState(harness);
  const [ch, setCh] = useState(channel ? channel.name : null);
  const v = value ?? inner;
  const set = (x) => (onChange ? onChange(x) : setInner(x));
  const send = () => { if (!v.trim()) return; onSend && onSend(v.trim()); if (value === undefined) setInner(''); };
  const chOpts = (channels || (channel ? [channel] : [])).map((c) => ({ value: c.name, label: '#' + c.name, avatar: c.name }));
  return (
    <div>
      <div className={'om-composer' + (big ? ' om-composer--big' : '')}>
        <textarea rows={2} value={v} placeholder={placeholder} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} aria-label="Message" />
        <div className="om-composer__bar">
          <div className="om-composer__ctx">
            <Picker label="Crew role" value={r} onChange={setR} up={up} options={ROLES.map((o) => ({ ...o, lead: <span style={{ display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: '50%', background: 'var(--bg)' }}><CrewMark role={o.value} size={13} /></span> }))} />
            {chOpts.length > 0 && <Picker label="Channel" value={ch} onChange={setCh} options={chOpts} up={up} />}
            <Picker label="Harness" value={h} onChange={setH} up={up} options={HARN.map((o) => ({ ...o, sub: o.sub + (model && o.value === h ? ' · ' + model : ''), lead: <span style={{ display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: '50%', background: 'var(--bg)', color: 'var(--fg)' }}><HarnessLogo harness={o.value} size={13} /></span> }))} />
            <IconButton label="Attach files" icon="paperclip" iconSize={15} />
          </div>
          <button type="button" className="om-send" aria-label="Send" onClick={send} disabled={!v.trim()}><Icon name="send" size={16} strokeWidth={2} /></button>
        </div>
      </div>
      {hints && <div className="om-composer__hint"><span>↵ send</span><span>⇧↵ newline</span><span>/ commands</span><span>@ crew</span></div>}
    </div>
  );
}

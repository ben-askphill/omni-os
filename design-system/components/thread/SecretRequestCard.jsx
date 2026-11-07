import React from 'react';
import { Button } from '../core/Button.jsx';
import { Status } from '../core/Status.jsx';

/* Secret request card (web/src components/thread/SecretRequestCard.tsx): an agent's request_secret in the thread. Pending:
   grey header with the label, the env var name in mono, where it goes and why, a masked field, Cancel and Save. A value
   already saved under that name is said before Save, Save reads Replace, and the first press asks once more. The value
   goes to the secret store and nowhere else: the agent only learns the name. Saved, cancelled or not entered: a quiet
   read-only summary. The vermilion pill under a pending card says it waits on you. */
const WHERE = { channel: 'this channel', global: 'every channel' };

export function SecretRequestCard({ ask, exists = false, state = 'pending', replaced = false, touch = false, confirming = false, error = null, onSave, onCancel }) {
  const [value, setValue] = React.useState('');
  const [confirm, setConfirm] = React.useState(confirming);
  const where = WHERE[ask.scope] || WHERE.channel;

  if (state !== 'pending') {
    const said = state === 'saved' ? `Saved to ${where} as ${ask.name}${replaced ? ', replacing the old value' : ''}` : state === 'cancelled' ? 'Cancelled' : 'Not entered';
    return (
      <section className="om-secret om-secret--done" aria-label="Secret">
        <span className="om-secret__tag">Secret</span>
        <div className="om-secret__pair">
          <span className="om-secret__asked">{ask.label}</span>
          <span className="om-secret__said">{said}</span>
        </div>
      </section>
    );
  }

  const save = (e) => {
    e.preventDefault();
    if (!value) return;
    if (exists && !confirm) return setConfirm(true);
    onSave && onSave(value, { replace: exists || confirm });
  };
  const note = confirm ? `This overwrites the value saved under ${ask.name} for ${where}.` : exists ? `A value is already saved under ${ask.name} for ${where}. Saving replaces it.` : null;

  return (
    <div className="om-secret-wrap">
      <section className={'om-secret' + (touch ? ' om-secret--touch' : '')} aria-label="Secret requested by the agent">
        <header className="om-secret__head">
          <span className="om-secret__tag">Secret</span>
          <h3 className="om-secret__label">{ask.label}</h3>
          <span className="om-secret__meta"><code>{ask.name}</code> for {where}</span>
          {ask.reason && <p className="om-secret__reason">{ask.reason}</p>}
        </header>
        <form className="om-secret__body" onSubmit={save}>
          <input className="om-input om-input--mono" type="password" autoComplete="new-password" spellCheck={false} data-1p-ignore data-lpignore="true" aria-label={`Value for ${ask.name}`} placeholder="Paste the value" value={value} onChange={(e) => { setValue(e.target.value); setConfirm(false); }} />
          {note && <p className="om-secret__note" role="status">{note}</p>}
          {error && <p className="om-secret__error" role="alert">{error}</p>}
          <div className="om-secret__foot">
            <Button size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" variant="primary" icon="key" type="submit" disabled={!value}>{confirm ? 'Confirm replace' : exists ? 'Replace' : 'Save'}</Button>
          </div>
        </form>
      </section>
      <Status state="needs" label="Needs your input" />
    </div>
  );
}

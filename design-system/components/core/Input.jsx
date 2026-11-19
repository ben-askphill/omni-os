import React from 'react';

/* Only the label names the field. The hint and the error describe it (aria-describedby), and aria-invalid is set
   exactly when the error and its vermilion edge show: in the app, once the field is left or the form submitted
   (useFieldErrors), never on each keystroke. The placeholder is never the name. */
export function Input({ label, hint, error, mono = false, id, className = '', ...rest }) {
  const fid = id || (label ? 'om-' + String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined);
  const note = fid && (error || hint) ? fid + (error ? '-error' : '-hint') : undefined;
  return (
    <div className={'om-field ' + className}>
      {label && <label className="om-field__label" htmlFor={fid}>{label}</label>}
      <input id={fid} className={'om-input' + (mono ? ' om-input--mono' : '') + (error ? ' om-input--error' : '')} aria-invalid={error ? true : undefined} aria-describedby={note} {...rest} />
      {error ? (
        <span id={note} className="om-field__hint" style={{ color: 'var(--fg)' }}><span className="om-dot om-dot--needs" style={{ width: 8, height: 8 }}><i /></span>{error}</span>
      ) : hint ? <span id={note} className="om-field__hint">{hint}</span> : null}
    </div>
  );
}

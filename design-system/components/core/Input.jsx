import React from 'react';

export function Input({ label, hint, error, mono = false, id, className = '', ...rest }) {
  const fid = id || (label ? 'om-' + String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined);
  return (
    <div className={'om-field ' + className}>
      {label && <label className="om-field__label" htmlFor={fid}>{label}</label>}
      <input id={fid} className={'om-input' + (mono ? ' om-input--mono' : '') + (error ? ' om-input--error' : '')} aria-invalid={!!error} {...rest} />
      {error ? (
        <span className="om-field__hint" style={{ color: 'var(--fg)' }}><span className="om-dot om-dot--needs" style={{ width: 8, height: 8 }}><i /></span>{error}</span>
      ) : hint ? <span className="om-field__hint">{hint}</span> : null}
    </div>
  );
}

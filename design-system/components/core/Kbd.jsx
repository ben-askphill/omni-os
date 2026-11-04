import React from 'react';

export function Kbd({ children, className = '' }) {
  return <kbd className={'om-kbd ' + className}>{children}</kbd>;
}

import React from 'react';

/* Crew marks: five silhouettes derived from the ring. 24 grid, 1.75 stroke, round joins to sit with the icon set. */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' };
const CREW = {
  conductor: { label: 'Conductor', el: <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="3.6" /> },
  researcher: { label: 'Researcher', el: <g><circle cx="12" cy="12" r="8.5" {...S} /><circle cx="12" cy="12" r="3.2" fill="currentColor" /></g> },
  builder: { label: 'Builder', el: <g><rect x="4" y="4" width="16" height="16" rx="3.5" {...S} /><rect x="12" y="12" width="8" height="8" rx="2" fill="currentColor" /></g> },
  'store-ops': { label: 'Store ops', el: <g><path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-9 9z" {...S} /><circle cx="8.5" cy="8.5" r="1.75" fill="currentColor" /></g> },
  inbox: { label: 'Inbox', el: <path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" {...S} /> }
};

export const CREW_ROLES = Object.keys(CREW);

export function CrewMark({ role = 'conductor', size = 16, className = '', title }) {
  const c = CREW[role] || CREW.conductor;
  return (
    <svg className={'om-crew ' + className} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title || c.label} style={{ display: 'block' }}>
      {c.el}
    </svg>
  );
}

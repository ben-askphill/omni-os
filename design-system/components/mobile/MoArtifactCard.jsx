import React from 'react';
import { StatusGlyph } from '../core/Status.jsx';
import { Icon } from '../icons/Icon.jsx';

/* An artifact in the thread: a white peek of the page on its surface card, the file name in mono, maximize to open full screen.
   image = a snapshot of the page; without one the peek is a striped placeholder. live = still being written. */
export function MoArtifactCard({ name, sub, image, live = false, onPress }) {
  return (
    <button type="button" className="om-mo-artifact om-mo-press" onClick={onPress}>
      <div className="om-mo-artifact__peek">
        {image ? <img src={image} alt="" /> : <div className="om-mo-artifact__stripes"><span>{name}</span></div>}
        {live && <span className="om-mo-artifact__live"><StatusGlyph state="running" size={8} /></span>}
      </div>
      <div className="om-mo-artifact__foot">
        <span className="om-mo-artifact__text">
          <span className="om-mo-artifact__name om-mo-ellipsis">{name}</span>
          {sub && <span className="om-mo-artifact__sub om-mo-ellipsis">{sub}</span>}
        </span>
        <Icon name="maximize" size={16} style={{ color: 'var(--fg-3)' }} />
      </div>
    </button>
  );
}

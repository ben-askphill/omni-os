import React from 'react';
import { Icon } from '../icons/Icon.jsx';
import { IconButton } from '../core/IconButton.jsx';

/* Inline artifact: a surface tray holding the rendered page on a white 14px-radius sheet. */
export function ArtifactEmbed({ name, kind = 'html', size, taskId, height = 260, srcDoc, src, caption, onOpen, children }) {
  return (
    <figure className="om-artifact">
      <div className="om-artifact__bar">
        <Icon name="file" size={14} style={{ color: 'var(--fg-3)' }} />
        <span className="om-artifact__name">{name}</span>
        <span className="om-artifact__kind">{kind}{size ? ' · ' + size : ''}</span>
        <IconButton label="Open beside the thread" icon="split" iconSize={14} size="sm" onClick={onOpen} />
        <IconButton label="Open in new tab" icon="external" iconSize={14} size="sm" />
      </div>
      <div className="om-artifact__body" style={{ height }}>
        {srcDoc || src ? <iframe title={name} srcDoc={srcDoc} src={src} style={{ height }} /> : children}
      </div>
      {(caption || taskId) && <figcaption className="om-artifact__cap">{taskId && <span>{taskId}</span>}{caption && <span>{caption}</span>}</figcaption>}
    </figure>
  );
}

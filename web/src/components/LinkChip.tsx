import { Children, isValidElement, type ReactNode } from 'react';
import { LINK_ICONS } from '../../../shared/link-icons.ts';
import { useLinkPreview, type LinkPreview } from '../link-previews.ts';

/** A source's mark, 24 by 24, drawn at the text's size. Marks too dark or light for both themes take the text colour. */
export function LinkMark({ icon, className = '' }: { icon: string; className?: string }) {
  const layers = LINK_ICONS[icon] ?? LINK_ICONS.link;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`link-mark ${className}`}>
      {layers.map((l, i) =>
        l.stroke ? (
          <path key={i} d={l.d} fill="none" stroke={l.fill ?? 'currentColor'} strokeWidth={l.stroke} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={i} d={l.d} fill={l.fill ?? 'currentColor'} />
        ),
      )}
    </svg>
  );
}

const textOf = (children: ReactNode): string =>
  Children.toArray(children)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : ''))
    .join('');

/** A link written as its bare URL (GFM autolinks put `http://` before a `www.` one). */
export function isBare(href: string, text: string) {
  if (text === href || `http://${text}` === href || `${text}/` === href) return true;
  try {
    return text === decodeURI(href);
  } catch {
    return false;
  }
}

export function tooltip(p: LinkPreview) {
  return [
    [p.name, p.context, p.state].filter(Boolean).join(' · '),
    p.resolved ? `${p.ref ? `${p.ref} ` : ''}${p.text}` : '',
    p.url,
    p.needs ? `Add the ${p.needs} secret to show titles from ${p.name}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * An outside link in a reply. A bare URL becomes its source's mark, its id and the title the source gives it; a link
 * with its own words keeps them and gains the mark. A page no source claims and no title was found for stays as written.
 */
export function ExternalLink({ href, children }: { href: string; children?: ReactNode }) {
  const p = useLinkPreview(href);
  const bare = isBare(href, textOf(children));
  const plain = !p || (p.source === 'web' && (!bare || !p.resolved));
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={p ? tooltip(p) : undefined} className={plain ? undefined : 'link-chip'}>
      {!plain && <LinkMark icon={p.icon} />}
      {plain ? (
        children
      ) : !bare ? (
        <span>{children}</span>
      ) : (
        <>
          {p.ref && <span className="link-ref">{p.ref}</span>}
          <span>{p.text}</span>
        </>
      )}
    </a>
  );
}

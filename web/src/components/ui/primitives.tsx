import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CHANNEL_GLYPHS, parseChannelIcon, svgDataUrl } from '../../../../shared/channel-icon.ts';
import { Loader } from '../brand.tsx';
import { Icon, type IconName } from './icons.tsx';

// ---------- buttons ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'needs';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-on-ink hover:bg-fg/88 disabled:opacity-35',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 disabled:opacity-45',
  ghost: 'hov text-fg-2 hover:text-fg disabled:opacity-40',
  // Destructive or blocking actions: vermilion fill with ink text, never vermilion text.
  needs: 'bg-needs text-on-needs hover:bg-[color-mix(in_srgb,var(--needs)_90%,var(--fg))] disabled:opacity-40',
};

const SIZES = {
  sm: 'h-7 px-3 text-[12.5px] gap-1.5',
  md: 'h-[34px] px-4 text-[13px] gap-2',
  lg: 'h-11 px-5 text-[14px] gap-2',
};

const btnBase = 'press inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,color,opacity,transform] duration-200 select-none';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  busy,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={`${btnBase} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}>
      {busy ? <Loader size={size === 'sm' ? 12 : 14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 15} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = '',
  size = 16,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: number; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-on={active || undefined}
      {...rest}
      className={`hov press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:text-fg disabled:opacity-40 data-[on=true]:text-fg ${className}`}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function IconLink({ href, icon, label, size = 15, download, newTab, className = '' }: { href: string; icon: IconName; label: string; size?: number; download?: boolean; newTab?: boolean; className?: string }) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      download={download || undefined}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener noreferrer' : undefined}
      className={`hov press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:text-fg ${className}`}
    >
      <Icon name={icon} size={size} />
    </a>
  );
}

export function LinkButton({ href, icon, children, className = '', variant = 'secondary', size = 'md', target }: { href: string; icon?: IconName; children?: ReactNode; className?: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; target?: string }) {
  return (
    <a href={href} target={target} rel={target ? 'noopener noreferrer' : undefined} className={`${btnBase} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 15} />}
      {children}
    </a>
  );
}

export type ChipTone = 'default' | 'outline' | 'ink' | 'live' | 'needs' | 'done';

export function Chip({ children, tone = 'default', className = '', title }: { children: ReactNode; tone?: ChipTone; className?: string; title?: string }) {
  const tones: Record<ChipTone, string> = {
    default: 'bg-surface-2 text-fg-2',
    outline: 'shadow-[inset_0_0_0_1px_var(--line-strong)] text-fg-3',
    ink: 'bg-fg text-on-ink',
    live: 'bg-live text-on-live',
    needs: 'bg-needs text-on-needs',
    done: 'bg-done text-on-done',
  };
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium leading-none tracking-normal ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

// Every icon a channel can pick is one this file draws.
const _channelGlyphsDrawn: readonly IconName[] = CHANNEL_GLYPHS;

/** A channel's own icon (an emoji, a design system icon or an uploaded SVG), or nothing when it has none. */
export function ChannelMark({ icon, size }: { icon: string | null | undefined; size: number }) {
  const mark = parseChannelIcon(icon);
  if (!mark) return null;
  if (mark.kind === 'glyph') return <Icon name={mark.name} size={size} />;
  // An image, never markup in the page: the SVG cannot run anything or load from elsewhere.
  if (mark.kind === 'svg') return <img src={svgDataUrl(mark.markup)} alt="" draggable={false} className="object-contain" style={{ width: size, height: size }} />;
  return <span className="inline-grid place-items-center overflow-visible leading-none" style={{ fontSize: size * 0.85, width: size, height: size }}>{mark.text}</span>;
}

/** Letter avatar for channels and roles: neutral surface, SF Rounded. No per-name hue. A channel's own icon replaces the letter. */
export function Avatar({ name, size = 28, icon, channelIcon, ink, className = '' }: { name: string; size?: number; icon?: IconName; channelIcon?: string | null; ink?: boolean; className?: string }) {
  const mark = parseChannelIcon(channelIcon);
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full font-rounded font-medium uppercase leading-none ${ink ? 'bg-fg text-on-ink' : 'bg-surface-2 text-fg-2'} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {icon ? (
        <Icon name={icon} size={size * 0.5} />
      ) : mark ? (
        <ChannelMark icon={channelIcon} size={size * { glyph: 0.5, emoji: 0.52, svg: 0.58 }[mark.kind]} />
      ) : (
        name.replace(/[^a-z0-9]/gi, '').slice(0, 1) || '?'
      )}
    </span>
  );
}

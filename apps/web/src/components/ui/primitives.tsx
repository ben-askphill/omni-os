import { avatarInk } from '@omni/shared/avatar-color.ts';
import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { monogram } from '@omni/shared/monogram.ts';
import { CHANNEL_GLYPHS, channelFace, parseChannelIcon, svgDataUrl } from '@omni/shared/channel-icon.ts';
import { Loader, StaticMark } from '../brand.tsx';
import { Icon, type IconName } from './icons.tsx';

// ---------- buttons ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'needs' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-on-ink hover:enabled:bg-fg/88',
  secondary: 'bg-surface-2 text-fg hover:enabled:bg-surface-3',
  ghost: 'hov text-fg-2 hover:text-fg',
  // Destructive or blocking actions: vermilion fill with ink text, never vermilion text.
  needs: 'bg-needs text-on-needs hover:enabled:bg-[color-mix(in_srgb,var(--needs)_90%,var(--fg))]',
  // A destructive action at rest: a red label, no fill. Ask before it runs with InlineConfirm (inline-confirm.tsx).
  danger: 'hov text-danger-text',
};

// A busy button is working, not unavailable: it keeps its fill and shows the loader instead of fading out.
const DISABLED: Record<Variant, string> = {
  primary: 'disabled:opacity-35',
  secondary: 'disabled:opacity-45',
  ghost: 'disabled:opacity-40',
  needs: 'disabled:opacity-40',
  danger: 'disabled:opacity-45',
};

const SIZES = {
  sm: 'h-7 px-3 text-[12.5px] gap-1.5',
  md: 'h-[34px] px-4 text-[13px] gap-2',
  lg: 'h-11 px-5 text-[14px] gap-2',
};

const btnBase = 'press inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,color,opacity,transform] duration-200 select-none motion-reduce:transition-[background-color,color,opacity]';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  busy,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; busy?: boolean }) {
  // Busy is aria-disabled, not disabled: a disabled button drops focus to the page, and the request it started usually
  // ends with focus wanted right there. So a busy button still gets clicks (and a form's Enter); it ignores them.
  return (
    <button
      type="button"
      {...rest}
      onClick={busy ? (e) => e.preventDefault() : onClick}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={`${btnBase} ${SIZES[size]} ${VARIANTS[variant]} ${busy ? 'cursor-progress' : DISABLED[variant]} ${className}`}
    >
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
  pressed,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  size?: number;
  /** Shown as on, with no state for assistive tech: a button whose popup is open says so with aria-expanded. */
  active?: boolean;
  /** A toggle that stays on or off (a tool, a view): shown as on and exposed as aria-pressed. */
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-on={active || pressed || undefined}
      {...rest}
      className={`hov press inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-3 transition-colors hover:text-fg disabled:opacity-40 data-[on=true]:text-fg ${className}`}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

/** `external`: the link goes where it says, even a GitHub PR that Omni has a page for (apps/web/src/pr-links.ts). */
export function IconLink({ href, icon, label, size = 15, download, newTab, external, className = '' }: { href: string; icon: IconName; label: string; size?: number; download?: boolean; newTab?: boolean; external?: boolean; className?: string }) {
  return (
    <a
      href={href}
      data-external={external || undefined}
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

/** `external`: the link goes where it says, even a GitHub PR that Omni has a page for (apps/web/src/pr-links.ts). */
export function LinkButton({ href, icon, children, className = '', variant = 'secondary', size = 'md', target, external }: { href: string; icon?: IconName; children?: ReactNode; className?: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; target?: string; external?: boolean }) {
  return (
    <a href={href} target={target} data-external={external || undefined} rel={target ? 'noopener noreferrer' : undefined} className={`${btnBase} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}>
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
void _channelGlyphsDrawn;

/** A channel's own icon (an emoji, a design system icon or an uploaded SVG), or nothing when it has none. */
export function ChannelMark({ icon, size, avatarBg }: { avatarBg?: string | null; icon: string | null | undefined; size: number }) {
  const mark = parseChannelIcon(icon);
  if (avatarBg) return <span className="inline-grid place-items-center rounded-full" style={{ backgroundColor: avatarBg, color: avatarInk(avatarBg), width: size + 6, height: size + 6 }}><ChannelMark icon={icon} size={size} /></span>;
  if (!mark) return null;
  if (mark.kind === 'glyph') return <Icon name={mark.name} size={size} />;
  // An image, never markup in the page: the SVG cannot run anything or load from elsewhere.
  if (mark.kind === 'svg') return <img src={svgDataUrl(mark.markup)} alt="" draggable={false} className="object-contain" style={{ width: size, height: size }} />;
  return <span className="inline-grid place-items-center overflow-visible leading-none" style={{ fontSize: size * 0.85, width: size, height: size }}>{mark.text}</span>;
}

/**
 * The channels' monograms (packages/shared/monograms), keyed by channel id and name, so two channels never share one.
 * The app's store provides it; a name it does not know (a person, a role) takes its plain monogram.
 */
export const Monograms = createContext<ReadonlyMap<string, string>>(new Map());

export function useMonogram(name: string): string {
  return useContext(Monograms).get(name) ?? monogram(name);
}

/**
 * Monogram avatar for channels and roles: neutral surface, SF Rounded. No per-name hue. A channel's own icon replaces
 * the letters. `omni` marks the Conductor: it draws the Omni mark until the Conductor gets an icon of its own
 * (channelFace in packages/shared/channel-icon.ts).
 */
export function Avatar({ name, size = 28, icon, omni, channelIcon, avatarBg, ink, className = '' }: { name: string; size?: number; icon?: IconName; omni?: boolean; channelIcon?: string | null; avatarBg?: string | null; ink?: boolean; className?: string }) {
  const face = channelFace(channelIcon, omni);
  const letters = useMonogram(name);
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full font-rounded font-medium leading-none ${ink ? 'bg-fg text-on-ink' : 'bg-surface-2 text-fg-2'} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.42, ...(avatarBg ? { backgroundColor: avatarBg, color: avatarInk(avatarBg) } : {}) }}
    >
      {icon ? (
        <Icon name={icon} size={size * 0.5} />
      ) : face.kind === 'omni' ? (
        <StaticMark size={size * 0.56} title="" />
      ) : face.kind === 'letters' ? (
        letters
      ) : (
        <ChannelMark icon={channelIcon} size={size * { glyph: 0.5, emoji: 0.52, svg: 0.58 }[face.kind]} />
      )}
    </span>
  );
}

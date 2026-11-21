import { useRef, useState, type ReactNode } from 'react';
import { AVATAR_UPLOAD_MAX_BYTES } from '@omni/shared/agent-avatar.ts';
import { AVATAR_SOURCES, avatarSourceLabel, glyphOf, iconFor, isSvgFile, sourceOf, styleTakesColor, uploadStyle, type AvatarStash, type AvatarStyle } from '@omni/shared/agent-identity.ts';
import { CHANNEL_GLYPHS, glyphIcon, readSvgIcon, SVG_MAX } from '@omni/shared/channel-icon.ts';
import { errorText } from '../api.ts';
import { squareAvatar } from '../agent-avatar-upload.ts';
import { lastGrapheme } from '../format.ts';
import { AgentAvatar, type AgentLook } from './AgentAvatar.tsx';
import { AvatarColorPicker } from './AvatarColorPicker.tsx';
import { Button, ErrorNote, Icon, Segmented } from './ui.tsx';

// The identity block at the top of an agent's page in Settings > Agents, and of New agent: the live preview with a
// thread-sized sample under it, its name and description, and one Avatar control with four sources (agent-identity.ts):
// Initials (Built-in for an agent with a mark), Emoji, Icon and Upload, which takes a photo or an SVG. Picking one
// replaces the others. The background color sits under every source but a photo. Nothing here saves on its own: the
// photo picked, the icon and the color go with the editor's Save.

/** What the block edits besides the name and description: the style, what each style holds, the color and a picked photo. */
export interface IdentityValue {
  style: AvatarStyle;
  stash: AvatarStash;
  bg: string;
  /** A photo picked and cropped here, as a data URL, waiting for Save. */
  picked: string | null;
}

/** The look the preview draws for `value`, as AgentAvatar reads an agent. `saved`: the uploaded image's URL, if any. */
export function identityLook(id: string, name: string, value: IdentityValue, saved: string | undefined): AgentLook {
  const image = value.style === 'photo' ? (value.picked ?? saved) : undefined;
  const icon = iconFor(value.style, value.stash);
  const bg = styleTakesColor(value.style) ? value.bg : '';
  return { id, name, avatar: image || icon || bg ? { ...(image && { image }), ...(icon && { icon }), ...(bg && { bg }) } : undefined };
}

/** A line under the preview: where the face comes from. */
function sourceLine(value: IdentityValue, opts: { saved?: string; offered?: boolean; builtInMark: boolean }) {
  switch (value.style) {
    case 'photo':
      if (value.picked) return 'New photo. Save to use it.';
      if (opts.saved && opts.offered) return 'The photo its server offered. Test connection reads it again until you upload your own.';
      return opts.saved ? 'A photo you uploaded.' : 'Nothing uploaded yet.';
    case 'svg':
      return 'Your SVG on its color.';
    case 'emoji':
      return value.stash.emoji ? 'An emoji on its color.' : 'Type an emoji.';
    case 'icon':
      return value.stash.glyph ? 'An icon on its color.' : 'Pick an icon.';
    case 'auto':
      return opts.builtInMark ? 'Its built-in mark.' : 'Its initials, on a color from its id.';
  }
}

export function AgentIdentity({
  id,
  name,
  value,
  onChange,
  saved,
  offered,
  builtInMark,
  fields,
}: {
  id: string;
  name: string;
  value: IdentityValue;
  onChange: (v: IdentityValue) => void;
  /** The image the agent has now (its URL), which Upload keeps until another source or file replaces it. */
  saved?: string;
  /** The image is the one a remote agent's server offered. */
  offered?: boolean;
  /** What it shows without a look of its own: a built-in's mark (true) or its initials. */
  builtInMark: boolean;
  /** The name, id and description fields, beside the preview. */
  fields: ReactNode;
}) {
  const look = identityLook(id, name, value, saved);
  const set = (patch: Partial<IdentityValue>) => onChange({ ...value, ...patch });
  // A built-in shows its mark only with no color of its own: a picked color puts its initials on it.
  const shownAuto = builtInMark && !value.bg;
  return (
    <div className="space-y-5" data-agent-identity>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <figure className="flex shrink-0 flex-col items-center gap-2.5 sm:w-[132px]" aria-label="Avatar preview">
          <span className="relative">
            <AgentAvatar agent={look} size={88} />
            {value.picked && <span className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full bg-[var(--live)] shadow-[0_0_0_2.5px_var(--surface)]" title="Not saved yet" />}
          </span>
          {/* How it reads on a reply's author line, at the size threads draw it. */}
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-bg py-1 pr-2.5 pl-1" title="On a message in a thread">
            <AgentAvatar agent={look} size={20} />
            <span className="min-w-0 truncate text-[12px] font-medium">{name}</span>
          </span>
          <figcaption className="text-center text-[11.5px] leading-[15px] text-balance text-fg-3" aria-live="polite">
            {sourceLine(value, { saved, offered, builtInMark: shownAuto })}
          </figcaption>
        </figure>
        <div className="min-w-0 flex-1 space-y-4">{fields}</div>
      </div>

      <div className="space-y-3">
        <span className="block text-[13px] font-medium text-fg">Avatar</span>
        <Segmented
          label="Avatar"
          size="sm"
          value={sourceOf(value.style)}
          onChange={(source) => set({ style: source === 'upload' ? uploadStyle(value, saved) : source })}
          className="max-w-full overflow-x-auto"
          options={AVATAR_SOURCES.map((s) => ({ id: s, label: avatarSourceLabel(s, builtInMark) }))}
        />
        <SourcePanel value={value} saved={saved} name={name} set={set} builtInMark={builtInMark} />
      </div>

      {styleTakesColor(value.style) && (
        <div className="space-y-2">
          <span className="block text-[13px] font-medium text-fg">Background</span>
          <AvatarColorPicker
            icon={iconFor(value.style, value.stash)}
            name={name}
            value={value.bg}
            manual={!!value.bg}
            preview={false}
            onChange={(bg) => set({ bg })}
            onAuto={() => set({ bg: '' })}
          />
        </div>
      )}
    </div>
  );
}

function SourcePanel({ value, saved, name, set, builtInMark }: { value: IdentityValue; saved?: string; name: string; set: (p: Partial<IdentityValue>) => void; builtInMark: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const stash = (patch: Partial<AvatarStash>) => set({ stash: { ...value.stash, ...patch } });
  const hint = 'text-[12px] leading-[17px] text-fg-3';
  // A photo becomes the image, cropped square; an SVG becomes the icon, on the background color.
  const upload = async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      if (isSvgFile(f)) {
        if (f.size > 512 * 1024) throw new Error(`That SVG is too big: keep it under ${SVG_MAX / 1000} KB.`);
        set({ style: 'svg', stash: { ...value.stash, svg: readSvgIcon(await f.text()) } });
      } else set({ style: 'photo', picked: await squareAvatar(f) });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  let panel: ReactNode;
  switch (sourceOf(value.style)) {
    case 'upload': {
      const has = value.style === 'svg' ? !!value.stash.svg : !!(value.picked || saved);
      panel = (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" icon="image" busy={busy} onClick={() => file.current?.click()}>
              {has ? 'Replace' : 'Upload image or SVG'}
            </Button>
            {value.picked && (
              <Button type="button" size="sm" variant="ghost" onClick={() => set({ picked: null })}>
                Undo
              </Button>
            )}
          </div>
          <p className={hint}>
            {value.style === 'svg'
              ? `A plain SVG up to ${SVG_MAX / 1000} KB, drawn on the background below. Transparent parts show the color.`
              : `A PNG, JPEG or WebP up to ${AVATAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB fills the circle, cropped square from the center. An SVG up to ${SVG_MAX / 1000} KB sits on a background color.`}
          </p>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp,.svg,image/svg+xml"
            className="sr-only"
            tabIndex={-1}
            aria-label={`Upload an image or SVG for ${name}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
        </div>
      );
      break;
    }
    case 'emoji':
      panel = (
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="crew-emoji"
            className="field w-20 text-center !text-[20px] placeholder:!text-[13px]"
            value={value.stash.emoji}
            onChange={(e) => stash({ emoji: lastGrapheme(e.target.value) })}
            placeholder="🙂"
            aria-label="Emoji"
          />
          <p className={`${hint} min-w-0 flex-1 basis-40`}>One emoji. Your keyboard's emoji picker works here (Control-Command-Space on a Mac).</p>
        </div>
      );
      break;
    case 'icon':
      panel = (
        <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1">
          {CHANNEL_GLYPHS.map((g) => {
            const on = glyphOf(value.stash.glyph) === g;
            return (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={g}
                title={g}
                onClick={() => stash({ glyph: on ? '' : glyphIcon(g) })}
                className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${on ? 'bg-fg text-on-ink' : 'hov text-fg-2 [--hov:var(--surface-2)]'}`}
              >
                <Icon name={g} size={17} />
              </button>
            );
          })}
        </div>
      );
      break;
    case 'auto':
      panel = <p className={hint}>{builtInMark ? 'Its built-in mark, until you give it a color: then its initials on that color.' : 'Two letters from its name, unique across your agents.'}</p>;
      break;
  }
  return (
    <div className="space-y-2">
      {panel}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

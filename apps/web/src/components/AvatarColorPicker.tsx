import { useId, useState, type MouseEvent } from 'react';
import { svgColors } from '@omni/shared/avatar-color.ts';
import { parseChannelIcon, svgDataUrl } from '@omni/shared/channel-icon.ts';
import { Avatar, Button, ErrorNote, FieldError, fieldErrorId, useFieldErrors } from './ui.tsx';

/** A swatch the picker offers, by name. */
export interface Swatch {
  name: string;
  hex: string;
}

/**
 * Uses the same field and button primitives as channel settings. Sample coordinates use the image's actual contain box.
 * `swatches`: the named colors it offers, from its caller: CHANNEL_SWATCHES for a channel, AGENT_PALETTE for an agent
 * (ADR 0021, D5). A color off them shows as Custom. `auto`: the color Automatic draws when `value` is empty, as an
 * agent's color is its shape's paired one until one is picked. `preview`: false where the caller draws the avatar
 * itself (an agent's identity block).
 */
export function AvatarColorPicker({ icon, name, omni, value, manual, swatches: named, auto, preview = true, onChange, onAuto }: { icon: string; name: string; omni?: boolean; value: string; manual: boolean; swatches: readonly Swatch[]; auto?: string; preview?: boolean; onChange: (color: string) => void; onAuto: () => void }) {
  const mark = parseChannelIcon(icon);
  const [error, setError] = useState('');
  const current = value.toLowerCase();
  const [hex, setHex] = useState(current);
  const [previous, setPrevious] = useState(current);
  if (previous !== current) { setPrevious(current); setHex(current); }
  const hexId = `${useId()}-hex`;
  // Shown once the field is left, not on every keystroke of a color being typed.
  const problems = useFieldErrors({ [hexId]: hex && !/^#[\da-f]{6}$/i.test(hex) ? 'Use # and six hex digits, like #e8d9f5.' : null });
  const hexError = problems.error(hexId);
  const sample = async (event: MouseEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const bounds = img.getBoundingClientRect();
    const scale = Math.min(bounds.width / img.naturalWidth, bounds.height / img.naturalHeight);
    const x = (event.clientX - bounds.left - (bounds.width - img.naturalWidth * scale) / 2) / scale;
    const y = (event.clientY - bounds.top - (bounds.height - img.naturalHeight * scale) / 2) / scale;
    if (x < 0 || y < 0 || x >= img.naturalWidth || y >= img.naturalHeight) return;
    try {
      const canvas = document.createElement('canvas');
      // Bound canvas memory for SVGs with huge declared dimensions.
      const ratio = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.ceil(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.ceil(img.naturalHeight * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image sampling is unavailable. Choose a palette color instead.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const [r, g, b, a] = ctx.getImageData(Math.min(canvas.width - 1, Math.floor(x * ratio)), Math.min(canvas.height - 1, Math.floor(y * ratio)), 1, 1).data;
      if (!a) { setError('That point is transparent. Click a painted part of the SVG.'); return; }
      onChange('#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join(''));
      setError('');
    } catch { setError('Could not sample that SVG. Choose a palette color instead.'); }
  };
  const names = new Map(named.map((s) => [s.hex.toLowerCase(), s.name]));
  const swatches = [...new Set([...named.map((s) => s.hex), ...(mark?.kind === 'svg' ? svgColors(mark.markup).palette : [])].map((c) => c.toLowerCase()))];
  const fallback = auto?.toLowerCase() || '#e8d9f5';
  const autoName = auto ? names.get(auto.toLowerCase()) : undefined;
  const status = manual ? (names.get(current) ?? 'Custom color') : autoName ? `Automatic, ${autoName}` : 'Automatic';
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      {preview && <Avatar name={name} omni={omni} channelIcon={icon} avatarBg={value} size={56} />}
      <input type="color" aria-label="Avatar background color" value={current || fallback} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 cursor-pointer rounded-lg" />
      <input id={hexId} aria-label="Avatar background hex" className="field field-mono !w-28" placeholder={fallback} value={hex} maxLength={7} spellCheck={false} autoCapitalize="none" autoCorrect="off" onChange={(e) => { setHex(e.target.value); if (/^#[\da-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }} onBlur={problems.onBlur} aria-invalid={problems.invalid(hexId)} aria-describedby={hexError ? fieldErrorId(hexId) : undefined} />
      <Button type="button" onClick={onAuto} disabled={!manual} title={manual ? undefined : 'Already automatic'}>Reset to auto</Button>
      <span className="text-xs text-fg-3">{status}</span>
    </div>
    {hexError && <FieldError id={fieldErrorId(hexId)}>{hexError}</FieldError>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Background swatches">
      {swatches.map((color) => {
        const name = names.get(color) ?? `From the SVG, ${color}`;
        const on = current === color;
        return <button key={color} type="button" title={name} aria-label={name} aria-pressed={on} onClick={() => onChange(color)} className="h-8 w-8 rounded-full border border-line-strong focus-visible:outline-2 focus-visible:outline-fg" style={{ backgroundColor: color, outline: on ? '2px solid var(--fg)' : undefined, outlineOffset: 2 }} />;
      })}
    </div>
    {mark?.kind === 'svg' && <div className="space-y-2"><p className="text-xs text-fg-3">Click a color in the SVG to sample it. You can also choose its colors from the swatches above.</p><img src={svgDataUrl(mark.markup)} alt="SVG color sampler" onClick={(e) => void sample(e)} className="h-32 w-32 cursor-crosshair rounded-xl border border-line object-contain" style={{ backgroundColor: value || auto || 'var(--surface-2)' }} /></div>}
    {error && <ErrorNote>{error}</ErrorNote>}
  </div>;
}

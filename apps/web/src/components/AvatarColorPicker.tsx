import { useState, type MouseEvent } from 'react';
import { AVATAR_SWATCHES, svgColors } from '@omni/shared/avatar-color.ts';
import { parseChannelIcon, svgDataUrl } from '@omni/shared/channel-icon.ts';
import { Avatar, Button, ErrorNote } from './ui.tsx';

/** Uses the same field and button primitives as channel settings. Sample coordinates use the image's actual contain box. */
export function AvatarColorPicker({ icon, name, value, manual, onChange, onAuto }: { icon: string; name: string; value: string; manual: boolean; onChange: (color: string) => void; onAuto: () => void }) {
  const mark = parseChannelIcon(icon);
  const [error, setError] = useState('');
  const [hex, setHex] = useState(value);
  const [previous, setPrevious] = useState(value);
  if (previous !== value) { setPrevious(value); setHex(value); }
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
  const swatches = [...new Set([...AVATAR_SWATCHES, ...(mark?.kind === 'svg' ? svgColors(mark.markup).palette : [])])];
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <Avatar name={name} channelIcon={icon} avatarBg={value} size={56} />
      <input type="color" aria-label="Avatar background color" value={value || '#e8d9f5'} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 cursor-pointer rounded-lg" />
      <input aria-label="Avatar background hex" className="field !w-28 font-mono" placeholder="#e8d9f5" value={hex} maxLength={7} onChange={(e) => { setHex(e.target.value); if (/^#[\da-f]{6}$/i.test(e.target.value)) onChange(e.target.value); }} aria-invalid={!!hex && !/^#[\da-f]{6}$/i.test(hex)} />
      <Button type="button" onClick={onAuto}>Reset to auto</Button>
      <span className="text-xs text-fg-3">{manual ? 'Custom color' : 'Automatic'}</span>
    </div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Background swatches">
      {swatches.map((color) => <button key={color} type="button" title={color} aria-label={`Use ${color}`} aria-pressed={value === color} onClick={() => onChange(color)} className="h-8 w-8 rounded-full border border-line focus-visible:outline-2 focus-visible:outline-fg" style={{ backgroundColor: color, outline: value === color ? '2px solid var(--fg)' : undefined, outlineOffset: 2 }} />)}
    </div>
    {mark?.kind === 'svg' && <div className="space-y-2"><p className="text-xs text-fg-3">Click a color in the SVG to sample it. You can also choose its colors from the swatches above.</p><img src={svgDataUrl(mark.markup)} alt="SVG color sampler" onClick={(e) => void sample(e)} className="h-32 w-32 cursor-crosshair rounded-xl border border-line object-contain" style={{ backgroundColor: value || 'var(--surface-2)' }} /></div>}
    {error && <ErrorNote>{error}</ErrorNote>}
  </div>;
}

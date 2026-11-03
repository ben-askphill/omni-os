import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

// A QR code as an SVG. Black on white in both themes, with the four-module quiet zone scanners need: a themed code
// would not scan in dark mode.

export function QrCode({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { size: n, path: d };
  }, [text]);
  const edge = size + 8;
  return (
    <svg role="img" aria-label={label} viewBox={`-4 -4 ${edge} ${edge}`} shapeRendering="crispEdges" className={`block aspect-square rounded-[12px] ${className}`}>
      <rect x={-4} y={-4} width={edge} height={edge} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

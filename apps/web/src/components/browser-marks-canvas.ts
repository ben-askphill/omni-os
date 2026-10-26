// Drawing a browser_annotation's marks (packages/shared/message-context-marks.ts) on a canvas: the live overlay while Ben
// draws, the detail view of a sent annotation, and the marked screenshot the agent is shown. One function draws them all,
// so what Ben saw is what the agent gets. `k` is canvas pixels per CSS page pixel.
import { arrowBarbs, markBox, textSize, type Mark } from '@omni/shared/message-context-marks.ts';

const FONT = '600 {px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
/** The largest a marked screenshot may be and still go up as a PNG; past it the render is JPEG. Under the server's 3.5 MB. */
export const PNG_MAX = 3_400_000;

export function drawMarks(ctx: CanvasRenderingContext2D, marks: readonly Mark[], k: number, selected = -1): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  marks.forEach((m, i) => {
    ctx.strokeStyle = ctx.fillStyle = m.color;
    ctx.lineWidth = m.stroke * k;
    ctx.beginPath();
    switch (m.type) {
      case 'pen':
        m.points.forEach(([x, y], j) => (j ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
        ctx.stroke();
        break;
      case 'rect':
        ctx.strokeRect(m.x * k, m.y * k, m.width * k, m.height * k);
        break;
      case 'ellipse':
        ctx.ellipse((m.x + m.width / 2) * k, (m.y + m.height / 2) * k, (m.width / 2) * k, (m.height / 2) * k, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'line':
      case 'arrow':
        ctx.moveTo(m.x0 * k, m.y0 * k);
        ctx.lineTo(m.x1 * k, m.y1 * k);
        if (m.type === 'arrow') {
          const [a, b] = arrowBarbs(m);
          ctx.moveTo(a[0] * k, a[1] * k);
          ctx.lineTo(m.x1 * k, m.y1 * k);
          ctx.lineTo(b[0] * k, b[1] * k);
        }
        ctx.stroke();
        break;
      case 'text':
        ctx.font = FONT.replace('{px}', String(textSize(m.stroke) * k));
        ctx.textBaseline = 'top';
        ctx.fillText(m.text, m.x * k, m.y * k);
        break;
    }
    if (i === selected) outline(ctx, m, k);
  });
  ctx.restore();
}

/** The dashed frame around the selected mark. */
function outline(ctx: CanvasRenderingContext2D, m: Mark, k: number) {
  const box = markBox(m);
  if (m.type === 'text') {
    ctx.font = FONT.replace('{px}', String(textSize(m.stroke) * k));
    box.width = ctx.measureText(m.text).width / k;
  }
  const [x0, y0, x1, y1] = [box.x, box.y, box.x + box.width, box.y + box.height];
  const pad = m.stroke / 2 + 4;
  ctx.save();
  ctx.lineWidth = 1.5 * Math.max(1, k);
  ctx.setLineDash([5 * k, 4 * k]);
  ctx.strokeStyle = '#3b82f6';
  ctx.strokeRect((x0 - pad) * k, (y0 - pad) * k, (x1 - x0 + pad * 2) * k, (y1 - y0 + pad * 2) * k);
  ctx.restore();
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the screenshot to mark it.'));
    img.src = src;
  });
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

/** The screenshot at `src` with the marks burned in, at its own size: a PNG, or a JPEG when the PNG is too big to send. */
export async function renderMarked(src: string, marks: readonly Mark[], viewportWidth: number): Promise<Blob> {
  const img = await load(src);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the marks onto the screenshot.');
  ctx.drawImage(img, 0, 0);
  drawMarks(ctx, marks, img.naturalWidth / viewportWidth);
  const png = await toBlob(c, 'image/png');
  if (png && png.size <= PNG_MAX) return png;
  const jpg = await toBlob(c, 'image/jpeg', 0.9);
  if (!jpg) throw new Error('Could not render the marked screenshot.');
  return jpg;
}

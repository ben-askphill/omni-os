import type { CharacterFace, CrewEye } from '@omni/shared/agent-avatar.ts';

/**
 * A crew character as the agent face draws it (ADR 0021): inside the lean, the outline filled with the agent's color
 * and stroked in the theme's foreground, the Conductor's satellite, and the two eyes in the eye ink. No disc behind
 * it. It decides nothing: `face` is agentFace()'s. `data-grid` and `data-eyes` name the drawing for screenshots.
 */
export function CrewCharacter({ face, className = '' }: { face: CharacterFace; className?: string }) {
  const [left, right] = face.pair;
  return (
    <svg
      aria-hidden="true"
      data-shape={face.shape}
      data-grid={face.grid}
      data-eyes={face.eyes}
      className={`shrink-0 ${className}`}
      width={face.size}
      height={face.size}
      viewBox={face.viewBox}
    >
      <g transform={face.lean}>
        <path d={face.outline} fill={face.body} stroke="var(--fg)" strokeWidth={face.stroke} strokeLinejoin="round" />
        {face.satellite && <circle cx={face.satellite.cx} cy={face.satellite.cy} r={face.satellite.r} fill="var(--fg)" />}
        <Eye eye={left} ink={face.ink} />
        <Eye eye={right} ink={face.ink} />
      </g>
    </svg>
  );
}

/** A filled glyph, or a line glyph (lid, chevron, arc) stroked `line` wide with round ends. */
function Eye({ eye, ink }: { eye: CrewEye; ink: string }) {
  if (eye.line === null) return <path d={eye.path} fill={ink} />;
  return <path d={eye.path} fill="none" stroke={ink} strokeWidth={eye.line} strokeLinecap="round" strokeLinejoin="round" />;
}

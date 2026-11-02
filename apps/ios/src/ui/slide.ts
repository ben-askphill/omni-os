export const SLIDE_REACHED = 0.85;

export const clampSlide = (dx: number, travel: number) => Math.min(Math.max(dx, 0), Math.max(travel, 0));

export const slideReached = (dx: number, travel: number) => travel > 0 && clampSlide(dx, travel) >= travel * SLIDE_REACHED;

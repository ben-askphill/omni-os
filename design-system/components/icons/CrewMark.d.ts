/**
 * Compact mark for a crew role, 12–16px. Conductor = the ring itself (thick);
 * researcher = aperture; builder = block; store-ops = tag; inbox = tray.
 */
export type CrewRole = 'conductor' | 'researcher' | 'builder' | 'store-ops' | 'inbox';
export interface CrewMarkProps {
  role?: CrewRole;
  size?: number;
  className?: string;
  title?: string;
}
export function CrewMark(props: CrewMarkProps): JSX.Element;
export const CREW_ROLES: CrewRole[];

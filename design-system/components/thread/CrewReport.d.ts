import type { ReactNode } from 'react';

/**
 * Crew report delivered back into the Conductor thread (web/src ReportCard): 22px-radius surface card; header with a
 * 28px round crew mark, "Report from {role}", T-id, #channel, a volt "New" chip while unread, time and an
 * "Open thread" white pill; display-face title; markdown body; optional actions; mono fact line.
 * @startingPoint section="Thread" subtitle="Crew report card" viewport="760x320"
 */
export interface CrewReportProps {
  role?: 'researcher' | 'builder' | 'store-ops' | 'inbox' | 'conductor';
  taskId?: string;
  channel?: { code?: string; name: string };
  time?: string;
  title?: string;
  fresh?: boolean;
  status?: 'running' | 'needs' | 'done' | 'settled' | 'failed';
  facts?: string[];
  actions?: ReactNode;
  onOpen?: () => void;
  children?: ReactNode;
}
export function CrewReport(props: CrewReportProps): JSX.Element;

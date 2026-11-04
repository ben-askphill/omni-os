/**
 * PR panel for a crew thread's pull request: state chip, display-face title, branch → base pills, checks tray, a
 * colour-free diff tick bar (ink = additions, outlined = deletions), files, and Bencho slide-to-merge (locked until
 * checks pass). Merged = volt chip.
 * @startingPoint section="Panels" subtitle="PR panel with slide-to-merge" viewport="380x680"
 */
export interface GitHubPanelProps {
  pr: {
    number: number;
    title: string;
    repo?: string;
    state?: 'open' | 'draft' | 'merged' | 'blocked';
    branch: string;
    base?: string;
    taskId?: string;
    checks?: { name: string; state: 'running' | 'done' | 'settled' | 'needs' | 'queued'; duration?: string }[];
    additions: number;
    deletions: number;
    files?: { path: string; add: number; del: number }[];
  };
  onClose?: () => void;
  onMerge?: () => void | Promise<void>;
  /** Forwarded to Panel: controlled width, or omit to let the user drag. */
  width?: number;
  resizable?: boolean;
  onResize?: (width: number) => void;
}
export function GitHubPanel(props: GitHubPanelProps): JSX.Element;

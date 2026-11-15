import { livesOnOf, refusalDetail, type LivesOn, type Takeover } from '@omni/shared/handoff.ts';
import { ApiError, errorText } from '../../api.ts';
import { Button, ErrorNote, Icon } from '../ui.tsx';

// A reply the server did not send because the thread lives on another machine (packages/shared/handoff.ts LivesOn):
// the Handoff card's alert look, with Send there and Take over in place of Cancel. Any other refusal with a raw
// reason under it (git's, when a worktree could not be made) is an ErrorNote with that reason on a second line.
// The desktop reply box and the phone composer show it over the box.

/** A refused send as the reply box shows it: the server's text, the raw reason under it, and where the thread lives. */
export interface SendRefusal {
  text: string;
  detail: string | null;
  livesOn: LivesOn | null;
}

export function sendRefusal(e: unknown): SendRefusal {
  const body = e instanceof ApiError ? e.body : null;
  return { text: errorText(e), detail: refusalDetail(body), livesOn: livesOnOf(body) };
}

/** Why Take over cannot be picked from the card, or null when it can. */
const takeoverBlock = (t: Takeover | null | undefined) => (t ? t.refused : 'No machine is known to hold this thread yet.');

export function LivesOnNote({
  refusal,
  takeover,
  busy,
  mobile,
  className = '',
  onSendThere,
  onTakeOver,
}: {
  refusal: SendRefusal;
  /** The thread's Take over (GET /api/threads/:id `takeover`), which the button opens. */
  takeover: Takeover | null | undefined;
  /** The message is going again. */
  busy?: boolean;
  mobile?: boolean;
  className?: string;
  onSendThere: () => void;
  onTakeOver: () => void;
}) {
  const { text, detail, livesOn } = refusal;
  const reason = detail && (
    <span className="mt-0.5 block text-[12px] leading-[1.5] break-words text-fg-3" title={detail}>
      {detail}
    </span>
  );
  if (!livesOn) {
    return (
      <ErrorNote className={className}>
        {text}
        {reason}
      </ErrorNote>
    );
  }
  const blocked = takeoverBlock(takeover);
  return (
    <section
      aria-label={`Lives on ${livesOn.machine.name}`}
      role="alert"
      className={`pop-in overflow-hidden bg-surface ${mobile ? 'rounded-[20px]' : 'rounded-2xl border border-line'} ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-needs/12 text-needs">
          <Icon name="monitor" size={15} />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className={`${mobile ? 'text-[14px]' : 'text-[13.5px]'} leading-[1.45] text-fg`}>{text}</p>
          {reason}
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button size="sm" variant="primary" icon="send" busy={busy} onClick={onSendThere}>
            Send there
          </Button>
          <Button size="sm" variant="secondary" icon="monitor" disabled={!!blocked || busy} title={blocked ?? undefined} onClick={onTakeOver}>
            Take over
          </Button>
        </div>
      </div>
    </section>
  );
}

// PROTOTYPE, throwaway. Three layouts for the desktop merge card, switchable on the real PR page with `?variant=A|B|C`
// in the hash (`#/c/<channel>/prs/<n>?variant=B`), plus `&mstate=conflicts|merging|error|merged` to force a state.
// Every mutation here is a stub: merging and auto-merge change local state only, nothing reaches gh. Never merge this to
// main; the winning layout gets rewritten into PRMergePanel.tsx properly.
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Channel, PRDetail as PRDetailT } from "../api.ts";
import {
  Button,
  Chip,
  ErrorNote,
  Icon,
  MENU_SURFACE,
  Segmented,
  StatusDot,
  Toggle,
  type IconName,
} from "../components/ui.tsx";
import { checkTone } from "@omni/shared/thread-glance.ts";
import {
  RerunNote,
  type useRerunFailedChecks,
} from "../components/RerunChecks.tsx";

type MergeMethod = "squash" | "merge" | "rebase";
export type ProtoVariant = "A" | "B" | "C";
type ProtoState = "default" | "conflicts" | "merging" | "error" | "merged";

const VARIANTS: { id: ProtoVariant; name: string }[] = [
  { id: "A", name: "One-line bar" },
  { id: "B", name: "Status headline" },
  { id: "C", name: "Docked bar" },
];
const STATES: ProtoState[] = [
  "default",
  "conflicts",
  "merging",
  "error",
  "merged",
];

const METHODS: {
  value: MergeMethod;
  label: string;
  short: string;
  sub: string;
}[] = [
  {
    value: "squash",
    label: "Squash and merge",
    short: "Squash",
    sub: "One commit on the base branch",
  },
  {
    value: "merge",
    label: "Merge commit",
    short: "Merge commit",
    sub: "Keep every commit plus a merge commit",
  },
  {
    value: "rebase",
    label: "Rebase and merge",
    short: "Rebase",
    sub: "Replay the commits, no merge commit",
  },
];

// ---------- the URL params ----------

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const hashQuery = () =>
  new URLSearchParams(window.location.hash.split("?")[1] ?? "");

export function useProtoParams(): {
  variant: ProtoVariant | null;
  state: ProtoState;
} {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  void hash;
  const q = hashQuery();
  const v = q.get("variant")?.toUpperCase();
  const s = q.get("mstate") as ProtoState | null;
  return {
    variant: v === "A" || v === "B" || v === "C" ? v : null,
    state: s && STATES.includes(s) ? s : "default",
  };
}

function setParam(key: string, value: string | null) {
  const [path, query = ""] = window.location.hash.split("?");
  const q = new URLSearchParams(query);
  if (value === null) q.delete(key);
  else q.set(key, value);
  const next = `${path}${q.toString() ? `?${q}` : ""}`;
  history.replaceState(null, "", next);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// ---------- the shared model: same inputs and states as PRMergePanel, mutations stubbed ----------

function useMergeModel(p: PRDetailT, state: ProtoState) {
  const [method, setMethod] = useState<MergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [autoOn, setAutoOn] = useState(!!p.autoMergeRequest);
  const [autoBusy, setAutoBusy] = useState(false);
  // A new forced state starts the card over.
  useEffect(() => {
    setMerging(false);
    setMerged(null);
    setMergeError(null);
  }, [state]);

  const doMerge = () => {
    setMergeError(null);
    setMerging(true);
    window.setTimeout(() => {
      setMerging(false);
      setMerged(
        `PROTOTYPE: would run gh pr merge ${p.number} --${method}${deleteBranch ? " --delete-branch" : ""}\n✓ Merged pull request #${p.number} (${p.title})`,
      );
    }, 1600);
  };
  const toggleAuto = () => {
    setAutoBusy(true);
    window.setTimeout(() => {
      setAutoBusy(false);
      setAutoOn((v) => !v);
    }, 600);
  };

  const failed = p.checkRuns.filter(
    (c) => checkTone(c.state) === "needs",
  ).length;
  const pending = p.checkRuns.filter(
    (c) => checkTone(c.state) === "running",
  ).length;
  const passed = p.checkRuns.length - failed - pending;
  const conflicting = state === "conflicts" || p.mergeable === "CONFLICTING";
  const warnings = [
    p.isDraft && "Still a draft",
    p.reviewDecision === "CHANGES_REQUESTED" && "Changes requested",
  ].filter(Boolean) as string[];
  const m = METHODS.find((x) => x.value === method)!;
  return {
    p,
    method,
    setMethod,
    m,
    deleteBranch,
    setDeleteBranch,
    merging: merging || state === "merging",
    merged:
      merged ??
      (state === "merged"
        ? `✓ Merged pull request #${p.number} (${p.title})`
        : null),
    mergeError:
      mergeError ??
      (state === "error"
        ? "GraphQL: Pull request is not mergeable: the base branch policy prohibits the merge. (mergePullRequest)"
        : null),
    conflicting,
    failed,
    pending,
    passed,
    warnings,
    blocked: conflicting || failed > 0 || warnings.length > 0,
    autoOn,
    autoBusy,
    toggleAuto,
    doMerge,
    /** What the merge will do, in one sentence: it replaces the "Runs gh pr merge" note. */
    sentence: `${m.label.replace(" and merge", "")} into ${p.baseRefName}${deleteBranch ? `, then delete ${p.headRefName}` : ""}.`,
  };
}
type Model = ReturnType<typeof useMergeModel>;

const headline = (x: Model): { text: string; status: string } =>
  x.merging
    ? { text: "Merging", status: "running" }
    : x.conflicting
      ? { text: "Has conflicts", status: "needs" }
      : x.failed
        ? {
            text:
              x.failed === 1 ? "1 check failing" : `${x.failed} checks failing`,
            status: "needs",
          }
        : x.warnings.length
          ? { text: x.warnings[0], status: "needs" }
          : { text: "Ready to merge", status: "done" };

/** A tiny outside-press popover: prototype only, the real one would use useAnchoredPopover. */
function usePop() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) =>
      !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, wrap };
}

/** Method radios with their sub line, the delete branch switch and the gh note: the options panel A and C share. */
function OptionsPanel({ x, className = "" }: { x: Model; className?: string }) {
  return (
    <div
      className={`${MENU_SURFACE} w-[19rem] p-1.5 ${className}`}
      role="dialog"
      aria-label="Merge options"
    >
      <div role="radiogroup" aria-label="Merge method">
        {METHODS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={x.method === o.value}
            onClick={() => x.setMethod(o.value)}
            className="hov flex w-full items-start gap-2.5 rounded-[var(--r-lg)] px-2.5 py-2 text-left"
          >
            <span className="mt-[3px] w-3.5 shrink-0 text-fg">
              {x.method === o.value && <Icon name="check" size={14} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[length:var(--fs-ui)] text-fg">
                {o.label}
              </span>
              <span className="block text-[length:var(--fs-12)] text-fg-3">
                {o.sub}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="mx-2.5 my-1.5 h-px bg-line" />
      <label className="flex items-center justify-between gap-3 px-2.5 py-2 text-[length:var(--fs-ui)] text-fg">
        Delete branch after merge
        <Toggle
          checked={x.deleteBranch}
          onChange={x.setDeleteBranch}
          label="Delete branch after merge"
        />
      </label>
      <p className="px-2.5 pt-1 pb-1.5 text-[length:var(--fs-12)] leading-[1.45] text-fg-3">
        Runs{" "}
        <span className="font-mono text-[length:var(--fs-code)] text-fg-2">
          gh pr merge
        </span>
        {x.deleteBranch ? ", then deletes the branch" : ""}. Can’t be undone
        from here.
      </p>
    </div>
  );
}

function MergeButton({
  x,
  className = "",
  size,
}: {
  x: Model;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <Button
      variant="primary"
      size={size}
      className={className}
      disabled={x.conflicting}
      busy={x.merging}
      onClick={x.doMerge}
    >
      {x.conflicting
        ? "Resolve conflicts first"
        : x.merging
          ? "Merging"
          : x.m.label}
    </Button>
  );
}

function AutoMergeButton({ x, size = "sm" }: { x: Model; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {x.autoOn && (
        <span className="inline-flex items-center gap-1 text-[length:var(--fs-ui)] font-medium text-live-text">
          <Icon name="zap" size={14} />
          Auto-merge is on
        </span>
      )}
      <Button
        size={size}
        variant="ghost"
        icon={x.autoOn ? undefined : "zap"}
        busy={x.autoBusy}
        disabled={x.p.isDraft && !x.autoOn}
        onClick={x.toggleAuto}
        title="Merges by itself once checks and reviews pass"
      >
        {x.autoOn ? "Turn off" : "Auto-merge"}
      </Button>
    </span>
  );
}

function RerunButton({
  rerun,
}: {
  rerun: ReturnType<typeof useRerunFailedChecks>;
}) {
  if (!rerun.can) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      icon="refresh"
      onClick={() => void rerun.run()}
      busy={rerun.busy}
      title="Runs gh run rerun --failed for each failing workflow run. No agent turn."
    >
      Rerun failed checks
    </Button>
  );
}

function Merged({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={`pop-in flex items-start gap-2.5 rounded-[var(--r-xl)] bg-surface px-4 py-3 text-[length:var(--fs-ui)] text-fg ${className}`}
    >
      <StatusDot status="done" size={9} className="mt-1 shrink-0" />
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  );
}

// ---------- A: one-line bar ----------
// The whole card is one row: what stands in the way on the left, a split merge button on the right. Method, delete
// branch and the gh note fold into the caret's menu, so the default case reads as one sentence and one button.

function VariantA({
  x,
  rerun,
}: {
  x: Model;
  rerun: ReturnType<typeof useRerunFailedChecks>;
}) {
  const pop = usePop();
  const h = headline(x);
  if (x.merged) return <Merged text={x.merged} className="mt-5" />;
  return (
    <section
      aria-label="Merge"
      className="mt-5 rounded-[var(--r-xl)] bg-surface py-2.5 pr-2.5 pl-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex min-w-0 items-center gap-2 text-[length:var(--fs-ui)] font-medium text-fg">
          <StatusDot status={h.status} size={9} />
          {h.text}
        </span>
        {x.blocked && !x.merging && (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {[
              x.conflicting && "Has conflicts",
              x.failed > 0 &&
                (x.failed === 1
                  ? "1 check failing"
                  : `${x.failed} checks failing`),
              ...x.warnings,
            ]
              .filter((t): t is string => !!t && t !== h.text)
              .map((t) => (
                <Chip key={t} tone="needs">
                  {t}
                </Chip>
              ))}
            <RerunButton rerun={rerun} />
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <AutoMergeButton x={x} />
          <div ref={pop.wrap} className="relative inline-flex">
            <MergeButton x={x} size="sm" className="rounded-r-none pr-3" />
            <Button
              variant="primary"
              size="sm"
              className="rounded-l-none border-l border-on-ink/20 px-2"
              disabled={x.merging}
              aria-label="Merge options"
              aria-expanded={pop.open}
              onClick={() => pop.setOpen(!pop.open)}
            >
              <Icon name="chevronDown" size={14} />
            </Button>
            {pop.open && (
              <OptionsPanel
                x={x}
                className="absolute top-full right-0 z-30 mt-1.5"
              />
            )}
          </div>
        </span>
      </div>
      <RerunNote outcome={rerun.outcome} className="mt-2" />
      {x.mergeError && (
        <ErrorNote className="mt-2 !bg-surface-2">{x.mergeError}</ErrorNote>
      )}
    </section>
  );
}

// ---------- B: status headline ----------
// The card leads with the answer ("Ready to merge", "Has conflicts") and lists each requirement as a row, so the
// reason a merge is blocked sits next to its fix. The options move to a footer under the requirements, and the note
// becomes a plain sentence of what the button will do.

function Req({
  ok,
  icon,
  children,
  action,
}: {
  ok: boolean | "live";
  icon?: IconName;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="flex min-h-9 items-center gap-2.5 border-t border-line py-1.5 first:border-t-0">
      <StatusDot
        status={ok === "live" ? "running" : ok ? "done" : "needs"}
        size={8}
        className="shrink-0"
      />
      {icon && <Icon name={icon} size={14} className="text-fg-3" />}
      <span className="min-w-0 flex-1 text-[length:var(--fs-ui)] text-fg-2">
        {children}
      </span>
      {action}
    </li>
  );
}

function VariantB({
  x,
  rerun,
}: {
  x: Model;
  rerun: ReturnType<typeof useRerunFailedChecks>;
}) {
  const h = headline(x);
  if (x.merged) return <Merged text={x.merged} className="mt-5" />;
  const review = x.p.reviewDecision;
  return (
    <section
      aria-label="Merge"
      className="mt-5 rounded-[var(--r-xl)] bg-surface px-4 pt-3.5 pb-3"
    >
      <div className="flex items-center gap-2.5">
        <StatusDot status={h.status} size={12} />
        <h3 className="font-display text-[length:var(--fs-heading)] leading-tight text-fg">
          {h.text}
        </h3>
        <span className="ml-auto">
          <AutoMergeButton x={x} />
        </span>
      </div>
      <ul className="mt-2.5">
        <Req ok={!x.conflicting} icon="branch">
          {x.conflicting ? (
            <>
              <span className="text-fg">Conflicts with {x.p.baseRefName}.</span>{" "}
              Resolve them on the branch first.
            </>
          ) : (
            <>No conflicts with {x.p.baseRefName}</>
          )}
        </Req>
        {x.p.checkRuns.length > 0 && (
          <Req
            ok={x.failed ? false : x.pending ? "live" : true}
            icon="check"
            action={<RerunButton rerun={rerun} />}
          >
            {x.failed ? (
              <span className="text-fg">
                {x.failed === 1
                  ? "1 check failing"
                  : `${x.failed} checks failing`}
              </span>
            ) : x.pending ? (
              `${x.pending} running`
            ) : (
              "All checks passed"
            )}
            {(x.failed > 0 || x.pending > 0) && (
              <span className="text-fg-3">
                {" "}
                · {x.passed} passed
                {x.failed && x.pending ? `, ${x.pending} running` : ""}
              </span>
            )}
          </Req>
        )}
        <Req
          ok={
            review === "APPROVED"
              ? true
              : review === "CHANGES_REQUESTED"
                ? false
                : "live"
          }
          icon="message"
        >
          {review === "APPROVED" ? (
            "Approved"
          ) : review === "CHANGES_REQUESTED" ? (
            <span className="text-fg">Changes requested</span>
          ) : (
            "Review requested"
          )}
        </Req>
        {x.p.isDraft && (
          <Req ok={false} icon="pencil">
            <span className="text-fg">Still a draft</span>
          </Req>
        )}
      </ul>
      <RerunNote outcome={rerun.outcome} className="mt-2" />
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--r-lg)] bg-surface-2 py-2 pr-2 pl-3">
        <Segmented
          size="sm"
          label="Merge method"
          value={x.method}
          onChange={x.setMethod}
          options={METHODS.map((o) => ({
            id: o.value,
            label: o.short,
            title: o.sub,
          }))}
        />
        <label className="flex items-center gap-2 text-[length:var(--fs-ui)] text-fg-2">
          <Toggle
            checked={x.deleteBranch}
            onChange={x.setDeleteBranch}
            label="Delete branch after merge"
          />
          Delete branch
        </label>
        <MergeButton x={x} className="ml-auto" />
      </div>
      <p className="mt-2 px-1 text-[length:var(--fs-12)] leading-[1.45] text-fg-3">
        {x.sentence} Can’t be undone from here.
      </p>
      {x.mergeError && (
        <ErrorNote className="mt-2 !bg-surface-2">{x.mergeError}</ErrorNote>
      )}
    </section>
  );
}

// ---------- C: docked bar ----------
// Nothing sits above the tabs: the review content gets the page. The merge control docks to the bottom of the window
// as one floating bar that stays in reach while you read the diff. Options open upward from a summary pill.

function VariantC({
  x,
  rerun,
}: {
  x: Model;
  rerun: ReturnType<typeof useRerunFailedChecks>;
}) {
  const pop = usePop();
  const h = headline(x);
  return (
    <div className="sticky bottom-4 z-20 mt-8">
      {x.mergeError && (
        <ErrorNote className="mb-2 shadow-[var(--shadow-menu)]">
          {x.mergeError}
        </ErrorNote>
      )}
      <RerunNote outcome={rerun.outcome} className="mb-2" />
      {x.merged ? (
        <Merged
          text={x.merged}
          className="!bg-elev shadow-[var(--shadow-menu)]"
        />
      ) : (
        <section
          aria-label="Merge"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--r-2xl)] bg-elev py-2 pr-2 pl-4 shadow-[var(--shadow-menu)]"
        >
          <span className="inline-flex min-w-0 items-center gap-2 text-[length:var(--fs-ui)] font-medium text-fg">
            <StatusDot status={h.status} size={9} />
            {h.text}
          </span>
          {x.failed > 0 && !x.merging && <RerunButton rerun={rerun} />}
          <div ref={pop.wrap} className="relative">
            <button
              type="button"
              className="hov inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[length:var(--fs-12)] text-fg-2 hover:text-fg"
              aria-expanded={pop.open}
              onClick={() => pop.setOpen(!pop.open)}
            >
              {x.m.short}
              {x.deleteBranch ? " · delete branch" : " · keep branch"}
              <Icon name="chevronDown" size={12} />
            </button>
            {pop.open && (
              <OptionsPanel
                x={x}
                className="absolute bottom-full left-0 z-30 mb-2"
              />
            )}
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <AutoMergeButton x={x} />
            <MergeButton x={x} />
          </span>
        </section>
      )}
    </div>
  );
}

// ---------- the switcher ----------

function Switcher({
  variant,
  state,
}: {
  variant: ProtoVariant;
  state: ProtoState;
}) {
  const i = VARIANTS.findIndex((v) => v.id === variant);
  const go = (d: number) =>
    setParam(
      "variant",
      VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length].id,
    );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft" && e.altKey) go(-1);
      if (e.key === "ArrowRight" && e.altKey) go(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <div className="fixed top-3 right-3 z-[60] flex items-center gap-1 rounded-full bg-fg px-1.5 py-1 text-[12px] text-on-ink shadow-[var(--shadow-menu)]">
      <span className="px-2 font-mono opacity-60">PROTOTYPE</span>
      <button
        type="button"
        className="rounded-full px-2 py-1 hover:bg-on-ink/15"
        onClick={() => go(-1)}
        aria-label="Previous variant"
        title="Alt+Left"
      >
        ←
      </button>
      <span className="min-w-[9.5rem] text-center font-medium">
        {variant} · {VARIANTS[i].name}
      </span>
      <button
        type="button"
        className="rounded-full px-2 py-1 hover:bg-on-ink/15"
        onClick={() => go(1)}
        aria-label="Next variant"
        title="Alt+Right"
      >
        →
      </button>
      <span className="mx-1 h-4 w-px bg-on-ink/25" />
      {STATES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setParam("mstate", s === "default" ? null : s)}
          className={`rounded-full px-2 py-1 ${s === state ? "bg-on-ink text-fg" : "hover:bg-on-ink/15"}`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

/**
 * The prototype in the merge card's place. `slot` is where PRs.tsx mounts it: `top` above the tabs (A, B), `bottom`
 * after the tab body (C, which docks). The switcher renders once, from the top slot.
 */
export function MergePrototype({
  slot,
  variant,
  state,
  p,
  rerun,
}: {
  slot: "top" | "bottom";
  variant: ProtoVariant;
  state: ProtoState;
  channel: Channel;
  p: PRDetailT;
  rerun: ReturnType<typeof useRerunFailedChecks>;
}) {
  // Keyed by variant and state so a switch starts the card fresh.
  const x = useMergeModel(p, state);
  const open = !p.state || p.state === "OPEN";
  if (slot === "top") {
    return (
      <>
        <Switcher variant={variant} state={state} />
        {open && variant === "A" && <VariantA x={x} rerun={rerun} />}
        {open && variant === "B" && <VariantB x={x} rerun={rerun} />}
      </>
    );
  }
  return open && variant === "C" ? <VariantC x={x} rerun={rerun} /> : null;
}

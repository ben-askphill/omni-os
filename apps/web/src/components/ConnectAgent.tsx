import { useMemo, useState } from 'react';
import { api, errorText, useApi } from '../api.ts';
import { agentKeyName, groupedCode, KIND_LABEL, NETWORK_LABEL, normalizeCode, parseConnectInput, slugFrom, type AgentTest, type FoundAgent, type PairedAgent } from '@omni/shared/connect-agent.ts';
import { Button, CheckItem, Chip, CopyButton, ErrorNote, Label, LinkButton, Modal, ModalFooter, Picker, type PickerOption } from './ui.tsx';
import { href } from '../router.ts';
import { AgentAvatar } from './AgentAvatar.tsx';

// Add remote agent (docs/plans/2026-11-18-connect-an-agent.md, C1; ADR 0020): Find, Sign in, Test, then Connect, which
// always makes the remote agent, wearing the avatar its server offers. The same sheet on desktop web, the phone layout
// and the desktop app, opened from Settings > Agents, from an omni://connect-agent link (the page
// #/connect-agent?...), or #/settings/crew?connect=<link> (#/settings/models?connect= from older links). A link only fills the
// sheet in: nothing is saved until the test turn passed and Ben presses Connect. The agent's key never reaches this
// page: a paired key stays on the server under a draft id, and a manual one is a secret's name. An eve agent that pairs
// offers its own Connect Omni page (`codeUrl`): Get a code opens it, Ben copies the code back and presses Pair.

interface Connected {
  harness: { id: string; name: string; host: string };
  /** The remote agent Connect made: connecting always makes one (ADR 0020). */
  role: { id: string; name: string };
}

/** What a remote agent can do on Omni, and what it cannot: chips, the cannots outlined. */
export function CapabilityChips({ can, cannot }: { can: readonly string[]; cannot: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="What a thread on it can do">
      {can.map((c) => (
        <Chip key={c}>{c}</Chip>
      ))}
      {cannot.map((c) => (
        <Chip key={c} tone="outline" title={`A remote agent has no ${c.toLowerCase()} on this machine`}>
          No {c.toLowerCase()}
        </Chip>
      ))}
    </div>
  );
}

/** The Remote tag a remote agent carries next to its name: it runs on a server outside Omni, at this host when shown. */
export function RemoteMark({ host }: { host?: string }) {
  return (
    <Chip tone="outline" title={host ? `Runs on ${host}, a server outside Omni` : 'Runs on a server outside Omni'}>
      Remote{host ? ` · ${host}` : ''}
    </Chip>
  );
}

type Step = 'pending' | 'in_progress' | 'completed';

export function ConnectAgentSheet({ open, initial, onClose, onConnected }: { open: boolean; initial?: string; onClose: () => void; onConnected?: (c: Connected) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add remote agent" roomy>
      {open && <ConnectBody key={initial ?? ''} initial={initial} onClose={onClose} onConnected={onConnected} />}
    </Modal>
  );
}

function ConnectBody({ initial, onClose, onConnected }: { initial?: string; onClose: () => void; onConnected?: (c: Connected) => void }) {
  const helper = useApi<{ command: string | null }>('/harnesses/connect/helper');
  const [text, setText] = useState(initial ?? '');
  const parsedText = useMemo(() => parseConnectInput(text), [text]);
  const [code, setCode] = useState(() => (initial ? parseConnectInput(initial)?.code : '') ?? '');
  const [found, setFound] = useState<FoundAgent | null>(null);
  const [paired, setPaired] = useState<PairedAgent | null>(null);
  const [secret, setSecret] = useState('');
  const [test, setTest] = useState<AgentTest | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState<'find' | 'pair' | 'test' | 'connect' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Connected | null>(null);

  const codeInText = parsedText?.code;
  const theCode = codeInText ?? code;
  const reset = () => {
    setFound(null);
    setPaired(null);
    setTest(null);
    setError(null);
  };

  const find = async (raw = text, typed = code) => {
    const given = parseConnectInput(raw);
    if (!given) return;
    setBusy('find');
    reset();
    try {
      const f = await api.post<FoundAgent>('/harnesses/connect/find', { ...given, ...(!given.code && typed.trim() && { code: typed.trim() }) });
      setFound(f);
      setName(f.name);
      if (!slugTouched) setSlug(slugFrom(f.name));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const pair = async () => {
    if (!found) return;
    setBusy('pair');
    setError(null);
    try {
      const p = await api.post<PairedAgent>('/harnesses/connect/pair', { ...(found.url && { url: found.url }), ...(found.pair && { pair: found.pair }), code: theCode, name: found.name, ...(found.kind === 'eve' && { kind: 'eve' }) });
      setPaired(p);
      setName(p.name);
      if (!slugTouched) setSlug(slugFrom(p.name));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy('test');
    setError(null);
    setTest(null);
    try {
      setTest(await api.post<AgentTest>('/harnesses/connect/test', paired ? { draft: paired.draft } : { url: found?.url, secret, ...eveKind }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const c = await api.post<Connected>('/harnesses/connect', { slug, name, ...(found?.description && { description: found.description }), ...(paired ? { draft: paired.draft } : { url: found?.url, secret, ...eveKind }) });
      setDone(c);
      onConnected?.(c);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const usable = !!found?.supported && !found.problem;
  // A manual key for an eve agent is tested and saved as one: the server speaks eve's own API to it.
  const eveKind = found?.kind === 'eve' ? { kind: 'eve' as const } : {};
  // A pairing route without a code yet (an eve agent's Connect Omni page): the code is typed under Sign in.
  const pairing = usable && found!.signIn === 'pairing' && (!!normalizeCode(theCode) || found!.kind === 'eve');
  const codeReady = !!normalizeCode(theCode);
  const signedIn = pairing ? !!paired : !!secret;
  const steps: { label: string; state: Step }[] = [
    { label: 'Find', state: usable ? 'completed' : busy === 'find' ? 'in_progress' : 'pending' },
    { label: 'Sign in', state: signedIn ? 'completed' : usable ? 'in_progress' : 'pending' },
    { label: 'Test', state: test?.ok ? 'completed' : signedIn ? 'in_progress' : 'pending' },
  ];

  if (done)
    return (
      <>
        <div className="space-y-3 px-6 pb-5" role="status">
          <p className="text-[14px]">
            <strong className="font-medium">{done.role.name}</strong> is connected, on {done.harness.host}. Start a thread as {done.role.name}, or seat it in one with @{done.role.name}.
          </p>
          <p className="text-[13px] text-fg-3">It talks only: a local agent seated beside it changes files. Its key is in Secrets on this machine only.</p>
        </div>
        <ModalFooter>
          <a className="mr-auto text-[13px] text-fg-2 underline underline-offset-2" href={href.agent(done.role.id)} onClick={onClose}>
            Open {done.role.name}
          </a>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </ModalFooter>
      </>
    );

  return (
    <>
      <div className="space-y-5 px-6 pb-5">
        <p className="text-[13px] leading-5 text-fg-2">An AI agent on your own server, such as Hermes or an eve agent, becomes an agent here: you mention it, seat it or start a thread as it, and it talks only. Nothing is saved until its test turn passes and you press Connect.</p>
        <ol className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Steps">
          {/* CheckItem is the list item itself. */}
          {steps.map((s) => (
            <CheckItem key={s.label} state={s.state}>
              {s.label}
            </CheckItem>
          ))}
        </ol>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void find();
          }}
        >
          <div>
            <Label htmlFor="connect-input" hint="The link its pairing helper printed, or the agent's address">
              Address, link or code
            </Label>
            <div className="flex gap-2">
              <input
                id="connect-input"
                data-autofocus
                className="field min-w-0 flex-1"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  reset();
                }}
                placeholder="omni://connect-agent?… or https://agent.example.com"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" busy={busy === 'find'} disabled={!parsedText || !!busy}>
                Find
              </Button>
            </div>
          </div>
          {/* A link only fills the sheet in: Omni reaches out to the address once the user has read it and pressed Find. */}
          {initial && !found && text === initial && (
            <p data-from-link className="text-[12.5px] text-fg-2">
              Opened from a link. Check this is the harness you meant, then press Find.
            </p>
          )}
          {!codeInText && !pairing && (
            <div>
              <Label htmlFor="connect-code" hint="Only when the helper printed an address and a code to type">
                Pairing code
              </Label>
              <input id="connect-code" className="field w-full font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-…" autoComplete="off" spellCheck={false} />
            </div>
          )}
        </form>

        {!found && helper.data?.command && (
          <div className="space-y-2 rounded-[14px] bg-bg p-3">
            <p className="text-[12.5px] text-fg-2">Hermes on a server? Run this there, then paste the link it prints:</p>
            <div className="flex min-w-0 items-start gap-2">
              <code className="min-w-0 flex-1 text-[11.5px] break-all">{helper.data.command}</code>
              <CopyButton text={helper.data.command} />
            </div>
          </div>
        )}

        {found && <FoundCard found={found} />}

        {usable && (
          <section className="space-y-2" aria-label="Sign in">
            <h3 className="caption">Sign in</h3>
            {pairing ? (
              paired ? (
                <p className="text-[13px] text-fg-2">
                  Paired with {paired.host}. The key is in this machine's server and is never shown.
                  {paired.sharedKey && ' The server gives every machine that pairs the same key: to cut one off, change the key on the server.'}
                </p>
              ) : codeInText ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-fg-2">
                    Code <code className="text-[12px]">{groupedCode(theCode)}</code>
                  </span>
                  <Button variant="primary" busy={busy === 'pair'} disabled={!!busy} onClick={() => void pair()}>
                    Pair
                  </Button>
                </div>
              ) : (
                <CodeEntry found={found!} code={code} onCode={setCode} ready={codeReady} busy={busy === 'pair'} disabled={!!busy} onPair={() => void pair()} />
              )
            ) : (
              <SecretPick value={secret} onChange={setSecret} suggested={agentKeyName(slug || slugFrom(found!.name))} />
            )}
          </section>
        )}

        {usable && signedIn && (
          <section className="space-y-2" aria-label="Test">
            <h3 className="caption">Test</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button busy={busy === 'test'} disabled={!!busy} onClick={() => void runTest()}>
                {test ? 'Test again' : 'Run a test turn'}
              </Button>
              <span className="text-[12.5px] text-fg-3">Asks it for one line: its name and model.</span>
            </div>
            {test && <TestOutcome test={test} />}
          </section>
        )}

        {test?.ok && (
          <section className="space-y-3" aria-label="Save">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="connect-name">Name</Label>
                <input id="connect-name" className="field w-full" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="connect-slug" hint="The agent's id, and its server's">
                  Id
                </Label>
                <input
                  id="connect-slug"
                  className="field w-full font-mono"
                  value={slug}
                  maxLength={48}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                  }}
                />
              </div>
            </div>
          </section>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy === 'connect'} disabled={!test?.ok || !name.trim() || !slug || !!busy} onClick={() => void connect()}>
          Connect
        </Button>
      </ModalFooter>
    </>
  );
}

/**
 * The one sign-in step for an agent that pairs: get a code where its owner sees it (an eve agent's Connect Omni page,
 * opened in a new tab or the system browser), paste it, Pair. Pair this machine on a Server card uses it too.
 */
export function CodeEntry({ found, code, onCode, ready, busy, disabled, onPair }: { found: Pick<FoundAgent, 'name' | 'codeUrl'>; code: string; onCode: (c: string) => void; ready: boolean; busy: boolean; disabled: boolean; onPair: () => void }) {
  // No <form> of its own: Pair this machine shows it inside the agent editor's form, and forms cannot nest. Enter in the
  // field pairs, and never reaches a form around it.
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] leading-[18px] text-fg-2">
        {found.codeUrl ? (
          <>
            Get a one-time code from {found.name}: open its Connect Omni page, sign in there if it asks, and copy the code. It works once, for 10 minutes.
          </>
        ) : (
          <>Type the one-time code the agent's owner got from it. It works once, for 10 minutes.</>
        )}
      </p>
      {found.codeUrl && (
        <LinkButton href={found.codeUrl} target="_blank" external icon="external" size="md">
          Get a code
        </LinkButton>
      )}
      <div className="flex items-center gap-2">
        <input
          aria-label="Pairing code"
          className="field min-w-0 flex-1 font-mono"
          value={code}
          onChange={(e) => onCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (ready && !disabled) onPair();
          }}
          placeholder="XXXX-XXXX-…"
          autoComplete="one-time-code"
          spellCheck={false}
        />
        <Button variant="primary" busy={busy} disabled={disabled || !ready} onClick={onPair}>
          Pair
        </Button>
      </div>
    </div>
  );
}

function FoundCard({ found }: { found: FoundAgent }) {
  return (
    <section className="space-y-2 rounded-[14px] bg-bg p-3" aria-label="Found">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* The face the agent will wear: the avatar its server offers, else its initials. */}
        <AgentAvatar agent={{ id: slugFrom(found.name), name: found.name, ...(found.avatar && { avatar: { image: found.avatar } }) }} size={32} />
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 text-[14px] font-medium break-words">{found.name}</span>
          <span className="min-w-0 text-[12.5px] break-all text-fg-3">{found.host}</span>
        </div>
      </div>
      {found.description && <p className="text-[12.5px] text-fg-2">{found.description}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Chip tone="outline">{KIND_LABEL[found.kind]}</Chip>
        <Chip tone="outline">{NETWORK_LABEL[found.network]}</Chip>
      </div>
      {found.supported && <CapabilityChips can={found.can} cannot={found.cannot} />}
      {found.warnings.map((w) => (
        <p key={w} className="text-[12.5px] text-fg-2">
          {w}
        </p>
      ))}
      {found.problem && <ErrorNote>{found.problem}</ErrorNote>}
    </section>
  );
}

const seconds = (ms?: number) => (ms === undefined ? '' : `${(ms / 1000).toFixed(1)} s`);

export function TestOutcome({ test }: { test: AgentTest }) {
  if (!test.ok) return <ErrorNote>{`${test.failed === 'probe' ? 'The signed-in check failed' : 'The test turn failed'}: ${test.detail ?? 'no answer'}`}</ErrorNote>;
  return (
    <div className="space-y-1 rounded-[14px] bg-bg p-3" role="status">
      <p className="text-[13.5px] break-words">“{test.reply || '(an empty reply)'}”</p>
      <p className="text-[12px] text-fg-3">
        {[test.model, test.firstEventMs !== undefined && `first event ${seconds(test.firstEventMs)}`, `done in ${seconds(test.totalMs)}`, test.tokens && `${test.tokens.input + test.tokens.output} tokens`].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}

/** The key from Secrets: pick a global secret by name, or add one here. Its value never comes back to this page. */
function SecretPick({ value, onChange, suggested }: { value: string; onChange: (v: string) => void; suggested: string }) {
  const list = useApi<{ scope: string; name: string }[]>('/secrets');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState(suggested);
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options: PickerOption<string>[] = [
    { value: '', label: 'Pick the secret that holds its key', avatar: false },
    ...(list.data ?? []).filter((s) => s.scope === 'global').map((s) => ({ value: s.name, label: s.name, avatar: false as const, icon: 'key' as const })),
  ];
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/secrets', { scope: 'global', name: newName.trim(), value: newValue.trim() });
      await list.reload();
      onChange(newName.trim());
      setAdding(false);
      setNewValue('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-fg-3">It offers no pairing code, so it signs in with a key you keep in Secrets. Omni sends it only to this harness, never to a thread.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Picker label="Secret" size="field" value={value} options={options} onChange={onChange} className="min-w-0 flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'Add a key'}
        </Button>
      </div>
      {adding && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input aria-label="Secret name" className="field font-mono" value={newName} onChange={(e) => setNewName(e.target.value.toUpperCase())} />
          <input aria-label="Key" className="field" type="password" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="The harness's key" autoComplete="off" />
          <Button variant="primary" busy={busy} disabled={!newName.trim() || !newValue.trim()} onClick={() => void add()}>
            Save key
          </Button>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

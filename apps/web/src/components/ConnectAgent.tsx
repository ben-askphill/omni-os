import { useMemo, useState } from 'react';
import { api, errorText, useApi } from '../api.ts';
import { agentKeyName, groupedCode, KIND_LABEL, NETWORK_LABEL, normalizeCode, parseConnectInput, slugFrom, type AgentTest, type FoundAgent, type PairedAgent } from '@omni/shared/connect-agent.ts';
import { Button, CheckItem, Chip, CopyButton, ErrorNote, Label, Modal, ModalFooter, Picker, Toggle, type PickerOption } from './ui.tsx';
import { href } from '../router.ts';

// Connect an agent (docs/plans/2026-11-18-connect-an-agent.md, C1): Find, Sign in, Test, then Connect. The same
// sheet on desktop web, the phone layout and the desktop app, opened from Settings > Models > Harnesses, from an
// omni://connect-agent link (the page #/connect-agent?...), or #/settings/models?connect=<link>. A link only fills the
// sheet in: nothing is saved until the test turn passed and Ben presses Connect. The agent's key never reaches this
// page: a paired key stays on the server under a draft id, and a manual one is a secret's name.

interface Connected {
  harness: { id: string; name: string; host: string };
  role: { id: string; name: string } | null;
}

/** What a remote harness can do on Omni, and what it cannot: chips, the cannots outlined. */
export function CapabilityChips({ can, cannot }: { can: readonly string[]; cannot: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="What a thread on it can do">
      {can.map((c) => (
        <Chip key={c}>{c}</Chip>
      ))}
      {cannot.map((c) => (
        <Chip key={c} tone="outline" title={`Threads on a remote agent have no ${c.toLowerCase()} on this machine`}>
          No {c.toLowerCase()}
        </Chip>
      ))}
    </div>
  );
}

/** The mark every remote harness carries next to its name: it runs on a server outside Omni, at this host. */
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
    <Modal open={open} onClose={onClose} title="Connect an agent" roomy>
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
  const [role, setRole] = useState(true);
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
      const p = await api.post<PairedAgent>('/harnesses/connect/pair', { ...(found.url && { url: found.url }), ...(found.pair && { pair: found.pair }), code: theCode, name: found.name });
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
      setTest(await api.post<AgentTest>('/harnesses/connect/test', paired ? { draft: paired.draft } : { url: found?.url, secret }));
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
      const c = await api.post<Connected>('/harnesses/connect', { slug, name, role, ...(paired ? { draft: paired.draft } : { url: found?.url, secret }) });
      setDone(c);
      onConnected?.(c);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const usable = !!found?.supported && !found.problem;
  const pairing = usable && found!.signIn === 'pairing' && !!normalizeCode(theCode);
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
            <strong className="font-medium">{done.harness.name}</strong> on {done.harness.host} is connected. Threads can run on it now
            {done.role ? (
              <>
                , and the crew role <strong className="font-medium">{done.role.name}</strong> is bound to it.
              </>
            ) : (
              '.'
            )}
          </p>
          <p className="text-[13px] text-fg-3">Its key is in Secrets on this machine only. In a thread, start a message with @{done.role?.id ?? 'its-role'} to ask it something.</p>
        </div>
        <ModalFooter>
          {done.role && (
            <a className="mr-auto text-[13px] text-fg-2 underline underline-offset-2" href={href.settingsSection('crew', 'crew-roles')} onClick={onClose}>
              Edit the role
            </a>
          )}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </ModalFooter>
      </>
    );

  return (
    <>
      <div className="space-y-5 px-6 pb-5">
        <p className="text-[13px] leading-5 text-fg-2">An agent on your own server, such as Hermes, becomes a harness threads run on. Nothing is saved until its test turn passes and you press Connect.</p>
        <ol className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Steps">
          {steps.map((s) => (
            <li key={s.label}>
              <CheckItem state={s.state}>{s.label}</CheckItem>
            </li>
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
              Agent address, link or code
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
              Opened from a link. Check this is the agent you meant, then press Find.
            </p>
          )}
          {!codeInText && (
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
                  {paired.sharedKey && ' The agent gives every machine that pairs the same key: to cut one off, change the key on the server.'}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-fg-2">
                    Code <code className="text-[12px]">{groupedCode(theCode)}</code>
                  </span>
                  <Button variant="primary" busy={busy === 'pair'} disabled={!!busy} onClick={() => void pair()}>
                    Pair
                  </Button>
                </div>
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
                <Label htmlFor="connect-slug" hint={`Its harness id: custom:${slug || '…'}`}>
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
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-fg-2">Make a crew role for it</span>
                <span className="mt-0.5 block text-[13px] leading-[18px] text-fg-3">A role bound to this agent, so you can ask it from a thread with @ and the Conductor can delegate to it.</span>
              </span>
              <Toggle checked={role} onChange={setRole} label="Make a crew role for it" />
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

function FoundCard({ found }: { found: FoundAgent }) {
  return (
    <section className="space-y-2 rounded-[14px] bg-bg p-3" aria-label="Found">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 text-[14px] font-medium break-words">{found.name}</span>
        <span className="min-w-0 text-[12.5px] break-all text-fg-3">{found.host}</span>
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
      <p className="text-[12.5px] text-fg-3">It offers no pairing code, so it signs in with a key you keep in Secrets. Omni sends it only to this agent, never to a thread.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Picker label="Secret" size="field" value={value} options={options} onChange={onChange} className="min-w-0 flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Cancel' : 'Add a key'}
        </Button>
      </div>
      {adding && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input aria-label="Secret name" className="field font-mono" value={newName} onChange={(e) => setNewName(e.target.value.toUpperCase())} />
          <input aria-label="Key" className="field" type="password" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="The agent's key" autoComplete="off" />
          <Button variant="primary" busy={busy} disabled={!newName.trim() || !newValue.trim()} onClick={() => void add()}>
            Save key
          </Button>
        </div>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

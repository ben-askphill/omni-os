import type { OmniApi } from '@omni/client-core';
import { takeoverShown } from '@omni/shared/thread-machine.ts';
import { crewRoleName, headerShowsRole } from '@omni/shared/crew-role.ts';
import { useHeaderHeight } from '@react-navigation/elements';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { HeaderButton } from '../components/HeaderButton';
import { Notice } from '../components/Notice';
import { HandoffBanner } from '../components/thread/HandoffBanner';
import { RunSheet } from '../components/thread/RunSheet';
import { ThreadBody } from '../components/thread/ThreadBody';
import { ThreadComposer } from '../components/thread/ThreadComposer';
import { ThreadFooter } from '../components/thread/ThreadFooter';
import { TakeoverSheet } from '../components/thread/TakeoverSheet';
import { ThreadHeader } from '../components/thread/ThreadHeader';
import { ThreadMenuSheet } from '../components/thread/ThreadMenuSheet';
import { StepChip } from '../components/thread/StepChip';
import { ThreadTitle } from '../components/thread/ThreadTitle';
import { MemberButton, MemberSheet } from '../components/thread/MemberSheet';
import { agentShows } from '@omni/shared/crew-eyes.ts';
import { threadMark, turnPhase } from '@omni/shared/status.ts';
import { useAgents, useChannels, useNeedsYou, useTechnical, useThreadLive, useThreadView } from '../live/react';
import { isRemoteAgentHarness } from '@omni/shared/remote-agent.ts';
import { useRemote } from '../live/use-remote';
import { useThreadMachine } from '../machine/hooks';
import type { RootScreenProps } from '../navigation/types';
import { useThreadPR } from '../pr/hooks';
import { agentOffersPR, stepChip } from '../pr/step';
import { usePRStep } from '../pr/use-step';
import { useOmniTheme } from '../theme';
import { useHarnessCatalog } from '../thread/hooks';
import { targetOfThread } from '../thread/target';
import { threadDeviceName, threadStatusLabel } from '../thread/title';
import { threadAccountLabel } from '@omni/shared/harness-accounts.ts';

const FLASH_MS = 3000;
const FORK_FALLBACK_MS = 800;
/** The server's own name, for the title when the thread runs here and there is no machine to pick. */
const loadStatus = (api: OmniApi) => api.status();

export function ThreadScreen({ route, navigation }: RootScreenProps<'Thread'>) {
  const { id } = route.params;
  const { colors } = useOmniTheme();
  const live = useThreadLive(id);
  const view = useThreadView(live);
  const headerHeight = useHeaderHeight();
  const { channels } = useChannels();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPage, setMenuPage] = useState<'menu' | 'machine'>('menu');
  const [runOpen, setRunOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const thread = view?.thread ?? null;
  const machine = useThreadMachine(view);
  const catalog = useHarnessCatalog(thread?.channel_id, thread !== null);
  const target = useMemo(() => (thread ? targetOfThread(thread) : null), [thread]);
  const listed = useMemo(() => channels?.find((c) => c.id === thread?.channel_id) ?? null, [channels, thread?.channel_id]);
  const folders = useMemo(() => listed?.folders ?? [], [listed]);
  const server = useRemote(loadStatus);
  const prStep = usePRStep(live, view ?? null);
  const busy = thread?.status === 'running' || thread?.status === 'queued';
  // Open PR as a one-tap answer when the agent just asked whether to open one. The PR list is read only then, to see the branch has none.
  const offers = view ? agentOffersPR({ rows: view.rows, pending: view.pending, busy }) : false;
  const offerPR = useThreadPR(offers ? thread : null);
  const offered = offers && offerPR.page.kind === 'empty' && offerPR.page.canOpen;
  const chip = stepChip(prStep.working, prStep.parked, offered, prStep.prompts);

  const title = thread?.title || 'Thread';
  const hasThread = thread !== null;
  const status = thread?.status;
  const technical = useTechnical();
  const channelName = listed?.name ?? view?.channel?.name ?? null;
  const crew = useAgents();
  const roleName = thread && headerShowsRole(thread) ? crewRoleName(thread.role, crew) : null;
  const lead = thread && headerShowsRole(thread) ? thread.role : null;
  // A remote agent leads talk-only (ADR 0020), said quietly where the harness would be.
  const talksOnly = !!thread && isRemoteAgentHarness(thread.harness);
  // A group thread's avatars are the only sign of who works: the header has no Working label (ADR 0019).
  const group = !!thread?.members?.length;
  const groupWorking = group && thread!.members!.some((m) => m.state === 'working');
  const device = view ? threadDeviceName({ takeover: takeoverShown(view.takeover, view.handoff), machine: machine.machine, hereName: server.data?.device?.name }) : null;
  // The mark the Web UI's header pill draws: what holds it up first, then the running turn's phase, so the lead's eyes
  // think through the turn and work during a tool call (ADR 0021, D7). The head of the reply being written shows it too.
  const rows = view?.rows;
  const turn = useMemo(() => (status === 'running' && rows ? turnPhase(rows) : null), [status, rows]);
  const need = useNeedsYou()?.items.find((i) => i.thread.id === id) ?? null;
  const mark = thread ? threadMark(thread, { turn, need }) : null;
  const ran = useRemote(useCallback((api: OmniApi) => api.threadAccount(id), [id]));
  const account = ran.data?.account ? threadAccountLabel(ran.data.account) : null;
  const canPick = machine.machine !== null;
  const openMenu = useCallback((page: 'menu' | 'machine') => {
    setMenuPage(page);
    setMenuOpen(true);
  }, []);
  useEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: () => (
        <ThreadTitle
          title={title}
          status={status}
          statusLabel={groupWorking ? '' : threadStatusLabel(status, technical)}
          channel={channelName}
          role={roleName}
          lead={lead}
          leadShows={thread && mark ? agentShows(thread.members, thread.role, mark) : undefined}
          talksOnly={talksOnly}
          wide={group}
          device={device}
          account={account}
          onOpenMachine={canPick ? () => openMenu('machine') : undefined}
        />
      ),
      headerRight: hasThread
        ? () => (
            <View style={styles.right}>
              {thread ? <MemberButton thread={thread} onOpen={() => setMembersOpen(true)} /> : null}
              <HeaderButton label="Thread menu" icon="ellipsis" onPress={() => openMenu('menu')} />
            </View>
          )
        : undefined,
    });
  }, [navigation, title, status, technical, channelName, roleName, lead, talksOnly, group, groupWorking, device, account, canPick, hasThread, openMenu, thread, mark]);

  // A machine can fall asleep while the thread stays open: read the list again each time the menu opens.
  const { reload: reloadMachines } = machine;
  useEffect(() => {
    if (menuOpen) reloadMachines();
  }, [menuOpen, reloadMachines]);

  // Fork and Actions open a screen, and a screen cannot present while the menu sheet is still dismissing. The menu reports
  // that it is gone through onClose (the sheet's onDismiss), and a timer covers a dismissal that never reports.
  const afterMenu = useRef<(() => void) | null>(null);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    const next = afterMenu.current;
    afterMenu.current = null;
    next?.();
  }, []);
  const leaveMenuFor = useCallback(
    (open: () => void) => {
      afterMenu.current = open;
      setMenuOpen(false);
      setTimeout(closeMenu, FORK_FALLBACK_MS);
    },
    [closeMenu],
  );
  const fork = useCallback(() => leaveMenuFor(() => navigation.navigate('Continue', { id })), [leaveMenuFor, navigation, id]);
  const openActions = useCallback(() => leaveMenuFor(() => navigation.navigate('Actions', { threadId: id })), [leaveMenuFor, navigation, id]);
  const openChanges = useCallback(() => leaveMenuFor(() => navigation.navigate('Changes', { id })), [leaveMenuFor, navigation, id]);
  const openPR = useCallback(() => leaveMenuFor(() => navigation.navigate('PullRequest', { id })), [leaveMenuFor, navigation, id]);
  const openArtifacts = useCallback(() => leaveMenuFor(() => navigation.navigate('ThreadArtifacts', { id })), [leaveMenuFor, navigation, id]);
  const addAgent = useCallback(() => leaveMenuFor(() => setMembersOpen(true)), [leaveMenuFor]);

  const say = useCallback((message: string) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(message);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const askStep = (prompt: string) => {
    void prStep.ask(prompt).then((out) => {
      if (out.kind === 'busy') say('Another message is still sending. Try again in a moment.');
      else if (out.kind === 'failed') say(out.message);
    });
  };

  if (!view || view.status === 'loading') return <Notice title="Loading thread" />;
  if (view.status === 'missing') return <Notice title="Thread not found" body="It may have been archived or removed on the server." />;
  if (view.status === 'error' && !view.thread) {
    return <Notice title="Could not open this thread" body={view.error ?? undefined} action={{ label: 'Try again', onPress: () => live?.retry() }} />;
  }

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ThreadHeader view={view} flash={flash} />
      <HandoffBanner view={view} machine={machine} />
      <ThreadBody view={view} live={live} mark={mark} />
      {live && view.thread ? (
        <ThreadFooter>
          <ThreadComposer live={live} thread={view.thread} harnesses={catalog.harnesses} onOpenRun={() => setRunOpen(true)} step={<StepChip chip={chip} onAsk={askStep} />} />
        </ThreadFooter>
      ) : null}
      <ThreadMenuSheet
        target={menuOpen ? target : null}
        openOn={menuPage}
        folders={folders}
        onClose={closeMenu}
        onChanged={say}
        machine={machine}
        onFork={fork}
        onActions={openActions}
        onChanges={openChanges}
        onPR={openPR}
        onArtifacts={openArtifacts}
        onAddAgent={view.thread && !view.thread.read_only ? addAgent : undefined}
      />
      {view.thread ? <MemberSheet thread={view.thread} visible={membersOpen} onClose={() => setMembersOpen(false)} /> : null}
      <TakeoverSheet
        visible={machine.ui.asking}
        takeover={takeoverShown(view.takeover, view.handoff)}
        busy={machine.ui.sending === 'takeOver'}
        error={machine.takeOverError}
        onConfirm={() => void machine.takeOver()}
        onCancel={machine.closeAsk}
      />
      <RunSheet
        visible={runOpen}
        onClose={() => setRunOpen(false)}
        threadId={id}
        thread={thread}
        busy={thread?.status === 'running' || thread?.status === 'queued'}
        catalog={catalog}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

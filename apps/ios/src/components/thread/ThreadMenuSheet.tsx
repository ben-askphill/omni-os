import type { Folder } from '@omni/client-core';
import type { ThreadActionIcon, ThreadActionId } from '@omni/shared/thread-actions.ts';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Text } from '../../ui/Text';

import type { ThreadMachineControl } from '../../machine/hooks';
import { machineNote } from '../../machine/state';
import { fontSize, minTarget, space, useOmniTheme } from '../../theme';
import type { ThreadAction } from '../../thread/actions';
import { useThreadActions } from '../../thread/hooks';
import { menuExtras, menuLinks } from '../../thread/menu';
import { folderChoices, organizeItems, type ThreadTarget } from '../../thread/target';
import { Callout } from '../../ui/Callout';
import { Icon, type IconName } from '../../ui/Icon';
import { OptionGroup, OptionRow } from '../../ui/OptionRow';
import { Sheet } from '../../ui/Sheet';
import { MachineList } from './MachineSheet';
import { TakeoverPrompt } from './TakeoverSheet';

const ICON: Record<ThreadActionIcon, IconName> = {
  pin: 'pin',
  check: 'check',
  pencil: 'pencil',
  folder: 'folder',
  archive: 'archive',
  branch: 'fork',
  message: 'message',
  grok: 'sparkle',
};

type MenuPage = 'menu' | 'move' | 'machine' | 'takeover';

interface ThreadMenuSheetProps {
  /** The thread the menu acts on, as it is now: the sheet opens when this is set and shows the labels for its state. */
  target: ThreadTarget | null;
  /** The thread's channel folders, for Move to folder. */
  folders: readonly Pick<Folder, 'id' | 'parent_id' | 'name'>[];
  onClose: () => void;
  /** An action went through: say what it did where the user is looking. */
  onChanged: (message: string) => void;
  /** The open thread's machine state. With a machine to pick, the menu has a Runs on row. A list row passes none. */
  machine?: ThreadMachineControl;
  /** Opens Continue for the open thread. Without it the menu has no Fork thread row. */
  onFork?: () => void;
  /** Opens the channel's Actions for the open thread. Without it the menu has no Actions row. */
  onActions?: () => void;
  /** Opens what the thread changed in its checkout. Without it the menu has no View changes row. */
  onChanges?: () => void;
  /** Opens the thread's pull request. Without it the menu has no Pull request row. */
  onPR?: () => void;
  /** The page the sheet opens on: the machine name in the open thread's title opens Runs on directly. */
  openOn?: 'menu' | 'machine';
}

/** The thread menu as a sheet: pin, done, rename, move to folder and archive, from the header and from a list row. */
export function ThreadMenuSheet({ target, folders, onClose, onChanged, machine, onFork, onActions, onChanges, onPR, openOn = 'menu' }: ThreadMenuSheetProps) {
  const { colors } = useOmniTheme();
  const run = useThreadActions();
  const [asked, setPage] = useState<MenuPage>(openOn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = target !== null;

  useEffect(() => {
    if (open) {
      setPage(openOn);
      if (openOn === 'machine') machine?.dismissError();
      return;
    }
    setError(null);
  // machine changes every render: read it only when the sheet opens.
  }, [open, openOn]);

  const picker = machine?.machine ?? null;
  // The machine pages fall back to the menu when the picker goes away, as when a handoff starts from the other machine.
  const page = (asked === 'machine' || asked === 'takeover') && !picker ? 'menu' : asked;
  const items = useMemo(() => (target ? organizeItems(target) : []), [target]);
  const extras = useMemo(() => (target ? menuExtras(target, picker, !!onFork, !!onActions) : []), [target, picker, onFork, onActions]);
  const links = useMemo(() => menuLinks(!!onChanges, !!onPR), [onChanges, onPR]);
  const choices = useMemo(() => folderChoices(folders, target?.folderId ?? null), [folders, target?.folderId]);

  async function perform(action: ThreadAction) {
    if (!target || pending) return;
    setPending(true);
    setError(null);
    const outcome = await run(target, action);
    setPending(false);
    if (outcome.kind === 'failed') {
      setError(outcome.error);
      return;
    }
    if (outcome.kind === 'changed') onChanged(outcome.message);
    onClose();
  }

  function rename() {
    if (!target) return;
    Alert.prompt('Rename thread', undefined, (title) => void perform({ kind: 'rename', title }), 'plain-text', target.title);
  }

  function choose(id: ThreadActionId) {
    if (id === 'pin') void perform({ kind: 'pin' });
    else if (id === 'done') void perform({ kind: 'done' });
    else if (id === 'archive') void perform({ kind: 'archive' });
    else if (id === 'rename') rename();
    else if (id === 'move') setPage('move');
  }

  function openMachine() {
    machine?.dismissError();
    setPage('machine');
  }

  async function pickMachine(value: string) {
    const result = await machine?.pick(value);
    if (result === 'done') onClose();
    else if (result === 'ask') setPage('takeover');
  }

  async function takeOver() {
    if (await machine?.takeOver()) onClose();
  }

  const sending = !!machine?.ui.sending;
  const accessory = pending || sending ? (
    <ActivityIndicator color={colors.fg3} />
  ) : page !== 'menu' ? (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={() => setPage(page === 'takeover' ? 'machine' : 'menu')} style={styles.back}>
      <Icon name="chevronLeft" size={15} strokeWidth={2} color={colors.fg} />
      <Text style={[styles.backLabel, { color: colors.fg }]}>Back</Text>
    </Pressable>
  ) : null;

  return (
    <Sheet visible={open} title={TITLES[page]} onClose={onClose} accessory={accessory}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <Callout message={error} /> : null}
        {page === 'menu' && links.length > 0 ? (
          <OptionGroup>
            {links.map((link, i) => (
              <OptionRow
                key={link.id}
                label={link.label}
                sub={link.sub}
                leading={<Icon name={link.id === 'changes' ? 'diff' : 'pr'} size={18} color={colors.fg2} />}
                opens
                disabled={pending}
                onPress={() => (link.id === 'changes' ? onChanges?.() : onPR?.())}
                last={i === links.length - 1}
              />
            ))}
          </OptionGroup>
        ) : null}
        {page === 'menu' ? (
          <OptionGroup>
            {items.map((item, i) => (
              <OptionRow
                key={item.id}
                label={item.label}
                sub={item.off ?? item.hint}
                leading={<Icon name={ICON[item.icon]} size={18} color={colors.fg2} />}
                opens={item.id === 'move'}
                disabled={pending || !!item.off}
                onPress={() => choose(item.id)}
                last={i === items.length - 1}
              />
            ))}
          </OptionGroup>
        ) : page === 'move' ? (
          <>
            <OptionGroup>
              {choices.map((choice, i) => (
                <OptionRow
                  key={choice.id ?? 'none'}
                  label={choice.name}
                  depth={choice.depth}
                  selected={choice.current}
                  disabled={pending}
                  onPress={() => void perform({ kind: 'move', folderId: choice.id })}
                  last={i === choices.length - 1}
                />
              ))}
            </OptionGroup>
            {folders.length === 0 ? (
              <Text style={[styles.note, { color: colors.fg3 }]}>This channel has no folders yet. Make one on the Web UI or the desktop app, then move threads into it here.</Text>
            ) : null}
          </>
        ) : null}
        {page === 'menu' && extras.length > 0 ? (
          <OptionGroup>
            {extras.map((extra, i) => (
              <OptionRow
                key={extra.id}
                label={extra.label}
                sub={extra.sub}
                leading={<Icon name={extra.id === 'machine' ? 'machine' : extra.id === 'actions' ? 'play' : ICON.branch} size={18} color={colors.fg2} />}
                opens={extra.id === 'machine'}
                disabled={pending || !!extra.off}
                onPress={() => (extra.id === 'machine' ? openMachine() : extra.id === 'actions' ? onActions?.() : onFork?.())}
                last={i === extras.length - 1}
              />
            ))}
          </OptionGroup>
        ) : null}
        {page === 'machine' && machine && picker ? (
          <MachineList rows={picker.rows} value={picker.value} note={machineNote(picker)} busy={sending} error={machine.handOffError} onPick={(value) => void pickMachine(value)} />
        ) : null}
        {page === 'takeover' && machine && picker?.kind === 'held' ? (
          <TakeoverPrompt
            takeover={picker.takeover}
            busy={machine.ui.sending === 'takeOver'}
            error={machine.takeOverError}
            onConfirm={() => void takeOver()}
            onCancel={() => setPage('machine')}
          />
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const TITLES = { menu: 'Thread', move: 'Move to folder', machine: 'Runs on', takeover: 'Take over' } as const;

const styles = StyleSheet.create({
  content: {
    gap: space.s8,
    paddingVertical: space.s6,
  },
  back: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s1,
  },
  backLabel: {
    fontSize: fontSize.input,
  },
  note: {
    paddingHorizontal: space.s9,
    fontSize: fontSize.body,
  },
});

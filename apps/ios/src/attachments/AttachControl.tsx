import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLiveHub } from '../live/react';
import { fontSize, space, useOmniTheme } from '../theme';
import { OptionGroup, OptionRow } from '../ui/OptionRow';
import { Sheet } from '../ui/Sheet';
import { DEFAULT_MAX_MB, MAX_ATTACHMENTS, describeProblems } from './model';
import { openSettings, pickFiles, type Pick } from './pickers';
import { addStaged, useStaged } from './staged';

const BUTTON_SIZE = 36;

const CHOICES: readonly { pick: Pick; glyph: string; label: string; sub: string }[] = [
  { pick: 'photo', glyph: '🖼', label: 'Photo library', sub: 'Choose one or more photos' },
  { pick: 'camera', glyph: '📷', label: 'Camera', sub: 'Take a photo' },
  { pick: 'file', glyph: '📄', label: 'Files', sub: 'Choose from Files or iCloud Drive' },
];

/**
 * The plus button beside a composer and the sheet it opens. A choice closes the sheet first and opens the system
 * picker once the sheet is gone, because iOS refuses to present one view controller over another that is leaving.
 * What it picks goes to the scope's staged files (`attachments/staged`). Anything Ben should hear about, a refused
 * file or a denied permission, goes to `onNotice`.
 */
export function AttachControl({ scope, disabled = false, onNotice }: { scope: string; disabled?: boolean; onNotice: (text: string | null) => void }) {
  const { colors } = useOmniTheme();
  const hub = useLiveHub();
  const staged = useStaged(scope);
  const [open, setOpen] = useState(false);
  const [maxMb, setMaxMb] = useState(DEFAULT_MAX_MB);
  const chosen = useRef<Pick | null>(null);
  const room = MAX_ATTACHMENTS - staged.length;

  useEffect(() => {
    let live = true;
    void hub.uploadLimitMb().then((mb) => live && setMaxMb(mb));
    return () => {
      live = false;
    };
  }, [hub]);

  async function run(which: Pick) {
    onNotice(null);
    const picked = await pickFiles(which, room);
    if (picked.kind === 'files') {
      const limit = await hub.uploadLimitMb();
      onNotice(describeProblems(addStaged(scope, picked.files, limit), limit));
    } else if (picked.kind === 'denied' || picked.kind === 'failed') {
      onNotice(picked.message);
    }
  }

  // The sheet reports its close on Done, a swipe down, and again once it has left the screen. Only the last one is
  // safe to present from, and by then `chosen` says whether a tile started it.
  const closed = () => {
    setOpen(false);
    const which = chosen.current;
    chosen.current = null;
    if (which) void run(which);
  };

  const choose = (which: Pick) => {
    chosen.current = which;
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Attach"
        accessibilityHint="Add photos or files to this message"
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={space.s2}
        onPress={() => setOpen(true)}
        style={[styles.button, { backgroundColor: colors.surface3, opacity: disabled ? 0.4 : 1 }]}
      >
        <Text style={[styles.glyph, { color: colors.fg }]}>+</Text>
      </Pressable>
      <Sheet visible={open} title="Attach" onClose={closed}>
        <View style={styles.body}>
          <OptionGroup>
            {CHOICES.map((c, i) => (
              <OptionRow
                key={c.pick}
                label={c.label}
                sub={c.sub}
                leading={<Text style={styles.choiceGlyph}>{c.glyph}</Text>}
                disabled={room <= 0}
                last={i === CHOICES.length - 1}
                onPress={() => choose(c.pick)}
              />
            ))}
          </OptionGroup>
          <Text style={[styles.hint, { color: colors.fg3 }]}>
            Up to {MAX_ATTACHMENTS} files, {maxMb} MB each. {room < MAX_ATTACHMENTS ? `${room} more fit in this message.` : ''}
          </Text>
        </View>
      </Sheet>
    </>
  );
}

/** A notice that offers the Settings app when the cause is a permission Ben refused. */
export function AttachNotice({ text }: { text: string }) {
  const { colors } = useOmniTheme();
  const permission = /Settings/.test(text);
  return (
    <View style={styles.notice}>
      <Text accessibilityRole="alert" style={[styles.noticeText, { color: colors.fg2 }]}>
        {text}
      </Text>
      {permission ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Open Settings" hitSlop={8} onPress={openSettings}>
          <Text style={[styles.noticeAction, { color: colors.fg }]}>Open Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '400',
  },
  body: {
    gap: space.s6,
    paddingTop: space.s6,
  },
  choiceGlyph: {
    fontSize: 20,
  },
  hint: {
    fontSize: fontSize.meta + 1,
    paddingHorizontal: space.s9,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.s6,
    paddingHorizontal: space.s6,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.meta + 1,
  },
  noticeAction: {
    fontSize: fontSize.meta + 1,
    fontWeight: '600',
  },
});

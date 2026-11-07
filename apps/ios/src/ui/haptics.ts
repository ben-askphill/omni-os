import * as Haptics from 'expo-haptics';

// Haptics follow the system: iOS skips them when System Haptics is off, so no setting here. A failure (no Taptic
// Engine, the Simulator) is never worth surfacing.
const quiet = (p: Promise<void>) => void p.catch(() => {});

/** A pick in a control: a segment, a chip, a toggle. */
export const selection = () => quiet(Haptics.selectionAsync());
/** A light tap that confirms a press with weight: Send, Stop, a swipe action. */
export const tap = () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
/** Something finished well: a message landed, a merge went through. */
export const success = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
/** Something was refused or failed. */
export const failure = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));

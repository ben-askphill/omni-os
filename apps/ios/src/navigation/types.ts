import type { Artifact } from '@omni/client-core';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Every tab's stack takes these routes: its own root, and the detail routes any tab can push. */
export type RootStackParamList = {
  /** First run, and after the last server is removed or revoked. Only in the stack while there is no session. */
  Connect: undefined;
  /** The Activity tab's root, and home once a server is paired. */
  Activity: undefined;
  /** The Channels tab's root. */
  Channels: undefined;
  /** The Library tab's root. */
  Library: undefined;
  Channel: { id: string };
  Thread: { id: string };
  Changes: { id: string };
  PullRequest: { id: string };
  /** Starts a thread. Opens on the channel it was asked from, else the Conductor. */
  NewThread: { channel?: string } | undefined;
  /** A file the crew made. Any tab can push it, through `openArtifact`. */
  Artifact: { artifact: Artifact };
  /** Forks a thread onto another harness: a new, linked thread that picks up from it. Presented as a modal over the thread. */
  Continue: { id: string };
  Search: undefined;
  Settings: undefined;
  Devices: undefined;
  Automations: undefined;
  /** The channel's named actions, run in this thread's checkout. Pushed from a thread's header. */
  Actions: { threadId: string };
  Servers: undefined;
  /** Pairing another server. A separate route, so pairing the first server swaps Connect out for the tabs. */
  AddServer: undefined;
  /** Which alerts each paired server may send this phone, and whether iOS allows them at all. */
  NotificationSettings: undefined;
  /** Shown once, as a sheet, after the first server is paired. Explains the alerts before iOS asks. */
  NotificationsIntro: undefined;
};

/** The tab bar while a session is open, in phone web's order. */
export type TabsParamList = {
  ActivityTab: undefined;
  ChannelsTab: undefined;
  LibraryTab: undefined;
};

export type RootScreenProps<Name extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  Name
>;

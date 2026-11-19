// The routines onboarding offers a new user (Onboarding's Routines step, POST /api/setup/complete `starters`). Each
// starts off and becomes the user's own automation file in data/automations/ only when they turn it on, so a fresh
// install still ships none. They need no connector: with none they say what to connect and ask instead. They run as
// the Admin role (crew/inbox.md) in General, post nothing when there is nothing to report, and the one that drafts
// mail asks before it sends and lets an unanswered draft expire.

export interface StarterAutomation {
  /** The automation's id and file name. */
  id: string;
  name: string;
  /** One line on the Routines step. */
  blurb: string;
  /** When it runs, in words, beside the toggle. */
  when: string;
  cron: string;
  /** Post nothing when empty (automation `quiet`). */
  quiet: boolean;
  /** Ask before acting (automation `approve`), and how long an unanswered draft waits (`expires`). */
  approve?: { expires: string };
  prompt: string;
}

/** The crew role every starter runs as. */
export const STARTER_ROLE = 'inbox';

export const STARTER_AUTOMATIONS: readonly StarterAutomation[] = [
  {
    id: 'morning-plan',
    name: 'Morning plan',
    blurb: "A short plan for your day: today's meetings, mail that needs you and what is due.",
    when: 'Weekdays at 8:30',
    cron: '30 8 * * 1-5',
    quiet: true,
    prompt: [
      'Write my plan for today, in at most 10 bullets.',
      '',
      "- If you can reach my calendar, mail or task tools, use them: today's meetings with their times, mail that needs a reply from me, and tasks due today or overdue.",
      '- Never send, accept or change anything. Only read and report.',
      '- If none of those tools are connected, say which ones I could connect in one line, then ask me for my top three priorities today.',
      '- If they are connected and today has no meetings, no mail waiting on me and nothing due, there is nothing to report.',
    ].join('\n'),
  },
  {
    id: 'follow-ups',
    name: 'Mail follow-ups',
    blurb: 'Drafts a short reply to mail that has waited on you for three days, and sends only what you approve.',
    when: 'Weekdays at 10:00',
    cron: '0 10 * * 1-5',
    quiet: true,
    approve: { expires: '8h' },
    prompt: [
      'Find mail that has waited on a reply from me for three days or more, at most five threads, newest first.',
      '',
      '- For each, draft a short, friendly reply in my voice that moves it on. Quote the line you are answering.',
      '- Leave out newsletters, receipts and anything that only informs me.',
      '- If my mail is not connected, say so in one line and how to connect it, and ask nothing else.',
      '- If nothing has waited three days, there is nothing to report.',
    ].join('\n'),
  },
  {
    id: 'weekly-review',
    name: 'Weekly review',
    blurb: 'Every Friday: what got done this week, what is still open and what to start with on Monday.',
    when: 'Fridays at 16:00',
    cron: '0 16 * * 5',
    quiet: false,
    prompt: [
      'Help me close my week, in at most 12 bullets under three headings: Done, Still open, Start Monday with.',
      '',
      '- If you can reach my calendar, mail, task or notes tools, look back over this week in them.',
      '- Never send, accept or change anything. Only read and report.',
      '- If none of those tools are connected, ask me three short questions about my week instead, and say which tools I could connect.',
    ].join('\n'),
  },
];

export const starterAutomation = (id: string) => STARTER_AUTOMATIONS.find((s) => s.id === id);

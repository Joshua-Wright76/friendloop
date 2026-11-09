/** No imports on purpose: the Playwright suite reads these numbers too. */
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type Limit = { max: number; windowMs: number };

/**
 * Every abuse ceiling in one place. Fixed windows aligned to the epoch, so the
 * worst case is twice `max` across a window boundary — fine for "stop a flood",
 * which is all these are for.
 */
export const LIMITS = {
  /** Sign-in links to one address: enough for a typo'd inbox and a retry or two. */
  signInEmail: { max: 5, windowMs: 15 * MINUTE },
  /** Sign-in requests from one network, whatever the addresses. Room for a shared office. */
  signInIp: { max: 20, windowMs: HOUR },
  /** Codes typed from one network, right or wrong, whatever the addresses. */
  signInCode: { max: 30, windowMs: HOUR },
  /**
   * Codes tried for one address, right or wrong, however many links it has asked
   * for. A day's worth of guessing is ten tries at a million.
   */
  signInCodeEmail: { max: 10, windowMs: DAY },
  /** Comments from one member: a lively thread, not a script. */
  comment: { max: 30, windowMs: 10 * MINUTE },
  /** Notes from someone the request proved (session or reply link). */
  feedback: { max: 10, windowMs: HOUR },
  /** Notes from a stranger, per network: wider, since a NAT can hide several people. */
  feedbackAnonymous: { max: 30, windowMs: HOUR },
  /** Invitations one person sends, across all their loops. Every one is an email to a stranger. */
  invite: { max: 50, windowMs: DAY },
  /** Hand-sent reminders for one loop. Each goes to everyone who hasn't answered. */
  nudge: { max: 5, windowMs: DAY },
  /** Files through one link or loop. A full reply with a photo wall is a dozen at most. */
  upload: { max: 60, windowMs: HOUR },
  /** Clips through one link, each up to 50 MB: one per answer and a couple on a wall, with retries. */
  videoUpload: { max: 15, windowMs: HOUR },
  /** Links to a new address: enough for a typo and a retry. */
  emailChange: { max: 3, windowMs: HOUR },
  /** Feedback emails to whoever runs this, however many notes arrive. The rest still store. */
  feedbackNotify: { max: 10, windowMs: HOUR },
} as const satisfies Record<string, Limit>;

/** Sizes, not rates. A friend group is well under both. */
export const MAX_LOOPS_PER_OWNER = 5;
export const MAX_MEMBERS_PER_LOOP = 50;

/**
 * The counter keys. Built here so erasure can find a person's own counters
 * (`signin:email`, `comment:member`, `feedback:member`, `feedback:user`) by the
 * same spelling the limits write them with. Network keys name nobody.
 */
export const limitKey = {
  signInIp: (ip: string) => `signin:ip:${ip}`,
  signInEmail: (email: string) => `signin:email:${email}`,
  signInCode: (ip: string) => `signin:code:${ip}`,
  signInCodeEmail: (email: string) => `signin:code-email:${email}`,
  comment: (membershipId: string) => `comment:member:${membershipId}`,
  feedbackMember: (membershipId: string) => `feedback:member:${membershipId}`,
  feedbackUser: (userId: string) => `feedback:user:${userId}`,
  feedbackIp: (ip: string) => `feedback:ip:${ip}`,
  invite: (userId: string) => `invite:user:${userId}`,
  nudge: (groupId: string) => `nudge:group:${groupId}`,
  upload: (subject: string) => `upload:${subject}`,
  videoUpload: (subject: string) => `upload:video:${subject}`,
  emailChange: (userId: string) => `email-change:user:${userId}`,
  feedbackNotify: () => "feedback:notify",
};

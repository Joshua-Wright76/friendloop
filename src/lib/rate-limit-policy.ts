/** No imports on purpose: the Playwright suite reads these numbers too. */
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

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
  /** Comments from one member: a lively thread, not a script. */
  comment: { max: 30, windowMs: 10 * MINUTE },
  /** Notes from someone the request proved (session or reply link). */
  feedback: { max: 10, windowMs: HOUR },
  /** Notes from a stranger, per network: wider, since a NAT can hide several people. */
  feedbackAnonymous: { max: 30, windowMs: HOUR },
} as const satisfies Record<string, Limit>;

/**
 * The counter keys. Built here so erasure can find a person's own counters
 * (`signin:email`, `comment:member`, `feedback:member`, `feedback:user`) by the
 * same spelling the limits write them with. Network keys name nobody.
 */
export const limitKey = {
  signInIp: (ip: string) => `signin:ip:${ip}`,
  signInEmail: (email: string) => `signin:email:${email}`,
  comment: (membershipId: string) => `comment:member:${membershipId}`,
  feedbackMember: (membershipId: string) => `feedback:member:${membershipId}`,
  feedbackUser: (userId: string) => `feedback:user:${userId}`,
  feedbackIp: (ip: string) => `feedback:ip:${ip}`,
};

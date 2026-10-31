import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** Management rights. */
export const accessEnum = pgEnum("access", ["owner", "admin", "member"]);
/** Whether a member is asked to write. */
export const participationEnum = pgEnum("participation", ["contributor", "reader"]);
export const modeEnum = pgEnum("mode", ["group", "from_you"]);
export const issueStatusEnum = pgEnum("issue_status", ["open", "delivered", "skipped"]);
export const replyStatusEnum = pgEnum("reply_status", ["draft", "submitted"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "sent", "failed"]);
export const emailKindEnum = pgEnum("email_kind", [
  "signin",
  "invite",
  "prompt",
  "reminder",
  "delivery",
  "nudge",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** IANA zone captured from the browser, used to render local deadlines. */
  timezone: text("timezone").default("UTC").notNull(),
  isSynthetic: boolean("is_synthetic").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Magic-link sign-in for owners and admins. Only the hash is stored. */
export const magicLinks = pgTable(
  "magic_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("magic_links_token_hash_idx").on(t.tokenHash), index("magic_links_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash)],
);

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /** Shown as the email display name: "The Friday Loop <hello@friendloop.dev>". */
  displayName: text("display_name"),
  mode: modeEnum("mode").default("group").notNull(),
  /** IANA zone the schedule is written in. */
  timezone: text("timezone").default("UTC").notNull(),
  /** 0 = Sunday … 6 = Saturday, evaluated in `timezone`. */
  promptWeekday: integer("prompt_weekday").default(5).notNull(),
  /** Local hour the prompt goes out, 0–23. */
  promptHour: integer("prompt_hour").default(9).notNull(),
  cadenceWeeks: integer("cadence_weeks").default(1).notNull(),
  /** Null keeps every active question in each round; a number rotates the pool. */
  questionsPerRound: integer("questions_per_round"),
  /** Zero-based position after the last question selected for a round. */
  questionCursor: integer("question_cursor").default(0).notNull(),
  /** Reply window length in days; delivery lands this long after opening. */
  windowDays: integer("window_days").default(7).notNull(),
  shareEnabled: boolean("share_enabled").default(false).notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  /** Last slot that produced an issue, so pause/resume restarts cleanly. */
  lastSlotAt: timestamp("last_slot_at", { withTimezone: true }),
  isSynthetic: boolean("is_synthetic").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    /** Null until this person signs in for the first time. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    name: text("name"),
    access: accessEnum("access").default("member").notNull(),
    participation: participationEnum("participation").default("contributor").notNull(),
    /** Bearer credential for the no-account reply link. Rotatable. */
    replyToken: text("reply_token").notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("memberships_reply_token_idx").on(t.replyToken),
    uniqueIndex("memberships_group_email_idx").on(t.groupId, t.email),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    text: text("text").notNull(),
    position: integer("position").default(0).notNull(),
    /** Whether it is offered when composing the next issue. */
    active: boolean("active").default(true).notNull(),
    /** Skipped for the next issue only; cleared once that issue opens. */
    skipNext: boolean("skip_next").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByMembershipId: uuid("created_by_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("questions_group_idx").on(t.groupId)],
);

export const issues = pgTable(
  "issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    number: integer("number").notNull(),
    status: issueStatusEnum("status").default("open").notNull(),
    /** The local wall-clock slot this issue came from, frozen as an instant. */
    slotAt: timestamp("slot_at", { withTimezone: true }).notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    deliversAt: timestamp("delivers_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Set when the loop had nothing to send and the issue was dropped. */
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    shareToken: text("share_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("issues_group_slot_idx").on(t.groupId, t.slotAt),
    uniqueIndex("issues_group_number_idx").on(t.groupId, t.number),
  ],
);

/** Questions are snapshotted per issue so editing a question never rewrites history. */
export const issueQuestions = pgTable(
  "issue_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .references(() => issues.id, { onDelete: "cascade" })
      .notNull(),
    questionId: uuid("question_id").references(() => questions.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    position: integer("position").default(0).notNull(),
    /** Frozen at snapshot time: the name an accepted suggestion credits, null when anonymous. */
    suggestedBy: text("suggested_by"),
  },
  (t) => [uniqueIndex("issue_questions_issue_question_idx").on(t.issueId, t.questionId)],
);

/** How a suggested question credits its author on the delivered issue. */
export const suggestionAuthorEnum = pgEnum("suggestion_author", ["name", "anonymous"]);
/** A suggested question's life: waiting for the owner, in the pool, or turned down. */
export const suggestionStatusEnum = pgEnum("suggestion_status", ["pending", "accepted", "declined"]);

/** A question pitched by a contributor, waiting for the owner's decision. */
export const questionSuggestions = pgTable(
  "question_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    membershipId: uuid("membership_id")
      .references(() => memberships.id, { onDelete: "cascade" })
      .notNull(),
    text: text("text").notNull(),
    /** Whether the delivered issue credits the author by name. The owner always sees the true author. */
    authorDisplay: suggestionAuthorEnum("author_display").default("name").notNull(),
    status: suggestionStatusEnum("status").default("pending").notNull(),
    /** Set when accepted: the pool question this suggestion became. */
    acceptedQuestionId: uuid("accepted_question_id").references(() => questions.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("question_suggestions_group_status_idx").on(t.groupId, t.status)],
);

export const replies = pgTable(
  "replies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .references(() => issues.id, { onDelete: "cascade" })
      .notNull(),
    issueQuestionId: uuid("issue_question_id")
      .references(() => issueQuestions.id, { onDelete: "cascade" })
      .notNull(),
    membershipId: uuid("membership_id")
      .references(() => memberships.id, { onDelete: "cascade" })
      .notNull(),
    body: text("body").default("").notNull(),
    photoUrl: text("photo_url"),
    status: replyStatusEnum("status").default("draft").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    addedAfterDelivery: boolean("added_after_delivery").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("replies_unique_idx").on(t.issueId, t.issueQuestionId, t.membershipId)],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .references(() => issues.id, { onDelete: "cascade" })
      .notNull(),
    membershipId: uuid("membership_id")
      .references(() => memberships.id, { onDelete: "cascade" })
      .notNull(),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("comments_issue_idx").on(t.issueId)],
);

export const reactions = pgTable(
  "reactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    replyId: uuid("reply_id")
      .references(() => replies.id, { onDelete: "cascade" })
      .notNull(),
    membershipId: uuid("membership_id")
      .references(() => memberships.id, { onDelete: "cascade" })
      .notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("reactions_unique_idx").on(t.replyId, t.membershipId, t.emoji)],
);

/** Every outgoing email lands here first. Tests read this instead of a mailbox. */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text").notNull(),
    kind: emailKindEnum("kind").notNull(),
    /** `kind:issue:membership` — makes retries and double cron runs harmless. */
    dedupeKey: text("dedupe_key").notNull(),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").references(() => memberships.id, { onDelete: "cascade" }),
    status: outboxStatusEnum("status").default("pending").notNull(),
    providerId: text("provider_id"),
    error: text("error"),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("outbox_dedupe_idx").on(t.dedupeKey),
    index("outbox_status_idx").on(t.status),
    index("outbox_group_idx").on(t.groupId),
  ],
);

/** Deliverability signal from Resend webhooks. */
export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: text("provider_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("email_events_provider_idx").on(t.providerId)],
);

export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type Reply = typeof replies.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;

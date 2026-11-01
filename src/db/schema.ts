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
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/** Management rights. */
export const accessEnum = pgEnum("access", ["owner", "admin", "member"]);
/** Whether a member is asked to write. */
export const participationEnum = pgEnum("participation", ["contributor", "reader"]);
export const modeEnum = pgEnum("mode", ["group", "from_you"]);
export const issueStatusEnum = pgEnum("issue_status", ["open", "delivered", "skipped"]);
export const replyStatusEnum = pgEnum("reply_status", ["draft", "submitted"]);
/** The three kinds of recurring content area an issue can carry besides questions. */
export const sectionKindEnum = pgEnum("section_kind", ["standard", "photo_wall", "music"]);
/** What a pool question asks for: a written answer, or a pick from fixed options. */
export const questionKindEnum = pgEnum("question_kind", ["written", "poll"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "sent", "failed"]);
export const emailKindEnum = pgEnum("email_kind", [
  "signin",
  "invite",
  "prompt",
  "reminder",
  "delivery",
  "nudge",
  "mention",
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
  /** The owner's switch: off hides every comment surface and refuses writes; nothing is deleted. */
  commentsEnabled: boolean("comments_enabled").default(true).notNull(),
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
    /** A poll is a question whose answer is a pick from `pollOptions`. */
    kind: questionKindEnum("kind").default("written").notNull(),
    pollMultiple: boolean("poll_multiple").default(false).notNull(),
    pollOptions: jsonb("poll_options").$type<string[]>(),
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
    /** A poll's shape, frozen with the text so editing the pool never rewrites a vote. */
    kind: questionKindEnum("kind").default("written").notNull(),
    pollMultiple: boolean("poll_multiple").default(false).notNull(),
    pollOptions: jsonb("poll_options").$type<string[]>(),
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
    /** A recorded voice note riding alongside the text and photo. */
    audioUrl: text("audio_url"),
    audioDurationMs: integer("audio_duration_ms"),
    /** A poll answer: indexes into the snapshotted `pollOptions`. Empty on written answers. */
    pollChoices: jsonb("poll_choices").$type<number[]>().default([]).notNull(),
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
    /** Plain text; a mention is stored as `@[<membership id>]` and rendered as that person's name. */
    body: text("body").notNull(),
    /** Null for the issue-level thread; otherwise the answer this comment hangs from. */
    replyId: uuid("reply_id").references(() => replies.id, { onDelete: "cascade" }),
    /** The comment this one answers. Falls back to "a removed comment" if that one goes. */
    quoteCommentId: uuid("quote_comment_id").references((): AnyPgColumn => comments.id, {
      onDelete: "set null",
    }),
    photoUrl: text("photo_url"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("comments_issue_idx").on(t.issueId), index("comments_reply_idx").on(t.replyId)],
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

/** A recurring content area a loop can carry in every issue besides questions. */
export const sections = pgTable(
  "sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    kind: sectionKindEnum("kind").notNull(),
    title: text("title").notNull(),
    emoji: text("emoji"),
    description: text("description"),
    /** Replies restricted to the owner and admins who contribute. */
    adminOnly: boolean("admin_only").default(false).notNull(),
    position: integer("position").default(0).notNull(),
    /** Whether future issues keep carrying it. */
    active: boolean("active").default(true).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sections_group_idx").on(t.groupId)],
);

/** Sections are snapshotted per issue, exactly like questions. */
export const issueSections = pgTable(
  "issue_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .references(() => issues.id, { onDelete: "cascade" })
      .notNull(),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    kind: sectionKindEnum("kind").notNull(),
    title: text("title").notNull(),
    emoji: text("emoji"),
    description: text("description"),
    adminOnly: boolean("admin_only").default(false).notNull(),
    position: integer("position").default(0).notNull(),
  },
  (t) => [uniqueIndex("issue_sections_issue_section_idx").on(t.issueId, t.sectionId)],
);

/** One section answer per member per snapshotted section. */
export const sectionReplies = pgTable(
  "section_replies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .references(() => issues.id, { onDelete: "cascade" })
      .notNull(),
    issueSectionId: uuid("issue_section_id")
      .references(() => issueSections.id, { onDelete: "cascade" })
      .notNull(),
    membershipId: uuid("membership_id")
      .references(() => memberships.id, { onDelete: "cascade" })
      .notNull(),
    /** Standard section text, or the one-line caption on a music pick. */
    body: text("body").default("").notNull(),
    /** Music sections only: the pasted link and who it belongs to. */
    linkUrl: text("link_url"),
    linkProvider: text("link_provider"),
    status: replyStatusEnum("status").default("draft").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    addedAfterDelivery: boolean("added_after_delivery").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("section_replies_unique_idx").on(t.issueId, t.issueSectionId, t.membershipId)],
);

/** Photos attached to a section answer; photo walls carry several with captions. */
export const sectionMedia = pgTable(
  "section_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sectionReplyId: uuid("section_reply_id")
      .references(() => sectionReplies.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    /** Required on photo walls; standard sections attach a single photo without one. */
    caption: text("caption"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("section_media_reply_idx").on(t.sectionReplyId)],
);

/** Cached metadata for pasted music links; render falls back to a plain card on a miss. */
export const musicLinks = pgTable("music_links", {
  url: text("url").primaryKey(),
  provider: text("provider").notNull(),
  title: text("title"),
  artworkUrl: text("artwork_url"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});

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

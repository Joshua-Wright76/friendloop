import {
  primaryKey,
  pgTable,
  date,
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
import { sql } from "drizzle-orm";

/** Management rights. */
export const accessEnum = pgEnum("access", ["owner", "admin", "member"]);
/** Whether a member is asked to write. */
export const participationEnum = pgEnum("participation", ["contributor", "reader"]);
/**
 * How many of the loop's automatic reminders a contributor wants. Today the loop
 * sends one, so "all" and "last" read the same; the value is stored as asked so a
 * longer schedule later needs no data change. Manual owner nudges ignore it.
 */
export const reminderPreferenceEnum = pgEnum("reminder_preference", ["all", "last", "none"]);
/**
 * Unused. "from_you" (only the owner writes) was never choosable and its code is
 * gone; every loop is "group". The column stays so a deploy never has to drop it
 * under code that still reads it; nothing reads it now.
 */
export const modeEnum = pgEnum("mode", ["group", "from_you"]);
export const issueStatusEnum = pgEnum("issue_status", ["open", "delivered", "skipped"]);
export const replyStatusEnum = pgEnum("reply_status", ["draft", "submitted"]);
/** The three kinds of recurring content area an issue can carry besides questions. */
export const sectionKindEnum = pgEnum("section_kind", ["standard", "photo_wall", "music"]);
/** What a pool question asks for: a written answer, or a pick from fixed options. */
export const questionKindEnum = pgEnum("question_kind", ["written", "poll"]);
/** A one-time milestone, or a birthday that comes back every year. */
export const eventKindEnum = pgEnum("event_kind", ["once", "birthday"]);
/**
 * How an ask is answered, once questions and sections are one list
 * (`docs/questions-unify-design.md`). Filled from `kind` by a trigger until then.
 */
export const answerFormatEnum = pgEnum("answer_format", ["written", "poll", "photo_wall", "music"]);
/** How often an ask comes round: every round, in turn from the queue, or on a date. */
export const askFrequencyEnum = pgEnum("ask_frequency", ["every_round", "rotating", "on_date"]);
/** `suppressed` is recorded, never sent: the member muted the loop or the address bounced. */
export const outboxStatusEnum = pgEnum("outbox_status", ["pending", "sent", "failed", "suppressed"]);
/** Why an address stopped receiving loop mail: the provider reported a hard bounce or a spam complaint. */
export const suppressionReasonEnum = pgEnum("suppression_reason", ["bounce", "complaint"]);
export const emailKindEnum = pgEnum("email_kind", [
  "signin",
  "invite",
  "prompt",
  "reminder",
  "delivery",
  "nudge",
  "mention",
  "feedback",
  "email_change",
  /** To whoever runs this instance, e.g. the daily email budget running low. */
  "alert",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** IANA zone captured from the browser, used to render local deadlines. */
  timezone: text("timezone").default("UTC").notNull(),
  isSynthetic: boolean("is_synthetic").default(false).notNull(),
  /** Set by whoever runs the instance (/dev/stats). A blocked person can't sign in. */
  blockedAt: timestamp("blocked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A signed-in person asking to move their account to a new address. Nothing
 * changes until the link sent to that address is used. Only the hash is stored.
 */
export const emailChanges = pgTable(
  "email_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    /** Kept so erasure can find the notice sent to the address they moved away from. */
    oldEmail: text("old_email").notNull(),
    newEmail: text("new_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("email_changes_token_hash_idx").on(t.tokenHash), index("email_changes_user_idx").on(t.userId)],
);

/** Magic-link sign-in for owners and admins. Only the hash is stored. */
export const magicLinks = pgTable(
  "magic_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** When it was first used. A link works again until it expires; this is a record, not a lock. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** The six-digit code sent with the link, keyed-hashed with the address. Null for links with no code. */
    codeHash: text("code_hash"),
    /**
     * Set when this link was asked for from a loop's invite link (`invite_links.token`).
     * Using it also joins that loop, if the invite link is still the loop's current one.
     */
    joinToken: text("join_token"),
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
  /** Unused; see `modeEnum`. */
  mode: modeEnum("mode").default("group").notNull(),
  /** IANA zone the schedule is written in. */
  timezone: text("timezone").default("UTC").notNull(),
  /** Delivery weekday, 0 = Sunday … 6 = Saturday, evaluated in `timezone`. */
  promptWeekday: integer("prompt_weekday").default(5).notNull(),
  /** Local hour the issue goes out, 0–23. (Named for the old model, where it opened the round.) */
  promptHour: integer("prompt_hour").default(9).notNull(),
  cadenceWeeks: integer("cadence_weeks").default(1).notNull(),
  /** Null keeps every active question in each round; a number rotates the pool. */
  questionsPerRound: integer("questions_per_round"),
  /** Zero-based position after the last question selected for a round. */
  questionCursor: integer("question_cursor").default(0).notNull(),
  /** Unused: a round now stays open from one delivery to the next. */
  windowDays: integer("window_days").default(7).notNull(),
  shareEnabled: boolean("share_enabled").default(false).notNull(),
  /** Stationery preset key; null is Gingham Picnic, the original look. */
  themePreset: text("theme_preset"),
  /** Owner's accent override as #rrggbb; null keeps the preset's own. */
  themeAccent: text("theme_accent"),
  /** The pattern behind every page; null is gingham. */
  themeBackground: text("theme_background"),
  /** The pack of paper textures for answers, polls, playlists and notes; null is plain cream. */
  themePaperPack: text("theme_paper_pack"),
  /** The pack of washi tape; null is the original picnic set. */
  themeTapePack: text("theme_tape_pack"),
  /** The drawing that stands in for the cherries on this loop's pages and emails; null is the cherries. */
  themeMascot: text("theme_mascot"),
  /** Owner's header picture, shown above the loop's own surfaces and emails. */
  headerImageUrl: text("header_image_url"),
  /** The owner's switch: off hides every comment surface and refuses writes; nothing is deleted. */
  commentsEnabled: boolean("comments_enabled").default(true).notNull(),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  /** Unused since rounds open as the previous one goes out. */
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
    /** A profile photo for this loop only; null falls back to the initial. */
    photoUrl: text("photo_url"),
    /** A sticker beside their name in this loop; null is none. */
    charm: text("charm"),
    /** What goes around their picture in this loop; null is none. */
    avatarFrame: text("avatar_frame"),
    access: accessEnum("access").default("member").notNull(),
    participation: participationEnum("participation").default("contributor").notNull(),
    reminderPreference: reminderPreferenceEnum("reminder_preference").default("all").notNull(),
    /** Bearer credential for the no-account reply link. Rotatable. */
    replyToken: text("reply_token").notNull(),
    /**
     * The List-Unsubscribe credential. Separate from `reply_token` on purpose: it
     * rides in a mail header that providers read and store, so it can only mute or
     * unmute this membership — never read the loop or write an answer — and
     * rotating a leaked reply link leaves old emails' unsubscribe links working.
     * 64 hex characters (two v4 UUIDs, 244 random bits), filled by the database so
     * every insert path, and every existing row, gets one.
     */
    unsubscribeToken: text("unsubscribe_token")
      .default(sql`replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')`)
      .notNull(),
    /**
     * Set when this person asked the loop to stop emailing them. They stay in the
     * loop, and their reply link still works; only loop mail is held back.
     */
    mutedAt: timestamp("muted_at", { withTimezone: true }),
    invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("memberships_reply_token_idx").on(t.replyToken),
    uniqueIndex("memberships_unsubscribe_token_idx").on(t.unsubscribeToken),
    uniqueIndex("memberships_group_email_idx").on(t.groupId, t.email),
    index("memberships_user_idx").on(t.userId),
  ],
);

/**
 * A loop's shareable invite link, `/join/<token>`. Anyone holding it can ask to
 * join with their email; they're in once they confirm it. One per loop, made the
 * first time a manager looks, and replaced (the old one stops working) on reset.
 * Kept apart from `groups` so the token never rides along with the loop's row to
 * every member's browser.
 */
export const inviteLinks = pgTable(
  "invite_links",
  {
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .primaryKey(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("invite_links_token_idx").on(t.token)],
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
    /*
     * The unified model, added ahead of the code that uses it
     * (`docs/questions-unify-design.md`). Until that ships, rows that aren't
     * `active` written or poll questions are someone else's: see `legacy-ask.ts`.
     */
    /** Filled from `kind` by a database trigger when an insert leaves it out. */
    format: answerFormatEnum("format"),
    frequency: askFrequencyEnum("frequency").default("rotating").notNull(),
    emoji: text("emoji"),
    description: text("description"),
    adminOnly: boolean("admin_only").default(false).notNull(),
    /** `on_date` only: a one-time date or a birthday. */
    dateKind: eventKindEnum("date_kind"),
    month: integer("month"),
    day: integer("day"),
    year: integer("year"),
    /** The birthday person. */
    aboutMembershipId: uuid("about_membership_id").references(() => memberships.id, { onDelete: "cascade" }),
    /** Occurrences the owner took out of a round, so carrying it over doesn't put them back. */
    skippedDates: date("skipped_dates", { mode: "string" }).array().default(sql`'{}'::date[]`).notNull(),
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
    /** The owner's name for this round ("Camping weekend"); null keeps "Round N". */
    name: text("name"),
    status: issueStatusEnum("status").default("open").notNull(),
    /**
     * The delivery slot this issue was opened for, frozen as an instant. A round
     * with nothing in it moves `deliversAt` on to a later slot; this stays put, so
     * the distance between the two counts how often it was carried over.
     */
    slotAt: timestamp("slot_at", { withTimezone: true }).notNull(),
    /** When it started taking answers: the moment the round before it went out. */
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    deliversAt: timestamp("delivers_at", { withTimezone: true }).notNull(),
    /**
     * The loop's question cursor when this round opened. Re-running the selection
     * from here keeps the open round in step with edits to the question pool.
     */
    questionCursor: integer("question_cursor"),
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
    /** The unified model, ahead of its code: see `questions` and `legacy-ask.ts`. */
    format: answerFormatEnum("format"),
    emoji: text("emoji"),
    description: text("description"),
    adminOnly: boolean("admin_only").default(false).notNull(),
    occurrenceDate: date("occurrence_date", { mode: "string" }),
    /** Frozen with the snapshot: the person a birthday card is about, who never sees it. */
    aboutMembershipId: uuid("about_membership_id").references(() => memberships.id, { onDelete: "cascade" }),
    /** History marker: copied from a section, so it keeps a section's look. */
    fromSection: boolean("from_section").default(false).notNull(),
  },
  (t) => [
    uniqueIndex("issue_questions_issue_question_idx").on(t.issueId, t.questionId),
    uniqueIndex("issue_questions_occurrence_idx").on(t.questionId, t.occurrenceDate),
  ],
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
    /** A short video clip, with the still image that stands in for it wherever it can't play (email, print, the album grid). */
    videoUrl: text("video_url"),
    videoPosterUrl: text("video_poster_url"),
    videoDurationMs: integer("video_duration_ms"),
    /** A poll answer: indexes into the snapshotted `pollOptions`. Empty on written answers. */
    pollChoices: jsonb("poll_choices").$type<number[]>().default([]).notNull(),
    /** A music answer's link, ahead of the code that writes it (`docs/questions-unify-design.md`). */
    linkUrl: text("link_url"),
    linkProvider: text("link_provider"),
    /**
     * Legacy: answers used to wait as drafts until sent. Every save now writes
     * `submitted`, and nothing reads it (see `src/lib/reply-query.ts`).
     */
    status: replyStatusEnum("status").default("draft").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Read-only history: an answer added after its round went out, from before a reply link only reached the open round. */
    addedAfterDelivery: boolean("added_after_delivery").default(false).notNull(),
    /** A draft left unsent in a round that went out before answers saved straight into the round. Never shown. */
    neverSent: boolean("never_sent").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("replies_unique_idx").on(t.issueId, t.issueQuestionId, t.membershipId)],
);

/** A photo-wall answer's photos, ahead of the code that writes them (`docs/questions-unify-design.md`). */
export const replyMedia = pgTable(
  "reply_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    replyId: uuid("reply_id")
      .references(() => replies.id, { onDelete: "cascade" })
      .notNull(),
    /** The picture. On a video, its still image, so everything that only shows pictures still shows something. */
    url: text("url").notNull(),
    caption: text("caption"),
    position: integer("position").default(0).notNull(),
    /** Set when this wall item is a video clip; `url` is then its still image. */
    videoUrl: text("video_url"),
    videoDurationMs: integer("video_duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("reply_media_reply_idx").on(t.replyId)],
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

/**
 * A date the loop wants to celebrate. The sweep snapshots the ones that fall in
 * an issue's window into a section; the row itself never rewrites history.
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .references(() => groups.id, { onDelete: "cascade" })
      .notNull(),
    kind: eventKindEnum("kind").notNull(),
    /** Required for a one-time event; a birthday is titled from the member's name at snapshot. */
    title: text("title"),
    emoji: text("emoji"),
    month: integer("month").notNull(),
    day: integer("day").notNull(),
    /** Set for a one-time event, null for a birthday (the year doesn't matter). */
    year: integer("year"),
    /** The birthday person. */
    membershipId: uuid("membership_id").references(() => memberships.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("events_group_idx").on(t.groupId)],
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
    /** Set when the section is a snapshot of an event; cleared if the event is deleted. */
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    /** The calendar date this snapshot celebrates, so one occurrence lands in one issue. */
    eventDate: date("event_date", { mode: "string" }),
  },
  (t) => [
    uniqueIndex("issue_sections_issue_section_idx").on(t.issueId, t.sectionId),
    uniqueIndex("issue_sections_event_occurrence_idx").on(t.eventId, t.eventDate),
  ],
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
    /**
     * Legacy: answers used to wait as drafts until sent. Every save now writes
     * `submitted`, and nothing reads it (see `src/lib/reply-query.ts`).
     */
    status: replyStatusEnum("status").default("draft").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Read-only history: an answer added after its round went out, from before a reply link only reached the open round. */
    addedAfterDelivery: boolean("added_after_delivery").default(false).notNull(),
    /** A draft left unsent in a round that went out before answers saved straight into the round. Never shown. */
    neverSent: boolean("never_sent").default(false).notNull(),
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
/**
 * Legacy row -> unified row, for everything migration `0023` copied out of the
 * section tables (`kind` names the legacy table: section, event, issue_section,
 * section_reply, section_media). A copy keeps its legacy id unless a row of the
 * target table already held it, so `unified_id` is almost always `legacy_id`.
 * The copy and mirror functions resolve through it, and so do the writes a reply
 * sheet loaded before the switch still sends. Dropped with the legacy tables.
 */
export const unifyIds = pgTable(
  "unify_ids",
  {
    kind: text("kind").notNull(),
    legacyId: uuid("legacy_id").notNull(),
    unifiedId: uuid("unified_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.legacyId] }), uniqueIndex("unify_ids_unified_idx").on(t.kind, t.unifiedId)],
);

export const musicLinks = pgTable("music_links", {
  url: text("url").primaryKey(),
  provider: text("provider").notNull(),
  title: text("title"),
  artworkUrl: text("artwork_url"),
  /** The first few songs, for the card; trackCount is the full length. */
  tracks: jsonb("tracks").$type<Array<{ title: string; artist: string | null; seconds: number | null }>>(),
  trackCount: integer("track_count"),
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
    /** Extra mail headers (List-Unsubscribe), kept so a retry sends the same message. */
    headers: jsonb("headers").$type<Record<string, string>>(),
    /** The loop's name as sender, kept so a retry doesn't fall back to the brand. */
    fromName: text("from_name"),
    /** The loop owner's address. A reply reaches a person rather than an unread mailbox. */
    replyTo: text("reply_to"),
    /** Why a `suppressed` row was held back: `muted`, `bounce` or `complaint`. */
    suppressedReason: text("suppressed_reason"),
    error: text("error"),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("outbox_dedupe_idx").on(t.dedupeKey),
    index("outbox_status_idx").on(t.status),
    index("outbox_group_idx").on(t.groupId),
    index("outbox_provider_idx").on(t.providerId),
  ],
);

/**
 * A note from the corner button: a bug or an idea, in the sender's own words.
 * Who sent it is recorded only when the request itself proved it (a session or
 * a reply link), and `path` has any reply token stripped before it is stored.
 */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    message: text("message").notNull(),
    path: text("path").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    membershipId: uuid("membership_id").references(() => memberships.id, { onDelete: "set null" }),
    /** Who they were at the time, so the note still reads after a rename or removal. */
    senderName: text("sender_name"),
    senderEmail: text("sender_email"),
    userAgent: text("user_agent"),
    viewport: text("viewport"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("feedback_created_idx").on(t.createdAt)],
);

/**
 * One fixed-window counter per abuse key (`signin:email:…`, `signin:ip:…`,
 * `comment:member:…`). A single upsert bumps or resets it, so it is atomic
 * without a lock, and `expires_at` lets the sweep delete stale rows by index.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_expires_idx").on(t.expiresAt)],
);

/**
 * Stored files waiting to be removed. A deletion writes its URLs here in the same
 * transaction that drops the rows pointing at them, then tries each file at once;
 * whatever Blob or the disk refused stays queued and the sweep retries it, so a
 * storage outage can delay a removal but never forget it.
 */
export const mediaDeletions = pgTable(
  "media_deletions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    url: text("url").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("media_deletions_url_idx").on(t.url)],
);

/** Deliverability signal from Resend webhooks. */
export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: text("provider_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    /** The webhook's `svix-id`: a redelivered event is recorded once. */
    messageId: text("message_id"),
    /** The outbox row this event is about, when the provider id matches one. */
    outboxId: uuid("outbox_id").references(() => outbox.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("email_events_provider_idx").on(t.providerId),
    uniqueIndex("email_events_message_idx").on(t.messageId),
  ],
);

/**
 * When each scheduled job last finished cleanly, keyed by job name ("sweep").
 * The health check reads it to notice a cron that stopped running — the sweep
 * self-heals when it runs, so the failure worth paging on is that it doesn't.
 */
export const heartbeats = pgTable("heartbeats", {
  name: text("name").primaryKey(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }).notNull(),
});

/**
 * An address the provider told us to stop mailing: a hard bounce or a spam
 * complaint. Every loop email to it is recorded as suppressed instead of sent;
 * sign-in links still go, because a person asking to sign in is asking for mail.
 * Stored lowercased.
 */
export const emailSuppressions = pgTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: suppressionReasonEnum("reason").notNull(),
  /** The Resend email id whose event caused it. */
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type Reply = typeof replies.$inferSelect;
export type LoopEvent = typeof events.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;

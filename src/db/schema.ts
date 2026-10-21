import { pgTable, uuid, text, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["owner", "admin", "member"]);
export const modeEnum = pgEnum("mode", ["group", "from_you"]);
export const issueStatusEnum = pgEnum("issue_status", ["open", "delivered"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  mode: modeEnum("mode").default("group").notNull(),
  // weekly cadence: 0=Sunday … 6=Saturday, delivery 7 days after prompts go out
  promptWeekday: integer("prompt_weekday").default(5).notNull(), // Friday
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").references(() => groups.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  role: roleEnum("role").default("member").notNull(),
  replyToken: text("reply_token").notNull().unique(), // unique private reply link
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const questions = pgTable("questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").references(() => groups.id).notNull(),
  text: text("text").notNull(),
  suggestedBy: uuid("suggested_by").references(() => users.id),
  active: boolean("active").default(true).notNull(),
  position: integer("position").default(0).notNull(),
});

export const issues = pgTable("issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").references(() => groups.id).notNull(),
  number: integer("number").notNull(),
  status: issueStatusEnum("status").default("open").notNull(),
  opensAt: timestamp("opens_at").notNull(),
  deliversAt: timestamp("delivers_at").notNull(),
  deliveredAt: timestamp("delivered_at"),
});

export const replies = pgTable("replies", {
  id: uuid("id").defaultRandom().primaryKey(),
  issueId: uuid("issue_id").references(() => issues.id).notNull(),
  questionId: uuid("question_id").references(() => questions.id).notNull(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  body: text("body").notNull(),
  photoUrl: text("photo_url"),
  editedAfterDelivery: boolean("edited_after_delivery").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

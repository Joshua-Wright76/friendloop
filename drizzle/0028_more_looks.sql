CREATE TABLE "issue_status_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_stickers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issue_id" uuid NOT NULL,
	"reply_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"sticker" text NOT NULL,
	"side" text NOT NULL,
	"offset" integer DEFAULT 0 NOT NULL,
	"tilt" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "motto" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "sign_off" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "seal_style" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "seal_color" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "divider" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "celebration" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "cover_sticker" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "cover_tint" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "signature" jsonb;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "signature_png_url" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "sticker" text;--> statement-breakpoint
ALTER TABLE "issue_status_lines" ADD CONSTRAINT "issue_status_lines_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_status_lines" ADD CONSTRAINT "issue_status_lines_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_stickers" ADD CONSTRAINT "issue_stickers_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_stickers" ADD CONSTRAINT "issue_stickers_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_stickers" ADD CONSTRAINT "issue_stickers_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_status_lines_unique_idx" ON "issue_status_lines" USING btree ("issue_id","membership_id");--> statement-breakpoint
CREATE INDEX "issue_stickers_issue_idx" ON "issue_stickers" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "issue_stickers_member_idx" ON "issue_stickers" USING btree ("issue_id","membership_id");
ALTER TYPE "public"."email_kind" ADD VALUE 'feedback';--> statement-breakpoint
ALTER TYPE "public"."email_kind" ADD VALUE 'email_change';--> statement-breakpoint
CREATE TABLE "email_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"old_email" text NOT NULL,
	"new_email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "from_name" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "reply_to" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_changes" ADD CONSTRAINT "email_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_changes_token_hash_idx" ON "email_changes" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_changes_user_idx" ON "email_changes" USING btree ("user_id");
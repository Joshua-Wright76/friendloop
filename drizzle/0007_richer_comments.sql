ALTER TYPE "public"."email_kind" ADD VALUE 'mention';--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "reply_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "quote_comment_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "comments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_reply_id_replies_id_fk" FOREIGN KEY ("reply_id") REFERENCES "public"."replies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_quote_comment_id_comments_id_fk" FOREIGN KEY ("quote_comment_id") REFERENCES "public"."comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_reply_idx" ON "comments" USING btree ("reply_id");
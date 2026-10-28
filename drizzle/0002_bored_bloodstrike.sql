ALTER TABLE "comments" ADD COLUMN "inbound_email_id" text;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "reply_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "comments_inbound_email_idx" ON "comments" USING btree ("inbound_email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_reply_token_idx" ON "outbox" USING btree ("reply_token");
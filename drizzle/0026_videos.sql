ALTER TABLE "replies" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "video_poster_url" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "video_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "reply_media" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "reply_media" ADD COLUMN "video_duration_ms" integer;
ALTER TABLE "music_links" ADD COLUMN "tracks" jsonb;--> statement-breakpoint
ALTER TABLE "music_links" ADD COLUMN "track_count" integer;--> statement-breakpoint
-- Existing cards predate songs: mark them stale so the next render refetches.
-- A failed refetch still answers with the cached title.
UPDATE "music_links" SET "fetched_at" = '1970-01-01T00:00:00Z';

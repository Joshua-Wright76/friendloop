CREATE TABLE "heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"last_ok_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Start the sweep's clock at migration time, so /api/health gives the first
-- scheduled run a full window instead of reporting "never ran" until it does.
INSERT INTO "heartbeats" ("name", "last_ok_at") VALUES ('sweep', now()) ON CONFLICT DO NOTHING;

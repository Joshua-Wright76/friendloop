CREATE TABLE "invite_links" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "magic_links" ADD COLUMN "join_token" text;--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_links_token_idx" ON "invite_links" USING btree ("token");
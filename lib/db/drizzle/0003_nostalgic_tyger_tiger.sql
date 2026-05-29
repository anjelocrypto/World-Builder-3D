CREATE TABLE "rp_houses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_id" uuid,
	"purchased_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rp_houses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "rp_houses" ADD CONSTRAINT "rp_houses_owner_id_rp_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."rp_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_rp_houses_owner" ON "rp_houses" USING btree ("owner_id");
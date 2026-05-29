CREATE TABLE "rp_city_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "rp_city_config" ADD CONSTRAINT "rp_city_config_updated_by_rp_players_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."rp_players"("id") ON DELETE set null ON UPDATE no action;
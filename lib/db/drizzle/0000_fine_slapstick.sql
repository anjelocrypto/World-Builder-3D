CREATE TABLE "rp_arrests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"arrested_by" uuid,
	"reason" text NOT NULL,
	"sentence_secs" integer NOT NULL,
	"fine" integer DEFAULT 0 NOT NULL,
	"arrested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rp_factions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"color" text DEFAULT '#ffffff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rp_factions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rp_jobs" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_building" text NOT NULL,
	"pay_per_route" integer NOT NULL,
	"cooldown_secs" integer DEFAULT 300 NOT NULL,
	"max_on_duty" smallint DEFAULT 8 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rp_owned_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"model" text NOT NULL,
	"variant" text NOT NULL,
	"color" text DEFAULT '#aabbcc' NOT NULL,
	"plate" text NOT NULL,
	"locked" boolean DEFAULT true NOT NULL,
	"fuel" smallint DEFAULT 100 NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_driven_at" timestamp with time zone,
	CONSTRAINT "rp_owned_vehicles_plate_unique" UNIQUE("plate")
);
--> statement-breakpoint
CREATE TABLE "rp_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"driver_license_at" timestamp with time zone,
	"weapon_license_at" timestamp with time zone,
	"jail_until" timestamp with time zone,
	"jail_reason" text,
	"faction_id" uuid,
	"faction_rank" smallint DEFAULT 0 NOT NULL,
	"current_job" text,
	"on_duty" boolean DEFAULT false NOT NULL,
	"last_paycheck_at" timestamp with time zone,
	CONSTRAINT "rp_players_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "rp_transaction_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cash_delta" integer DEFAULT 0 NOT NULL,
	"bank_delta" integer DEFAULT 0 NOT NULL,
	"cash_after" integer NOT NULL,
	"bank_after" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rp_wallets" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"cash" integer DEFAULT 500 NOT NULL,
	"bank" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rp_wallets_cash_nonneg" CHECK ("rp_wallets"."cash" >= 0),
	CONSTRAINT "rp_wallets_bank_nonneg" CHECK ("rp_wallets"."bank" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rp_warrants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"stars" smallint DEFAULT 1 NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	CONSTRAINT "rp_warrants_stars_range" CHECK ("rp_warrants"."stars" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "rp_arrests" ADD CONSTRAINT "rp_arrests_player_id_rp_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."rp_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rp_arrests" ADD CONSTRAINT "rp_arrests_arrested_by_rp_players_id_fk" FOREIGN KEY ("arrested_by") REFERENCES "public"."rp_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rp_owned_vehicles" ADD CONSTRAINT "rp_owned_vehicles_owner_id_rp_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."rp_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rp_players" ADD CONSTRAINT "rp_players_faction_id_rp_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."rp_factions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rp_transaction_log" ADD CONSTRAINT "rp_transaction_log_player_id_rp_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."rp_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rp_wallets" ADD CONSTRAINT "rp_wallets_player_id_rp_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."rp_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rp_warrants" ADD CONSTRAINT "rp_warrants_player_id_rp_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."rp_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rp_warrants" ADD CONSTRAINT "rp_warrants_issued_by_rp_players_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."rp_players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_rp_arrests_player" ON "rp_arrests" USING btree ("player_id","arrested_at");--> statement-breakpoint
CREATE INDEX "idx_rp_vehicles_owner" ON "rp_owned_vehicles" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "idx_rp_players_token" ON "rp_players" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_rp_players_faction" ON "rp_players" USING btree ("faction_id");--> statement-breakpoint
CREATE INDEX "idx_rp_tx_player_time" ON "rp_transaction_log" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_rp_warrants_player" ON "rp_warrants" USING btree ("player_id");--> statement-breakpoint
-- Manually appended: partial index for active (uncleared) warrants hot path.
-- Keep idx_rp_warrants_player above — do NOT delete it (Option A, see NEMOVERSE_RP_PLAN.md §4.6).
CREATE INDEX "idx_rp_warrants_active" ON "rp_warrants" ("player_id") WHERE "cleared_at" IS NULL;
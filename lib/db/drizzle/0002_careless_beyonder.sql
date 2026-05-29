CREATE TABLE "rp_inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"item_slug" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rp_inventory_quantity_nonneg" CHECK ("rp_inventory_items"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "rp_inventory_items" ADD CONSTRAINT "rp_inventory_items_player_id_rp_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."rp_players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_rp_inventory_player_item" ON "rp_inventory_items" USING btree ("player_id","item_slug");
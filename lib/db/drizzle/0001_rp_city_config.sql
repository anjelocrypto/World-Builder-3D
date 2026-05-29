-- Phase 8C: rp_city_config — persistent key/value store for server-wide city settings.
-- Generated for review. DO NOT apply without reviewing.
-- Run `pnpm run generate` on your local machine to get the Drizzle-tracked version.
--> statement-breakpoint

CREATE TABLE "rp_city_config" (
    "key"        text                     PRIMARY KEY NOT NULL,
    "value"      text                     NOT NULL,
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_by" uuid                     REFERENCES "rp_players"("id") ON DELETE SET NULL
);

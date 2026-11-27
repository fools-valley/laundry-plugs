CREATE TYPE "plugs"."outage_cause" AS ENUM('power_cut', 'network_outage');--> statement-breakpoint
CREATE TABLE "plugs"."outage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"house" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"restored_at" timestamp with time zone,
	"powered_on_at" timestamp with time zone,
	"cause" "plugs"."outage_cause"
);
--> statement-breakpoint
ALTER TABLE "plugs"."reading" ADD COLUMN "uptime_seconds" integer;--> statement-breakpoint
CREATE INDEX "outage_created_at_index" ON "plugs"."outage" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "outage_house_index" ON "plugs"."outage" ("house") WHERE ("restored_at" is null);
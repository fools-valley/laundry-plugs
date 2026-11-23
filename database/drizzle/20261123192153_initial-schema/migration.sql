CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "plugs";
--> statement-breakpoint
CREATE TABLE "auth"."access_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plugs"."plug" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"identifier" text NOT NULL,
	"created_by_access_token_id" uuid NOT NULL,
	"last_reading_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plugs"."reading" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plug_id" uuid NOT NULL,
	"access_token_id" uuid NOT NULL,
	"is_on" boolean,
	"power_watts" double precision NOT NULL,
	"voltage_volts" double precision,
	"current_amperes" double precision,
	"energy_total_watt_hours" double precision,
	"temperature_celsius" double precision,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "access_token_created_at_index" ON "auth"."access_token" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "access_token_token_hash_index" ON "auth"."access_token" ("token_hash");--> statement-breakpoint
CREATE INDEX "plug_created_at_index" ON "plugs"."plug" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plug_identifier_index" ON "plugs"."plug" ("identifier");--> statement-breakpoint
CREATE INDEX "reading_created_at_index" ON "plugs"."reading" ("created_at");--> statement-breakpoint
CREATE INDEX "reading_plug_id_created_at_index" ON "plugs"."reading" ("plug_id","created_at");--> statement-breakpoint
ALTER TABLE "plugs"."plug" ADD CONSTRAINT "plug_created_by_access_token_id_access_token_id_fkey" FOREIGN KEY ("created_by_access_token_id") REFERENCES "auth"."access_token"("id");--> statement-breakpoint
ALTER TABLE "plugs"."reading" ADD CONSTRAINT "reading_plug_id_plug_id_fkey" FOREIGN KEY ("plug_id") REFERENCES "plugs"."plug"("id");--> statement-breakpoint
ALTER TABLE "plugs"."reading" ADD CONSTRAINT "reading_access_token_id_access_token_id_fkey" FOREIGN KEY ("access_token_id") REFERENCES "auth"."access_token"("id");
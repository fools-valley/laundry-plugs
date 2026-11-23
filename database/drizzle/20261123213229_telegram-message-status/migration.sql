ALTER TABLE "plugs"."plug" ADD COLUMN "telegram_message" jsonb;--> statement-breakpoint
ALTER TABLE "plugs"."plug" ADD COLUMN "telegram_unavailable" boolean DEFAULT false NOT NULL;
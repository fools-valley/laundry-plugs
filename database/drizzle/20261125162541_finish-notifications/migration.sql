CREATE TABLE "plugs"."finish_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plug_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "finish_notification_created_at_index" ON "plugs"."finish_notification" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "finish_notification_plug_id_telegram_chat_id_index" ON "plugs"."finish_notification" ("plug_id","telegram_chat_id") WHERE ("notified_at" is null);--> statement-breakpoint
ALTER TABLE "plugs"."finish_notification" ADD CONSTRAINT "finish_notification_plug_id_plug_id_fkey" FOREIGN KEY ("plug_id") REFERENCES "plugs"."plug"("id");
CREATE TYPE "plugs"."notification_event" AS ENUM('started', 'finished');--> statement-breakpoint
ALTER TABLE "plugs"."finish_notification" RENAME TO "notification";--> statement-breakpoint
DROP INDEX "plugs"."finish_notification_plug_id_telegram_chat_id_index";--> statement-breakpoint
ALTER TABLE "plugs"."notification" ADD COLUMN "event" "plugs"."notification_event" DEFAULT 'finished'::"plugs"."notification_event" NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_plug_id_telegram_chat_id_event_index" ON "plugs"."notification" ("plug_id","telegram_chat_id","event") WHERE ("notified_at" is null);
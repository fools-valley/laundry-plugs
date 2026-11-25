CREATE TABLE "plugs"."machine_menu" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"telegram_message_id" integer NOT NULL,
	"button_labels" jsonb NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "machine_menu_created_at_index" ON "plugs"."machine_menu" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_menu_telegram_chat_id_index" ON "plugs"."machine_menu" ("telegram_chat_id") WHERE ("closed_at" is null);
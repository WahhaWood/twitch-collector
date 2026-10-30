CREATE TABLE "streak_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"channel_id" text NOT NULL,
	"login" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"broadcast_id" text,
	"live_since" timestamp with time zone,
	"live" boolean DEFAULT false NOT NULL,
	"watched_seconds" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "twitch_accounts" ADD COLUMN "auto_watch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "twitch_accounts" ADD COLUMN "watching" jsonb;--> statement-breakpoint
ALTER TABLE "twitch_accounts" ADD COLUMN "watching_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "streak_channels" ADD CONSTRAINT "streak_channels_account_id_twitch_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."twitch_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "streak_channels_account_channel" ON "streak_channels" USING btree ("account_id","channel_id");
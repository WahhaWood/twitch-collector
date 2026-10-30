CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"game_name" text,
	"image_url" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"required_minutes" integer,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "progress" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"minutes_watched" integer,
	"status" text DEFAULT 'unknown' NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text,
	"error_code" text,
	"error_summary" text
);
--> statement-breakpoint
CREATE TABLE "twitch_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"twitch_user_id" text NOT NULL,
	"login" text NOT NULL,
	"display_name" text NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	CONSTRAINT "twitch_accounts_twitch_user_id_unique" UNIQUE("twitch_user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_account_id_twitch_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."twitch_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress" ADD CONSTRAINT "progress_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_account_id_twitch_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."twitch_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "twitch_accounts" ADD CONSTRAINT "twitch_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "progress_account_campaign" ON "progress" USING btree ("account_id","campaign_id");--> statement-breakpoint
CREATE INDEX "sync_runs_started_at" ON "sync_runs" USING btree ("started_at");
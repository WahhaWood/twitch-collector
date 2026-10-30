CREATE TABLE "ai_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"question" text,
	"answer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_channels" (
	"campaign_external_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"login" text NOT NULL,
	"display_name" text NOT NULL,
	"title" text,
	"viewers" integer,
	"avatar_url" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_channels_campaign_external_id_channel_id_pk" PRIMARY KEY("campaign_external_id","channel_id")
);
--> statement-breakpoint
CREATE TABLE "progress_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"minutes_watched" integer,
	"delta" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"benefit_id" text NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"awarded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "campaign_external_id" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "account_link_url" text;--> statement-breakpoint
ALTER TABLE "progress" ADD COLUMN "account_connected" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_history" ADD CONSTRAINT "progress_history_account_id_twitch_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."twitch_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_history" ADD CONSTRAINT "progress_history_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_account_id_twitch_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."twitch_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_messages_user_created" ON "ai_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "live_channels_seen_at" ON "live_channels" USING btree ("seen_at");--> statement-breakpoint
CREATE INDEX "progress_history_account_at" ON "progress_history" USING btree ("account_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "rewards_account_benefit" ON "rewards" USING btree ("account_id","benefit_id");--> statement-breakpoint
CREATE INDEX "rewards_awarded_at" ON "rewards" USING btree ("awarded_at");
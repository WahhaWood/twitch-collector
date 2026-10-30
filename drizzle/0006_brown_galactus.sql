CREATE TABLE "skipped_campaigns" (
	"account_id" integer NOT NULL,
	"campaign_key" text NOT NULL,
	"campaign_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skipped_campaigns_account_id_campaign_key_pk" PRIMARY KEY("account_id","campaign_key")
);
--> statement-breakpoint
ALTER TABLE "skipped_campaigns" ADD CONSTRAINT "skipped_campaigns_account_id_twitch_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."twitch_accounts"("id") ON DELETE cascade ON UPDATE no action;
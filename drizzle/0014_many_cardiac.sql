ALTER TABLE "streak_channels" ADD COLUMN "points" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "streak_channels" ADD COLUMN "points_balance" integer;--> statement-breakpoint
ALTER TABLE "twitch_accounts" ADD COLUMN "auto_claim_points" boolean DEFAULT true NOT NULL;
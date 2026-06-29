CREATE TABLE `push_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_user_id_unique` ON `push_subscription` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_push_subscription_user` ON `push_subscription` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_match` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`home_team_id` text,
	`away_team_id` text,
	`kickoff_utc` text NOT NULL,
	`status` text NOT NULL,
	`home_score` integer,
	`away_score` integer,
	`result_source` text,
	`settled_at` text,
	`group_label` text,
	`stage_id` text,
	`home_placeholder` text,
	`away_placeholder` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tournament_id`) REFERENCES `tournament`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`home_team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`away_team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_match`("id", "tournament_id", "home_team_id", "away_team_id", "kickoff_utc", "status", "home_score", "away_score", "result_source", "settled_at", "group_label", "stage_id", "home_placeholder", "away_placeholder", "created_at") SELECT "id", "tournament_id", "home_team_id", "away_team_id", "kickoff_utc", "status", "home_score", "away_score", "result_source", "settled_at", "group_label", "stage_id", "home_placeholder", "away_placeholder", "created_at" FROM `match`;--> statement-breakpoint
DROP TABLE `match`;--> statement-breakpoint
ALTER TABLE `__new_match` RENAME TO `match`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_match_kickoff` ON `match` (`kickoff_utc`);--> statement-breakpoint
CREATE INDEX `idx_match_status` ON `match` (`status`);
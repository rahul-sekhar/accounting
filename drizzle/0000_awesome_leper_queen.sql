CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bank` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`balance` integer,
	`balance_date` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `accounts_owner` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`filename` text NOT NULL,
	`added` integer NOT NULL,
	`skipped` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `imports_owner` ON `imports` (`user_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`import_id` text NOT NULL,
	`category` text DEFAULT 'Uncategorized' NOT NULL,
	`source` text DEFAULT 'none' NOT NULL,
	`confidence` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedupe` ON `transactions` (`user_id`,`account_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `transactions_owner_date` ON `transactions` (`user_id`,`date`);
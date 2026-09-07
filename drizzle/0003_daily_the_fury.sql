ALTER TABLE `accounts` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `balance`;--> statement-breakpoint
ALTER TABLE `accounts` DROP COLUMN `balance_date`;
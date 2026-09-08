ALTER TABLE `transactions` ADD `spread_start_month` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `spread_month_count` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `spread_revision` integer DEFAULT 0 NOT NULL;
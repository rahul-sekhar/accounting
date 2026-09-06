CREATE TABLE `category_definitions` (
	`user_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `sub_description` text DEFAULT '' NOT NULL;
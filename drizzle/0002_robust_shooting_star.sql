CREATE TABLE `categorization_contexts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_review_events` (
	`operation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_category_id` text,
	`resulting_category_id` text NOT NULL,
	`previous_source` text NOT NULL,
	`previous_confidence` text,
	`previous_memory_enabled` integer,
	`resulting_memory_enabled` integer NOT NULL,
	`description` text NOT NULL,
	`sub_description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`account_id` text NOT NULL,
	`account_type` text NOT NULL,
	`recorded_at` text NOT NULL,
	`reviewed_at` text,
	`resulting_revision` integer NOT NULL,
	`origin` text NOT NULL,
	`input_hash` text NOT NULL,
	PRIMARY KEY(`user_id`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `review_events_owner_transaction` ON `transaction_review_events` (`user_id`,`transaction_id`,`resulting_revision`);--> statement-breakpoint
CREATE TABLE `transaction_reviews` (
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`latest_operation_id` text NOT NULL,
	`category_id` text NOT NULL,
	`memory_enabled` integer DEFAULT true NOT NULL,
	`revision` integer NOT NULL,
	`reviewed_at` text,
	`description` text NOT NULL,
	`sub_description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`account_id` text NOT NULL,
	`account_type` text NOT NULL,
	`origin` text NOT NULL,
	PRIMARY KEY(`user_id`, `transaction_id`)
);
--> statement-breakpoint
CREATE INDEX `transaction_reviews_owner_memory` ON `transaction_reviews` (`user_id`,`memory_enabled`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `categorization_evidence` text;--> statement-breakpoint
PRAGMA optimize;

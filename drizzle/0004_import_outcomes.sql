CREATE TABLE `import_row_outcomes` (
	`user_id` text NOT NULL,
	`import_id` text NOT NULL,
	`account_id` text NOT NULL,
	`row_ordinal` integer NOT NULL,
	`occurrence` integer NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`sub_description` text NOT NULL,
	`amount` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`outcome` text NOT NULL,
	`transaction_id` text NOT NULL,
	`action_detail` text NOT NULL,
	PRIMARY KEY(`user_id`, `import_id`, `row_ordinal`),
	FOREIGN KEY (`import_id`) REFERENCES `imports`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_outcomes_owner_import_outcome` ON `import_row_outcomes` (`user_id`,`import_id`,`outcome`,`row_ordinal`);--> statement-breakpoint
CREATE INDEX `import_outcomes_owner_account` ON `import_row_outcomes` (`user_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `operation_receipts` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`committed_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `operation_id`)
);
--> statement-breakpoint
CREATE INDEX `operation_receipts_owner_committed` ON `operation_receipts` (`user_id`,`committed_at`);--> statement-breakpoint
ALTER TABLE `imports` ADD `enriched` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `imports` ADD `report_version` integer;
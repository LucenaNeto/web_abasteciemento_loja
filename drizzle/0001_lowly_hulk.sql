CREATE TABLE `inventory_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`type` text NOT NULL,
	`ref_type` text,
	`ref_id` integer,
	`request_item_id` integer,
	`note` text,
	`created_by_user_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `im_product_idx` ON `inventory_movements` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `im_req_item_unique` ON `inventory_movements` (`ref_type`,`request_item_id`);--> statement-breakpoint
DROP INDEX `idx_products_sku`;--> statement-breakpoint
DROP INDEX `idx_products_name`;--> statement-breakpoint
ALTER TABLE `products` ADD `stock` integer DEFAULT 0 NOT NULL;
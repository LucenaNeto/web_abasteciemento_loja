DROP INDEX `im_product_idx`;--> statement-breakpoint
DROP INDEX `im_req_item_unique`;--> statement-breakpoint
CREATE INDEX `idx_im_product` ON `inventory_movements` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_im_req_item` ON `inventory_movements` (`ref_type`,`request_item_id`);
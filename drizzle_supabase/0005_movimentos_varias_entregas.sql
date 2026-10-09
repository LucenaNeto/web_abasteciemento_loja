DROP INDEX "uq_im_req_item";--> statement-breakpoint
CREATE INDEX "idx_im_ref" ON "inventory_movements" USING btree ("ref_type","request_item_id");
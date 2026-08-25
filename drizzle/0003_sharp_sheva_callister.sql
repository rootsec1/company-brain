ALTER TABLE "messages" ADD COLUMN "client_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_client_idx" ON "messages" USING btree ("conversation_id","client_id");
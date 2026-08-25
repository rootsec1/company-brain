CREATE TABLE "workflow_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"format" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_relationships" ADD COLUMN "to_source_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_artifacts_run_idx" ON "workflow_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "workflow_artifacts_document_idx" ON "workflow_artifacts" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "pending_relationships" ADD CONSTRAINT "pending_relationships_to_source_id_sources_id_fk" FOREIGN KEY ("to_source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;
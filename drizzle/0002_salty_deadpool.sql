CREATE TABLE "pending_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"from_external_id" text NOT NULL,
	"to_external_id" text NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"confidence" real,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_relationships" ADD CONSTRAINT "pending_relationships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_relationships" ADD CONSTRAINT "pending_relationships_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_relationship_unique_idx" ON "pending_relationships" USING btree ("source_id","from_external_id","to_external_id","type");--> statement-breakpoint
CREATE INDEX "pending_relationship_source_idx" ON "pending_relationships" USING btree ("source_id","resolved_at");
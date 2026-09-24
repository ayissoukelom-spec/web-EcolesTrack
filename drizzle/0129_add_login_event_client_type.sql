ALTER TABLE "user_login_events" ADD COLUMN IF NOT EXISTS "client_type" text;

DO $$ BEGIN
 ALTER TABLE "user_login_events" ADD CONSTRAINT "user_login_events_client_type_check" CHECK ("client_type" IS NULL OR "client_type" IN ('web', 'android'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
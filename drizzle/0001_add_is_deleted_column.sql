-- Add isDeleted column to users table
ALTER TABLE "users" ADD COLUMN "is_deleted" boolean DEFAULT false NOT NULL;

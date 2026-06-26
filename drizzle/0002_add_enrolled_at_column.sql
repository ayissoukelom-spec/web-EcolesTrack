-- Add enrolled_at column to students table to track when a student was enrolled in a class
ALTER TABLE "students" ADD COLUMN "enrolled_at" timestamp DEFAULT now() NOT NULL;

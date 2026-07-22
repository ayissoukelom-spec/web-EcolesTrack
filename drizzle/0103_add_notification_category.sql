DO $$ BEGIN
  CREATE TYPE notification_category_enum AS ENUM (
    'evaluation_created',
    'grade_created',
    'absence_created',
    'info'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS category notification_category_enum;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE evaluation_id IS NOT NULL
      AND type <> 'grade'
  ) THEN
    UPDATE notifications
    SET category = 'evaluation_created'
    WHERE evaluation_id IS NOT NULL
      AND type = 'grade'
      AND category IS NULL;
  END IF;
END;
$$;

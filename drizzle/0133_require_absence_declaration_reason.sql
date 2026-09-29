ALTER TABLE "absence_declarations"
  ALTER COLUMN "reason" SET NOT NULL;

ALTER TABLE "absence_declarations"
  ADD CONSTRAINT "absence_declarations_reason_nonblank_check"
  CHECK ("reason" ~ '[^[:space:]]');
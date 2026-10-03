ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_canonical_check"
	CHECK (left("phone", 1) = '+' AND length("phone") BETWEEN 3 AND 16 AND substring("phone" FROM 2 FOR 1) BETWEEN '1' AND '9' AND substring("phone" FROM 2) !~ '[^0-9]');
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE ("phone");
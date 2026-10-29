ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS last_mobile_visit_at TIMESTAMP;

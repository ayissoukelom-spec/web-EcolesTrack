-- Repair missing user_schools rows for school_admin users so they can log in and select a school.
INSERT INTO user_schools (user_id, school_id, role, is_active, created_at)
SELECT
  u.id AS user_id,
  u.school_id AS school_id,
  'school_admin' AS role,
  true AS is_active,
  now() AS created_at
FROM users AS u
WHERE u.role = 'school_admin'
  AND u.school_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_schools AS us
    WHERE us.user_id = u.id
      AND us.school_id = u.school_id
  );

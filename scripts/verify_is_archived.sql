-- Verify evaluations with NULL is_archived
SELECT id, class_id, title, is_archived FROM evaluations WHERE is_archived IS NULL ORDER BY id;

-- Quick counts by value
SELECT is_archived, COUNT(*) as cnt FROM evaluations GROUP BY is_archived ORDER BY is_archived NULLS FIRST;

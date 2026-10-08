ALTER TABLE accounting_tariffs
  ADD COLUMN label text;

UPDATE accounting_tariffs AS tariff
SET label = category.label
FROM accounting_categories AS category
WHERE category.id = tariff.category_id;

ALTER TABLE accounting_tariffs
  ALTER COLUMN label SET NOT NULL;

-- Add evaluation type and sequence management fields
-- Type values: 'interrogation', 'devoir', 'composition'
-- Sequence number is per (term_id, class_id) combination

ALTER TABLE evaluations ADD COLUMN type text DEFAULT NULL;
ALTER TABLE evaluations ADD COLUMN sequence_number integer DEFAULT NULL;
ALTER TABLE evaluations ADD COLUMN generated_name text DEFAULT NULL;

-- Create partial unique index on (term_id, class_id, sequence_number) to prevent duplicates
-- Only applies to rows where sequence_number IS NOT NULL
-- This allows existing evaluations with NULL sequence_number to coexist without conflict
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_term_class_sequence_unique
  ON evaluations(term_id, class_id, sequence_number)
  WHERE sequence_number IS NOT NULL;

-- Create index for fast lookups of sequence numbers in a (term_id, class_id) context
CREATE INDEX IF NOT EXISTS evaluations_term_class_idx ON evaluations(term_id, class_id);

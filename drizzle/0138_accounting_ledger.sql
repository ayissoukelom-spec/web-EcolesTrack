CREATE SEQUENCE IF NOT EXISTS accounting_receipt_number_seq AS bigint NO CYCLE;

CREATE TABLE accounting_categories (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code IN ('enrollment', 'tuition', 'canteen', 'uniform', 'other')),
  label text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounting_categories_school_code_idx ON accounting_categories (school_id, code);

CREATE TABLE accounting_tariffs (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id integer NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  category_id integer NOT NULL REFERENCES accounting_categories(id) ON DELETE RESTRICT,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  is_enabled boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounting_tariffs_school_year_class_category_idx
  ON accounting_tariffs (school_id, academic_year_id, class_id, category_id);

CREATE TABLE accounting_schedule_templates (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id integer NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  category_id integer NOT NULL REFERENCES accounting_categories(id) ON DELETE RESTRICT,
  period_type text NOT NULL CHECK (period_type IN ('annual', 'trimester', 'semester')),
  installments jsonb NOT NULL,
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounting_schedule_templates_scope_idx
  ON accounting_schedule_templates (school_id, academic_year_id, class_id, category_id);

CREATE TABLE accounting_fee_definitions (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  academic_year_id integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  student_id integer REFERENCES students(id) ON DELETE RESTRICT,
  category_id integer NOT NULL REFERENCES accounting_categories(id) ON DELETE RESTRICT,
  class_id integer REFERENCES classes(id) ON DELETE RESTRICT,
  label text NOT NULL,
  description text,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  is_mandatory boolean NOT NULL DEFAULT false,
  due_date text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'validated', 'active', 'rejected', 'disabled')),
  proposed_by integer REFERENCES users(id) ON DELETE SET NULL,
  validated_by integer REFERENCES users(id) ON DELETE SET NULL,
  validated_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX accounting_fee_definitions_school_year_idx
  ON accounting_fee_definitions (school_id, academic_year_id);

CREATE TABLE financial_obligations (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  class_id integer NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  category_id integer NOT NULL REFERENCES accounting_categories(id) ON DELETE RESTRICT,
  tariff_id integer REFERENCES accounting_tariffs(id) ON DELETE RESTRICT,
  fee_definition_id integer REFERENCES accounting_fee_definitions(id) ON DELETE RESTRICT,
  label text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  class_name_snapshot text NOT NULL,
  enrollment_kind text CHECK (enrollment_kind IS NULL OR enrollment_kind IN ('first_enrollment', 're_enrollment', 'ordinary')),
  source_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_obligations_school_source_key_idx
  ON financial_obligations (school_id, source_key);
CREATE INDEX financial_obligations_student_year_idx
  ON financial_obligations (school_id, student_id, academic_year_id);

CREATE TABLE financial_installments (
  id serial PRIMARY KEY,
  obligation_id integer NOT NULL REFERENCES financial_obligations(id) ON DELETE RESTRICT,
  label text NOT NULL,
  order_index integer NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  due_date text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_installments_obligation_order_idx
  ON financial_installments (obligation_id, order_index);

CREATE TABLE financial_payments (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  student_id integer NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id integer NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  method text NOT NULL CHECK (method IN ('cash', 'tmoney', 'flooz', 'bank_transfer', 'check', 'other')),
  reference text,
  request_fingerprint text NOT NULL,
  paid_at timestamp NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  idempotency_key text NOT NULL,
  recorded_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_payments_school_idempotency_idx
  ON financial_payments (school_id, idempotency_key);
CREATE INDEX financial_payments_school_paid_at_idx
  ON financial_payments (school_id, paid_at);

CREATE TABLE financial_payment_allocations (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL REFERENCES financial_payments(id) ON DELETE RESTRICT,
  obligation_id integer NOT NULL REFERENCES financial_obligations(id) ON DELETE RESTRICT,
  installment_id integer REFERENCES financial_installments(id) ON DELETE RESTRICT,
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX financial_payment_allocations_payment_idx ON financial_payment_allocations (payment_id);
CREATE INDEX financial_payment_allocations_obligation_idx ON financial_payment_allocations (obligation_id);

CREATE TABLE financial_adjustments (
  id serial PRIMARY KEY,
  payment_id integer NOT NULL REFERENCES financial_payments(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('cancellation', 'refund')),
  amount integer NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  source_key text NOT NULL,
  recorded_by integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_adjustments_source_key_idx
  ON financial_adjustments (source_key);
CREATE INDEX financial_adjustments_payment_idx ON financial_adjustments (payment_id);

CREATE TABLE financial_adjustment_allocations (
  id serial PRIMARY KEY,
  adjustment_id integer NOT NULL REFERENCES financial_adjustments(id) ON DELETE RESTRICT,
  payment_allocation_id integer NOT NULL REFERENCES financial_payment_allocations(id) ON DELETE RESTRICT,
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX financial_adjustment_allocations_adjustment_idx
  ON financial_adjustment_allocations (adjustment_id);
CREATE INDEX financial_adjustment_allocations_payment_allocation_idx
  ON financial_adjustment_allocations (payment_allocation_id);

CREATE TABLE financial_receipts (
  id serial PRIMARY KEY,
  school_id integer NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  payment_id integer NOT NULL REFERENCES financial_payments(id) ON DELETE RESTRICT,
  receipt_number text NOT NULL,
  snapshot jsonb NOT NULL,
  issued_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX financial_receipts_payment_idx ON financial_receipts (payment_id);
CREATE UNIQUE INDEX financial_receipts_school_number_idx ON financial_receipts (school_id, receipt_number);

ALTER TABLE notifications ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX notifications_dedupe_key_idx ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

INSERT INTO accounting_categories (school_id, code, label, is_enabled)
SELECT id, 'enrollment', 'Inscription', true FROM schools
UNION ALL SELECT id, 'tuition', 'Scolarité', true FROM schools
UNION ALL SELECT id, 'canteen', 'Cantine', false FROM schools
UNION ALL SELECT id, 'uniform', 'Uniforme', false FROM schools
UNION ALL SELECT id, 'other', 'Autres frais', true FROM schools
ON CONFLICT (school_id, code) DO NOTHING;

CREATE FUNCTION seed_accounting_categories_for_school() RETURNS trigger AS $$
BEGIN
  INSERT INTO accounting_categories (school_id, code, label, is_enabled) VALUES
    (NEW.id, 'enrollment', 'Inscription', true),
    (NEW.id, 'tuition', 'Scolarité', true),
    (NEW.id, 'canteen', 'Cantine', false),
    (NEW.id, 'uniform', 'Uniforme', false),
    (NEW.id, 'other', 'Autres frais', true)
  ON CONFLICT (school_id, code) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER schools_seed_accounting_categories
AFTER INSERT ON schools
FOR EACH ROW EXECUTE FUNCTION seed_accounting_categories_for_school();

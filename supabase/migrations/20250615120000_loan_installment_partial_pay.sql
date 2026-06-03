-- Track cumulative payments per installment (full settle sets paid_amount = amount).
ALTER TABLE loan_installments
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0;

ALTER TABLE loan_installments
  DROP CONSTRAINT IF EXISTS loan_installments_paid_amount_bounds;

ALTER TABLE loan_installments
  ADD CONSTRAINT loan_installments_paid_amount_bounds
  CHECK (paid_amount >= 0 AND paid_amount <= amount);

UPDATE loan_installments
SET paid_amount = amount
WHERE is_paid = true AND paid_amount = 0;

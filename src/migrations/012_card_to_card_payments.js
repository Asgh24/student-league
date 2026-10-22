export const id = '012_card_to_card_payments';

/**
 * Manual card-to-card payments.
 *
 * The site owner publishes a destination card number/holder in the admin panel.
 * A teacher chooses a plan, transfers the money outside the app and submits a
 * text receipt and/or an image. The payment stays `pending` until the owner
 * approves it; approval is the only place that extends the subscription.
 *
 * Receipt files live outside the public web root and are served through an
 * authenticated admin endpoint. Only metadata is stored in SQLite.
 */
export function up(db) {
  db.exec(`
    CREATE TABLE payment_settings (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      card_number   TEXT NOT NULL DEFAULT '',
      card_holder   TEXT NOT NULL DEFAULT '',
      bank_name     TEXT NOT NULL DEFAULT '',
      instructions  TEXT NOT NULL DEFAULT '',
      updated_by    INTEGER REFERENCES admins (id) ON DELETE SET NULL,
      updated_at    TEXT
    );

    INSERT INTO payment_settings (id, card_number, card_holder, bank_name, instructions, updated_by, updated_at)
    VALUES (1, '', '', '', '', NULL, NULL);

    ALTER TABLE payments ADD COLUMN receipt_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE payments ADD COLUMN receipt_file TEXT;
    ALTER TABLE payments ADD COLUMN receipt_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE payments ADD COLUMN receipt_mime TEXT NOT NULL DEFAULT '';
    ALTER TABLE payments ADD COLUMN receipt_size INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE payments ADD COLUMN reviewed_by INTEGER REFERENCES admins (id) ON DELETE SET NULL;
    ALTER TABLE payments ADD COLUMN reviewed_at TEXT;
    ALTER TABLE payments ADD COLUMN review_note TEXT NOT NULL DEFAULT '';

    CREATE INDEX idx_payments_pending_card ON payments (provider, status, created_at);
  `);
}

import { toAsciiDigits } from '../lib/normalize.js';

/**
 * The destination card shown to teachers for manual card-to-card payments.
 * There is exactly one row (`id = 1`); the admin panel owns it.
 */
export function normalizeCardNumber(value) {
  return toAsciiDigits(value).replace(/[\s-]/g, '').trim();
}

export function cardSettingsJson(row) {
  return {
    cardNumber: row?.card_number ?? '',
    cardHolder: row?.card_holder ?? '',
    bankName: row?.bank_name ?? '',
    instructions: row?.instructions ?? '',
    updatedAt: row?.updated_at ?? null,
  };
}

export function getCardSettings(db) {
  const row = db.prepare('SELECT * FROM payment_settings WHERE id = 1').get();
  return cardSettingsJson(row);
}

export function isCardConfigured(settings) {
  return Boolean(String(settings?.cardNumber ?? '').trim() && String(settings?.cardHolder ?? '').trim());
}

export function saveCardSettings(db, {
  cardNumber,
  cardHolder,
  bankName = '',
  instructions = '',
  adminId = null,
  now = new Date().toISOString(),
}) {
  const normalizedNumber = normalizeCardNumber(cardNumber);
  db.prepare(`
    UPDATE payment_settings
    SET card_number = ?, card_holder = ?, bank_name = ?, instructions = ?,
        updated_by = ?, updated_at = ?
    WHERE id = 1
  `).run(
    normalizedNumber,
    String(cardHolder ?? '').trim(),
    String(bankName ?? '').trim(),
    String(instructions ?? '').trim(),
    adminId,
    now,
  );
  return getCardSettings(db);
}

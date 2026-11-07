export const id = '023_plan_original_price';

/**
 * Optional pre-discount price for a subscription plan.
 *
 * `price` stays the amount the teacher actually pays. When `original_price`
 * is set and higher, the storefront shows the old price struck through next to
 * the discounted price and the saving percentage.
 */
export function up(db) {
  db.exec(`
    ALTER TABLE subscription_plans ADD COLUMN original_price INTEGER;
  `);
}

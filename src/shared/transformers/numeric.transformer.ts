import { ValueTransformer } from 'typeorm';

/**
 * Persists numeric columns (decimal/numeric) but reads them back as JS numbers.
 * MySQL + the mysql2 driver return DECIMAL as strings; this keeps the domain
 * model working with real numbers so arithmetic and JSON output are correct.
 */
export class NumericTransformer implements ValueTransformer {
  /**
   * Pass the value through unchanged. Critically, `undefined` must stay
   * `undefined` (not become `null`) so TypeORM omits the column and the DB
   * `DEFAULT` applies — otherwise a NOT-NULL decimal with a default blows up
   * when the property is left unset (e.g. a seeder that omits minQuantity).
   */
  to(value: number | null | undefined): number | null | undefined {
    return value;
  }

  from(value: string | null): number | null {
    return value === null || value === undefined ? null : Number(value);
  }
}

/** Shared singleton — decimal columns can reference the same instance. */
export const numericTransformer = new NumericTransformer();

/**
 * Fulfilment roll-up shared by the delivery order (`deliveryProgress`) and the
 * invoice (`deliveryStatus`) — both enums use these same string values.
 *  - delivered: every goods line is closed and at least some quantity shipped;
 *  - cancelled: every goods line is closed by a sales return and NOTHING shipped
 *               (the customer returned it all before delivery — never «تم التسليم»);
 *  - partial:   something shipped, something is still owed;
 *  - pending:   nothing shipped yet, something is still owed.
 */
export type FulfilmentState = 'pending' | 'partial' | 'delivered' | 'cancelled';

export interface FulfilmentLine {
  ordered: number;
  delivered: number;
  /** Closed without shipping (credited by a sales return). */
  closed: number;
}

/** null when there are no goods lines at all. */
export function fulfilmentState(lines: FulfilmentLine[]): FulfilmentState | null {
  if (!lines.length) return null;
  const anyDelivered = lines.some((l) => (Number(l.delivered) || 0) > 1e-6);
  const allClosed = lines.every((l) => (Number(l.delivered) || 0) + (Number(l.closed) || 0) + 1e-6 >= (Number(l.ordered) || 0));
  if (allClosed) return anyDelivered ? 'delivered' : 'cancelled';
  return anyDelivered ? 'partial' : 'pending';
}

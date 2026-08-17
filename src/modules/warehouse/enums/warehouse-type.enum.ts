/** Warehouse kinds. Stored as a slug; displayed in Arabic via WAREHOUSE_TYPE_LABELS. */
export enum WarehouseType {
  STORE = 'store',
  SHOWROOM = 'showroom',
  STORE_SHOWROOM = 'store_showroom',
}

/** Arabic labels for each warehouse type (used by the lookup endpoint & UI). */
export const WAREHOUSE_TYPE_LABELS: Record<WarehouseType, string> = {
  [WarehouseType.STORE]: 'مخزن',
  [WarehouseType.SHOWROOM]: 'معرض',
  [WarehouseType.STORE_SHOWROOM]: 'مخزن + معرض',
};

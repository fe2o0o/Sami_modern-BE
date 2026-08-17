/** Nature of a product — drives inventory/manufacturing behaviour downstream. */
export enum ProductType {
  RAW_MATERIAL = 'raw_material',
  FINISHED_PRODUCT = 'finished_product',
  SEMI_FINISHED = 'semi_finished',
  SERVICE = 'service',
}

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  [ProductType.RAW_MATERIAL]: 'مادة خام',
  [ProductType.FINISHED_PRODUCT]: 'منتج تام',
  [ProductType.SEMI_FINISHED]: 'نصف مصنّع',
  [ProductType.SERVICE]: 'خدمة',
};

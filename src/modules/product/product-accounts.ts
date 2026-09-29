import { DataSource, EntityManager } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductCategory } from '../product-category/entities/product-category.entity';

type AccountKey = 'inventoryAccountId' | 'cogsAccountId' | 'salesAccountId';
const KEYS: AccountKey[] = ['inventoryAccountId', 'cogsAccountId', 'salesAccountId'];

/**
 * Accounting accounts are configured on the product CATEGORY (inherited down
 * the tree) — the product's own columns are only a legacy fallback and the
 * Accounting Settings supply the final default (see each posting service).
 *
 * `applyEffectiveAccounts` overlays the category accounts onto the loaded
 * product objects IN MEMORY (category → product legacy value), so every
 * posting service can keep reading `product.inventoryAccountId ?? settings…`.
 * The products passed here are read-only posting context; they are never
 * saved back, so the overlay never reaches the database.
 */
export async function applyEffectiveAccounts(
  products: Product[],
  manager: Pick<EntityManager | DataSource, 'getRepository'>,
): Promise<Product[]> {
  const categoryIds = new Set(products.map((p) => p.categoryId).filter((id): id is string => !!id));
  if (!categoryIds.size) return products;

  // Categories are a small table — load them all once to walk the parent chain.
  const rows = await manager.getRepository(ProductCategory).find({
    select: { id: true, parentId: true, inventoryAccountId: true, cogsAccountId: true, salesAccountId: true },
    withDeleted: true,
  });
  const byId = new Map(rows.map((c) => [c.id, c]));

  const fromCategory = (startId: string, key: AccountKey): string | null => {
    let current = byId.get(startId);
    for (let depth = 0; current && depth < 25; depth++) {
      if (current[key]) return current[key];
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return null;
  };

  for (const product of products) {
    if (!product.categoryId) continue;
    for (const key of KEYS) {
      const inherited = fromCategory(product.categoryId, key);
      if (inherited) product[key] = inherited;
    }
  }
  return products;
}

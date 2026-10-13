import { EntityManager } from 'typeorm';
import { ProductCategory } from './entities/product-category.entity';

/**
 * A category plus every category below it (any depth). Filtering by a parent
 * category therefore covers the products of all its subcategories.
 * Returns `null` when no category is given.
 */
export async function categorySubtreeIds(
  manager: EntityManager,
  categoryId?: string | null,
): Promise<string[] | null> {
  if (!categoryId) return null;
  const rows = await manager
    .createQueryBuilder(ProductCategory, 'c')
    .select(['c.id AS id', 'c.parentId AS parentId'])
    .getRawMany<{ id: string; parentId: string | null }>();
  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = children.get(r.parentId) ?? [];
    list.push(r.id);
    children.set(r.parentId, list);
  }
  const out = new Set<string>([categoryId]);
  const queue = [categoryId];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return [...out];
}

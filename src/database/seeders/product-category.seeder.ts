import { DataSource, Repository } from 'typeorm';
import { ProductCategory } from '../../modules/product-category/entities/product-category.entity';
import { Seeder } from './seeder.interface';

interface CategorySeed {
  code: string;
  name: string;
  nameEn: string;
  children?: CategorySeed[];
}

/**
 * Seeds a realistic furniture-manufacturing category tree. Idempotent by code;
 * `level` and `parentId` are derived from the nesting.
 */
export class ProductCategorySeeder implements Seeder {
  readonly name = 'ProductCategorySeeder';

  private readonly tree: CategorySeed[] = [
    {
      code: '100',
      name: 'غرف النوم',
      nameEn: 'Bedrooms',
      children: [
        { code: '101', name: 'أسرّة', nameEn: 'Beds' },
        { code: '102', name: 'دواليب', nameEn: 'Wardrobes' },
        { code: '103', name: 'تسريحات', nameEn: 'Dressers' },
      ],
    },
    {
      code: '200',
      name: 'غرف المعيشة',
      nameEn: 'Living Rooms',
      children: [
        { code: '201', name: 'كنب', nameEn: 'Sofas' },
        { code: '202', name: 'طاولات', nameEn: 'Tables' },
        { code: '203', name: 'مكتبات', nameEn: 'Bookshelves' },
      ],
    },
    {
      code: '300',
      name: 'غرف الطعام',
      nameEn: 'Dining Rooms',
      children: [
        { code: '301', name: 'طاولات طعام', nameEn: 'Dining Tables' },
        { code: '302', name: 'كراسي طعام', nameEn: 'Dining Chairs' },
      ],
    },
    {
      code: '400',
      name: 'أثاث المكاتب',
      nameEn: 'Office Furniture',
      children: [
        { code: '401', name: 'مكاتب', nameEn: 'Desks' },
        { code: '402', name: 'كراسي مكتب', nameEn: 'Office Chairs' },
      ],
    },
    {
      code: '900',
      name: 'المواد الخام',
      nameEn: 'Raw Materials',
      children: [
        { code: '901', name: 'أخشاب', nameEn: 'Wood' },
        { code: '902', name: 'أقمشة', nameEn: 'Fabrics' },
        { code: '903', name: 'إكسسوارات', nameEn: 'Accessories' },
      ],
    },
  ];

  async run(dataSource: DataSource): Promise<void> {
    const repo = dataSource.getRepository(ProductCategory);
    for (const root of this.tree) {
      await this.seedNode(repo, root, null, 1);
    }
  }

  private async seedNode(
    repo: Repository<ProductCategory>,
    node: CategorySeed,
    parentId: string | null,
    level: number,
  ): Promise<void> {
    let category = await repo.findOne({ where: { code: node.code } });
    if (!category) {
      category = await repo.save(
        repo.create({
          code: node.code,
          name: node.name,
          nameEn: node.nameEn,
          parentId,
          level,
          isActive: true,
        }),
      );
    }
    for (const child of node.children ?? []) {
      await this.seedNode(repo, child, category.id, level + 1);
    }
  }
}

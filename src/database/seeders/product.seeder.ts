import { DataSource } from 'typeorm';
import { Product } from '../../modules/product/entities/product.entity';
import { ProductCategory } from '../../modules/product-category/entities/product-category.entity';
import { Brand } from '../../modules/brand/entities/brand.entity';
import { Unit } from '../../modules/unit/entities/unit.entity';
import { ProductType } from '../../modules/product/enums/product-type.enum';
import { Seeder } from './seeder.interface';

interface ProductSeed {
  code: string;
  name: string;
  nameEn: string;
  categoryCode: string;
  brandCode: string;
  unitCode: string;
  productType: ProductType;
  costPrice: number;
  sellingPrice: number;
}

/**
 * Seeds realistic furniture products, resolving category/brand/unit by their
 * seeded codes. Idempotent by product code. Images are added via the UI upload
 * (binary files can't be seeded meaningfully).
 */
export class ProductSeeder implements Seeder {
  readonly name = 'ProductSeeder';

  private readonly products: ProductSeed[] = [
    { code: 'PRD-0001', name: 'سرير مزدوج فاخر', nameEn: 'Luxury Double Bed', categoryCode: '101', brandCode: 'SAMI', unitCode: 'PCS', productType: ProductType.FINISHED_PRODUCT, costPrice: 3000, sellingPrice: 4500 },
    { code: 'PRD-0002', name: 'دولاب أربع ضلفات', nameEn: '4-Door Wardrobe', categoryCode: '102', brandCode: 'SAMI', unitCode: 'PCS', productType: ProductType.FINISHED_PRODUCT, costPrice: 5000, sellingPrice: 7500 },
    { code: 'PRD-0003', name: 'كنبة زاوية', nameEn: 'Corner Sofa', categoryCode: '201', brandCode: 'MODRN', unitCode: 'SET', productType: ProductType.FINISHED_PRODUCT, costPrice: 8000, sellingPrice: 12000 },
    { code: 'PRD-0004', name: 'طاولة طعام خشبية', nameEn: 'Wooden Dining Table', categoryCode: '301', brandCode: 'CLASC', unitCode: 'PCS', productType: ProductType.FINISHED_PRODUCT, costPrice: 2500, sellingPrice: 4000 },
    { code: 'PRD-0005', name: 'كرسي مكتب دوّار', nameEn: 'Swivel Office Chair', categoryCode: '402', brandCode: 'MODRN', unitCode: 'PCS', productType: ProductType.FINISHED_PRODUCT, costPrice: 800, sellingPrice: 1400 },
    { code: 'PRD-0006', name: 'خشب زان', nameEn: 'Beech Wood', categoryCode: '901', brandCode: 'SAMI', unitCode: 'MTR', productType: ProductType.RAW_MATERIAL, costPrice: 150, sellingPrice: 0 },
    { code: 'PRD-0007', name: 'قماش تنجيد', nameEn: 'Upholstery Fabric', categoryCode: '902', brandCode: 'SAMI', unitCode: 'MTR', productType: ProductType.RAW_MATERIAL, costPrice: 90, sellingPrice: 0 },
  ];

  async run(dataSource: DataSource): Promise<void> {
    const productRepo = dataSource.getRepository(Product);
    const categoryRepo = dataSource.getRepository(ProductCategory);
    const brandRepo = dataSource.getRepository(Brand);
    const unitRepo = dataSource.getRepository(Unit);

    for (const seed of this.products) {
      const exists = await productRepo.findOne({ where: { code: seed.code } });
      if (exists) {
        continue;
      }

      const [category, brand, unit] = await Promise.all([
        categoryRepo.findOne({ where: { code: seed.categoryCode } }),
        brandRepo.findOne({ where: { code: seed.brandCode } }),
        unitRepo.findOne({ where: { code: seed.unitCode } }),
      ]);

      await productRepo.save(
        productRepo.create({
          code: seed.code,
          name: seed.name,
          nameEn: seed.nameEn,
          categoryId: category?.id ?? null,
          brandId: brand?.id ?? null,
          unitId: unit?.id ?? null,
          productType: seed.productType,
          trackInventory: seed.productType !== ProductType.SERVICE,
          costPrice: seed.costPrice,
          sellingPrice: seed.sellingPrice,
          isActive: true,
        }),
      );
    }
  }
}

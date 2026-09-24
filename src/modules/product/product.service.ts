import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { Product } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductComponent } from './entities/product-component.entity';
import { ProductCategory } from '../product-category/entities/product-category.entity';
import { CodeSettingService } from '../code-setting/code-setting.service';
import { Brand } from '../brand/entities/brand.entity';
import { Unit } from '../unit/entities/unit.entity';
import { ProductType, PRODUCT_TYPE_LABELS } from './enums/product-type.enum';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, optNum, bool, enumFromLabel } from '../../common/excel/import.helpers';

/** Minimal shape of a Multer file (memory storage). Avoids a @types/multer dep. */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'products');
const PUBLIC_PREFIX = '/uploads/products';
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const SORTABLE = ['code', 'name', 'sellingPrice', 'createdAt'];

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', example: 'P-001', note: 'كود فريد للمنتج' },
  { field: 'name', header: 'الاسم', required: true, example: 'كرسي خشبي' },
  { field: 'barcode', header: 'الباركود', example: '6221000000001' },
  { field: 'nameEn', header: 'الاسم بالإنجليزية', example: 'Wooden Chair' },
  { field: 'categoryCode', header: 'كود التصنيف', example: 'CAT-001', note: 'كود تصنيف موجود' },
  { field: 'brandCode', header: 'كود العلامة', example: 'BR-001', note: 'كود علامة موجودة' },
  { field: 'unitCode', header: 'كود الوحدة', example: 'PCS', note: 'كود وحدة قياس موجودة' },
  {
    field: 'productType',
    header: 'نوع المنتج',
    example: 'منتج تام',
    note: 'منتج تام / مادة خام / نصف مصنّع / خدمة (افتراضي: منتج تام)',
  },
  { field: 'trackInventory', header: 'تتبع المخزون', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
  { field: 'isManufactured', header: 'مُصنّع داخلياً', type: 'boolean', example: 'لا', note: 'نعم/لا (افتراضي: لا)' },
  { field: 'costPrice', header: 'سعر التكلفة', type: 'number', example: 500 },
  { field: 'sellingPrice', header: 'سعر البيع', type: 'number', example: 750 },
  { field: 'minQuantity', header: 'الحد الأدنى', type: 'number', example: 5 },
  { field: 'reorderPoint', header: 'حد إعادة الطلب', type: 'number', example: 10 },
  { field: 'description', header: 'الوصف', example: '' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

@Injectable()
export class ProductService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductImage)
    private readonly imageRepository: Repository<ProductImage>,
    @InjectRepository(ProductComponent)
    private readonly componentRepository: Repository<ProductComponent>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
    imports: ImportRegistry,
  ) {
    imports.register('products', {
      templateFilename: 'products-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================================================
  // EXCEL IMPORT
  // =========================================================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'المنتجات',
      title: 'استيراد المنتجات',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seenCode = new Set<string>();
    const seenBarcode = new Set<string>();
    return this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const repo = manager.getRepository(Product);
      const code = await this.codeSettings.resolveCode('product', optStr(v.code), manager);
      const codeKey = code.toLowerCase();
      if (seenCode.has(codeKey)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seenCode.add(codeKey);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود المنتج «${code}» مستخدم بالفعل`);
      }

      const barcode = optStr(v.barcode);
      if (barcode) {
        if (seenBarcode.has(barcode)) throw new Error(`الباركود «${barcode}» مكرر داخل الملف`);
        seenBarcode.add(barcode);
        if (await repo.findOne({ where: { barcode }, withDeleted: true })) {
          throw new Error(`الباركود «${barcode}» مستخدم بالفعل`);
        }
      }

      const categoryId = await this.resolveByCode(
        manager, ProductCategory, optStr(v.categoryCode), 'التصنيف',
      );
      const brandId = await this.resolveByCode(
        manager, Brand, optStr(v.brandCode), 'العلامة',
      );
      const unitId = await this.resolveByCode(
        manager, Unit, optStr(v.unitCode), 'الوحدة',
      );

      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          barcode,
          nameEn: optStr(v.nameEn),
          description: optStr(v.description),
          categoryId,
          brandId,
          unitId,
          productType: enumFromLabel<ProductType>(
            v.productType, PRODUCT_TYPE_LABELS, 'نوع المنتج', ProductType.FINISHED_PRODUCT,
          ),
          trackInventory: bool(v.trackInventory, true),
          isManufactured: bool(v.isManufactured, false),
          costPrice: optNum(v.costPrice, 0),
          sellingPrice: optNum(v.sellingPrice, 0),
          minQuantity: optNum(v.minQuantity, 0),
          reorderPoint: optNum(v.reorderPoint, 0),
          isActive: bool(v.isActive, true),
        }),
      );
    });
  }

  /** Resolve an entity id from a human `code`; null when blank, error when unknown. */
  private async resolveByCode<T extends { id: string }>(
    manager: import('typeorm').EntityManager,
    entity: new () => T,
    code: string | null,
    label: string,
  ): Promise<string | null> {
    if (!code) return null;
    const row = await manager.getRepository(entity).findOne({ where: { code } as never });
    if (!row) throw new Error(`${label} بكود «${code}» غير موجود`);
    return row.id;
  }

  // =========================================================
  // CRUD
  // =========================================================
  async create(dto: CreateProductDto): Promise<Product> {
    const code = await this.codeSettings.resolveCode('product', dto.code);
    await this.ensureUnique('code', code, undefined, 'كود المنتج مستخدم بالفعل');
    if (dto.barcode) {
      await this.ensureUnique('barcode', dto.barcode, undefined, 'الباركود مستخدم بالفعل');
    }
    const { components, ...rest } = dto;
    const saved = await this.productRepository.save(this.productRepository.create({ ...rest, code }));
    if (components?.length) await this.replaceComponents(saved.id, components);
    return this.findOne(saved.id);
  }

  /** Replace a product's Bill of Materials with the given component lines. */
  private async replaceComponents(
    productId: string,
    components: { componentProductId: string; quantity: number }[],
  ): Promise<void> {
    await this.componentRepository.delete({ parentProductId: productId });
    if (!components.length) return;
    await this.componentRepository.save(
      components.map((c) =>
        this.componentRepository.create({
          parentProductId: productId,
          componentProductId: c.componentProductId,
          quantity: c.quantity,
        }),
      ),
    );
  }

  async findAll(query: QueryProductDto): Promise<PaginatedResult<Product>> {
    const qb = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.brand', 'brand')
      .leftJoinAndSelect('product.unit', 'unit')
      .leftJoinAndSelect('product.images', 'images');

    if (query.search) {
      qb.andWhere(
        '(product.code LIKE :s OR product.name LIKE :s OR product.nameEn LIKE :s OR product.barcode LIKE :s)',
        { s: `%${query.search}%` },
      );
    }
    if (query.categoryId) {
      qb.andWhere('product.categoryId = :categoryId', { categoryId: query.categoryId });
    }
    if (query.brandId) {
      qb.andWhere('product.brandId = :brandId', { brandId: query.brandId });
    }
    if (query.productType) {
      qb.andWhere('product.productType = :productType', { productType: query.productType });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('product.isActive = :isActive', { isActive: query.isActive });
    }

    const sortBy = SORTABLE.includes(query.sortBy ?? '') ? query.sortBy! : 'createdAt';
    qb.orderBy(`product.${sortBy}`, query.order);
    qb.addOrderBy('images.displayOrder', 'ASC');
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { category: true, brand: true, unit: true, images: true, components: true },
      order: { images: { displayOrder: 'ASC' } },
    });
    if (!product) {
      throw new NotFoundException('لم يتم العثور على المنتج');
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    // Load WITHOUT relations: a stale loaded `category`/`brand`/`unit` object
    // would override the changed FK (categoryId/brandId/unitId) on save.
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) throw new NotFoundException('لم يتم العثور على المنتج');
    if (dto.code && dto.code !== product.code) {
      await this.ensureUnique('code', dto.code, id, 'كود المنتج مستخدم بالفعل');
    }
    if (dto.barcode && dto.barcode !== product.barcode) {
      await this.ensureUnique('barcode', dto.barcode, id, 'الباركود مستخدم بالفعل');
    }
    const { components, ...rest } = dto;
    Object.assign(product, rest);
    await this.productRepository.save(product);
    // Replace the BOM only when the caller sent a components array.
    if (components !== undefined) await this.replaceComponents(id, components);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    // Future: block when the product has stock movements / documents.
    await this.productRepository.softDelete(id);
  }

  async restore(id: string): Promise<void> {
    await this.productRepository.restore(id);
  }

  // =========================================================
  // IMAGES
  // =========================================================
  async addImages(productId: string, files: UploadedImage[]): Promise<ProductImage[]> {
    await this.findOne(productId);
    if (!files?.length) {
      throw new BadRequestException('لم يتم إرفاق أي صور');
    }
    for (const file of files) {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        throw new BadRequestException('صيغة الصورة غير مدعومة (JPG / PNG / WEBP فقط)');
      }
    }

    await fs.mkdir(UPLOAD_DIR, { recursive: true });

    const existing = await this.imageRepository.find({ where: { productId } });
    let order = existing.reduce((max, img) => Math.max(max, img.displayOrder), -1);
    let hasPrimary = existing.some((img) => img.isPrimary);

    const saved: ProductImage[] = [];
    for (const file of files) {
      const ext = extname(file.originalname) || this.extFromMime(file.mimetype);
      const fileName = `${randomUUID()}${ext}`;
      await fs.writeFile(join(UPLOAD_DIR, fileName), file.buffer);

      order += 1;
      const image = await this.imageRepository.save(
        this.imageRepository.create({
          productId,
          fileName,
          originalName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          url: `${PUBLIC_PREFIX}/${fileName}`,
          displayOrder: order,
          isPrimary: !hasPrimary, // first ever image becomes primary
        }),
      );
      hasPrimary = true;
      saved.push(image);
    }

    return this.imagesOf(productId);
  }

  async deleteImage(productId: string, imageId: string): Promise<ProductImage[]> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId, productId },
    });
    if (!image) {
      throw new NotFoundException('لم يتم العثور على الصورة');
    }

    await this.imageRepository.delete(image.id);
    await this.unlinkQuietly(image.fileName);

    // Promote a new primary if we removed the primary one.
    if (image.isPrimary) {
      const next = await this.imageRepository.findOne({
        where: { productId },
        order: { displayOrder: 'ASC' },
      });
      if (next) {
        next.isPrimary = true;
        await this.imageRepository.save(next);
      }
    }

    return this.imagesOf(productId);
  }

  async setPrimary(productId: string, imageId: string): Promise<ProductImage[]> {
    const image = await this.imageRepository.findOne({
      where: { id: imageId, productId },
    });
    if (!image) {
      throw new NotFoundException('لم يتم العثور على الصورة');
    }
    await this.imageRepository.update({ productId }, { isPrimary: false });
    await this.imageRepository.update(image.id, { isPrimary: true });
    return this.imagesOf(productId);
  }

  async reorderImages(productId: string, imageIds: string[]): Promise<ProductImage[]> {
    const images = await this.imageRepository.find({ where: { productId } });
    const ownedIds = new Set(images.map((i) => i.id));
    if (imageIds.length !== images.length || imageIds.some((id) => !ownedIds.has(id))) {
      throw new BadRequestException('قائمة الصور لا تطابق صور المنتج');
    }
    await Promise.all(
      imageIds.map((id, index) =>
        this.imageRepository.update(id, { displayOrder: index }),
      ),
    );
    return this.imagesOf(productId);
  }

  // =========================================================
  // PRIVATE
  // =========================================================
  private imagesOf(productId: string): Promise<ProductImage[]> {
    return this.imageRepository.find({
      where: { productId },
      order: { displayOrder: 'ASC' },
    });
  }

  private async ensureUnique(
    field: 'code' | 'barcode',
    value: string,
    ignoreId?: string,
    message = 'القيمة مستخدمة بالفعل',
  ): Promise<void> {
    const existing = await this.productRepository.findOne({
      where: { [field]: value } as never,
    });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException(message);
    }
  }

  private extFromMime(mime: string): string {
    if (mime === 'image/png') return '.png';
    if (mime === 'image/webp') return '.webp';
    return '.jpg';
  }

  private async unlinkQuietly(fileName: string): Promise<void> {
    try {
      await fs.unlink(join(UPLOAD_DIR, fileName));
    } catch {
      // File already gone — ignore.
    }
  }
}

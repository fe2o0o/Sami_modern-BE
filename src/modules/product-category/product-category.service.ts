import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProductCategory } from './entities/product-category.entity';
import { Product } from '../product/entities/product.entity';
import { CreateProductCategoryDto } from './dto/create-product-category.dto';
import { UpdateProductCategoryDto } from './dto/update-product-category.dto';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, bool } from '../../common/excel/import.helpers';
import { CodeSettingService } from '../code-setting/code-setting.service';

/** ProductCategory node with its nested children (tree response). */
export interface CategoryTreeNode extends ProductCategory {
  children: CategoryTreeNode[];
}

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', example: 'CAT-001', note: 'كود فريد للتصنيف' },
  { field: 'name', header: 'الاسم', required: true, example: 'غرف نوم' },
  { field: 'nameEn', header: 'الاسم بالإنجليزية', example: 'Bedrooms' },
  { field: 'parentCode', header: 'كود التصنيف الأب', example: '', note: 'اتركه فارغاً للتصنيف الرئيسي. يجب أن يظهر صف الأب قبل أبنائه.' },
  { field: 'description', header: 'الوصف', example: '' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

@Injectable()
export class ProductCategoryService {
  constructor(
    @InjectRepository(ProductCategory)
    private readonly categoryRepository: Repository<ProductCategory>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly excel: ExcelService,
    private readonly codeSettings: CodeSettingService,
    private readonly dataSource: DataSource,
    imports: ImportRegistry,
  ) {
    imports.register('product-categories', {
      templateFilename: 'product-categories-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================================================
  // EXCEL IMPORT
  // =========================================================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'تصنيفات المنتجات',
      title: 'استيراد تصنيفات المنتجات',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const repo = manager.getRepository(ProductCategory);
      const code = await this.codeSettings.resolveCode('product_category', optStr(v.code), manager);
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود التصنيف «${code}» مستخدم بالفعل`);
      }

      let parentId: string | null = null;
      let level = 1;
      const parentCode = optStr(v.parentCode);
      if (parentCode) {
        const parent = await repo.findOne({ where: { code: parentCode } });
        if (!parent) {
          throw new Error(
            `التصنيف الأب بكود «${parentCode}» غير موجود — تأكد أنه مُدرج قبل هذا الصف في الملف`,
          );
        }
        parentId = parent.id;
        level = parent.level + 1;
      }

      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          nameEn: optStr(v.nameEn),
          description: optStr(v.description),
          parentId,
          level,
          isActive: bool(v.isActive, true),
        }),
      );
    });
  }

  // =========================================================
  // CREATE
  // =========================================================
  async create(dto: CreateProductCategoryDto): Promise<ProductCategory> {
    const code = await this.codeSettings.resolveCode('product_category', dto.code);
    await this.ensureCodeUnique(code);

    let level = 1;
    if (dto.parentId) {
      const parent = await this.findOne(dto.parentId);
      level = parent.level + 1;
    }

    const category = this.categoryRepository.create({
      ...dto,
      parentId: dto.parentId ?? null,
      level,
      code,
    });
    return this.categoryRepository.save(category);
  }

  // =========================================================
  // READ
  // =========================================================
  /** Full nested tree, ordered by code at each level. */
  async tree(): Promise<CategoryTreeNode[]> {
    const all = await this.categoryRepository.find({ order: { code: 'ASC' } });
    const byId = new Map<string, CategoryTreeNode>();
    all.forEach((c) => byId.set(c.id, Object.assign(c, { children: [] })));

    const roots: CategoryTreeNode[] = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async findOne(id: string): Promise<ProductCategory> {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException('لم يتم العثور على التصنيف');
    }
    return category;
  }

  // =========================================================
  // UPDATE
  // =========================================================
  async update(
    id: string,
    dto: UpdateProductCategoryDto,
  ): Promise<ProductCategory> {
    const category = await this.findOne(id);

    if (dto.code && dto.code !== category.code) {
      await this.ensureCodeUnique(dto.code, id);
    }

    // Re-parenting: guard against cycles and recompute the subtree levels.
    if (dto.parentId !== undefined && dto.parentId !== category.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('لا يمكن جعل التصنيف أباً لنفسه');
      }
      let newLevel = 1;
      if (dto.parentId) {
        const parent = await this.findOne(dto.parentId);
        await this.assertNotDescendant(id, dto.parentId);
        newLevel = parent.level + 1;
      }
      category.parentId = dto.parentId ?? null;
      category.level = newLevel;
      await this.recomputeDescendantLevels(category.id, newLevel);
    }

    const { parentId: _p, ...rest } = dto;
    Object.assign(category, rest);
    return this.categoryRepository.save(category);
  }

  // =========================================================
  // DELETE / RESTORE
  // =========================================================
  async remove(id: string): Promise<void> {
    await this.findOne(id);

    const childCount = await this.categoryRepository.count({
      where: { parentId: id },
    });
    if (childCount > 0) {
      throw new BadRequestException('لا يمكن حذف تصنيف يحتوي على تصنيفات فرعية');
    }

    if (await this.hasProducts(id)) {
      throw new BadRequestException('لا يمكن حذف التصنيف لوجود منتجات مرتبطة به');
    }

    await this.categoryRepository.softDelete(id);
  }

  async restore(id: string): Promise<void> {
    await this.categoryRepository.restore(id);
  }

  // =========================================================
  // PRIVATE
  // =========================================================
  private async ensureCodeUnique(code: string, ignoreId?: string): Promise<void> {
    const existing = await this.categoryRepository.findOne({ where: { code } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('كود التصنيف مستخدم بالفعل');
    }
  }

  /** Reject re-parenting a node under one of its own descendants. */
  private async assertNotDescendant(
    nodeId: string,
    targetParentId: string,
  ): Promise<void> {
    let current: string | null = targetParentId;
    while (current) {
      if (current === nodeId) {
        throw new BadRequestException('لا يمكن نقل التصنيف إلى أحد فروعه');
      }
      const parent = await this.categoryRepository.findOne({
        where: { id: current },
        select: { parentId: true },
      });
      current = parent?.parentId ?? null;
    }
  }

  /** After a re-parent, cascade the new level down the subtree. */
  private async recomputeDescendantLevels(
    parentId: string,
    parentLevel: number,
  ): Promise<void> {
    const children = await this.categoryRepository.find({
      where: { parentId },
      select: { id: true },
    });
    for (const child of children) {
      const level = parentLevel + 1;
      await this.categoryRepository.update(child.id, { level });
      await this.recomputeDescendantLevels(child.id, level);
    }
  }

  /** A category with products attached cannot be deleted. */
  private async hasProducts(categoryId: string): Promise<boolean> {
    const count = await this.productRepository.count({ where: { categoryId } });
    return count > 0;
  }
}

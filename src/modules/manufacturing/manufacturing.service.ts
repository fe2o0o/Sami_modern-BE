import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BranchScope, applyBranchScope, isWithinBranchScope, resolveWriteBranch } from "../../common/utils/branch-scope.util";
import { Brackets, DataSource, EntityManager, In, Repository } from 'typeorm';
import { ManufacturingOrder } from './entities/manufacturing-order.entity';
import { ManufacturingOrderComponent } from './entities/manufacturing-order-component.entity';
import { ManufacturingOrderStatus } from './enums/manufacturing.enum';
import { CreateManufacturingOrderDto } from './dto/create-manufacturing-order.dto';
import { UpdateManufacturingOrderDto } from './dto/update-manufacturing-order.dto';
import { ManufacturingComponentDto } from './dto/manufacturing-component.dto';
import { ManufacturingOrderQueryDto } from './dto/manufacturing-order-query.dto';
import { Product } from '../product/entities/product.entity';
import { ProductComponent } from '../product/entities/product-component.entity';
import { SalesInvoiceItem } from '../sales-invoice/entities/sales-invoice-item.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Branch } from '../branch/entities/branch.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { User } from '../user/entities/user.entity';
import { SequenceService } from '../sequence/sequence.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface ManufacturingOrderListItem {
  id: string;
  orderNumber: string | null;
  orderDate: string;
  productId: string;
  productName: string | null;
  customerName: string | null;
  quantity: number;
  deliveryDate: string | null;
  status: ManufacturingOrderStatus;
  sourceNumber: string | null;
}

/** One manufacturing line to spawn an order from (from a sales invoice). */
export interface ManufacturingFromInvoiceInput {
  productId: string;
  productName: string | null;
  quantity: number;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  fiscalYearId: string | null;
  orderDate: string;
  deliveryDate: string | null;
  dimensions: string | null;
  color: string | null;
  material: string | null;
  specifications: string | null;
  sourceType: string;
  sourceId: string;
  sourceNumber: string | null;
  /** The exact invoice line this order fulfils (for the delivery back-link). */
  salesInvoiceItemId?: string | null;
  accountingPeriodId?: string | null;
  /** Per-order BOM from the invoice line (TOTAL quantities). When empty the
   *  product's default BOM is copied instead. */
  components?: { componentProductId: string; quantity: number; warehouseId?: string | null }[];
  actorId?: string | null;
}

@Injectable()
export class ManufacturingService {
  constructor(
    @InjectRepository(ManufacturingOrder)
    private readonly orderRepository: Repository<ManufacturingOrder>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductComponent)
    private readonly productComponentRepository: Repository<ProductComponent>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly sequenceService: SequenceService,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // CREATE / UPDATE / DELETE
  // =========================================================
  async create(
    dto: CreateManufacturingOrderDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<ManufacturingOrder> {
    const product = await this.productRepository.findOne({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('المنتج غير موجود');
    const customer = dto.customerId
      ? await this.customerRepository.findOne({ where: { id: dto.customerId } })
      : null;
    const fiscalYear = await this.resolveFiscalYear(dto.fiscalYearId ?? null);

    return this.dataSource.transaction(async (manager) => {
      const orderNumber = await this.sequenceService.nextDocumentNumber('MO', fiscalYear, manager);
      const repo = manager.getRepository(ManufacturingOrder);
      // Components: explicit lines if given, otherwise the product's default BOM.
      const components = await this.buildOrderComponents(dto.productId, dto.quantity, dto.components, manager);
      return repo.save(
        repo.create({
          orderNumber,
          orderDate: dto.orderDate,
          productId: dto.productId,
          productName: product.name,
          customerId: dto.customerId ?? null,
          customerName: customer?.name ?? null,
          quantity: dto.quantity,
          deliveryDate: dto.deliveryDate ?? null,
          dimensions: dto.dimensions ?? null,
          color: dto.color ?? null,
          material: dto.material ?? null,
          specifications: dto.specifications ?? null,
          status: ManufacturingOrderStatus.NEW,
          // A branch-restricted user's documents are forced onto their own branch.
          branchId: resolveWriteBranch(branchScope, dto.branchId),
          fiscalYearId: fiscalYear.id,
          manufacturingFee: dto.manufacturingFee ?? 0,
          factorySupplierId: dto.factorySupplierId ?? null,
          notes: dto.notes ?? null,
          components,
          createdBy: actorId ?? null,
        }),
      );
    });
  }

  async update(
    id: string,
    dto: UpdateManufacturingOrderDto,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<ManufacturingOrder> {
    const order = await this.getEditable(id, branchScope);

    if (dto.productId && dto.productId !== order.productId) {
      const product = await this.productRepository.findOne({ where: { id: dto.productId } });
      if (!product) throw new NotFoundException('المنتج غير موجود');
      order.productId = dto.productId;
      order.productName = product.name;
    }
    if (dto.customerId !== undefined) {
      order.customerId = dto.customerId ?? null;
      order.customerName = dto.customerId
        ? (await this.customerRepository.findOne({ where: { id: dto.customerId } }))?.name ?? null
        : null;
    }
    if (dto.quantity !== undefined) order.quantity = dto.quantity;
    if (dto.orderDate) order.orderDate = dto.orderDate;
    if (dto.deliveryDate !== undefined) order.deliveryDate = dto.deliveryDate ?? null;
    if (dto.dimensions !== undefined) order.dimensions = dto.dimensions ?? null;
    if (dto.color !== undefined) order.color = dto.color ?? null;
    if (dto.material !== undefined) order.material = dto.material ?? null;
    if (dto.specifications !== undefined) order.specifications = dto.specifications ?? null;
    if (dto.manufacturingFee !== undefined) order.manufacturingFee = dto.manufacturingFee ?? 0;
    if (dto.factorySupplierId !== undefined) order.factorySupplierId = dto.factorySupplierId ?? null;
    // A branch-restricted user cannot move a document to another branch.
    if (branchScope !== null) order.branchId = resolveWriteBranch(branchScope, order.branchId);
    else if (dto.branchId !== undefined) order.branchId = dto.branchId ?? null;
    if (dto.notes !== undefined) order.notes = dto.notes ?? null;
    order.updatedBy = actorId ?? null;

    const saved = await this.orderRepository.save(order);
    // Replace the component list when provided (editable per order).
    if (dto.components) {
      await this.replaceComponents(order.id, order.productId, order.quantity, dto.components);
    }
    return saved;
  }

  /** Replace an order's component lines transactionally. */
  private async replaceComponents(
    orderId: string,
    productId: string,
    orderQuantity: number,
    components: ManufacturingComponentDto[],
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ManufacturingOrderComponent).delete({ manufacturingOrderId: orderId });
      const comps = await this.buildOrderComponents(productId, orderQuantity, components, manager);
      comps.forEach((c) => (c.manufacturingOrderId = orderId));
      if (comps.length) await manager.getRepository(ManufacturingOrderComponent).save(comps);
    });
  }

  async setStatus(
    id: string,
    status: ManufacturingOrderStatus,
    actorId?: string,
  ): Promise<ManufacturingOrder> {
    const order = await this.findOne(id);
    if (order.status === ManufacturingOrderStatus.CANCELLED) {
      throw new BadRequestException('لا يمكن تغيير حالة أمر ملغى');
    }
    if (status === ManufacturingOrderStatus.IN_PROGRESS && !order.startedAt) {
      order.startedAt = new Date();
    }
    if (status === ManufacturingOrderStatus.DONE && !order.doneAt) {
      order.doneAt = new Date();
    }
    order.status = status;
    order.updatedBy = actorId ?? null;
    return this.orderRepository.save(order);
  }

  async remove(
    id: string,
    actorId?: string,
    branchScope: BranchScope = null,
  ): Promise<void> {
    const order = await this.findOne(id, branchScope);
    if (order.status !== ManufacturingOrderStatus.NEW) {
      throw new BadRequestException('لا يمكن حذف أمر بدأ تنفيذه — يمكن إلغاؤه بدلاً من ذلك');
    }
    await this.orderRepository.update(id, { deletedBy: actorId ?? null });
    await this.orderRepository.softDelete(id);
  }

  // =========================================================
  // READ
  // =========================================================
  async findAll(
    query: ManufacturingOrderQueryDto,
    branchScope: BranchScope = null,
  ): Promise<PaginatedResult<ManufacturingOrderListItem>> {
    const qb = this.orderRepository.createQueryBuilder('mo');
    // Branch-restricted users only ever see their own branch's documents.
    applyBranchScope(qb, 'mo.branchId', branchScope);
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('mo.orderNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('mo.sourceNumber LIKE :s', { s: `%${query.search}%` })
            .orWhere('mo.productName LIKE :s', { s: `%${query.search}%` });
        }),
      );
    }
    if (query.productId) qb.andWhere('mo.productId = :p', { p: query.productId });
    if (query.customerId) qb.andWhere('mo.customerId = :cu', { cu: query.customerId });
    if (query.branchId) qb.andWhere('mo.branchId = :br', { br: query.branchId });
    if (query.status) qb.andWhere('mo.status = :st', { st: query.status });
    if (query.dateFrom) qb.andWhere('mo.orderDate >= :df', { df: query.dateFrom });
    if (query.dateTo) qb.andWhere('mo.orderDate <= :dt', { dt: query.dateTo });

    qb.orderBy('mo.orderDate', 'DESC').addOrderBy('mo.createdAt', 'DESC')
      .skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    const rows: ManufacturingOrderListItem[] = items.map((i) => ({
      id: i.id,
      orderNumber: i.orderNumber,
      orderDate: i.orderDate,
      productId: i.productId,
      productName: i.productName,
      customerName: i.customerName,
      quantity: i.quantity,
      deliveryDate: i.deliveryDate,
      status: i.status,
      sourceNumber: i.sourceNumber,
    }));
    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string, branchScope: BranchScope = null): Promise<ManufacturingOrder> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order || !isWithinBranchScope(order.branchId, branchScope)) {
      throw new NotFoundException('لم يتم العثور على أمر التصنيع');
    }
    return order;
  }

  async findOneDetailed(id: string, branchScope: BranchScope = null): Promise<Record<string, unknown>> {
    const order = await this.findOne(id, branchScope);
    const [branch, fiscalYear, users, components, invoiceLine] = await Promise.all([
      order.branchId ? this.branchRepository.findOne({ where: { id: order.branchId } }) : null,
      order.fiscalYearId ? this.fiscalYearRepository.findOne({ where: { id: order.fiscalYearId } }) : null,
      this.userNames([order.createdBy, order.updatedBy]),
      this.orderRepository.manager
        .getRepository(ManufacturingOrderComponent)
        .find({ where: { manufacturingOrderId: id }, order: { lineNumber: 'ASC' } }),
      // The linked sales-invoice line carries the selling price → drives profit.
      order.salesInvoiceItemId
        ? this.orderRepository.manager
            .getRepository(SalesInvoiceItem)
            .findOne({ where: { id: order.salesInvoiceItemId } })
        : null,
    ]);
    return {
      ...order,
      branchName: branch?.name ?? null,
      fiscalYearName: fiscalYear?.name ?? null,
      createdByName: users.get(order.createdBy ?? '') ?? null,
      components,
      // Selling side (from the sales invoice) for the profit view.
      sellingUnitPrice: invoiceLine?.unitPrice ?? null,
      sellingNet: invoiceLine?.netBeforeTax ?? null,
    };
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private async getEditable(id: string, branchScope: BranchScope = null): Promise<ManufacturingOrder> {
    const order = await this.findOne(id, branchScope);
    if (
      order.status === ManufacturingOrderStatus.PRODUCED ||
      order.status === ManufacturingOrderStatus.DONE ||
      order.status === ManufacturingOrderStatus.CANCELLED
    ) {
      throw new BadRequestException('لا يمكن تعديل أمر تم إنتاجه أو منتهٍ أو ملغى');
    }
    return order;
  }

  private async resolveFiscalYear(fiscalYearId: string | null): Promise<FiscalYear> {
    if (fiscalYearId) {
      const fy = await this.fiscalYearRepository.findOne({ where: { id: fiscalYearId } });
      if (!fy) throw new NotFoundException('السنة المالية غير موجودة');
      return fy;
    }
    const latest = await this.fiscalYearRepository.findOne({
      where: {},
      order: { startDate: 'DESC' },
    });
    if (!latest) throw new BadRequestException('لا توجد سنة مالية — يجب إنشاء سنة مالية أولاً');
    return latest;
  }

  private async userNames(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (!unique.length) return new Map();
    const users = await this.userRepository.find({ where: { id: In(unique) } });
    return new Map(users.map((u): [string, string] => [u.id, u.fullName]));
  }

  /**
   * Create a manufacturing order from a sales-invoice manufacturing line,
   * joining the caller's transaction. Numbered with the invoice's fiscal year.
   */
  async createFromInvoiceLine(
    input: ManufacturingFromInvoiceInput,
    manager: EntityManager,
  ): Promise<ManufacturingOrder> {
    const fiscalYear = await this.resolveFiscalYearIn(input.fiscalYearId, manager);
    const orderNumber = await this.sequenceService.nextDocumentNumber('MO', fiscalYear, manager);
    const repo = manager.getRepository(ManufacturingOrder);
    // Use the invoice line's per-order BOM when provided (already TOTAL quantities),
    // otherwise copy the product's default BOM (per-unit × order quantity).
    const components = await this.buildOrderComponents(
      input.productId,
      input.quantity,
      input.components?.length ? input.components : undefined,
      manager,
    );
    return repo.save(
      repo.create({
        orderNumber,
        orderDate: input.orderDate,
        productId: input.productId,
        productName: input.productName,
        customerId: input.customerId,
        customerName: input.customerName,
        quantity: input.quantity,
        deliveryDate: input.deliveryDate,
        dimensions: input.dimensions,
        color: input.color,
        material: input.material,
        specifications: input.specifications,
        status: ManufacturingOrderStatus.NEW,
        branchId: input.branchId,
        fiscalYearId: fiscalYear.id,
        accountingPeriodId: input.accountingPeriodId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceNumber: input.sourceNumber,
        salesInvoiceItemId: input.salesInvoiceItemId ?? null,
        components,
        createdBy: input.actorId ?? null,
      }),
    );
  }

  /**
   * Build a manufacturing order's component lines. Uses the explicit lines when
   * provided (total quantity as entered), otherwise copies the product's default
   * BOM scaled by the order quantity (BOM is per-unit).
   */
  private async buildOrderComponents(
    productId: string,
    orderQuantity: number,
    explicit: ManufacturingComponentDto[] | undefined,
    manager: EntityManager,
  ): Promise<ManufacturingOrderComponent[]> {
    const compRepo = manager.getRepository(ManufacturingOrderComponent);
    let source: { componentProductId: string; quantity: number; warehouseId: string | null }[];
    if (explicit?.length) {
      source = explicit.map((c) => ({
        componentProductId: c.componentProductId,
        quantity: c.quantity,
        warehouseId: c.warehouseId ?? null,
      }));
    } else {
      const bom = await manager
        .getRepository(ProductComponent)
        .find({ where: { parentProductId: productId } });
      source = bom.map((b) => ({
        componentProductId: b.componentProductId,
        quantity: round3(b.quantity * orderQuantity),
        warehouseId: null,
      }));
    }
    if (!source.length) return [];
    const products = await manager.getRepository(Product).find({
      where: { id: In(source.map((s) => s.componentProductId)) },
      relations: { unit: true },
    });
    const pMap = new Map(products.map((p): [string, Product] => [p.id, p]));
    return source.map((s, i) =>
      compRepo.create({
        lineNumber: i + 1,
        componentProductId: s.componentProductId,
        componentProductName: pMap.get(s.componentProductId)?.name ?? null,
        unitName: pMap.get(s.componentProductId)?.unit?.name ?? null,
        quantity: s.quantity,
        warehouseId: s.warehouseId,
      }),
    );
  }

  private async resolveFiscalYearIn(
    fiscalYearId: string | null,
    manager: EntityManager,
  ): Promise<FiscalYear> {
    const repo = manager.getRepository(FiscalYear);
    if (fiscalYearId) {
      const fy = await repo.findOne({ where: { id: fiscalYearId } });
      if (fy) return fy;
    }
    const latest = await repo.findOne({ where: {}, order: { startDate: 'DESC' } });
    if (!latest) throw new BadRequestException('لا توجد سنة مالية');
    return latest;
  }
}

function round3(v: number): number {
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BranchScope, isWithinBranchScope } from '../../common/utils/branch-scope.util';
import { ManufacturingStage } from './entities/manufacturing-stage.entity';
import { ManufacturingOrderStage, OrderStageStatus } from './entities/manufacturing-order-stage.entity';
import { ManufacturingOrder } from './entities/manufacturing-order.entity';
import { ManufacturingOrderStatus } from './enums/manufacturing.enum';
import { ProductStage } from '../product/entities/product-stage.entity';
import { Product } from '../product/entities/product.entity';
import { User } from '../user/entities/user.entity';
import { CreateManufacturingStageDto, StageRouteLineDto, UpdateManufacturingStageDto } from './dto/manufacturing-stage.dto';

/** Orders whose product can still move through its stages. */
const PROGRESS_STATUSES = [ManufacturingOrderStatus.NEW, ManufacturingOrderStatus.IN_PROGRESS];

/**
 * Production stages (internal manufacturing): the master list, each product's
 * route, and the PRODUCT's progress on an order — separate from the order status.
 * Only internal orders (no factory supplier) carry stages.
 */
@Injectable()
export class ManufacturingStageService {
  constructor(
    @InjectRepository(ManufacturingStage)
    private readonly stageRepository: Repository<ManufacturingStage>,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================
  // MASTER LIST
  // =========================================================
  findAll(includeInactive = true): Promise<ManufacturingStage[]> {
    return this.stageRepository.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async create(dto: CreateManufacturingStageDto): Promise<ManufacturingStage> {
    await this.assertUniqueName(dto.name);
    const next = dto.sortOrder ?? ((await this.stageRepository.maximum('sortOrder')) ?? 0) + 1;
    return this.stageRepository.save(
      this.stageRepository.create({ ...dto, nameEn: dto.nameEn ?? null, defaultDays: dto.defaultDays ?? null, sortOrder: next, isActive: dto.isActive ?? true }),
    );
  }

  async update(id: string, dto: UpdateManufacturingStageDto): Promise<ManufacturingStage> {
    const stage = await this.stageRepository.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('مرحلة التصنيع غير موجودة');
    if (dto.name && dto.name !== stage.name) await this.assertUniqueName(dto.name, id);
    Object.assign(stage, dto);
    return this.stageRepository.save(stage);
  }

  /** Refused while a product route or an open order still uses it (deactivate instead). */
  async remove(id: string): Promise<void> {
    const stage = await this.stageRepository.findOne({ where: { id } });
    if (!stage) throw new NotFoundException('مرحلة التصنيع غير موجودة');
    const onProducts = await this.dataSource.getRepository(ProductStage).count({ where: { stageId: id } });
    if (onProducts) throw new BadRequestException(`المرحلة مستخدمة في مسار ${onProducts} منتج — أزلها منها أو اجعلها غير نشطة`);
    const onOrders = await this.dataSource.getRepository(ManufacturingOrderStage).count({ where: { stageId: id } });
    if (onOrders) throw new BadRequestException('المرحلة مستخدمة في أوامر تصنيع — اجعلها غير نشطة بدلاً من حذفها');
    await this.stageRepository.softDelete(id);
  }

  private async assertUniqueName(name: string, exceptId?: string): Promise<void> {
    const same = await this.stageRepository.findOne({ where: { name } });
    if (same && same.id !== exceptId) throw new BadRequestException(`المرحلة «${name}» موجودة بالفعل`);
  }

  // =========================================================
  // ORDER STAGES
  // =========================================================
  /** Copy the product's route onto a new internal order (joins the caller's transaction). */
  async copyFromProduct(order: ManufacturingOrder, manager: EntityManager): Promise<void> {
    await manager.getRepository(ManufacturingOrderStage).delete({ manufacturingOrderId: order.id });
    const product = await manager.getRepository(Product).findOne({ where: { id: order.productId } });
    const route = order.factorySupplierId
      ? []
      : await manager.getRepository(ProductStage).find({ where: { productId: order.productId }, order: { sequence: 'ASC' } });
    if (route.length) {
      const masters = await manager.getRepository(ManufacturingStage).find({ where: { id: In(route.map((r) => r.stageId)) }, withDeleted: true });
      const name = new Map(masters.map((s): [string, string] => [s.id, s.name]));
      await manager.getRepository(ManufacturingOrderStage).save(
        route.map((r, i) =>
          manager.getRepository(ManufacturingOrderStage).create({
            manufacturingOrderId: order.id,
            stageId: r.stageId,
            stageName: name.get(r.stageId) ?? '—',
            sequence: i + 1,
            expectedDays: r.expectedDays ?? null,
            status: OrderStageStatus.PENDING,
          }),
        ),
      );
    }
    await manager.getRepository(ManufacturingOrder).update(order.id, { stagesStrictOrder: product?.stagesStrictOrder ?? true });
    await this.refreshSummary(order.id, manager);
  }

  /**
   * Replace an order's stage list from the editor (array order = sequence). A line
   * with `id` keeps its progress; a removed line must not have started; a started
   * stage keeps its master stage.
   */
  async replaceOrderStages(order: ManufacturingOrder, lines: StageRouteLineDto[], manager: EntityManager): Promise<void> {
    if (order.factorySupplierId && lines.length) throw new BadRequestException('مراحل التصنيع للتصنيع الداخلي فقط — الأمر لدى مصنع خارجي');
    const repo = manager.getRepository(ManufacturingOrderStage);
    const current = await repo.find({ where: { manufacturingOrderId: order.id } });
    const byId = new Map(current.map((s): [string, ManufacturingOrderStage] => [s.id, s]));
    const kept = new Set(lines.map((l) => l.id).filter((v): v is string => !!v));
    for (const s of current) {
      if (!kept.has(s.id) && s.status !== OrderStageStatus.PENDING) {
        throw new BadRequestException(`لا يمكن حذف مرحلة «${s.stageName}» — بدأت بالفعل`);
      }
    }
    const masterIds = [...new Set(lines.map((l) => l.stageId))];
    const masters = masterIds.length ? await manager.getRepository(ManufacturingStage).find({ where: { id: In(masterIds) }, withDeleted: true }) : [];
    const masterById = new Map(masters.map((s): [string, ManufacturingStage] => [s.id, s]));
    if (masters.length !== masterIds.length) throw new BadRequestException('إحدى مراحل التصنيع غير موجودة');
    if (masterIds.length !== lines.length) throw new BadRequestException('المرحلة مكررة في أمر التصنيع');

    const removed = current.filter((s) => !kept.has(s.id)).map((s) => s.id);
    if (removed.length) await repo.delete({ manufacturingOrderId: order.id, id: In(removed) });
    const rows = lines.map((l, i) => {
      const existing = l.id ? byId.get(l.id) : undefined;
      if (l.id && !existing) throw new BadRequestException('سطر مرحلة غير موجود في هذا الأمر');
      if (existing && existing.status !== OrderStageStatus.PENDING && existing.stageId !== l.stageId) {
        throw new BadRequestException(`لا يمكن تغيير مرحلة «${existing.stageName}» بعد بدئها`);
      }
      const row = existing ?? repo.create({ manufacturingOrderId: order.id, status: OrderStageStatus.PENDING });
      row.stageId = l.stageId;
      row.stageName = existing && existing.status !== OrderStageStatus.PENDING ? existing.stageName : masterById.get(l.stageId)!.name;
      row.sequence = i + 1;
      row.expectedDays = l.expectedDays ?? null;
      return row;
    });
    if (rows.length) await repo.save(rows);
    await this.refreshSummary(order.id, manager);
  }

  /** The order went to a factory: drop its (unstarted) stages. Back in-house: copy the route. */
  async onFactoryChanged(order: ManufacturingOrder, manager: EntityManager): Promise<void> {
    if (order.factorySupplierId) {
      const started = await manager.getRepository(ManufacturingOrderStage).count({ where: { manufacturingOrderId: order.id, status: In([OrderStageStatus.IN_PROGRESS, OrderStageStatus.DONE]) } });
      if (started) throw new BadRequestException('بدأت مراحل التصنيع الداخلي لهذا الأمر — لا يمكن تحويله لمصنع خارجي');
      await manager.getRepository(ManufacturingOrderStage).delete({ manufacturingOrderId: order.id });
      await this.refreshSummary(order.id, manager);
    } else {
      const any = await manager.getRepository(ManufacturingOrderStage).count({ where: { manufacturingOrderId: order.id } });
      if (!any) await this.copyFromProduct(order, manager);
    }
  }

  /** An order's stages with who moved them, for the details page. */
  async listForOrder(orderId: string): Promise<Array<ManufacturingOrderStage & { startedByName: string | null; completedByName: string | null }>> {
    const rows = await this.dataSource.getRepository(ManufacturingOrderStage).find({ where: { manufacturingOrderId: orderId }, order: { sequence: 'ASC' } });
    const userIds = [...new Set(rows.flatMap((r) => [r.startedBy, r.completedBy]).filter((v): v is string => !!v))];
    const users = userIds.length ? await this.dataSource.getRepository(User).find({ where: { id: In(userIds) } }) : [];
    const name = new Map(users.map((u): [string, string] => [u.id, u.fullName]));
    return rows.map((r) => ({ ...r, startedByName: r.startedBy ? name.get(r.startedBy) ?? null : null, completedByName: r.completedBy ? name.get(r.completedBy) ?? null : null }));
  }

  // =========================================================
  // PROGRESS (operations supervisor)
  // =========================================================
  async start(orderId: string, stageRowId: string, notes: string | null | undefined, actorId?: string, branchScope: BranchScope = null) {
    return this.move(orderId, stageRowId, 'start', notes, actorId, branchScope);
  }

  async complete(orderId: string, stageRowId: string, notes: string | null | undefined, actorId?: string, branchScope: BranchScope = null) {
    return this.move(orderId, stageRowId, 'complete', notes, actorId, branchScope);
  }

  /** Undo the last move on a stage (done → in progress, in progress → not started). */
  async undo(orderId: string, stageRowId: string, notes: string | null | undefined, actorId?: string, branchScope: BranchScope = null) {
    return this.move(orderId, stageRowId, 'undo', notes, actorId, branchScope);
  }

  private async move(
    orderId: string,
    stageRowId: string,
    action: 'start' | 'complete' | 'undo',
    notes: string | null | undefined,
    actorId: string | undefined,
    branchScope: BranchScope,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.getRepository(ManufacturingOrder).findOne({ where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || !isWithinBranchScope(order.branchId, branchScope)) throw new NotFoundException('لم يتم العثور على أمر التصنيع');
      if (!PROGRESS_STATUSES.includes(order.status)) {
        throw new BadRequestException('لا يمكن تحديث مراحل أمر تم إنتاجه أو منتهٍ أو ملغى');
      }
      const repo = manager.getRepository(ManufacturingOrderStage);
      const stages = await repo.find({ where: { manufacturingOrderId: orderId }, order: { sequence: 'ASC' } });
      const stage = stages.find((s) => s.id === stageRowId);
      if (!stage) throw new NotFoundException('المرحلة غير موجودة في هذا الأمر');
      const before = stages.filter((s) => s.sequence < stage.sequence);
      const after = stages.filter((s) => s.sequence > stage.sequence);
      const now = new Date();

      if (action === 'start' || action === 'complete') {
        if (stage.status === OrderStageStatus.DONE) throw new BadRequestException(`مرحلة «${stage.stageName}» تمت بالفعل`);
        if (action === 'start' && stage.status === OrderStageStatus.IN_PROGRESS) throw new BadRequestException(`مرحلة «${stage.stageName}» جارية بالفعل`);
        // Strict route: every earlier stage must be done first.
        const open = before.find((s) => s.status !== OrderStageStatus.DONE);
        if (order.stagesStrictOrder && open) {
          throw new BadRequestException(`الترتيب إجباري — أنهِ مرحلة «${open.stageName}» أولاً`);
        }
        if (stage.status === OrderStageStatus.PENDING) {
          stage.status = OrderStageStatus.IN_PROGRESS;
          stage.startedAt = now;
          stage.startedBy = actorId ?? null;
        }
        if (action === 'complete') {
          stage.status = OrderStageStatus.DONE;
          stage.completedAt = now;
          stage.completedBy = actorId ?? null;
        }
      } else {
        if (stage.status === OrderStageStatus.PENDING) throw new BadRequestException(`مرحلة «${stage.stageName}» لم تبدأ بعد`);
        // Strict route: a stage can't go back while a later one has started.
        const later = after.find((s) => s.status !== OrderStageStatus.PENDING);
        if (order.stagesStrictOrder && later) {
          throw new BadRequestException(`الترتيب إجباري — تراجع عن مرحلة «${later.stageName}» أولاً`);
        }
        if (stage.status === OrderStageStatus.DONE) {
          stage.status = OrderStageStatus.IN_PROGRESS;
          stage.completedAt = null;
          stage.completedBy = null;
        } else {
          stage.status = OrderStageStatus.PENDING;
          stage.startedAt = null;
          stage.startedBy = null;
        }
      }
      if (notes !== undefined && notes !== null && notes.trim()) {
        stage.notes = [stage.notes, notes.trim()].filter(Boolean).join(' — ');
      }
      await repo.save(stage);
      await this.refreshSummary(orderId, manager);
      return manager.getRepository(ManufacturingOrder).findOne({ where: { id: orderId } });
    });
  }

  /** Refuse producing while a stage is not done (called by produce()). */
  async assertAllDone(orderId: string, manager: EntityManager): Promise<void> {
    const open = await manager.getRepository(ManufacturingOrderStage).find({
      where: { manufacturingOrderId: orderId, status: In([OrderStageStatus.PENDING, OrderStageStatus.IN_PROGRESS]) },
      order: { sequence: 'ASC' },
    });
    if (open.length) {
      throw new BadRequestException(`لم تكتمل مراحل التصنيع — المتبقي: ${open.map((s) => s.stageName).join('، ')}`);
    }
  }

  /** Keep the order's «current stage» summary in step with its stage rows. */
  async refreshSummary(orderId: string, manager: EntityManager): Promise<void> {
    const stages = await manager.getRepository(ManufacturingOrderStage).find({ where: { manufacturingOrderId: orderId }, order: { sequence: 'ASC' } });
    const done = stages.filter((s) => s.status === OrderStageStatus.DONE).length;
    const current = stages.find((s) => s.status === OrderStageStatus.IN_PROGRESS) ?? stages.find((s) => s.status === OrderStageStatus.PENDING) ?? null;
    await manager.getRepository(ManufacturingOrder).update(orderId, {
      stagesTotal: stages.length,
      stagesDone: done,
      currentStageId: current?.stageId ?? null,
      currentStageName: current?.stageName ?? null,
      currentStageStatus: !stages.length ? null : current ? current.status : OrderStageStatus.DONE,
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { InventoryAdjustment } from './entities/inventory-adjustment.entity';
import {
  AdjustmentType,
  InventoryAdjustmentStatus,
} from './enums/inventory-adjustment.enum';
import { ReverseInventoryAdjustmentDto } from './dto/reverse-inventory-adjustment.dto';
import { Product } from '../product/entities/product.entity';
import { ProductType } from '../product/enums/product-type.enum';
import { AccountingSetting } from '../accounting-setting/entities/accounting-setting.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { AccountingPeriod } from '../accounting-period/entities/accounting-period.entity';
import { StockLineInput, StockService } from '../stock/stock.service';
import { StockMovementType } from '../stock/enums/stock.enum';
import { SequenceService } from '../sequence/sequence.service';
import {
  JournalEntryService,
  JournalLineInput,
} from '../journal-entry/journal-entry.service';
import { JournalSourceType } from '../journal-entry/enums/journal-entry.enum';

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Stock + accounting side-effects of an inventory adjustment. On posting, in one
 * transaction: each INCREASE line receives stock at its entered cost, each
 * DECREASE line issues stock at its current weighted-average cost, and one
 * balanced journal posts against the inventory-adjustment account.
 */
@Injectable()
export class InventoryAdjustmentPostingService {
  constructor(
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
    private readonly journalService: JournalEntryService,
    private readonly dataSource: DataSource,
  ) {}

  async post(id: string, actorId?: string): Promise<InventoryAdjustment> {
    return this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lock(manager, id);
      if (adjustment.status !== InventoryAdjustmentStatus.DRAFT) {
        throw new BadRequestException('لا يمكن ترحيل تسوية غير مسودة');
      }
      if (!adjustment.items?.length) throw new BadRequestException('لا يمكن ترحيل تسوية بدون أصناف');

      const { fiscalYear } = await this.assertOpenPostingContext(
        adjustment.fiscalYearId, adjustment.accountingPeriodId, adjustment.adjustmentDate, manager,
      );
      const settings = await manager.getRepository(AccountingSetting).findOne({ where: {} });
      if (!settings) throw new BadRequestException('يجب ضبط إعدادات المحاسبة أولاً');
      if (!settings.inventoryAdjustmentAccountId) {
        throw new BadRequestException('حساب تسويات المخزون غير محدد في إعدادات المحاسبة');
      }

      const products = await this.loadProducts(adjustment.items.map((i) => i.productId), manager);
      for (const item of adjustment.items) {
        const product = products.get(item.productId);
        if (!product) throw new BadRequestException('أحد المنتجات غير موجود');
        if (!this.resolveInventoryAccount(product, settings)) {
          throw new BadRequestException(`حساب المخزون للمنتج "${product.name}" غير محدد`);
        }
      }

      const number = await this.sequenceService.nextDocumentNumber('ADJ', fiscalYear, manager);

      // Apply stock per line, capturing DECREASE cost from the live average.
      for (const item of adjustment.items) {
        const line: StockLineInput = {
          warehouseId: adjustment.warehouseId,
          productId: item.productId,
          productName: item.productName ?? undefined,
          quantity: item.quantity,
          unitCost: item.unitCost,
        };
        if (item.adjustmentType === AdjustmentType.INCREASE) {
          await this.stockService.receive([line], manager, this.opts(number, adjustment, actorId));
        } else {
          const issued = await this.stockService.issue([line], manager, {
            ...this.opts(number, adjustment, actorId),
            allowNegative: true,
          });
          item.unitCost = issued[0].unitCost;
          item.lineValue = issued[0].totalCost;
        }
      }

      const totalValue = round2(
        adjustment.items.reduce(
          (s, i) => s + (i.adjustmentType === AdjustmentType.INCREASE ? i.lineValue : -i.lineValue),
          0,
        ),
      );

      const lines = this.buildJournalLines(adjustment, products, settings);
      const journalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.INVENTORY_ADJUSTMENT,
          sourceId: adjustment.id,
          sourceNumber: number,
          entryDate: adjustment.adjustmentDate,
          fiscalYearId: adjustment.fiscalYearId,
          accountingPeriodId: adjustment.accountingPeriodId,
          branchId: adjustment.branchId,
          description: `تسوية مخزون ${number}`,
          lines,
          actorId,
        },
        manager,
      );

      adjustment.adjustmentNumber = number;
      adjustment.status = InventoryAdjustmentStatus.POSTED;
      adjustment.totalValue = totalValue;
      adjustment.journalEntryId = journalEntry.id;
      adjustment.postedAt = new Date();
      adjustment.postedBy = actorId ?? null;
      adjustment.updatedBy = actorId ?? null;

      await manager.getRepository(InventoryAdjustment).save(adjustment);
      return this.reload(manager, id);
    });
  }

  async reverse(id: string, dto: ReverseInventoryAdjustmentDto, actorId?: string): Promise<InventoryAdjustment> {
    return this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lock(manager, id);
      if (adjustment.status === InventoryAdjustmentStatus.REVERSED) {
        throw new ConflictException('التسوية معكوسة بالفعل');
      }
      if (adjustment.status !== InventoryAdjustmentStatus.POSTED) {
        throw new BadRequestException('لا يمكن عكس تسوية غير مُرحّلة');
      }
      const period = await this.getOpenPeriod(dto.accountingPeriodId, manager);
      this.assertDateWithin(dto.reversalDate, period.startDate, period.endDate,
        'تاريخ العكس خارج نطاق الفترة المحاسبية المختارة');

      const original = adjustment.journalEntryId
        ? await this.journalService.findWithLines(adjustment.journalEntryId)
        : null;
      if (!original) throw new BadRequestException('تعذّر إيجاد القيد الأصلي للتسوية');

      // Reverse stock: undo each line at its original cost.
      for (const item of adjustment.items) {
        const line: StockLineInput = {
          warehouseId: adjustment.warehouseId,
          productId: item.productId,
          productName: item.productName ?? undefined,
          quantity: item.quantity,
          unitCost: item.unitCost,
        };
        if (item.adjustmentType === AdjustmentType.INCREASE) {
          await this.stockService.issue([line], manager, {
            ...this.opts(adjustment.adjustmentNumber, adjustment, actorId, dto.reversalDate),
            allowNegative: true,
          });
        } else {
          await this.stockService.receive([line], manager,
            this.opts(adjustment.adjustmentNumber, adjustment, actorId, dto.reversalDate));
        }
      }

      const reversalLines: JournalLineInput[] = original.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.credit,
        credit: l.debit,
        description: l.description ? `عكس: ${l.description}` : 'عكس تسوية مخزون',
      }));
      const reversalEntry = await this.journalService.createSystemJournalEntry(
        {
          sourceType: JournalSourceType.INVENTORY_ADJUSTMENT,
          sourceId: adjustment.id,
          sourceNumber: adjustment.adjustmentNumber,
          entryDate: dto.reversalDate,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: period.id,
          branchId: adjustment.branchId,
          description: `عكس تسوية مخزون ${adjustment.adjustmentNumber ?? ''} — ${dto.reason}`,
          reversalOfJournalEntryId: original.id,
          lines: reversalLines,
          actorId,
        },
        manager,
      );
      await this.journalService.markEntryReversed(original.id, reversalEntry.id, dto.reason, actorId, manager);

      adjustment.status = InventoryAdjustmentStatus.REVERSED;
      adjustment.reversedAt = new Date();
      adjustment.reversedBy = actorId ?? null;
      adjustment.reversalReason = dto.reason;
      adjustment.reversalJournalEntryId = reversalEntry.id;
      adjustment.updatedBy = actorId ?? null;

      await manager.getRepository(InventoryAdjustment).save(adjustment);
      return this.reload(manager, id);
    });
  }

  // =========================================================
  // ACCOUNTING
  // =========================================================
  private buildJournalLines(
    adjustment: InventoryAdjustment,
    products: Map<string, Product>,
    settings: AccountingSetting,
  ): JournalLineInput[] {
    const acc = new Map<string, { debit: number; credit: number }>();
    const add = (accountId: string, debit: number, credit: number): void => {
      const e = acc.get(accountId) ?? { debit: 0, credit: 0 };
      e.debit = round2(e.debit + debit);
      e.credit = round2(e.credit + credit);
      acc.set(accountId, e);
    };
    const adjAccount = settings.inventoryAdjustmentAccountId!;
    for (const item of adjustment.items) {
      const inv = this.resolveInventoryAccount(products.get(item.productId)!, settings)!;
      if (item.adjustmentType === AdjustmentType.INCREASE) {
        add(inv, item.lineValue, 0);
        add(adjAccount, 0, item.lineValue);
      } else {
        add(adjAccount, item.lineValue, 0);
        add(inv, 0, item.lineValue);
      }
    }
    return [...acc.entries()]
      .map(([accountId, e]) => {
        const net = round2(e.debit - e.credit);
        return net >= 0
          ? { accountId, debit: net, credit: 0 }
          : { accountId, debit: 0, credit: round2(-net) };
      })
      .filter((l) => l.debit > 0 || l.credit > 0);
  }

  private resolveInventoryAccount(product: Product, settings: AccountingSetting): string | null {
    if (product.inventoryAccountId) return product.inventoryAccountId;
    return product.productType === ProductType.RAW_MATERIAL
      ? settings.rawMaterialInventoryAccountId
      : settings.finishedGoodsInventoryAccountId;
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private opts(
    number: string | null,
    adjustment: InventoryAdjustment,
    actorId?: string,
    date?: string,
  ) {
    return {
      movementType: StockMovementType.ADJUSTMENT,
      sourceType: JournalSourceType.INVENTORY_ADJUSTMENT,
      sourceId: adjustment.id,
      sourceNumber: number,
      movementDate: date ?? adjustment.adjustmentDate,
      actorId,
    };
  }

  private async lock(manager: EntityManager, id: string): Promise<InventoryAdjustment> {
    const a = await manager.findOne(InventoryAdjustment, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
      lock: { mode: 'pessimistic_write' },
    });
    if (!a) throw new NotFoundException('لم يتم العثور على تسوية المخزون');
    return a;
  }

  private reload(manager: EntityManager, id: string): Promise<InventoryAdjustment> {
    return manager.findOne(InventoryAdjustment, {
      where: { id },
      relations: { items: true },
      order: { items: { lineNumber: 'ASC' } },
    }) as Promise<InventoryAdjustment>;
  }

  private async loadProducts(ids: string[], manager: EntityManager): Promise<Map<string, Product>> {
    const unique = [...new Set(ids)];
    const rows = unique.length
      ? await manager.getRepository(Product).find({ where: { id: In(unique) } })
      : [];
    return new Map(rows.map((p): [string, Product] => [p.id, p]));
  }

  private async assertOpenPostingContext(
    fiscalYearId: string,
    accountingPeriodId: string,
    entryDate: string,
    manager: EntityManager,
  ): Promise<{ fiscalYear: FiscalYear; period: AccountingPeriod }> {
    const fiscalYear = await manager.getRepository(FiscalYear).findOne({ where: { id: fiscalYearId } });
    if (!fiscalYear) throw new NotFoundException('السنة المالية غير موجودة');
    if (fiscalYear.isClosed) throw new BadRequestException('السنة المالية مغلقة');
    const period = await manager.getRepository(AccountingPeriod).findOne({ where: { id: accountingPeriodId } });
    if (!period) throw new NotFoundException('الفترة المحاسبية غير موجودة');
    if (period.fiscalYearId !== fiscalYear.id) {
      throw new BadRequestException('الفترة المحاسبية لا تتبع السنة المالية المختارة');
    }
    if (period.isClosed) throw new BadRequestException('لا يمكن الترحيل إلى فترة محاسبية مغلقة');
    this.assertDateWithin(entryDate, period.startDate, period.endDate, 'تاريخ التسوية خارج نطاق الفترة المحاسبية');
    return { fiscalYear, period };
  }

  private async getOpenPeriod(id: string, manager: EntityManager): Promise<AccountingPeriod> {
    const period = await manager.getRepository(AccountingPeriod).findOne({ where: { id } });
    if (!period) throw new NotFoundException('الفترة المحاسبية للعكس غير موجودة');
    if (period.isClosed) throw new BadRequestException('الفترة المحاسبية للعكس مغلقة، يرجى اختيار فترة مفتوحة');
    return period;
  }

  private assertDateWithin(date: string, start: string, end: string, message: string): void {
    const d = new Date(date).getTime();
    if (d < new Date(start).getTime() || d > new Date(end).getTime()) {
      throw new BadRequestException(message);
    }
  }
}

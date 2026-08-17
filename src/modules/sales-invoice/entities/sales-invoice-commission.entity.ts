import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { SalesCommissionType } from '../enums/sales-invoice.enum';
import { SalesInvoice } from './sales-invoice.entity';

/**
 * One employee's sales commission on an invoice. `value` is what the user
 * entered (a percentage or a fixed amount); `amount` is the resolved commission
 * — for a percentage it is computed on the invoice's taxable (net-before-VAT)
 * total. On posting, the total commission posts DR commission-expense / CR
 * commission-payable in the invoice's journal entry.
 */
@Entity('sales_invoice_commissions')
export class SalesInvoiceCommission extends BaseEntity {
  @ManyToOne(() => SalesInvoice, (invoice) => invoice.commissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sales_invoice_id' })
  salesInvoice!: SalesInvoice;

  @Column({ type: 'uuid' })
  salesInvoiceId!: string;

  @Column({ type: 'int', default: 1 })
  lineNumber!: number;

  @Column({ type: 'uuid' })
  employeeId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  employeeName!: string | null;

  @Column({ type: 'enum', enum: SalesCommissionType, default: SalesCommissionType.PERCENTAGE })
  commissionType!: SalesCommissionType;

  /** The entered percentage (e.g. 2.5) or fixed amount. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  value!: number;

  /** Resolved commission amount. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  amount!: number;
}

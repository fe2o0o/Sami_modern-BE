import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { SalesCommissionType } from '../../sales-invoice/enums/sales-invoice.enum';

/**
 * The share of one employee's invoice commission taken back by a POSTED sales
 * return (created when the return posts; the return's status decides whether it
 * counts — a reversed return no longer does).
 *  - percentage commission: rate × returned product net (services excluded, like the invoice base);
 *  - fixed commission:      nothing until the invoice's products are all returned, then the whole amount.
 * Dated by the return (the deduction lands in the month the return is posted).
 * The return's journal books it: DR commission payable / CR commission expense.
 */
@Entity('sales_return_commissions')
export class SalesReturnCommission extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  salesReturnId!: string;

  @Index()
  @Column({ type: 'uuid' })
  salesInvoiceId!: string;

  /** The invoice commission line this reduces. */
  @Column({ type: 'uuid' })
  salesInvoiceCommissionId!: string;

  @Index()
  @Column({ type: 'uuid' })
  employeeId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  employeeName!: string | null;

  @Column({ type: 'enum', enum: SalesCommissionType, default: SalesCommissionType.PERCENTAGE })
  commissionType!: SalesCommissionType;

  /** Percentage entered / fixed amount on the invoice line. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  value!: number;

  /** Returned product net (the commission base taken back by this return). */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  returnedBase!: number;

  /** Commission taken back. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  amount!: number;
}

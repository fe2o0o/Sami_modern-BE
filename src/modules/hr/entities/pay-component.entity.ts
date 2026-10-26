import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';
import { PayCalcType, PayComponentType } from '../enums/hr.enum';

/**
 * Salary building block defined once (basic, transport allowance, insurance…).
 * Exactly one component is the BASIC one; percentages are computed from it.
 */
@Entity('pay_components')
export class PayComponent extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'enum', enum: PayComponentType })
  componentType!: PayComponentType;

  @Column({ type: 'enum', enum: PayCalcType, default: PayCalcType.FIXED })
  calcType!: PayCalcType;

  /** Suggested amount (or %) when the component is added to a package. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  defaultValue!: number;

  /** Optional GL account override for payroll posting (falls back to the salaries settings). */
  @Column({ type: 'varchar', length: 36, nullable: true })
  accountId!: string | null;

  @Column({ type: 'boolean', default: false })
  isBasic!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}

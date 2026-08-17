import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { numericTransformer } from '../../../shared/transformers/numeric.transformer';

/** Employee master — basic data, net salary, and a default sales-commission rate. */
@Entity('employees')
export class Employee extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  mobile!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  nationalId!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  jobTitle!: string | null;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  @Column({ type: 'date', nullable: true })
  hireDate!: string | null;

  /** Net monthly salary. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0, transformer: numericTransformer })
  netSalary!: number;

  /** Default sales-commission percentage (e.g. 2.5 = 2.5%) pre-filled on invoices. */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0, transformer: numericTransformer })
  commissionRate!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}

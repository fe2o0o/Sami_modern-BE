import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Branch } from '../../branch/entities/branch.entity';

/**
 * The single company record for the whole system (Sami Furniture).
 * There is exactly ONE row — no create/delete/list, only view + update.
 */
@Entity('companies')
export class Company extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true, nullable: true })
  code!: string | null;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  legalName!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  commercialRegistration!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  taxNumber!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  vatNumber!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  mobile!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  website!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  postalCode!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'EGP' })
  currency!: string;

  @Column({ type: 'varchar', length: 10, default: 'ar' })
  language!: string;

  @Column({ type: 'varchar', length: 60, default: 'Africa/Cairo' })
  timezone!: string;

  /** Fiscal year start as MM-DD (e.g. "01-01"). */
  @Column({ type: 'varchar', length: 10, default: '01-01' })
  fiscalYearStart!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  logo!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => Branch, (branch) => branch.company)
  branches!: Branch[];
}

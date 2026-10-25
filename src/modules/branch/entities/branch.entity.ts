import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Company } from '../../company/entities/company.entity';
import { Warehouse } from '../../warehouse/entities/warehouse.entity';
import { Employee } from '../../employee/entities/employee.entity';

@Entity('branches')
export class Branch extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** Display snapshot of the manager's name (kept in sync with `managerEmployee`). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  managerName!: string | null;

  /** Manager = an employee (links branches/warehouses to HR). */
  @ManyToOne(() => Employee, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'manager_employee_id' })
  managerEmployee!: Employee | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  managerEmployeeId!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  mobile!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude!: number | null;

  @Column({ type: 'boolean', default: false })
  isMain!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // =========================
  // RELATIONS
  // =========================
  @ManyToOne(() => Company, (company) => company.branches, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'company_id' })
  company!: Company;

  @Column({ type: 'uuid' })
  companyId!: string;

  @OneToMany(() => Warehouse, (warehouse) => warehouse.branch)
  warehouses!: Warehouse[];
}

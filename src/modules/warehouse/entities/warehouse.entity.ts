import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Branch } from '../../branch/entities/branch.entity';
import { Employee } from '../../employee/entities/employee.entity';
import { WarehouseType } from '../enums/warehouse-type.enum';

@Entity('warehouses')
export class Warehouse extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({
    type: 'enum',
    enum: WarehouseType,
    default: WarehouseType.STORE,
  })
  type!: WarehouseType;

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

  @Column({ type: 'varchar', length: 255, nullable: true })
  email!: string | null;

  @Column({ type: 'text', nullable: true })
  address!: string | null;

  @Column({ type: 'boolean', default: false })
  allowNegativeStock!: boolean;

  @Column({ type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // =========================
  // RELATIONS
  // =========================
  // A warehouse may be unassigned to any branch (a central/shared warehouse).
  @ManyToOne(() => Branch, (branch) => branch.warehouses, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch | null;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;
}

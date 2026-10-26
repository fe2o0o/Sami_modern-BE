import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Employee } from '../../employee/entities/employee.entity';

/** Company-wide department (Sales, Warehouse, Accounts, Manufacturing…). */
@Entity('departments')
export class Department extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @ManyToOne(() => Employee, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'manager_employee_id' })
  managerEmployee!: Employee | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  managerEmployeeId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}

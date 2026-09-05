import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Branch } from '../../branch/entities/branch.entity';
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

  @Column({ type: 'varchar', length: 255, nullable: true })
  managerName!: string | null;

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

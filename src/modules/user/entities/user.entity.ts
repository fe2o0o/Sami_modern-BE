import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Role } from '../../role/entities/role.entity';
import { Branch } from '../../branch/entities/branch.entity';

/**
 * Application user (login account).
 *
 * Password and refreshToken are stored hashed and never selected by default
 * (`select: false`) — they must be explicitly added via a query builder.
 */
@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 50, nullable: true })
  employeeNumber!: string | null;

  @Column({ type: 'varchar', length: 255 })
  fullName!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  username!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', length: 255, select: false })
  password!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar!: string | null;

  // =========================
  // STATUS
  // =========================
  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', default: false })
  isLocked!: boolean;

  @Column({ type: 'datetime', nullable: true })
  lastLogin!: Date | null;

  /** Hashed refresh token — never returned. Null when logged out. */
  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  refreshToken!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  // =========================
  // RELATIONS
  // =========================
  @ManyToOne(() => Role, (role) => role.users, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @Column({ type: 'uuid' })
  roleId!: string;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branch_id' })
  branch!: Branch | null;

  @Column({ type: 'uuid', nullable: true })
  branchId!: string | null;

  // =========================
  // AUDIT (who)
  // =========================
  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}

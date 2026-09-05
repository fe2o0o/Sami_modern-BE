import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../../role/entities/role.entity';

/**
 * One permission key granted to a role. A role's full permission set is the
 * collection of its rows here. Kept as a lean join table (no soft-delete /
 * versioning) so a role's permissions can be replaced by a plain delete+insert.
 */
@Entity('role_permissions')
@Index('uq_role_permission', ['roleId', 'permissionKey'], { unique: true })
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @Column({ type: 'uuid' })
  roleId!: string;

  /** A `<module>.<action>` key from the permission catalog. */
  @Column({ type: 'varchar', length: 100 })
  permissionKey!: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}

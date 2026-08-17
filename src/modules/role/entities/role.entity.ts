import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { User } from '../../user/entities/user.entity';

@Entity('roles')
export class Role extends BaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nameEn!: string | null;

  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** System roles cannot be deleted from the UI. */
  @Column({ type: 'boolean', default: false })
  isSystem!: boolean;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => User, (user) => user.role)
  users!: User[];
}

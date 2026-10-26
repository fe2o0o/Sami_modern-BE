import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';

/**
 * Job grade — a node of the organisation hierarchy (org chart). Each grade may
 * report to a parent grade; `level` = depth (1 = top), recomputed on every change.
 */
@Entity('job_grades')
export class JobGrade extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  nameEn!: string | null;

  @ManyToOne(() => JobGrade, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parent_id' })
  parent!: JobGrade | null;

  @Index()
  @Column({ type: 'varchar', length: 36, nullable: true })
  parentId!: string | null;

  @Column({ type: 'int', default: 1 })
  level!: number;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}

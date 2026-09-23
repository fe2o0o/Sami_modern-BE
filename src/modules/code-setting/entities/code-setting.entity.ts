import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Per-entity code-generation configuration. One row per code-bearing master-data
 * entity (see CODE_ENTITIES). When `autoGenerate` is on, the entity's `code` is
 * assigned by the system as `<prefix>-<nextNumber padded to `padding`>`, and
 * `nextNumber` is bumped atomically on each generation.
 */
@Entity('code_settings')
export class CodeSetting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('uq_code_setting_entity', { unique: true })
  @Column({ type: 'varchar', length: 50 })
  entityKey!: string;

  @Column({ type: 'boolean', default: true })
  autoGenerate!: boolean;

  @Column({ type: 'varchar', length: 20, default: '' })
  prefix!: string;

  @Column({ type: 'int', default: 4 })
  padding!: number;

  @Column({ type: 'int', default: 1 })
  nextNumber!: number;
}

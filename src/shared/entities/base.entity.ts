import { ApiProperty } from '@nestjs/swagger';
import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

/**
 * Base class every entity extends.
 *
 * Provides a UUID primary key, audit timestamps, optimistic-locking version
 * and soft-delete support. No table is created from this class directly —
 * concrete entities (added later) inherit these columns.
 */
export abstract class BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @ApiProperty({ required: false, nullable: true })
  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date | null;

  @ApiProperty()
  @VersionColumn({ default: 1 })
  version!: number;
}

import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../shared/entities/base.entity';
import { Employee } from '../../employee/entities/employee.entity';
import { EmployeeDocumentType } from '../enums/hr.enum';

/**
 * A scanned document of an employee. The file lives in the PRIVATE storage
 * folder (not the public /uploads) and is only served through an authenticated,
 * permission-checked endpoint.
 */
@Entity('employee_documents')
export class EmployeeDocument extends BaseEntity {
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Index()
  @Column({ type: 'varchar', length: 36 })
  employeeId!: string;

  @Column({ type: 'enum', enum: EmployeeDocumentType, default: EmployeeDocumentType.OTHER })
  documentType!: EmployeeDocumentType;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  /** Original file name as uploaded. */
  @Column({ type: 'varchar', length: 255 })
  originalName!: string;

  /** Stored file name inside the employee's private folder. */
  @Column({ type: 'varchar', length: 255 })
  storedName!: string;

  @Column({ type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ type: 'int', default: 0 })
  sizeBytes!: number;

  @Column({ type: 'date', nullable: true })
  expiryDate!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdBy!: string | null;
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { Employee } from '../employee/entities/employee.entity';
import { EmployeeStatusChange } from './entities/employee-status-change.entity';
import { EmployeeDocument } from './entities/employee-document.entity';
import { ChangeEmployeeStatusDto, UploadEmployeeDocumentDto } from './dto/employee-hr.dto';
import { EMPLOYMENT_STATUS_LABELS, EmployeeDocumentType, EmploymentStatus, EXIT_STATUSES } from './enums/hr.enum';

/**
 * PRIVATE storage root — deliberately NOT under the public `/uploads` static
 * folder: ID cards and contracts are only served through an authenticated,
 * permission-checked endpoint. Include it in server backups.
 */
export const HR_STORAGE_ROOT = join(process.cwd(), 'storage', 'employees');

export const DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface UploadedHrFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredFile {
  path: string;
  mimeType: string;
  fileName: string;
}

/** Days before expiry at which a document is flagged. */
export const DOCUMENT_EXPIRY_WARNING_DAYS = 30;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
};

/** Employee HR actions: status lifecycle, documents and photo. */
@Injectable()
export class EmployeeHrService {
  constructor(
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(EmployeeStatusChange) private readonly statusChanges: Repository<EmployeeStatusChange>,
    @InjectRepository(EmployeeDocument) private readonly documents: Repository<EmployeeDocument>,
    private readonly dataSource: DataSource,
  ) {}

  private async employee(id: string): Promise<Employee> {
    const e = await this.employees.findOne({ where: { id } });
    if (!e) throw new NotFoundException('لم يتم العثور على الموظف');
    return e;
  }

  // ── status lifecycle ───────────────────────────────────
  /**
   * Move to another status with a date and reason; a history row is written.
   * Resigned / terminated stay in the system (reports, old invoices) but leave
   * the pickers after their exit date; `isActive` follows the status.
   */
  async changeStatus(id: string, dto: ChangeEmployeeStatusDto, actorId?: string | null): Promise<Employee> {
    return this.dataSource.transaction(async (manager) => {
      const employee = await manager.findOne(Employee, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!employee) throw new NotFoundException('لم يتم العثور على الموظف');
      if (employee.employmentStatus === dto.status) {
        throw new BadRequestException(`الموظف بالفعل في حالة «${EMPLOYMENT_STATUS_LABELS[dto.status]}»`);
      }
      const exiting = EXIT_STATUSES.includes(dto.status);
      if (exiting && !dto.reason?.trim()) throw new BadRequestException('سبب ترك العمل مطلوب');
      if (exiting && employee.hireDate && dto.effectiveDate < employee.hireDate) {
        throw new BadRequestException('تاريخ ترك العمل لا يمكن أن يكون قبل تاريخ التعيين');
      }

      await manager.getRepository(EmployeeStatusChange).save(
        manager.getRepository(EmployeeStatusChange).create({
          employeeId: id,
          fromStatus: employee.employmentStatus,
          toStatus: dto.status,
          effectiveDate: dto.effectiveDate,
          reason: dto.reason?.trim() || null,
          createdBy: actorId ?? null,
        }),
      );
      employee.employmentStatus = dto.status;
      employee.exitDate = exiting ? dto.effectiveDate : null;
      employee.exitReason = exiting ? dto.reason!.trim() : null;
      employee.isActive = !exiting;
      return manager.getRepository(Employee).save(employee);
    });
  }

  async statusHistory(id: string): Promise<EmployeeStatusChange[]> {
    await this.employee(id);
    return this.statusChanges.find({ where: { employeeId: id }, order: { createdAt: 'DESC' } });
  }

  // ── documents ──────────────────────────────────────────
  async listDocuments(id: string) {
    await this.employee(id);
    const docs = await this.documents.find({ where: { employeeId: id }, order: { createdAt: 'DESC' } });
    return docs.map((d) => this.withExpiry(d));
  }

  async uploadDocument(id: string, file: UploadedHrFile | undefined, dto: UploadEmployeeDocumentDto, actorId?: string | null) {
    await this.employee(id);
    if (!file) throw new BadRequestException('اختر ملف المستند');
    if (!DOCUMENT_MIME.includes(file.mimetype)) throw new BadRequestException('صيغة المستند غير مدعومة (PDF / JPG / PNG / WEBP فقط)');
    // multer hands the multipart file name over as latin1 — restore the UTF-8 (Arabic) name
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const storedName = `${randomUUID()}${extname(file.originalname).toLowerCase() || ''}`;
    await this.writeFile(id, storedName, file.buffer);
    const doc = await this.documents.save(
      this.documents.create({
        employeeId: id,
        documentType: dto.documentType ?? EmployeeDocumentType.OTHER,
        title: dto.title?.trim() || file.originalname,
        originalName: file.originalname,
        storedName,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        expiryDate: dto.expiryDate || null,
        notes: dto.notes?.trim() || null,
        createdBy: actorId ?? null,
      }),
    );
    return this.withExpiry(doc);
  }

  async documentFile(id: string, documentId: string): Promise<StoredFile> {
    const doc = await this.documents.findOne({ where: { id: documentId, employeeId: id } });
    if (!doc) throw new NotFoundException('لم يتم العثور على المستند');
    return { path: await this.existing(id, doc.storedName), mimeType: doc.mimeType, fileName: doc.originalName };
  }

  async removeDocument(id: string, documentId: string): Promise<void> {
    const doc = await this.documents.findOne({ where: { id: documentId, employeeId: id } });
    if (!doc) throw new NotFoundException('لم يتم العثور على المستند');
    await this.documents.softDelete(doc.id);
    // the file is kept on disk with the soft-deleted row (restorable, auditable)
  }

  /** Documents expiring within the warning window (or already expired) — for cards/dashboard. */
  async expiringDocumentsCount(employeeIds?: string[]): Promise<number> {
    const limit = new Date();
    limit.setDate(limit.getDate() + DOCUMENT_EXPIRY_WARNING_DAYS);
    const qb = this.documents
      .createQueryBuilder('d')
      .innerJoin(Employee, 'e', 'e.id = d.employeeId AND e.deletedAt IS NULL AND e.isActive = 1')
      .where('d.expiryDate IS NOT NULL')
      .andWhere('d.expiryDate <= :limit', { limit: limit.toISOString().slice(0, 10) });
    if (employeeIds) {
      if (!employeeIds.length) return 0;
      qb.andWhere('d.employeeId IN (:...ids)', { ids: employeeIds });
    }
    return qb.getCount();
  }

  private withExpiry(d: EmployeeDocument) {
    let expiryState: 'none' | 'valid' | 'expiring' | 'expired' = 'none';
    if (d.expiryDate) {
      const t = today();
      const limit = new Date();
      limit.setDate(limit.getDate() + DOCUMENT_EXPIRY_WARNING_DAYS);
      expiryState = d.expiryDate < t ? 'expired' : d.expiryDate <= limit.toISOString().slice(0, 10) ? 'expiring' : 'valid';
    }
    const { storedName: _s, ...rest } = d;
    return { ...rest, expiryState };
  }

  // ── photo ──────────────────────────────────────────────
  async uploadPhoto(id: string, file: UploadedHrFile | undefined): Promise<{ hasPhoto: true }> {
    const employee = await this.employee(id);
    if (!file) throw new BadRequestException('اختر صورة الموظف');
    if (!PHOTO_MIME.includes(file.mimetype)) throw new BadRequestException('صيغة الصورة غير مدعومة (JPG / PNG / WEBP فقط)');
    const name = `photo-${randomUUID()}${extname(file.originalname).toLowerCase() || '.jpg'}`;
    await this.writeFile(id, name, file.buffer);
    const old = employee.photoName;
    await this.employees.update(id, { photoName: name });
    if (old) await fs.rm(join(HR_STORAGE_ROOT, id, old), { force: true });
    return { hasPhoto: true };
  }

  async photoFile(id: string): Promise<StoredFile> {
    const employee = await this.employee(id);
    if (!employee.photoName) throw new NotFoundException('لا توجد صورة لهذا الموظف');
    const ext = extname(employee.photoName).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { path: await this.existing(id, employee.photoName), mimeType, fileName: employee.photoName };
  }

  async removePhoto(id: string): Promise<void> {
    const employee = await this.employee(id);
    if (!employee.photoName) return;
    await fs.rm(join(HR_STORAGE_ROOT, id, employee.photoName), { force: true });
    await this.employees.update(id, { photoName: null });
  }

  // ── storage helpers ────────────────────────────────────
  private async writeFile(employeeId: string, name: string, buffer: Buffer): Promise<void> {
    const dir = join(HR_STORAGE_ROOT, employeeId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, name), buffer);
  }

  private async existing(employeeId: string, name: string): Promise<string> {
    const path = join(HR_STORAGE_ROOT, employeeId, name);
    try {
      await fs.access(path);
    } catch {
      throw new NotFoundException('الملف غير موجود على الخادم');
    }
    return path;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { BaseCrudService } from '../../common/services/base-crud.service';
import { ExcelService } from '../../common/excel/excel.service';
import { ImportRegistry } from '../../common/excel/import.registry';
import { ImportColumn, ImportResult, UploadedExcel } from '../../common/excel/excel.types';
import { str, optStr, optNum, bool } from '../../common/excel/import.helpers';

const IMPORT_COLUMNS: ImportColumn[] = [
  { field: 'code', header: 'الكود', required: true, example: 'C-001', note: 'كود فريد للعميل' },
  { field: 'name', header: 'الاسم', required: true, example: 'شركة النور' },
  { field: 'nameEn', header: 'الاسم بالإنجليزية', example: 'Al Noor Co.' },
  { field: 'mobile', header: 'الجوال', example: '01000000000' },
  { field: 'phone', header: 'الهاتف', example: '0221000000' },
  { field: 'email', header: 'البريد الإلكتروني', example: 'info@alnoor.com' },
  { field: 'taxNumber', header: 'الرقم الضريبي', example: '123-456-789' },
  { field: 'address', header: 'العنوان', example: 'شارع الجمهورية' },
  { field: 'city', header: 'المدينة', example: 'القاهرة' },
  { field: 'country', header: 'الدولة', example: 'مصر' },
  { field: 'creditLimit', header: 'حد الائتمان', type: 'number', example: 50000, note: 'رقم (افتراضي: 0)' },
  { field: 'paymentTerms', header: 'مدة السداد (أيام)', type: 'number', example: 30 },
  { field: 'notes', header: 'ملاحظات', example: '' },
  { field: 'isActive', header: 'نشط', type: 'boolean', example: 'نعم', note: 'نعم/لا (افتراضي: نعم)' },
];

@Injectable()
export class CustomerService extends BaseCrudService<Customer> {
  protected readonly alias = 'customer';
  protected readonly searchFields = ['code', 'name', 'nameEn', 'mobile', 'phone', 'email'];
  protected readonly sortableFields = ['code', 'name', 'createdAt'];
  protected readonly notFoundMessage = 'لم يتم العثور على العميل';

  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly excel: ExcelService,
    private readonly dataSource: DataSource,
    imports: ImportRegistry,
  ) {
    super(customerRepository);
    imports.register('customers', {
      templateFilename: 'customers-template',
      template: () => this.importTemplate(),
      importRows: (file) => this.importRows(file),
    });
  }

  // =========================
  // EXCEL IMPORT
  // =========================
  importTemplate(): Promise<Buffer> {
    return this.excel.buildTemplate(IMPORT_COLUMNS, {
      sheetName: 'العملاء',
      title: 'استيراد العملاء',
    });
  }

  async importRows(file: UploadedExcel): Promise<ImportResult> {
    const parsed = await this.excel.parse(file, IMPORT_COLUMNS);
    const seen = new Set<string>();
    return this.excel.runImport(this.dataSource, parsed, async (v, manager) => {
      const code = str(v.code, 'الكود');
      const key = code.toLowerCase();
      if (seen.has(key)) throw new Error(`الكود «${code}» مكرر داخل الملف`);
      seen.add(key);
      const repo = manager.getRepository(Customer);
      if (await repo.findOne({ where: { code }, withDeleted: true })) {
        throw new Error(`كود العميل «${code}» مستخدم بالفعل`);
      }
      const paymentTerms = optStr(v.paymentTerms);
      await repo.save(
        repo.create({
          code,
          name: str(v.name, 'الاسم'),
          nameEn: optStr(v.nameEn),
          mobile: optStr(v.mobile),
          phone: optStr(v.phone),
          email: optStr(v.email),
          taxNumber: optStr(v.taxNumber),
          address: optStr(v.address),
          city: optStr(v.city),
          country: optStr(v.country),
          creditLimit: optNum(v.creditLimit, 0),
          paymentTerms: paymentTerms === null ? null : optNum(v.paymentTerms, 0),
          notes: optStr(v.notes),
          isActive: bool(v.isActive, true),
        }),
      );
    });
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    await this.ensureUnique('code', dto.code, undefined, 'كود العميل مستخدم بالفعل');
    return this.customerRepository.save(this.customerRepository.create(dto));
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    const customer = await this.findOne(id);
    if (dto.code && dto.code !== customer.code) {
      await this.ensureUnique('code', dto.code, id, 'كود العميل مستخدم بالفعل');
    }
    Object.assign(customer, dto);
    return this.customerRepository.save(customer);
  }
}

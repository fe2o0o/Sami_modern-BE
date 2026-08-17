import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../branch/entities/branch.entity';
import { Warehouse } from '../warehouse/entities/warehouse.entity';
import { Role } from '../role/entities/role.entity';
import { FiscalYear } from '../fiscal-year/entities/fiscal-year.entity';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';
import { Unit } from '../unit/entities/unit.entity';
import { Brand } from '../brand/entities/brand.entity';
import { ProductCategory } from '../product-category/entities/product-category.entity';
import { Customer } from '../customer/entities/customer.entity';
import { Supplier } from '../supplier/entities/supplier.entity';
import { Employee } from '../employee/entities/employee.entity';
import { Product } from '../product/entities/product.entity';
import {
  WAREHOUSE_TYPE_LABELS,
  WarehouseType,
} from '../warehouse/enums/warehouse-type.enum';
import {
  AccountSubType,
  AccountType,
} from '../chart-of-account/enums/account.enum';

export interface LookupItem {
  id: string;
  name: string;
}

export interface WarehouseLookupItem extends LookupItem {
  branchId: string;
}

export interface EmployeeLookupItem extends LookupItem {
  code: string;
  commissionRate: number;
}

export interface WarehouseTypeLookupItem {
  value: WarehouseType;
  name: string;
}

@Injectable()
export class LookupsService {
  constructor(
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepository: Repository<FiscalYear>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    @InjectRepository(ProductCategory)
    private readonly categoryRepository: Repository<ProductCategory>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepository: Repository<Supplier>,
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  /** Active employees with their default commission rate (for invoice pickers). */
  async employees(): Promise<EmployeeLookupItem[]> {
    const rows = await this.employeeRepository.find({
      where: { isActive: true },
      select: { id: true, code: true, name: true, commissionRate: true },
      order: { name: 'ASC' },
    });
    return rows.map((e) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      commissionRate: e.commissionRate,
    }));
  }

  /** Active products labelled `code - name` (for inventory/document lines). */
  async products(): Promise<LookupItem[]> {
    const rows = await this.productRepository.find({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      order: { code: 'ASC' },
    });
    return rows.map((r) => ({ id: r.id, name: `${r.code} - ${r.name}` }));
  }

  async customers(): Promise<LookupItem[]> {
    const rows = await this.customerRepository.find({
      where: { isActive: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async suppliers(): Promise<LookupItem[]> {
    const rows = await this.supplierRepository.find({
      where: { isActive: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async units(): Promise<LookupItem[]> {
    const rows = await this.unitRepository.find({
      where: { isActive: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async brands(): Promise<LookupItem[]> {
    const rows = await this.brandRepository.find({
      where: { isActive: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async productCategories(): Promise<LookupItem[]> {
    const rows = await this.categoryRepository.find({
      where: { isActive: true },
      select: { id: true, name: true },
      order: { code: 'ASC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  /** Active leaf accounts that can receive postings. */
  async postingAccounts(): Promise<LookupItem[]> {
    const rows = await this.accountRepository.find({
      where: { allowPosting: true, isActive: true },
      select: { id: true, accountCode: true, accountNameAr: true },
      order: { accountCode: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: `${r.accountCode} - ${r.accountNameAr}`,
    }));
  }

  /** Active cash posting accounts (ASSET/CASH) — for treasury GL mapping. */
  cashAccounts(): Promise<LookupItem[]> {
    return this.classifiedAccounts(AccountType.ASSET, AccountSubType.CASH);
  }

  /** Active bank posting accounts (ASSET/BANK) — for bank-account GL mapping. */
  bankAccounts(): Promise<LookupItem[]> {
    return this.classifiedAccounts(AccountType.ASSET, AccountSubType.BANK);
  }

  private async classifiedAccounts(
    accountType: AccountType,
    accountSubType: AccountSubType,
  ): Promise<LookupItem[]> {
    const rows = await this.accountRepository.find({
      where: {
        allowPosting: true,
        isActive: true,
        isHeader: false,
        accountType,
        accountSubType,
      },
      select: { id: true, accountCode: true, accountNameAr: true },
      order: { accountCode: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: `${r.accountCode} - ${r.accountNameAr}`,
    }));
  }

  async roles(): Promise<LookupItem[]> {
    const rows = await this.roleRepository.find({
      where: { isActive: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async fiscalYears(): Promise<LookupItem[]> {
    const rows = await this.fiscalYearRepository.find({
      select: { id: true, name: true },
      order: { startDate: 'DESC' },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
  }

  async branches(): Promise<LookupItem[]> {
    const rows = await this.branchRepository.find({
      where: { isActive: true },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
    return rows.map((b) => ({ id: b.id, name: b.name }));
  }

  async warehouses(branchId?: string): Promise<WarehouseLookupItem[]> {
    const rows = await this.warehouseRepository.find({
      where: { isActive: true, ...(branchId ? { branchId } : {}) },
      select: { id: true, name: true, branchId: true },
      order: { name: 'ASC' },
    });
    return rows.map((w) => ({ id: w.id, name: w.name, branchId: w.branchId }));
  }

  warehouseTypes(): WarehouseTypeLookupItem[] {
    return Object.values(WarehouseType).map((value) => ({
      value,
      name: WAREHOUSE_TYPE_LABELS[value],
    }));
  }
}

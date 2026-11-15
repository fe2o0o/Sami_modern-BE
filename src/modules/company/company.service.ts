import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';
import { UpdateCompanyDto } from './dto/update-company.dto';

/** Public folder of the company logo (served as /uploads/company/<file>). */
const LOGO_DIR = join(process.cwd(), 'uploads', 'company');
const LOGO_URL = '/uploads/company/';
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** The Company Profile as every screen / printed document reads it (no internal fields). */
export interface CompanyProfile {
  name: string;
  nameEn: string | null;
  legalName: string | null;
  logo: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  taxNumber: string | null;
  vatNumber: string | null;
  commercialRegistration: string | null;
  currency: string;
  language: string;
  timezone: string;
  fiscalYearStart: string;
}

/**
 * Company service — single-record semantics. The ONE place company settings are
 * read from (`profile()`), so other modules never query the table directly.
 * The system always has exactly one company; there is no create/delete/list.
 */
@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
  ) {}

  /** Return the one and only company record. */
  async get(): Promise<Company> {
    const company = await this.companyRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });

    if (!company) {
      throw new NotFoundException('لم يتم العثور على بيانات الشركة');
    }

    return company;
  }

  /** Update the company record in place. */
  async update(dto: UpdateCompanyDto): Promise<Company> {
    const company = await this.get();
    // The logo has its own upload endpoint; a form save never overwrites it.
    const { logo: _logo, ...rest } = dto;
    Object.assign(company, rest);
    return this.companyRepository.save(company);
  }

  /** The Company Profile for display (any signed-in user, printed documents, the employee portal). */
  async profile(): Promise<CompanyProfile> {
    const c = await this.get();
    return {
      name: c.name,
      nameEn: c.nameEn,
      legalName: c.legalName,
      logo: c.logo,
      phone: c.phone,
      mobile: c.mobile,
      email: c.email,
      website: c.website,
      address: c.address,
      city: c.city,
      country: c.country,
      taxNumber: c.taxNumber,
      vatNumber: c.vatNumber,
      commercialRegistration: c.commercialRegistration,
      currency: c.currency,
      language: c.language,
      timezone: c.timezone,
      fiscalYearStart: c.fiscalYearStart,
    };
  }

  /** Store a new logo under /uploads/company and point the company at it. */
  async uploadLogo(file: { buffer: Buffer; mimetype: string; size: number } | undefined): Promise<Company> {
    if (!file) throw new BadRequestException('اختر صورة الشعار');
    const ext = LOGO_TYPES[file.mimetype];
    if (!ext) throw new BadRequestException('الشعار يجب أن يكون صورة PNG أو JPG أو WEBP');
    if (file.size > MAX_LOGO_BYTES) throw new BadRequestException('حجم الشعار أكبر من 2 ميجابايت');
    const company = await this.get();
    await fs.mkdir(LOGO_DIR, { recursive: true });
    const name = `logo-${Date.now()}${ext}`;
    await fs.writeFile(join(LOGO_DIR, name), file.buffer);
    await this.removeLogoFile(company.logo);
    company.logo = `${LOGO_URL}${name}`;
    return this.companyRepository.save(company);
  }

  async removeLogo(): Promise<Company> {
    const company = await this.get();
    await this.removeLogoFile(company.logo);
    company.logo = null;
    return this.companyRepository.save(company);
  }

  /** Only files this service stored are ever deleted. */
  private async removeLogoFile(path: string | null): Promise<void> {
    if (!path || !path.startsWith(LOGO_URL) || path.includes('..')) return;
    await fs.unlink(join(LOGO_DIR, path.slice(LOGO_URL.length))).catch(() => undefined);
  }
}

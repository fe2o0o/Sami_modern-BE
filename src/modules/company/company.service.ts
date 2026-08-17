import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';
import { UpdateCompanyDto } from './dto/update-company.dto';

/**
 * Company service — single-record semantics.
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
    Object.assign(company, dto);
    return this.companyRepository.save(company);
  }
}

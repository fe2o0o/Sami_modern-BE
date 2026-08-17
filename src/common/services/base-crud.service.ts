import { ConflictException, NotFoundException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { PaginatedResult } from '../interfaces/api-response.interface';
import { paginate } from '../utils/pagination.util';

/** Query shape every list endpoint accepts (pagination + optional status filter). */
export type ListQuery = PaginationQueryDto & { isActive?: boolean };

/**
 * Generic CRUD base for flat master-data entities. Owns the cross-cutting
 * concerns — paginated list with free-text search, safe sorting, status filter,
 * soft delete and restore — so concrete services only add their own business
 * rules (uniqueness, delete guards, relations).
 *
 * Subclasses declare the entity alias, which columns are searchable, which are
 * safe to sort by (whitelisted to avoid SQL injection through `sortBy`), and
 * the not-found message.
 */
export abstract class BaseCrudService<T extends ObjectLiteral> {
  protected abstract readonly alias: string;
  protected abstract readonly searchFields: string[];
  protected abstract readonly sortableFields: string[];
  protected abstract readonly notFoundMessage: string;

  constructor(protected readonly repository: Repository<T>) {}

  async findAll(query: ListQuery): Promise<PaginatedResult<T>> {
    const qb = this.repository.createQueryBuilder(this.alias);

    if (query.search && this.searchFields.length) {
      const condition = this.searchFields
        .map((field) => `${this.alias}.${field} LIKE :s`)
        .join(' OR ');
      qb.andWhere(`(${condition})`, { s: `%${query.search}%` });
    }

    if (query.isActive !== undefined) {
      qb.andWhere(`${this.alias}.isActive = :active`, { active: query.isActive });
    }

    qb.orderBy(`${this.alias}.${this.resolveSort(query.sortBy)}`, query.order);
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<T> {
    const entity = await this.repository.findOne({
      where: { id } as never,
    });
    if (!entity) {
      throw new NotFoundException(this.notFoundMessage);
    }
    return entity;
  }

  /** Soft delete. Concrete services override to add guards, then call super. */
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repository.softDelete(id);
  }

  /** Bring a soft-deleted row back. */
  async restore(id: string): Promise<void> {
    await this.repository.restore(id);
  }

  /** Reject a duplicate value on a unique column (case-sensitive per DB collation). */
  protected async ensureUnique(
    field: keyof T,
    value: unknown,
    ignoreId?: string,
    message = 'القيمة مستخدمة بالفعل',
  ): Promise<void> {
    const existing = await this.repository.findOne({
      where: { [field]: value } as never,
    });
    if (existing && (existing as ObjectLiteral).id !== ignoreId) {
      throw new ConflictException(message);
    }
  }

  private resolveSort(sortBy?: string): string {
    return sortBy && this.sortableFields.includes(sortBy) ? sortBy : 'createdAt';
  }
}

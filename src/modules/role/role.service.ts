import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import { Role } from './entities/role.entity';
import { User } from '../user/entities/user.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { PermissionsService, SUPER_ADMIN_ROLE_CODE } from '../permissions/permissions.service';
import { ALL_PERMISSION_KEYS } from '../permissions/permission.catalog';
import { paginate } from '../../common/utils/pagination.util';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';

export interface RoleListItem {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  usersCount: number;
  permissionsCount: number;
}

export interface RoleDetail extends Omit<RoleListItem, 'usersCount' | 'permissionsCount'> {
  isSuperAdmin: boolean;
  usersCount: number;
  permissions: string[];
}

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly permissionsService: PermissionsService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateRoleDto, actorId?: string): Promise<RoleDetail> {
    const code = dto.code.trim().toUpperCase();
    const exists = await this.roleRepository.findOne({ where: { code } });
    if (exists) throw new ConflictException('يوجد دور بنفس الكود بالفعل');

    const role = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(Role).save(
        manager.getRepository(Role).create({
          code,
          name: dto.name,
          nameEn: dto.nameEn ?? null,
          description: dto.description ?? null,
          isActive: dto.isActive ?? true,
          isSystem: false,
        }),
      );
      await this.permissionsService.setRolePermissions(saved.id, dto.permissions ?? [], manager);
      return saved;
    });

    return this.findOne(role.id);
  }

  async findAll(query: QueryRoleDto): Promise<PaginatedResult<RoleListItem>> {
    const qb = this.roleRepository.createQueryBuilder('r');
    if (query.search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('r.name LIKE :s', { s: `%${query.search}%` })
            .orWhere('r.code LIKE :s', { s: `%${query.search}%` });
        }),
      );
    }
    if (query.isActive !== undefined) qb.andWhere('r.isActive = :a', { a: query.isActive });
    qb.orderBy('r.isSystem', 'DESC').addOrderBy('r.name', 'ASC').skip(query.skip).take(query.perPage);

    const [roles, total] = await qb.getManyAndCount();

    const rows: RoleListItem[] = await Promise.all(
      roles.map(async (r) => {
        const isSuper = r.code === SUPER_ADMIN_ROLE_CODE;
        const [usersCount, keys] = await Promise.all([
          this.userRepository.count({ where: { roleId: r.id } }),
          isSuper ? Promise.resolve(ALL_PERMISSION_KEYS) : this.permissionsService.getRolePermissionKeys(r.id),
        ]);
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          nameEn: r.nameEn,
          description: r.description,
          isSystem: r.isSystem,
          isActive: r.isActive,
          usersCount,
          permissionsCount: keys.length,
        };
      }),
    );

    return paginate(rows, total, query.page, query.perPage);
  }

  async findOne(id: string): Promise<RoleDetail> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) throw new NotFoundException('لم يتم العثور على الدور');

    const isSuperAdmin = role.code === SUPER_ADMIN_ROLE_CODE;
    const [usersCount, permissions] = await Promise.all([
      this.userRepository.count({ where: { roleId: role.id } }),
      isSuperAdmin ? Promise.resolve(ALL_PERMISSION_KEYS) : this.permissionsService.getRolePermissionKeys(role.id),
    ]);

    return {
      id: role.id,
      code: role.code,
      name: role.name,
      nameEn: role.nameEn,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      isSuperAdmin,
      usersCount,
      permissions,
    };
  }

  async update(id: string, dto: UpdateRoleDto, actorId?: string): Promise<RoleDetail> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) throw new NotFoundException('لم يتم العثور على الدور');
    const isSuperAdmin = role.code === SUPER_ADMIN_ROLE_CODE;

    if (isSuperAdmin && dto.isActive === false) {
      throw new BadRequestException('لا يمكن إلغاء تفعيل دور مدير النظام');
    }

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Role);
      if (dto.name !== undefined) role.name = dto.name;
      if (dto.nameEn !== undefined) role.nameEn = dto.nameEn ?? null;
      if (dto.description !== undefined) role.description = dto.description ?? null;
      if (dto.isActive !== undefined) role.isActive = dto.isActive;
      await repo.save(role);

      // A super-admin's permissions are implicit (all) and never stored.
      if (!isSuperAdmin && dto.permissions !== undefined) {
        await this.permissionsService.setRolePermissions(role.id, dto.permissions, manager);
      }
    });

    return this.findOne(id);
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) throw new NotFoundException('لم يتم العثور على الدور');
    if (role.isSystem) throw new BadRequestException('لا يمكن حذف دور نظامي');

    const usersCount = await this.userRepository.count({ where: { roleId: id } });
    if (usersCount > 0) {
      throw new BadRequestException(`لا يمكن حذف الدور لوجود ${usersCount} مستخدم مرتبط به`);
    }

    await this.roleRepository.softDelete(id);
  }
}

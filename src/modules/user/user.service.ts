import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { Branch } from '../branch/entities/branch.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PaginatedResult } from '../../common/interfaces/api-response.interface';
import { paginate } from '../../common/utils/pagination.util';

export type SafeUser = Omit<User, 'password' | 'refreshToken'>;

const SALT_ROUNDS = 10;

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
  ) {}

  // =========================
  // CREATE
  // =========================
  async create(dto: CreateUserDto, actorId?: string): Promise<SafeUser> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('كلمة المرور وتأكيدها غير متطابقين');
    }

    await this.ensureUsernameUnique(dto.username);
    await this.ensureEmailUnique(dto.email);
    await this.ensureRoleExists(dto.roleId);
    const branches = await this.resolveBranches(dto.branchIds);

    const { confirmPassword: _cp, password, branchIds: _bi, ...rest } = dto;
    const user = this.userRepository.create({
      ...rest,
      branches,
      password: await bcrypt.hash(password, SALT_ROUNDS),
      createdBy: actorId ?? null,
    });

    const saved = await this.userRepository.save(user);
    return this.findOne(saved.id);
  }

  // =========================
  // LIST (paginated + search + filters)
  // =========================
  async findAll(query: QueryUserDto): Promise<PaginatedResult<SafeUser>> {
    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('user.branches', 'branch');

    if (query.search) {
      qb.andWhere(
        '(user.fullName LIKE :s OR user.username LIKE :s OR user.email LIKE :s OR user.phone LIKE :s)',
        { s: `%${query.search}%` },
      );
    }
    if (query.branchId) {
      // Users assigned to this branch (EXISTS keeps the full branch list in the row).
      qb.andWhere(
        `EXISTS (SELECT 1 FROM user_branches ub
                 WHERE ub.user_id = user.id AND ub.branch_id = :branchId)`,
        { branchId: query.branchId },
      );
    }
    if (query.roleId) {
      qb.andWhere('user.roleId = :roleId', { roleId: query.roleId });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('user.isActive = :active', { active: query.isActive });
    }

    const sortBy = query.sortBy ?? 'createdAt';
    qb.orderBy(`user.${sortBy}`, query.order);
    qb.skip(query.skip).take(query.perPage);

    const [items, total] = await qb.getManyAndCount();
    return paginate(items.map((u) => this.sanitize(u)), total, query.page, query.perPage);
  }

  // =========================
  // GET ONE
  // =========================
  async findOne(id: string): Promise<SafeUser> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { role: true, branches: true },
    });
    if (!user) {
      throw new NotFoundException('لم يتم العثور على المستخدم');
    }
    return this.sanitize(user);
  }

  // =========================
  // UPDATE (admin)
  // =========================
  async update(id: string, dto: UpdateUserDto, actorId?: string): Promise<SafeUser> {
    // Load branches so the M2M diff on save is computed against the real set.
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { branches: true },
    });
    if (!user) {
      throw new NotFoundException('لم يتم العثور على المستخدم');
    }

    if (dto.email && dto.email !== user.email) {
      await this.ensureEmailUnique(dto.email, id);
    }
    if (dto.roleId) {
      await this.ensureRoleExists(dto.roleId);
    }
    // Only touch the branch set when the caller sends branchIds — saving the
    // owning side then syncs the user_branches join table.
    if (dto.branchIds !== undefined) {
      user.branches = await this.resolveBranches(dto.branchIds);
    }

    const { branchIds: _bi, ...rest } = dto;
    Object.assign(user, rest, { updatedBy: actorId ?? null });
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  // =========================
  // DELETE (soft)
  // =========================
  async remove(id: string, actorId?: string): Promise<void> {
    await this.getEntity(id);
    await this.userRepository.update(id, { deletedBy: actorId ?? null });
    await this.userRepository.softDelete(id);
  }

  // =========================
  // ADMIN RESET PASSWORD
  // =========================
  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    actorId?: string,
  ): Promise<{ password?: string }> {
    await this.getEntity(id);
    const generated = !dto.password;
    const newPassword = dto.password ?? this.generatePassword();

    await this.userRepository.update(id, {
      password: await bcrypt.hash(newPassword, SALT_ROUNDS),
      refreshToken: null, // force re-login
      updatedBy: actorId ?? null,
    });

    // Only surface the password when the server generated it.
    return generated ? { password: newPassword } : {};
  }

  // =========================
  // TOGGLE LOCK / ACTIVE
  // =========================
  async toggleLock(id: string): Promise<SafeUser> {
    const user = await this.getEntity(id);
    user.isLocked = !user.isLocked;
    if (user.isLocked) {
      user.refreshToken = null;
    }
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  async toggleActive(id: string): Promise<SafeUser> {
    const user = await this.getEntity(id);
    user.isActive = !user.isActive;
    if (!user.isActive) {
      user.refreshToken = null;
    }
    await this.userRepository.save(user);
    return this.findOne(id);
  }

  // =========================================================
  // AUTH HELPERS
  // =========================================================

  /** Find by email OR username, WITH password + refreshToken + relations. */
  findByLogin(login: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.refreshToken'])
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('user.branches', 'branch')
      .where('user.email = :login OR user.username = :login', { login })
      .getOne();
  }

  findByIdWithSecret(id: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect(['user.password', 'user.refreshToken'])
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('user.branches', 'branch')
      .where('user.id = :id', { id })
      .getOne();
  }

  async setRefreshToken(id: string, hashed: string | null): Promise<void> {
    await this.userRepository.update(id, { refreshToken: hashed });
  }

  async setPassword(id: string, hashed: string): Promise<void> {
    await this.userRepository.update(id, { password: hashed, refreshToken: null });
  }

  async touchLastLogin(id: string, when: Date): Promise<void> {
    await this.userRepository.update(id, { lastLogin: when });
  }

  /** Strip password + refreshToken before returning to any caller. */
  sanitize(user: User): SafeUser {
    const { password: _p, refreshToken: _r, ...safe } = user;
    return safe;
  }

  // =========================================================
  // PRIVATE
  // =========================================================

  private async getEntity(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('لم يتم العثور على المستخدم');
    }
    return user;
  }

  private async ensureUsernameUnique(username: string, ignoreId?: string): Promise<void> {
    const existing = await this.userRepository.findOne({ where: { username } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('اسم المستخدم مستخدم بالفعل');
    }
  }

  private async ensureEmailUnique(email: string, ignoreId?: string): Promise<void> {
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing && existing.id !== ignoreId) {
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
    }
  }

  private async ensureRoleExists(roleId: string): Promise<void> {
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException('لم يتم العثور على الدور');
    }
  }

  /** Resolve+validate the assigned branch ids. Empty/undefined → no branches. */
  private async resolveBranches(ids?: string[]): Promise<Branch[]> {
    const unique = [...new Set((ids ?? []).filter(Boolean))];
    if (!unique.length) return [];
    const rows = await this.branchRepository.find({ where: { id: In(unique) } });
    if (rows.length !== unique.length) {
      throw new NotFoundException('أحد الفروع المختارة غير موجود');
    }
    return rows;
  }

  private generatePassword(): string {
    // e.g. "Sami@3f9a2b" — readable + reasonably strong for a one-time reset.
    return `Sami@${randomBytes(4).toString('hex')}`;
  }
}

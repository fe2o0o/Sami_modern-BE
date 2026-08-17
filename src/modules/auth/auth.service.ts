import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  AuthenticatedUser,
  JwtPayload,
} from './interfaces/jwt-payload.interface';

const INVALID_CREDENTIALS =
  'اسم المستخدم أو البريد الإلكتروني أو كلمة المرور غير صحيحة';
const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
  ) {}

  // =========================
  // LOGIN (email OR username)
  // =========================
  async login(dto: LoginDto) {
    const user = await this.userService.findByLogin(dto.login);
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      throw new UnauthorizedException('الحساب غير مُفعّل، تواصل مع المسؤول');
    }
    if (user.isLocked) {
      throw new UnauthorizedException('الحساب مقفل، تواصل مع المسؤول');
    }

    const tokens = await this.issueTokens(user);
    await this.userService.touchLastLogin(user.id, new Date());

    return {
      message: 'تم تسجيل الدخول بنجاح',
      ...tokens,
      user: this.userService.sanitize(user),
    };
  }

  // =========================
  // REFRESH
  // =========================
  async refresh(dto: RefreshTokenDto) {
    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('رمز التحديث غير صالح');
    }

    const user = await this.userService.findByIdWithSecret(payload.sub);
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('رمز التحديث غير صالح');
    }

    const matches = await bcrypt.compare(dto.refreshToken, user.refreshToken);
    if (!matches) {
      throw new UnauthorizedException('رمز التحديث غير صالح');
    }
    if (!user.isActive || user.isLocked) {
      throw new UnauthorizedException('الحساب غير متاح');
    }

    const tokens = await this.issueTokens(user);
    return {
      message: 'تم تحديث الجلسة',
      ...tokens,
      user: this.userService.sanitize(user),
    };
  }

  // =========================
  // LOGOUT
  // =========================
  async logout(userId: string) {
    await this.userService.setRefreshToken(userId, null);
    return { message: 'تم تسجيل الخروج بنجاح' };
  }

  // =========================
  // ME
  // =========================
  me(actor: AuthenticatedUser) {
    return this.userService.findOne(actor.userId);
  }

  // =========================
  // CHANGE PASSWORD
  // =========================
  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('كلمة المرور الجديدة وتأكيدها غير متطابقين');
    }

    const user = await this.userService.findByIdWithSecret(userId);
    if (!user) {
      throw new UnauthorizedException('المستخدم غير موجود');
    }

    const matches = await bcrypt.compare(dto.currentPassword, user.password);
    if (!matches) {
      throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة');
    }

    const hashed = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.userService.setPassword(userId, hashed); // also clears refresh token

    return { message: 'تم تغيير كلمة المرور بنجاح، يرجى تسجيل الدخول مجدداً' };
  }

  // =========================================================
  // INTERNAL
  // =========================================================

  private async issueTokens(user: User) {
    const companyId = await this.resolveCompanyId();
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roleId: user.roleId,
      branchId: user.branchId,
      companyId,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: this.config.get<string>('jwt.expiresIn') as JwtSignOptions['expiresIn'],
    });

    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>(
          'jwt.refreshExpiresIn',
        ) as JwtSignOptions['expiresIn'],
      },
    );

    await this.userService.setRefreshToken(
      user.id,
      await bcrypt.hash(refreshToken, SALT_ROUNDS),
    );

    return { accessToken, refreshToken };
  }

  private async resolveCompanyId(): Promise<string | null> {
    const company = await this.companyRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    return company?.id ?? null;
  }
}

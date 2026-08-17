import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccountingSetting } from './entities/accounting-setting.entity';
import { UpdateAccountingSettingDto } from './dto/update-accounting-setting.dto';
import {
  SETTING_ACCOUNT_RULES,
  SETTING_ACCOUNT_RULE_BY_KEY,
} from './accounting-setting.rules';
import { ChartOfAccount } from '../chart-of-account/entities/chart-of-account.entity';

/** Valid account options for one setting field (labelled `code - nameAr`). */
export interface AccountOption {
  id: string;
  name: string;
}

@Injectable()
export class AccountingSettingService {
  constructor(
    @InjectRepository(AccountingSetting)
    private readonly settingRepository: Repository<AccountingSetting>,
    @InjectRepository(ChartOfAccount)
    private readonly accountRepository: Repository<ChartOfAccount>,
  ) {}

  /** Return the one settings record, creating an empty one on first access. */
  async get(): Promise<AccountingSetting> {
    const existing = await this.settingRepository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    if (existing) {
      return existing;
    }
    return this.settingRepository.save(this.settingRepository.create({}));
  }

  /** Update the settings record after validating every selected account. */
  async update(dto: UpdateAccountingSettingDto): Promise<AccountingSetting> {
    await this.validateAccounts(dto);
    const setting = await this.get();
    Object.assign(setting, dto);
    return this.settingRepository.save(setting);
  }

  /**
   * Valid account options per setting field, so each dropdown only ever shows
   * accounts appropriate for that setting. Only active, posting, non-header
   * accounts matching the field's type + subtypes are returned.
   */
  async accountOptions(): Promise<Record<string, AccountOption[]>> {
    const accounts = await this.accountRepository.find({
      where: { isActive: true, allowPosting: true, isHeader: false },
      order: { accountCode: 'ASC' },
    });

    const result: Record<string, AccountOption[]> = {};
    for (const rule of SETTING_ACCOUNT_RULES) {
      const allowed = new Set(rule.subTypes);
      result[rule.key] = accounts
        .filter(
          (a) =>
            a.accountType === rule.accountType &&
            !!a.accountSubType &&
            allowed.has(a.accountSubType),
        )
        .map((a) => ({
          id: a.id,
          name: `${a.accountCode} - ${a.accountNameAr}`,
        }));
    }
    return result;
  }

  // =========================================================
  // VALIDATION
  // =========================================================
  private async validateAccounts(dto: UpdateAccountingSettingDto): Promise<void> {
    // Collect the non-null ids actually submitted.
    const entries = Object.entries(dto).filter(
      ([key, value]) => SETTING_ACCOUNT_RULE_BY_KEY.has(key) && !!value,
    ) as [string, string][];

    if (entries.length === 0) {
      return;
    }

    const ids = [...new Set(entries.map(([, id]) => id))];
    const accounts = await this.accountRepository.find({
      where: { id: In(ids) },
    });
    const byId = new Map(accounts.map((a): [string, ChartOfAccount] => [a.id, a]));

    for (const [key, id] of entries) {
      const rule = SETTING_ACCOUNT_RULE_BY_KEY.get(key)!;
      const account = byId.get(id);

      if (!account) {
        throw new BadRequestException(`${rule.label}: الحساب المحدد غير موجود`);
      }
      if (!account.isActive) {
        throw new BadRequestException(`${rule.label}: الحساب غير نشط`);
      }
      if (account.isHeader || !account.allowPosting) {
        throw new BadRequestException(
          `${rule.label}: يجب اختيار حساب فرعي قابل للترحيل (وليس حساباً رئيسياً)`,
        );
      }
      if (account.accountType !== rule.accountType) {
        throw new BadRequestException(
          `${rule.label}: نوع الحساب غير مناسب لهذا الإعداد`,
        );
      }
      if (
        !account.accountSubType ||
        !rule.subTypes.includes(account.accountSubType)
      ) {
        throw new BadRequestException(
          `${rule.label}: تصنيف الحساب غير مناسب لهذا الإعداد`,
        );
      }
    }
  }
}

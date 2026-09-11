import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CodeSetting } from './entities/code-setting.entity';
import { UpdateCodeSettingDto } from './dto/update-code-setting.dto';
import { CODE_ENTITIES, CODE_ENTITY_KEYS } from './code-entities';

export interface CodeSettingView {
  entityKey: string;
  labelAr: string;
  autoGenerate: boolean;
  prefix: string;
  padding: number;
  nextNumber: number;
  /** The next code that would be generated, for previews. */
  preview: string;
}

@Injectable()
export class CodeSettingService {
  constructor(
    @InjectRepository(CodeSetting)
    private readonly repository: Repository<CodeSetting>,
    private readonly dataSource: DataSource,
  ) {}

  private format(setting: Pick<CodeSetting, 'prefix' | 'padding'>, n: number): string {
    const padded = String(n).padStart(Math.max(1, setting.padding), '0');
    return setting.prefix ? `${setting.prefix}-${padded}` : padded;
  }

  private labelFor(entityKey: string): string {
    return CODE_ENTITIES.find((e) => e.key === entityKey)?.labelAr ?? entityKey;
  }

  private toView(s: CodeSetting): CodeSettingView {
    return {
      entityKey: s.entityKey,
      labelAr: this.labelFor(s.entityKey),
      autoGenerate: s.autoGenerate,
      prefix: s.prefix,
      padding: s.padding,
      nextNumber: s.nextNumber,
      preview: this.format(s, s.nextNumber),
    };
  }

  /** Ensure a row exists for a known entity (lazily seeded from the registry). */
  private async ensure(entityKey: string): Promise<CodeSetting> {
    let s = await this.repository.findOne({ where: { entityKey } });
    if (!s) {
      const def = CODE_ENTITIES.find((e) => e.key === entityKey);
      if (!def) throw new NotFoundException('كيان غير معروف لإعداد الأكواد');
      s = await this.repository.save(
        this.repository.create({
          entityKey,
          autoGenerate: false,
          prefix: def.prefix,
          padding: 4,
          nextNumber: 1,
        }),
      );
    }
    return s;
  }

  /** All code-generation configs (lazily seeds any missing entity). */
  async findAll(): Promise<CodeSettingView[]> {
    const rows = await Promise.all(CODE_ENTITY_KEYS.map((k) => this.ensure(k)));
    return rows.map((s) => this.toView(s));
  }

  async update(entityKey: string, dto: UpdateCodeSettingDto): Promise<CodeSettingView> {
    const s = await this.ensure(entityKey);
    if (dto.autoGenerate !== undefined) s.autoGenerate = dto.autoGenerate;
    if (dto.prefix !== undefined) s.prefix = dto.prefix.trim();
    if (dto.padding !== undefined) s.padding = dto.padding;
    if (dto.nextNumber !== undefined) s.nextNumber = dto.nextNumber;
    const saved = await this.repository.save(s);
    return this.toView(saved);
  }

  /** The next code preview for an entity (does NOT consume the counter). */
  async preview(entityKey: string): Promise<{ entityKey: string; autoGenerate: boolean; code: string }> {
    const s = await this.ensure(entityKey);
    return { entityKey, autoGenerate: s.autoGenerate, code: this.format(s, s.nextNumber) };
  }

  /** Whether an entity's code is system-generated. */
  async isAuto(entityKey: string): Promise<boolean> {
    const s = await this.ensure(entityKey);
    return s.autoGenerate;
  }

  /**
   * Atomically assign the next code for an entity when auto-generation is on,
   * consuming the counter under a row lock. Returns `null` when the entity is
   * set to manual (the caller keeps the user-entered code).
   *
   * Pass a `manager` to join an existing transaction (e.g. a bulk Excel import)
   * so the counter increment commits/rolls back with it; omit it to run standalone.
   */
  async generateCode(entityKey: string, manager?: EntityManager): Promise<string | null> {
    if (!CODE_ENTITY_KEYS.includes(entityKey)) return null;
    const run = async (m: EntityManager): Promise<string | null> => {
      const repo = m.getRepository(CodeSetting);
      let s = await repo.findOne({ where: { entityKey }, lock: { mode: 'pessimistic_write' } });
      if (!s) {
        // Lazily create (on this same manager) then re-lock so the increment is atomic.
        const def = CODE_ENTITIES.find((e) => e.key === entityKey);
        if (!def) throw new NotFoundException('كيان غير معروف لإعداد الأكواد');
        await repo.save(
          repo.create({ entityKey, autoGenerate: false, prefix: def.prefix, padding: 4, nextNumber: 1 }),
        );
        s = await repo.findOne({ where: { entityKey }, lock: { mode: 'pessimistic_write' } });
      }
      if (!s || !s.autoGenerate) return null;
      const n = s.nextNumber;
      s.nextNumber = n + 1;
      await repo.save(s);
      return this.format(s, n);
    };
    return manager ? run(manager) : this.dataSource.transaction(run);
  }

  /**
   * Resolve the code to persist for a new record: the generated one when auto,
   * otherwise the user-entered code (which must be present). Pass a `manager` to
   * join a surrounding transaction (bulk imports).
   */
  async resolveCode(
    entityKey: string,
    provided?: string | null,
    manager?: EntityManager,
  ): Promise<string> {
    const generated = await this.generateCode(entityKey, manager);
    if (generated) return generated;
    const code = (provided ?? '').trim();
    if (!code) throw new BadRequestException('الكود مطلوب');
    return code;
  }
}

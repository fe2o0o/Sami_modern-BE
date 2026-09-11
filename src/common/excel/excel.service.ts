import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Workbook, Worksheet } from 'exceljs';
import {
  ImportColumn,
  ImportResult,
  ParsedRow,
  RowError,
  UploadedExcel,
} from './excel.types';

/**
 * Persist one parsed row inside the shared import transaction. Throw an Error
 * whose message is a human (Arabic) reason to fail JUST that row — the runner
 * collects it and rolls the whole import back (all-or-nothing).
 */
export type RowHandler = (
  values: Record<string, unknown>,
  manager: EntityManager,
  rowNumber: number,
) => Promise<void>;

/**
 * Shared, entity-agnostic Excel engine used by every "import from Excel"
 * feature. It ONLY knows about columns (header ↔ field ↔ type) — never about
 * any specific entity. Each module supplies its column map, then resolves
 * foreign keys / uniqueness itself. Two responsibilities:
 *   1. build a styled `.xlsx` TEMPLATE (header row + one example row + a locked
 *      instructions sheet) for the user to fill,
 *   2. PARSE an uploaded workbook back into typed rows keyed by field, with a
 *      per-row error for anything that fails a required/type check.
 */
@Injectable()
export class ExcelService {
  private readonly headerFill = 'FF1E3A5F';
  private readonly headerFont = 'FFFFFFFF';

  // =========================================================
  // TEMPLATE
  // =========================================================
  async buildTemplate(
    columns: ImportColumn[],
    opts: { sheetName: string; title: string },
  ): Promise<Buffer> {
    const workbook = new Workbook();
    workbook.views = [{ rightToLeft: true } as never];

    const sheet = workbook.addWorksheet(opts.sheetName, {
      views: [{ rightToLeft: true }],
    });
    this.writeHeader(sheet, columns);
    this.writeExampleRow(sheet, columns);
    this.buildInstructionsSheet(workbook, columns, opts.title);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private writeHeader(sheet: Worksheet, columns: ImportColumn[]): void {
    sheet.columns = columns.map((c) => ({
      header: c.header,
      key: c.field,
      width: c.width ?? 22,
    }));
    const headerRow = sheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell, col) => {
      const column = columns[col - 1];
      cell.value = column.required ? `${column.header} *` : column.header;
      cell.font = { bold: true, color: { argb: this.headerFont } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: this.headerFill },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
  }

  private writeExampleRow(sheet: Worksheet, columns: ImportColumn[]): void {
    const values = columns.map((c) => c.example ?? '');
    const row = sheet.addRow(values);
    row.eachCell((cell) => {
      cell.font = { italic: true, color: { argb: 'FF9CA3AF' } };
    });
  }

  private buildInstructionsSheet(
    workbook: Workbook,
    columns: ImportColumn[],
    title: string,
  ): void {
    const sheet = workbook.addWorksheet('تعليمات', {
      views: [{ rightToLeft: true }],
      state: 'visible',
    });
    sheet.columns = [
      { header: 'العمود', key: 'header', width: 26 },
      { header: 'مطلوب؟', key: 'required', width: 10 },
      { header: 'النوع', key: 'type', width: 14 },
      { header: 'ملاحظات', key: 'note', width: 60 },
    ];
    sheet.getRow(1).font = { bold: true };

    sheet.addRow({ header: title });
    sheet.addRow({});
    for (const c of columns) {
      sheet.addRow({
        header: c.header,
        required: c.required ? 'نعم' : 'لا',
        type: this.typeLabel(c.type ?? 'string'),
        note: c.note ?? '',
      });
    }
    sheet.addRow({});
    sheet.addRow({
      header: 'ملاحظة',
      note: 'احذف صف المثال قبل الاستيراد. لا تُعدّل صف العناوين. الحقول المميزة بعلامة * إلزامية.',
    });
  }

  private typeLabel(type: string): string {
    switch (type) {
      case 'number':
        return 'رقم';
      case 'boolean':
        return 'نعم/لا';
      case 'date':
        return 'تاريخ (YYYY-MM-DD)';
      default:
        return 'نص';
    }
  }

  // =========================================================
  // PARSE
  // =========================================================
  async parse(
    file: UploadedExcel,
    columns: ImportColumn[],
  ): Promise<{ rows: ParsedRow[]; errors: RowError[] }> {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('لم يتم إرفاق ملف');
    }

    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(file.buffer as never);
    } catch {
      throw new BadRequestException('تعذّر قراءة الملف — تأكد أنه ملف Excel صالح (.xlsx)');
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('الملف لا يحتوي على أي ورقة بيانات');

    // Map each worksheet column index → our field, by matching the header text
    // (tolerant of the trailing " *" the template adds to required columns).
    const headerRow = sheet.getRow(1);
    const fieldByCol = new Map<number, ImportColumn>();
    headerRow.eachCell((cell, col) => {
      const text = this.cellText(cell.value).replace(/\*+$/, '').trim();
      const match = columns.find((c) => c.header === text);
      if (match) fieldByCol.set(col, match);
    });

    // Only REQUIRED columns must be present. Optional ones (e.g. `code` when the
    // entity auto-generates it) may be omitted from the file entirely.
    const missing = columns.filter(
      (c) => c.required && ![...fieldByCol.values()].includes(c),
    );
    if (missing.length) {
      throw new BadRequestException(
        `الأعمدة التالية مفقودة في الملف: ${missing.map((m) => m.header).join('، ')}`,
      );
    }

    const rows: ParsedRow[] = [];
    const errors: RowError[] = [];

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const values: Record<string, unknown> = {};
      let hasAny = false;

      for (const [col, column] of fieldByCol.entries()) {
        const raw = row.getCell(col).value;
        const coerced = this.coerce(raw, column.type ?? 'string');
        if (coerced !== null && coerced !== '') hasAny = true;
        values[column.field] = coerced;
      }
      if (!hasAny) continue; // skip fully-empty rows

      // Required + type validation for this row.
      for (const column of columns) {
        const value = values[column.field];
        const blank = value === null || value === '' || value === undefined;
        if (column.required && blank) {
          errors.push({ row: r, message: `العمود «${column.header}» مطلوب` });
        } else if (!blank && column.type === 'number' && typeof value !== 'number') {
          errors.push({ row: r, message: `العمود «${column.header}» يجب أن يكون رقماً` });
        }
      }

      rows.push({ rowNumber: r, values });
    }

    if (!rows.length && !errors.length) {
      throw new BadRequestException('لا توجد بيانات في الملف بعد صف العناوين');
    }

    return { rows, errors };
  }

  // =========================================================
  // IMPORT RUNNER (all-or-nothing)
  // =========================================================
  /**
   * Run an all-or-nothing import: if ANY row fails (parse or business), nothing
   * is committed and every failing row's error is returned. On a fully-valid
   * file, all rows persist in one transaction. Each module supplies only the
   * per-row {@link RowHandler} (FK resolution / uniqueness / insert).
   */
  async runImport(
    dataSource: DataSource,
    parsed: { rows: ParsedRow[]; errors: RowError[] },
    handle: RowHandler,
  ): Promise<ImportResult> {
    const { rows, errors: parseErrors } = parsed;
    // A parse/type error already dooms the file — don't touch the database.
    if (parseErrors.length) {
      return { created: 0, failed: parseErrors.length, errors: this.sortErrors(parseErrors) };
    }

    const errors: RowError[] = [];
    try {
      await dataSource.transaction(async (manager) => {
        for (const row of rows) {
          try {
            await handle(row.values, manager, row.rowNumber);
          } catch (e) {
            errors.push({ row: row.rowNumber, message: this.errText(e) });
          }
        }
        if (errors.length) throw new RollbackSignal();
      });
    } catch (e) {
      if (e instanceof RollbackSignal) {
        return { created: 0, failed: errors.length, errors: this.sortErrors(errors) };
      }
      throw e; // a genuine infrastructure error — let it surface
    }

    return { created: rows.length, failed: 0, errors: [] };
  }

  private sortErrors(errors: RowError[]): RowError[] {
    return [...errors].sort((a, b) => a.row - b.row);
  }

  private errText(e: unknown): string {
    if (e instanceof Error && e.message) return e.message;
    return 'خطأ غير متوقع في هذا الصف';
  }

  // =========================================================
  // HELPERS
  // =========================================================
  private coerce(raw: unknown, type: string): unknown {
    const text = this.cellText(raw).trim();
    if (text === '') return type === 'string' ? '' : null;

    switch (type) {
      case 'number': {
        const n = Number(text.replace(/,/g, ''));
        return Number.isFinite(n) ? n : text; // non-number kept as text → row error
      }
      case 'boolean':
        return ['نعم', 'true', '1', 'yes', 'y'].includes(text.toLowerCase());
      case 'date':
        return this.toIsoDate(raw, text);
      default:
        return text;
    }
  }

  /** Read a display string from any exceljs cell value (rich text, formula, hyperlink…). */
  private cellText(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return this.dateToIso(value);
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.result !== 'undefined') return String(obj.result);
    if (Array.isArray(obj.richText)) {
      return (obj.richText as { text: string }[]).map((t) => t.text).join('');
    }
    if (typeof obj.hyperlink === 'string') return obj.hyperlink;
    return String(value);
  }

  private toIsoDate(raw: unknown, text: string): string {
    if (raw instanceof Date) return this.dateToIso(raw);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? text : this.dateToIso(parsed);
  }

  private dateToIso(date: Date): string {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/** Internal marker used to roll back the import transaction on row errors. */
class RollbackSignal extends Error {}

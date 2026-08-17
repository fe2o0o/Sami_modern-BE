/** Cell value kinds the template + parser understand. */
export type ExcelCellType = 'string' | 'number' | 'boolean' | 'date';

/** One column in an import template / parsed sheet. */
export interface ImportColumn {
  /** Object key the parsed value lands on. */
  field: string;
  /** Arabic header shown in the template + matched on import. */
  header: string;
  /** Default 'string'. */
  type?: ExcelCellType;
  /** Blank required cells become a per-row error. */
  required?: boolean;
  /** Sample value shown in the template's example row. */
  example?: string | number | boolean;
  /** Extra guidance shown on the instructions sheet. */
  note?: string;
  /** Column width in the template. */
  width?: number;
}

/** One raw row read from the sheet, keyed by column field. */
export interface ParsedRow {
  /** 1-based worksheet row number (for human error messages). */
  rowNumber: number;
  values: Record<string, unknown>;
}

/** A per-row problem (either a parse/type error or a business error). */
export interface RowError {
  row: number;
  message: string;
}

/** Returned by every import endpoint. */
export interface ImportResult {
  created: number;
  failed: number;
  errors: RowError[];
}

/** Minimal shape of a Multer memory-storage file (avoids a @types/multer dep). */
export interface UploadedExcel {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

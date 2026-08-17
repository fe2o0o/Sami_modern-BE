import { BadRequestException } from '@nestjs/common';

const MAX_EXCEL_BYTES = 5 * 1024 * 1024; // 5 MB

const XLSX_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream', // some browsers send this for .xlsx
];

/** Shared Multer options for every `.xlsx` import endpoint (memory storage). */
export const EXCEL_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_EXCEL_BYTES },
  fileFilter: (
    _req: unknown,
    file: { originalname: string; mimetype: string },
    cb: (error: Error | null, acceptFile: boolean) => void,
  ): void => {
    const isXlsx = file.originalname.toLowerCase().endsWith('.xlsx');
    if (isXlsx || XLSX_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestException('يُقبل ملف Excel بصيغة .xlsx فقط'), false);
    }
  },
};

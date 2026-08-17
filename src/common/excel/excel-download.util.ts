import { Response } from 'express';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Stream an `.xlsx` buffer as a file download, bypassing the JSON response
 * envelope. Controllers call this from a handler that injects `@Res()`.
 */
export function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  const safe = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(safe)}"`,
  );
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

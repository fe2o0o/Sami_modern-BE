import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `products.barcode` is unique and optional. Some rows were saved with an empty
 * string instead of NULL, so the next product without a barcode hit the unique
 * index. Blank barcodes become NULL (the API now does the same on save).
 */
export class EmptyProductBarcodeToNull1792400000000 implements MigrationInterface {
  name = 'EmptyProductBarcodeToNull1792400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE \`products\` SET \`barcode\` = NULL WHERE TRIM(\`barcode\`) = ''`);
  }

  public async down(): Promise<void> {
    // nothing to restore — NULL and '' meant the same «no barcode»
  }
}

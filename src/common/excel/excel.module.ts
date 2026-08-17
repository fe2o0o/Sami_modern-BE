import { Global, Module } from '@nestjs/common';
import { ExcelService } from './excel.service';
import { ImportRegistry } from './import.registry';
import { ImportController } from './import.controller';

/**
 * Global so any feature module can inject {@link ExcelService} +
 * {@link ImportRegistry} for its import/template features without repeating an
 * import. The single {@link ImportController} serves every registered resource.
 */
@Global()
@Module({
  controllers: [ImportController],
  providers: [ExcelService, ImportRegistry],
  exports: [ExcelService, ImportRegistry],
})
export class ExcelModule {}

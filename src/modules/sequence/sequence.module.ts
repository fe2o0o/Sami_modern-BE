import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequence } from './entities/document-sequence.entity';
import { SequenceService } from './sequence.service';

/**
 * Shared document-numbering module. Any module that mints sequential document
 * numbers imports this and injects {@link SequenceService}.
 */
@Module({
  imports: [TypeOrmModule.forFeature([DocumentSequence])],
  providers: [SequenceService],
  exports: [SequenceService],
})
export class SequenceModule {}

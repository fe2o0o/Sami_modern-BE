import { PartialType } from '@nestjs/swagger';
import { CreateJournalEntryDto } from './create-journal-entry.dto';

/** Edit a DRAFT manual journal entry (full replace of header + lines). */
export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}

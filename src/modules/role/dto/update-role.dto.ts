import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateRoleDto } from './create-role.dto';

/** The `code` is a stable identifier and cannot change after creation. */
export class UpdateRoleDto extends PartialType(OmitType(CreateRoleDto, ['code'] as const)) {}

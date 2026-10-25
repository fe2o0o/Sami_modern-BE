import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Employee } from './entities/employee.entity';

/**
 * Resolve a branch/warehouse manager picked from the employees list into the
 * stored pair { managerEmployeeId, managerName } — the name is a snapshot for
 * display/exports. `undefined` = not sent (leave as is); `null` = cleared.
 */
export async function resolveManagerEmployee(
  manager: EntityManager,
  managerEmployeeId: string | null | undefined,
): Promise<{ managerEmployeeId: string | null; managerName: string | null } | null> {
  if (managerEmployeeId === undefined) return null;
  if (!managerEmployeeId) return { managerEmployeeId: null, managerName: null };
  const employee = await manager.getRepository(Employee).findOne({ where: { id: managerEmployeeId } });
  if (!employee) throw new BadRequestException('الموظف المختار كمدير غير موجود');
  return { managerEmployeeId: employee.id, managerName: employee.name };
}

/** Excel import: match a manager name (or employee code) to exactly one employee. */
export async function matchManagerEmployee(manager: EntityManager, nameOrCode: string | null | undefined): Promise<string | null> {
  const v = nameOrCode?.trim();
  if (!v) return null;
  const found = await manager.getRepository(Employee).find({ where: [{ code: v }, { name: v }], take: 2 });
  return found.length === 1 ? found[0].id : null;
}

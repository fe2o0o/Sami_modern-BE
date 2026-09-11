import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * A principal's branch access scope.
 *  - `null`  → may see EVERY branch (super-admin or `all_branches.view`).
 *  - `[...]` → may see only these branch ids.
 *  - `[]`    → branch-restricted with NO assigned branches → sees nothing.
 */
export type BranchScope = string[] | null;

/**
 * Restrict a query to the caller's branch scope on `column` (e.g. `'si.branchId'`).
 * `null` applies no filter; an empty scope matches nothing.
 */
export function applyBranchScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  column: string,
  scope: BranchScope,
  paramName = 'branchScopeIds',
): SelectQueryBuilder<T> {
  if (scope === null) return qb;
  if (scope.length === 0) return qb.andWhere('1 = 0');
  return qb.andWhere(`${column} IN (:...${paramName})`, { [paramName]: scope });
}

/** True when `branchId` is visible under `scope` (`null` = all branches). */
export function isWithinBranchScope(
  branchId: string | null | undefined,
  scope: BranchScope,
): boolean {
  if (scope === null) return true;
  if (!branchId) return false;
  return scope.includes(branchId);
}

/**
 * Resolve the branch a scoped write (create/update) must use.
 *  - scope `null` (all branches): use the provided branch as-is.
 *  - scope restricted: the provided branch must be within scope; if none is
 *    provided and exactly one branch is allowed, default to it; otherwise the
 *    caller must choose. An empty scope forbids the write.
 */
export function resolveWriteBranch(
  scope: BranchScope,
  provided?: string | null,
): string | null {
  if (scope === null) return provided ?? null;
  if (scope.length === 0) {
    throw new ForbiddenException('لا يوجد فرع مخصّص لك لتنفيذ هذه العملية');
  }
  if (provided) {
    if (!scope.includes(provided)) {
      throw new ForbiddenException('لا يمكنك العمل على فرع غير مخصّص لك');
    }
    return provided;
  }
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('يجب اختيار الفرع');
}

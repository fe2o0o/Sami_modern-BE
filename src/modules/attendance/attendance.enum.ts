export enum PunchType {
  IN = 'in',
  OUT = 'out',
}

/** Where a punch came from — `device` is reserved for the attendance machine integration. */
export enum PunchSource {
  MOBILE = 'mobile',
  MANUAL = 'manual',
  DEVICE = 'device',
}

export enum PunchStatus {
  ACCEPTED = 'accepted',
  /** Outside every branch / weak GPS — kept so HR can review the attempt. */
  REJECTED = 'rejected',
  /** Cancelled by HR (manual correction). */
  VOIDED = 'voided',
}

/** Computed status of one employee-day (never stored). */
export enum AttendanceDayStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  /** Checked in, no check-out (day already over). */
  INCOMPLETE = 'incomplete',
  /** Today: checked in, shift still running. */
  WORKING = 'working',
  /** Today: not checked in yet, shift not over. */
  PENDING = 'pending',
  WEEKLY_OFF = 'weekly_off',
  HOLIDAY = 'holiday',
  /** An approved leave request covers the day. */
  LEAVE = 'leave',
  /** No shift assigned → no expected hours. */
  NO_SHIFT = 'no_shift',
  /** Before hire date / after exit date. */
  NOT_EMPLOYED = 'not_employed',
}

/** Sections of «بوابة الموظف» — granted per employee by HR. */
export enum AppFeature {
  ATTENDANCE = 'attendance',
  LEAVE = 'leave',
  REQUESTS = 'requests',
  PRODUCTS = 'products',
  /** Selling prices inside the products section. */
  PRICES = 'prices',
  /** Stock per warehouse inside the products section. */
  STOCK = 'stock',
  CUSTOMERS = 'customers',
  /** «مبيعاتي»: the employee's own sales (no commission figures). */
  SALES = 'sales',
  /** Inside «مبيعاتي»: also see every employee's sales (no commissions). */
  SALES_ALL = 'sales_all',
}
export const DEFAULT_APP_FEATURES: AppFeature[] = [AppFeature.ATTENDANCE, AppFeature.LEAVE, AppFeature.REQUESTS];

/** The features an employee actually has (null → defaults; prices / stock only with products). */
export function appFeaturesOf(e: { appPermissions?: string[] | null }): AppFeature[] {
  const all = Object.values(AppFeature) as string[];
  const list = (e.appPermissions ?? DEFAULT_APP_FEATURES).filter((f) => all.includes(f)) as AppFeature[];
  return list.filter((f) =>
    f === AppFeature.PRICES || f === AppFeature.STOCK ? list.includes(AppFeature.PRODUCTS) : f === AppFeature.SALES_ALL ? list.includes(AppFeature.SALES) : true,
  );
}

export enum LeaveRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

/** «إذن»: a mission (work outside) or a personal permission. */
export enum PermissionType {
  MISSION = 'mission',
  PERSONAL = 'personal',
}
export const PERMISSION_TYPE_LABELS: Record<PermissionType, string> = {
  [PermissionType.MISSION]: 'مأمورية',
  [PermissionType.PERSONAL]: 'إذن شخصي',
};

export enum RequestSource {
  APP = 'app',
  ERP = 'erp',
}

export enum HrRequestType {
  ADVANCE = 'advance',
  SALARY_CERTIFICATE = 'salary_certificate',
  WORK_CERTIFICATE = 'work_certificate',
  PUNCH_CORRECTION = 'punch_correction',
  COMPLAINT = 'complaint',
  SUGGESTION = 'suggestion',
  OTHER = 'other',
}

export enum HrRequestStatus {
  NEW = 'new',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

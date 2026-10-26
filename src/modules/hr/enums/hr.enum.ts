/** Employment status lifecycle. Resigned / terminated people are kept (never deleted). */
export enum EmploymentStatus {
  ACTIVE = 'active',
  ON_LEAVE = 'on_leave',
  RESIGNED = 'resigned',
  TERMINATED = 'terminated',
}

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  [EmploymentStatus.ACTIVE]: 'نشط',
  [EmploymentStatus.ON_LEAVE]: 'في إجازة',
  [EmploymentStatus.RESIGNED]: 'مستقيل',
  [EmploymentStatus.TERMINATED]: 'منتهي خدمته',
};

/** Statuses that end the employment (exit date + reason required). */
export const EXIT_STATUSES = [EmploymentStatus.RESIGNED, EmploymentStatus.TERMINATED];

export enum ContractType {
  PERMANENT = 'permanent',
  TEMPORARY = 'temporary',
  PIECEWORK = 'piecework',
  TRAINEE = 'trainee',
}

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  [ContractType.PERMANENT]: 'دائم',
  [ContractType.TEMPORARY]: 'مؤقت',
  [ContractType.PIECEWORK]: 'بالقطعة',
  [ContractType.TRAINEE]: 'تحت التدريب',
};

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
}

export enum MaritalStatus {
  SINGLE = 'single',
  MARRIED = 'married',
  DIVORCED = 'divorced',
  WIDOWED = 'widowed',
}

export enum EmployeeDocumentType {
  CONTRACT = 'contract',
  NATIONAL_ID = 'national_id',
  CERTIFICATE = 'certificate',
  MEDICAL = 'medical',
  OTHER = 'other',
}

export const EMPLOYEE_DOCUMENT_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  [EmployeeDocumentType.CONTRACT]: 'عقد عمل',
  [EmployeeDocumentType.NATIONAL_ID]: 'بطاقة رقم قومي',
  [EmployeeDocumentType.CERTIFICATE]: 'شهادة',
  [EmployeeDocumentType.MEDICAL]: 'كشف طبي',
  [EmployeeDocumentType.OTHER]: 'أخرى',
};

/** Pay component: an earning adds to pay, a deduction takes from it. */
export enum PayComponentType {
  EARNING = 'earning',
  DEDUCTION = 'deduction',
}

/** Fixed amount, or a percentage of the employee's basic salary. */
export enum PayCalcType {
  FIXED = 'fixed',
  PERCENT_OF_BASIC = 'percent_of_basic',
}

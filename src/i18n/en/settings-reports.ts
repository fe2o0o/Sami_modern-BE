/**
 * English for settings-reports API messages — keys are the Arabic source texts. Messages built
 * with values use {placeholders}: 'المنتج "{name}" غير موجود' → 'Product "{name}" not found'.
 */
export const settingsReports: Record<string, string> = {
  // ── Roles ───────────────────────────────────────────────────────────────
  'تم إنشاء الدور بنجاح': 'Role created successfully',
  'تم تعديل الدور بنجاح': 'Role updated successfully',
  'تم حذف الدور بنجاح': 'Role deleted successfully',
  'يوجد دور بنفس الكود بالفعل': 'A role with the same code already exists',
  'لم يتم العثور على الدور': 'Role not found',
  'لا يمكن إلغاء تفعيل دور مدير النظام': 'The system administrator role cannot be deactivated',
  'لا يمكن حذف دور نظامي': 'A system role cannot be deleted',
  'لا يمكن حذف الدور لوجود {count} مستخدم مرتبط به': 'Cannot delete the role because {count} user(s) are assigned to it',

  // ── Users ───────────────────────────────────────────────────────────────
  'تم إنشاء المستخدم بنجاح': 'User created successfully',
  'تم تعديل المستخدم بنجاح': 'User updated successfully',
  'تم حذف المستخدم بنجاح': 'User deleted successfully',
  'تم إعادة تعيين كلمة المرور': 'Password has been reset',
  'تم تحديث حالة القفل': 'Lock status updated',
  'تم تحديث حالة التفعيل': 'Active status updated',
  'كلمة المرور وتأكيدها غير متطابقين': 'Password and confirmation do not match',
  'لم يتم العثور على المستخدم': 'User not found',
  'اسم المستخدم مستخدم بالفعل': 'Username is already in use',
  'البريد الإلكتروني مستخدم بالفعل': 'Email is already in use',
  'أحد الفروع المختارة غير موجود': 'One of the selected branches does not exist',

  // ── Company / branches ──────────────────────────────────────────────────
  'لم يتم العثور على بيانات الشركة': 'Company details not found',
  'تم إنشاء الفرع بنجاح، وتم إنشاء مخزن افتراضي لهذا الفرع تلقائيًا وتعيينه كمخزن افتراضي':
    'Branch created successfully, and a default warehouse was created for it automatically',
  'تم حذف الفرع بنجاح': 'Branch deleted successfully',
  'كود الفرع «{code}» مستخدم بالفعل': 'Branch code «{code}» is already in use',
  'لم يتم العثور على الفرع': 'Branch not found',
  'لا يمكن حذف الفرع الرئيسي': 'The main branch cannot be deleted',
  'لا يمكن حذف الفرع لوجود حركة مخزنية في مخازنه': 'Cannot delete the branch because its warehouses have stock movements',
  'لا يمكن حذف الفرع لارتباط مخازنه بفواتير': 'Cannot delete the branch because its warehouses are linked to invoices',
  'لا يمكن حذف الفرع لارتباطه بفواتير': 'Cannot delete the branch because it is linked to invoices',
  'كود الفرع مستخدم بالفعل': 'Branch code is already in use',
  'الفرع غير موجود': 'Branch not found',
  'الفرع بكود «{code}» غير موجود': 'Branch with code «{code}» not found',

  // ── Warehouses ──────────────────────────────────────────────────────────
  'تم حذف المخزن بنجاح': 'Warehouse deleted successfully',
  'كود المخزن «{code}» مستخدم بالفعل': 'Warehouse code «{code}» is already in use',
  'لم يتم العثور على المخزن': 'Warehouse not found',
  'لا يمكن حذف المخزن لوجود حركات مخزنية مرتبطة به': 'Cannot delete the warehouse because it has stock movements',
  'كود المخزن مستخدم بالفعل': 'Warehouse code is already in use',

  // ── Treasuries (cash boxes) / bank accounts ─────────────────────────────
  'تم حفظ الخزينة بنجاح': 'Cash box saved successfully',
  'تم حذف الخزينة بنجاح': 'Cash box deleted successfully',
  'كود الخزينة «{code}» مستخدم بالفعل': 'Cash box code «{code}» is already in use',
  'الحساب بكود «{code}» غير موجود': 'Account with code «{code}» not found',
  'لم يتم العثور على الخزينة': 'Cash box not found',
  'لا يمكن حذف الخزينة لوجود حركات مسجلة عليها': 'Cannot delete the cash box because it has recorded transactions',
  'كود الخزينة مستخدم بالفعل': 'Cash box code is already in use',
  'تم حفظ الحساب البنكي بنجاح': 'Bank account saved successfully',
  'تم حذف الحساب البنكي بنجاح': 'Bank account deleted successfully',
  'كود الحساب البنكي «{code}» مستخدم بالفعل': 'Bank account code «{code}» is already in use',
  'لم يتم العثور على الحساب البنكي': 'Bank account not found',
  'لا يمكن حذف الحساب البنكي لوجود حركات مسجلة عليه': 'Cannot delete the bank account because it has recorded transactions',
  'كود الحساب البنكي مستخدم بالفعل': 'Bank account code is already in use',
  'الحساب المحاسبي المختار غير موجود': 'The selected GL account does not exist',
  'الحساب "{name}" غير نشط': 'Account "{name}" is inactive',
  'الحساب "{name}" حساب رئيسي ولا يقبل الترحيل': 'Account "{name}" is a header account and does not accept posting',
  'يجب أن يكون الحساب المحاسبي لـالخزينة حساب نقدية': 'The cash box GL account must be a cash account',
  'يجب أن يكون الحساب المحاسبي لـالخزينة حساب نقدية (مصنّف بشكل صحيح في شجرة الحسابات)':
    'The cash box GL account must be a cash account (correctly classified in the chart of accounts)',
  'يجب أن يكون الحساب المحاسبي لـالحساب البنكي حساب بنك': 'The bank account GL account must be a bank account',
  'يجب أن يكون الحساب المحاسبي لـالحساب البنكي حساب بنك (مصنّف بشكل صحيح في شجرة الحسابات)':
    'The bank account GL account must be a bank account (correctly classified in the chart of accounts)',

  // ── Code settings ───────────────────────────────────────────────────────
  'تم تحديث إعداد الكود بنجاح': 'Code setting updated successfully',
  'كيان غير معروف لإعداد الأكواد': 'Unknown entity for code settings',

  // ── Accounting settings ─────────────────────────────────────────────────
  'تم حفظ إعدادات المحاسبة بنجاح': 'Accounting settings saved successfully',
  '{label}: الحساب المحدد غير موجود': '{label}: the selected account does not exist',
  '{label}: الحساب غير نشط': '{label}: the account is inactive',
  '{label}: يجب اختيار حساب فرعي قابل للترحيل (وليس حساباً رئيسياً)': '{label}: choose a postable sub-account (not a header account)',
  '{label}: نوع الحساب غير مناسب لهذا الإعداد': '{label}: the account type is not suitable for this setting',
  '{label}: تصنيف الحساب غير مناسب لهذا الإعداد': '{label}: the account classification is not suitable for this setting',
  'حساب إيرادات المبيعات': 'Sales revenue account',
  'حساب مراقبة العملاء': 'Customers control account',
  'حساب مراقبة الموردين': 'Suppliers control account',
  'حساب مخزون المواد الخام': 'Raw materials inventory account',
  'حساب مخزون المنتج التام': 'Finished goods inventory account',
  'حساب تكلفة البضاعة المباعة': 'Cost of goods sold account',
  'حساب بضاعة مباعة لم تُسلَّم': 'Goods sold not yet delivered account',
  'حساب تسويات المخزون': 'Stock adjustments account',
  'حساب رسوم التصنيع (داخلي)': 'Manufacturing fee account (internal)',
  'حساب النقدية الافتراضي': 'Default cash account',
  'حساب البنك الافتراضي': 'Default bank account',
  'ضريبة القيمة المضافة - المشتريات': 'VAT - purchases',
  'ضريبة القيمة المضافة - المبيعات': 'VAT - sales',
  'حساب مصروف عمولات المبيعات': 'Sales commission expense account',
  'حساب عمولات مستحقة للموظفين': 'Commissions payable to employees account',
  'حساب موازنة الأرصدة الافتتاحية': 'Opening balances equalization account',

  // ── Chart of accounts ───────────────────────────────────────────────────
  'تم إنشاء الحساب بنجاح': 'Account created successfully',
  'تم تعديل الحساب بنجاح': 'Account updated successfully',
  'تم حذف الحساب بنجاح': 'Account deleted successfully',
  'تم تحديث حالة الحساب': 'Account status updated',
  'كود الحساب «{code}» مكرر داخل الملف': 'Account code «{code}» is duplicated within the file',
  'كود الحساب «{code}» مستخدم بالفعل': 'Account code «{code}» is already in use',
  'الحساب الأب بكود «{code}» غير موجود — تأكد أنه مُدرج قبل هذا الصف':
    'Parent account with code «{code}» not found — make sure it is listed before this row',
  'نوع الحساب مطلوب (أو حدّد حساباً أباً يُورَث منه)': 'Account type is required (or specify a parent account to inherit it from)',
  'لم يتم العثور على الحساب الأب': 'Parent account not found',
  'لم يتم العثور على الحساب': 'Account not found',
  'لا يمكن جعل الحساب أباً لنفسه': 'An account cannot be its own parent',
  'لا يمكن حذف الحسابات الرئيسية الافتراضية': 'Default header accounts cannot be deleted',
  'لا يمكن حذف حساب يحتوي على حسابات فرعية': 'Cannot delete an account that has sub-accounts',
  'لا يمكن حذف حساب مستخدم': 'Cannot delete an account that is in use',
  'كود الحساب مستخدم بالفعل': 'Account code is already in use',
  'لا يمكن أن يكون الحساب رئيسياً وقابلاً للترحيل في نفس الوقت': 'An account cannot be both a header account and postable',
  'لا يمكن نقل الحساب إلى أحد حساباته الفرعية': 'An account cannot be moved under one of its own sub-accounts',

  // ── Reports / dashboard ─────────────────────────────────────────────────
  'نوع الحساب غير صالح': 'Invalid account type',
  'الحساب غير موجود': 'Account not found',
  'تاريخ البداية بعد تاريخ النهاية': 'Start date is after end date',
  'لا توجد سنة مالية حالية محددة': 'No current fiscal year is set',
  'لا توجد فترة محاسبية تشمل تاريخ اليوم': "No accounting period covers today's date",
  'حدد تاريخ البداية والنهاية للفترة المخصصة': 'Specify the start and end dates for the custom period',
  'تاريخ البداية يجب أن يسبق تاريخ النهاية': 'Start date must be before end date',
  'الخزينة غير موجودة': 'Cash box not found',
  'لا تملك صلاحية على هذه الخزينة': 'You do not have access to this cash box',
  'الحساب البنكي غير موجود': 'Bank account not found',
  'لا تملك صلاحية على هذا الحساب البنكي': 'You do not have access to this bank account',
};

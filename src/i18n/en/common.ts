/**
 * English for common API messages — keys are the Arabic source texts. Messages built
 * with values use {placeholders}: 'المنتج "{name}" غير موجود' → 'Product "{name}" not found'.
 */
export const common: Record<string, string> = {
  // ── Auth ────────────────────────────────────────────────────────────────
  'اسم المستخدم أو البريد الإلكتروني أو كلمة المرور غير صحيحة': 'Invalid username, email or password',
  'الحساب غير مُفعّل، تواصل مع المسؤول': 'Your account is not active, please contact the administrator',
  'الحساب مقفل، تواصل مع المسؤول': 'Your account is locked, please contact the administrator',
  'تم تسجيل الدخول بنجاح': 'Logged in successfully',
  'رمز التحديث غير صالح': 'Invalid refresh token',
  'الحساب غير متاح': 'Account is not available',
  'تم تحديث الجلسة': 'Session refreshed',
  'تم تسجيل الخروج بنجاح': 'Logged out successfully',
  'كلمة المرور الجديدة وتأكيدها غير متطابقين': 'New password and confirmation do not match',
  'المستخدم غير موجود': 'User not found',
  'كلمة المرور الحالية غير صحيحة': 'Current password is incorrect',
  'تم تغيير كلمة المرور بنجاح، يرجى تسجيل الدخول مجدداً': 'Password changed successfully, please log in again',
  'تم تغيير كلمة المرور بنجاح': 'Password changed successfully',
  'رمز الدخول غير صالح': 'Invalid access token',

  // ── Guards / permissions ────────────────────────────────────────────────
  'غير مصرح — يرجى تسجيل الدخول': 'Unauthorized — please log in',
  'ليس لديك صلاحية للقيام بهذا الإجراء': 'You do not have permission to perform this action',

  // ── Branch scope ────────────────────────────────────────────────────────
  'لا يوجد فرع مخصّص لك لتنفيذ هذه العملية': 'No branch is assigned to you to perform this operation',
  'لا يمكنك العمل على فرع غير مخصّص لك': 'You cannot work on a branch that is not assigned to you',
  'يجب اختيار الفرع': 'Branch is required',

  // ── Generic ─────────────────────────────────────────────────────────────
  'القيمة مستخدمة بالفعل': 'Value is already in use',
  'تم حفظ البيانات بنجاح': 'Data saved successfully',
  'هذه العملية متاحة لمدير النظام فقط': 'This operation is available to the system administrator only',

  // ── Reference guard (delete blocked because the record is in use) ───────
  'لا يمكن حذف {what} لأنه مستخدم في: {hits}. يمكنك إيقافه (غير نشط) بدلاً من الحذف للحفاظ على السجلات.':
    'Cannot delete {what} because it is used in: {hits}. You can deactivate it instead of deleting it to keep the records.',
  'العميل «{name}»': 'customer «{name}»',
  'المورد «{name}»': 'supplier «{name}»',
  'المنتج «{name}»': 'product «{name}»',
  'الوحدة «{name}»': 'unit «{name}»',
  // Usage list items "label (count)" joined with '، '. Keys are deliberately left
  // "open" (no closing parenthesis) so that a joined list splits correctly.
  '{a})، {b}': '{a}), {b}',
  'فواتير مبيعات ({n}': 'Sales invoices ({n}',
  'مردودات مبيعات ({n}': 'Sales returns ({n}',
  'أذون تسليم ({n}': 'Delivery notes ({n}',
  'سندات ({n}': 'Vouchers ({n}',
  'أوامر تصنيع ({n}': 'Manufacturing orders ({n}',
  'أوامر تصنيع (كمصنع) ({n}': 'Manufacturing orders (as factory) ({n}',
  'حركات كشف الحساب ({n}': 'Account statement transactions ({n}',
  'قيود يومية ({n}': 'Journal entries ({n}',
  'أرصدة افتتاحية ({n}': 'Opening balances ({n}',
  'فواتير مشتريات ({n}': 'Purchase invoices ({n}',
  'مردودات مشتريات ({n}': 'Purchase returns ({n}',
  'أصناف تصنيع في فواتير مبيعات ({n}': 'Manufactured items in sales invoices ({n}',
  'رصيد في المخازن ({n}': 'Stock in warehouses ({n}',
  'حركات مخزون ({n}': 'Stock movements ({n}',
  'مكوّنات تصنيع في فواتير مبيعات ({n}': 'Manufacturing components in sales invoices ({n}',
  'تسويات مخزنية ({n}': 'Stock adjustments ({n}',
  'تحويلات مخزنية ({n}': 'Stock transfers ({n}',
  'مكوّنات أوامر تصنيع ({n}': 'Manufacturing order components ({n}',
  'مكوّنات منتجات أخرى ({n}': 'Components of other products ({n}',
  'منتجات ({n}': 'Products ({n}',

  // ── Joined error lists ──────────────────────────────────────────────────
  '{a}؛ {b}': '{a}; {b}',
  '{a} | {b}': '{a} | {b}',
  // Import row errors joined with '؛ ' (explicit 2–4 row forms keep each row's
  // message isolated; longer lists fall back to the open-ended form).
  'صف {r1}: {m1}؛ صف {r2}: {m2}؛ صف {r3}: {m3}؛ صف {r4}: {rest}':
    'Row {r1}: {m1}; Row {r2}: {m2}; Row {r3}: {m3}; Row {r4}: {rest}',
  'صف {r1}: {m1}؛ صف {r2}: {m2}؛ صف {r3}: {m3}': 'Row {r1}: {m1}; Row {r2}: {m2}; Row {r3}: {m3}',
  'صف {r1}: {m1}؛ صف {r2}: {m2}': 'Row {r1}: {m1}; Row {r2}: {m2}',
  '{message}؛ صف {row}: {rest}': '{message}; Row {row}: {rest}',
  'صف {row}: {message}': 'Row {row}: {message}',

  // ── Excel import / templates ────────────────────────────────────────────
  'يُقبل ملف Excel بصيغة .xlsx فقط': 'Only Excel files (.xlsx) are accepted',
  'لم يتم إرفاق ملف': 'No file was attached',
  'تعذّر قراءة الملف — تأكد أنه ملف Excel صالح (.xlsx)': 'Could not read the file — make sure it is a valid Excel file (.xlsx)',
  'الملف لا يحتوي على أي ورقة بيانات': 'The file does not contain any worksheet',
  'الأعمدة التالية مفقودة في الملف: {columns}': 'The following columns are missing from the file: {columns}',
  'العمود «{column}» مطلوب': 'Column «{column}» is required',
  'العمود «{column}» يجب أن يكون رقماً': 'Column «{column}» must be a number',
  'قيمة «{value}» غير صحيحة للعمود «{column}» — القيم المسموحة: {allowed}':
    'Invalid value «{value}» for column «{column}» — allowed values: {allowed}',
  'لا توجد بيانات في الملف بعد صف العناوين': 'There is no data in the file after the header row',
  'خطأ غير متوقع في هذا الصف': 'Unexpected error in this row',
  'نوع الاستيراد «{resource}» غير معروف': 'Unknown import type «{resource}»',
  'تمت معالجة ملف الاستيراد': 'Import file processed',
  'الكود «{code}» مكرر داخل الملف': 'Code «{code}» is duplicated within the file',

  // ── AI assistant (client-facing only) ───────────────────────────────────
  'تمت معالجة الطلب': 'Request processed',
  'تم جلب المحادثات': 'Conversations loaded',
  'تم جلب المحادثة': 'Conversation loaded',
  'تم حذف المحادثة': 'Conversation deleted',
  'المحادثة غير موجودة': 'Conversation not found',
  'مساعد الذكاء الاصطناعي غير مُفعّل (لم يتم ضبط مفتاح OpenAI).': 'The AI assistant is not enabled (the OpenAI key is not configured).',
  'تعذّر الوصول إلى مساعد الذكاء الاصطناعي حالياً، حاول مرة أخرى بعد قليل.':
    'The AI assistant cannot be reached right now, please try again shortly.',
};

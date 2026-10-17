/**
 * English for inventory API messages — keys are the Arabic source texts. Messages built
 * with values use {placeholders}: 'المنتج "{name}" غير موجود' → 'Product "{name}" not found'.
 */
export const inventory: Record<string, string> = {
  // ===== Stock =====
  'معرّف المخزن غير صالح': 'Invalid warehouse ID',
  'معرّف التصنيف غير صالح': 'Invalid category ID',
  'الكمية المتاحة من المنتج {name} هي {available} فقط (الرصيد {onHand} منها {reserved} محجوزة لفواتير مبيعات لم تُسلَّم بعد)، ولا يمكن ترحيل كمية {qty}.':
    'The available quantity of product {name} is only {available} (balance {onHand}, of which {reserved} is reserved for sales invoices not yet delivered), so a quantity of {qty} cannot be posted.',
  'الكمية المتاحة من المنتج {name} هي {available} فقط، ولا يمكن ترحيل كمية {qty}.':
    'The available quantity of product {name} is only {available}, so a quantity of {qty} cannot be posted.',

  // ===== Stock adjustments =====
  'نوع التسوية غير صحيح': 'Invalid adjustment type',
  'التكلفة يجب أن تكون رقماً': 'Cost must be a number',
  'تاريخ التسوية غير صحيح': 'Invalid adjustment date',
  'لم يتم العثور على تسوية المخزون': 'Stock adjustment not found',
  'لا يمكن ترحيل تسوية غير مسودة': 'Only a draft adjustment can be posted',
  'لا يمكن ترحيل تسوية بدون أصناف': 'Cannot post an adjustment without items',
  'حساب تسويات المخزون غير محدد في إعدادات المحاسبة': 'The stock adjustments account is not set in the Accounting Settings',
  'حساب المخزون للمنتج "{name}" غير محدد': 'The inventory account for product "{name}" is not set',
  'التسوية معكوسة بالفعل': 'The adjustment is already reversed',
  'لا يمكن عكس تسوية غير مُرحّلة': 'Only a posted adjustment can be reversed',
  'تعذّر إيجاد القيد الأصلي للتسوية': 'The original journal entry of the adjustment could not be found',
  'تاريخ التسوية خارج نطاق الفترة المحاسبية': 'The adjustment date is outside the accounting period',
  'تم حفظ التسوية كمسودة بنجاح': 'Stock adjustment saved as draft',
  'تم تحديث التسوية بنجاح': 'Stock adjustment updated successfully',
  'تم حذف التسوية بنجاح': 'Stock adjustment deleted successfully',
  'تم ترحيل التسوية بنجاح': 'Stock adjustment posted successfully',
  'تم عكس التسوية بنجاح': 'Stock adjustment reversed successfully',
  'لا يمكن تعديل أو حذف تسوية مُرحّلة — استخدم العكس': 'A posted adjustment cannot be edited or deleted — use a reversal',

  // ===== Stock transfers =====
  'تاريخ التحويل غير صحيح': 'Invalid transfer date',
  'يجب اختيار المخزن المصدر': 'Please select the source warehouse',
  'يجب اختيار المخزن الوجهة': 'Please select the destination warehouse',
  'تم حفظ التحويل كمسودة بنجاح': 'Stock transfer saved as draft',
  'تم تحديث التحويل بنجاح': 'Stock transfer updated successfully',
  'تم حذف التحويل بنجاح': 'Stock transfer deleted successfully',
  'تم ترحيل التحويل بنجاح': 'Stock transfer posted successfully',
  'تم عكس التحويل بنجاح': 'Stock transfer reversed successfully',
  'لم يتم العثور على التحويل': 'Stock transfer not found',
  'لا يمكن ترحيل تحويل غير مسودة': 'Only a draft transfer can be posted',
  'لا يمكن ترحيل تحويل بدون أصناف': 'Cannot post a transfer without items',
  'المخزن المصدر والوجهة لا يمكن أن يكونا نفس المخزن': 'The source and destination warehouses cannot be the same',
  'التحويل معكوس بالفعل': 'The transfer is already reversed',
  'لا يمكن عكس تحويل غير مُرحّل': 'Only a posted transfer can be reversed',
  'لا يمكن تعديل أو حذف تحويل مُرحّل — استخدم العكس': 'A posted transfer cannot be edited or deleted — use a reversal',
  'أحد المخازن غير موجود': 'One of the warehouses does not exist',

  // ===== Manufacturing =====
  'يجب اختيار المنتج': 'Please select the product',
  'تاريخ الأمر غير صحيح': 'Invalid order date',
  'رسوم التصنيع يجب أن تكون رقماً': 'Manufacturing fee must be a number',
  'تاريخ الإنتاج غير صحيح': 'Invalid production date',
  'حالة غير صحيحة': 'Invalid status',
  'لم يتم العثور على أمر التصنيع': 'Manufacturing order not found',
  'يمكن بدء التنفيذ لأمر جديد فقط': 'Execution can only be started for a new order',
  'حدد رسوم التصنيع قبل بدء التنفيذ — تُرحَّل على المورّد عند البدء':
    'Set the manufacturing fee before starting execution — it is posted to the supplier on start',
  'المصنع (المورّد) غير موجود': 'Factory (supplier) not found',
  'المنتج المُصنّع غير موجود': 'Manufactured product not found',
  'حساب مراقبة الموردين غير محدد في إعدادات المحاسبة': 'The supplier control account is not set in the Accounting Settings',
  'حساب رسوم التصنيع (داخلي) غير محدد في إعدادات المحاسبة':
    'The (internal) manufacturing fee account is not set in the Accounting Settings',
  'حساب رسوم التصنيع غير محدد في إعدادات المحاسبة': 'The manufacturing fee account is not set in the Accounting Settings',
  'الأمر ملغى بالفعل': 'The order is already cancelled',
  'لا يمكن إلغاء أمر تم إنتاجه': 'A produced order cannot be cancelled',
  'تعذّر إيجاد قيد رسوم التصنيع الأصلي': 'The original manufacturing fee journal entry could not be found',
  'تم إنتاج هذا الأمر بالفعل': 'This order has already been produced',
  'الأمر منتهٍ': 'The order is completed',
  'الأمر ملغى': 'The order is cancelled',
  'ابدأ التنفيذ أولاً — تنفيذ الإنتاج متاح للأوامر قيد التنفيذ فقط':
    'Start execution first — running production is only available for orders in progress',
  'كمية الإنتاج غير صالحة': 'Invalid production quantity',
  'المورّد مُرحّلة عليه الرسوم عند بدء التنفيذ ولا يمكن تغييره هنا':
    'The fee was posted to the supplier when execution started, so the supplier cannot be changed here',
  'لا يمكن التصنيع بدون مكوّنات وبدون رسوم — أضف مكوّنات أو رسوم تصنيع':
    'Cannot manufacture without components and without a fee — add components or a manufacturing fee',
  'لا توجد فترة محاسبية مفتوحة تشمل هذا التاريخ': 'There is no open accounting period covering this date',
  'تم إنشاء أمر التصنيع بنجاح': 'Manufacturing order created successfully',
  'تم تحديث أمر التصنيع بنجاح': 'Manufacturing order updated successfully',
  'تم تحديث حالة أمر التصنيع بنجاح': 'Manufacturing order status updated successfully',
  'تم تنفيذ الإنتاج بنجاح': 'Production run completed successfully',
  'تم حذف أمر التصنيع بنجاح': 'Manufacturing order deleted successfully',
  'رسوم التصنيع مُرحّلة على المورّد بالفعل عند بدء التنفيذ ولا يمكن تغييرها':
    'The manufacturing fee was already posted to the supplier when execution started and cannot be changed',
  'المورّد مُرحّلة عليه الرسوم بالفعل ولا يمكن تغييره بعد بدء التنفيذ':
    'The fee has already been posted to the supplier, so the supplier cannot be changed after execution started',
  'لا يمكن تغيير حالة أمر ملغى': 'The status of a cancelled order cannot be changed',
  'لا يمكن تحديد الأمر كمنتهٍ قبل تنفيذ الإنتاج — نفّذ الإنتاج أولاً من صفحة الأمر':
    'The order cannot be marked as completed before production is run — run production first from the order page',
  'لا يمكن حذف أمر بدأ تنفيذه — يمكن إلغاؤه بدلاً من ذلك': 'An order whose execution has started cannot be deleted — cancel it instead',
  'لا يمكن تعديل أمر تم إنتاجه أو منتهٍ أو ملغى': 'A produced, completed or cancelled order cannot be edited',
  'لا توجد سنة مالية — يجب إنشاء سنة مالية أولاً': 'There is no fiscal year — create a fiscal year first',
  'لا توجد سنة مالية': 'There is no fiscal year',
  "تسوية رسوم التصنيع متاحة فقط لأمر قيد التنفيذ رُحّلت رسومه عند البدء": "A manufacturing fee adjustment is only available for an in-progress order whose fee was posted at start",
  "لا يمكن تصفير رسوم أمر تصنيع لدى مصنع خارجي — ألغِ الأمر بدلاً من ذلك": "An external factory order's fee cannot be set to zero — cancel the order instead",
};

# Mini HR — Feature Plan & User Stories

> Sami Modern ERP · Employees / HR module · Status: **Planning** · Last updated: 2026-10-09

## 1. Summary

Extend the existing **Employees** master-data screen into a small, integrated HR module so the ERP covers people as well as stock and money: a full employee profile, salary structure, advances and custody, attendance, leave, and a **monthly payroll that posts to the general ledger** through the same posting engine as every other document.

The module is built **on top of what already exists** — nothing is removed or reshaped:

| Already in the system | Reused for |
|---|---|
| `employees` (code, name, mobile, national ID, job title, branches, hire date, net salary, commission rate, active) | The employee master — extended, not replaced |
| Sales-invoice commissions (DR commission expense / CR commission payable) + commissions report | Commissions feed the monthly payroll |
| `JournalSourceType.PAYROLL` (declared, unused) | Payroll journal entries |
| Account «عهد وسلف» (123000) | Default account for employee advances / custody |
| Central posting engine, branch scope, permissions, confirmation dialog, analysis cards, print pipeline, AI tool registry | Every new HR document follows the same patterns |

### Goals
- One place to see everything about an employee (profile, pay, advances, attendance, leave, payslips, commissions).
- Payroll that is **correct in the books**: expenses per branch/department, payables, advances recovered, cash paid out through treasuries/banks.
- Small and practical — no heavy HR suite features in the first release.

### Out of scope (V1)
- Automatic income-tax brackets and social-insurance tables (handled as fixed deductions — see Decisions).
- Recruitment, performance reviews, training.
- Employee self-service portal (possible V2).

---

## 2. Phases & delivery order

| # | Phase | Depends on | Size |
|---|---|---|---|
| 1 | Employee profile 360° | — | M |
| 2 | Salary structure (components) | 1 | S |
| 3 | Advances & custody + employee statement | 1 | M |
| 6 | Monthly payroll (V1 without attendance) | 2, 3 | L |
| 4 | Attendance | 1 | M |
| 5 | Leave | 1, 4 | M |
| 7 | HR reports, dashboard & AI tools | all | S |

**Recommended order: 1 → 2 → 3 → 6 → 4 → 5 → 7.** Payroll ships early and correct; attendance and leave then plug their deductions into it without rework.

---

## 3. User stories

Format: *As a … I want … so that …* followed by acceptance criteria (AC).

### Phase 1 — Employee profile

**HR-1.1 Enriched employee record**
As an HR officer I want to record department, job grade, contract type and dates, direct manager, bank/IBAN and emergency contact, so that the employee file is complete.
- AC: new fields are optional; existing employees keep working unchanged.
- AC: department and job grade are lookups (managed lists), not free text.
- AC: contract end date earlier than start date is rejected.

**HR-1.2 Employment status lifecycle**
As an HR officer I want to move an employee between *Active → On leave → Resigned / Terminated* with a date and reason, so that history is preserved instead of deleting people.
- AC: a resigned/terminated employee disappears from pickers (sales commission, payroll) after the end date but stays in reports.
- AC: the change is confirmed through the global confirmation dialog.

**HR-1.3 Employee documents**
As an HR officer I want to attach scanned documents (contract, national ID, certificates) with an optional expiry date, so that paperwork is in one place.
- AC: upload / preview / delete; expiry within 30 days is flagged on the profile and dashboard.

**HR-1.4 Link to a system user**
As an admin I want to link an employee to a user account, so that later self-service and approvals know who is who.
- AC: one user ↔ at most one employee.

**HR-1.5 Employee 360° page**
As a manager I want one page showing profile, salary, advances balance, attendance summary, leave balances, payslips and sales commissions, so that I don't have to search several screens.
- AC: tabs follow the existing details-page design (page header, stat cards, section cards).

### Phase 2 — Salary structure

**HR-2.1 Pay components catalogue**
As a payroll officer I want to define earnings (basic, transport, housing, …) and deductions (insurance, fixed penalty, …) once, so that every employee's pay is built from the same building blocks.
- AC: each component has type (earning/deduction), calculation (fixed amount or % of basic), and an optional GL account override.

**HR-2.2 Employee salary package with effective date**
As a payroll officer I want to assign components and amounts to an employee with an effective-from date, so that raises apply from the right month without rewriting history.
- AC: payroll of a month uses the package effective in that month.
- AC: the existing `netSalary` field is migrated into a "basic" component (non-destructive).

### Phase 3 — Advances & custody

**HR-3.1 Advance request & payment**
As an HR officer I want to register an advance (amount, reason, number of monthly installments) and pay it from a treasury/bank, so that it is tracked and recovered automatically.
- AC: payment posts DR «سلف الموظفين» / CR treasury|bank and appears on the treasury statement.
- AC: the installment schedule is generated and editable before approval.

**HR-3.2 Custody (عهدة)**
As a finance officer I want to give and settle employee custody, so that cash in employees' hands is controlled.
- AC: settlement can be by returned cash or by expense receipts (DR expense / CR custody).

**HR-3.3 Employee statement**
As finance I want a statement per employee (advances, installments, custody, salary payable, payments), so that the balance owed by/to the employee is clear.
- AC: same look & behaviour as the customer/supplier statement (running balance, Excel/PDF export).

### Phase 6 — Monthly payroll

**HR-6.1 Create a payroll run**
As a payroll officer I want to create a payroll run for a month (optionally per branch), so that all active employees' pay is calculated in one go.
- AC: lines = earnings + **sales commissions of the month (from posted invoices)** + overtime − absence/lateness deductions − advance installments due − penalties + bonuses.
- AC: one run per branch per month (duplicates refused).

**HR-6.2 Review and adjust**
As a payroll officer I want to review every line and add one-off bonuses/penalties with a note before approval, so that exceptions are handled without editing master data.

**HR-6.3 Approve & post**
As a finance manager I want to approve the run, so that it posts to the ledger.
- AC: posts DR salaries expense (per branch/department) + DR commission payable / CR salaries payable + CR «سلف الموظفين» (installments recovered).
- AC: confirmation dialog shows totals per branch; posting into a closed period is refused.
- AC: a posted run can be reversed (reversal entry), never edited.

**HR-6.4 Pay salaries**
As finance I want to pay the approved run from a treasury or bank (all at once or per employee), so that cash and payables match.
- AC: DR salaries payable / CR treasury|bank; bank-transfer file export (CSV) for bank payments.

**HR-6.5 Payslip**
As an employee/HR I want a printable payslip, so that each employee gets a clear breakdown.
- AC: uses the shared print pipeline (company header, no system name).

### Phase 4 — Attendance

**HR-4.1 Shifts, working days & holidays**
As HR I want to define shifts (start/end, grace minutes), weekly days off and public holidays, so that lateness, absence and overtime are computed consistently.

**HR-4.2 Record attendance**
As HR I want to enter attendance manually **or import it from the fingerprint device export (Excel/CSV)**, so that I don't retype device data.
- AC: import preview shows matched/unmatched employees and errors before saving (same pattern as the existing Excel import dialog).

**HR-4.3 Monthly attendance summary**
As payroll I want each employee's monthly lateness minutes, absence days and overtime hours, so that payroll deductions/additions are automatic.

### Phase 5 — Leave

**HR-5.1 Leave types & yearly balances**
As HR I want leave types (annual, sick, unpaid, …) with yearly entitlement and carry-over rules, so that balances are tracked per employee.

**HR-5.2 Leave request & approval**
As a manager I want to approve or reject leave requests, so that absences are planned.
- AC: approved leave reduces the balance and marks the days as excused in attendance; unpaid leave becomes a payroll deduction.

### Phase 7 — Reports, dashboard & AI

**HR-7.1 HR dashboard**: headcount by branch/department, joiners/leavers, payroll cost trend, advances outstanding, documents expiring.
**HR-7.2 Reports**: payroll register, attendance report, leave balances, advances aging — with filter-aware analysis cards and Excel/PDF export.
**HR-7.3 AI assistant tools**: read-only tools (headcount, payroll cost, an employee's advances/leave) following the existing tool registry and permissions.

---

## 4. Technical design (summary)

### Backend
New `hr` module (NestJS) reusing: `createSystemJournalEntry` (source `payroll`), branch scope, permissions, document numbering (`PR-YYYY-000001` for payroll runs, `ADV-…` for advances), migrations (additive only).

New tables:
`departments`, `job_grades`, `employee_documents`, `pay_components`, `employee_pay_components`, `employee_advances`, `employee_advance_installments`, `employee_transactions`, `shifts`, `holidays`, `attendance_records`, `leave_types`, `leave_balances`, `leave_requests`, `payroll_runs`, `payroll_lines`, `payroll_line_components`.

Employees table: additive columns only (department, grade, contract fields, manager, bank, status, user link).

### Accounting settings (new, optional with department-level override like product categories)
- Salaries expense · Salaries payable · Employee advances (default «عهد وسلف») · optional Overtime / Bonuses expense.

### Permissions (new)
`hr.view`, `hr.manage`, `hr.documents`, `advances.manage`, `attendance.manage`, `leave.request`, `leave.approve`, `payroll.run`, `payroll.approve`, `payroll.post`, `payroll.pay`.

### Frontend (Angular)
New sidebar group «الموارد البشرية»: الموظفون · الحضور · الإجازات · السلف والعهد · الرواتب · تقارير الموارد البشرية. All pages follow the design system (page header, stat cards, section cards, filter bar + chips, global confirmation dialog).

---

## 5. Open decisions (needed before Phase 1 starts)

1. **Tax & social insurance** — automatic brackets/rates, or fixed manual deductions in V1? *(Recommended: fixed deductions in V1.)*
2. **Attendance source** — fingerprint device (model? Excel export or API?) or manual entry?
3. **Approval chain** — who approves leave and advances: direct manager, then HR?
4. **Self-service** — will employees log in (requests, payslips) or does HR enter everything in V1?
5. **Commissions** — paid inside the monthly payroll *(recommended)* or separately as today?
6. **Pre-requisite field(s)** — additional field(s) to add before Phase 1 (to be confirmed by the product owner).

---

## 6. Definition of done (every phase)
- Migrations are additive; production data untouched; tested on a copy first.
- Backend typecheck + unit tests green; Angular build clean.
- Every state-changing action uses the global confirmation dialog and existing permissions/branch scope.
- Postings verified on dev (balanced entries, correct accounts, subledgers match).
- Analysis cards + Excel/PDF exports on every new list.
- AI assistant tools updated for the new data.

import { z } from 'zod';

/** Un gasto solo entra al presupuesto cuando esta `confirmed`. */
export const EXPENSE_STATUSES = ['pending', 'confirmed', 'rejected', 'reversed'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const EXPENSE_SOURCES = ['manual', 'recurring'] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

export const ACCOUNT_KINDS = ['debit', 'credit', 'wallet', 'cash'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const RECURRING_INSTANCE_STATUSES = ['planned', 'posted', 'skipped'] as const;
export type RecurringInstanceStatus = (typeof RECURRING_INSTANCE_STATUSES)[number];

const id = z.string().min(1);
const isoDate = z.string().datetime({ offset: true });
const cents = z.number().int();
const nonNegativeCents = z.number().int().nonnegative();

export const accountSchema = z.object({
  id,
  name: z.string().min(1),
  kind: z.enum(ACCOUNT_KINDS),
  /** Ultimos digitos, para cruzar notificaciones con la cuenta correcta. */
  last4: z.string().regex(/^\d{3,4}$/).nullish(),
  institution: z.string().nullish(),
  currency: z.string().length(3).default('COP'),
  color: z.string().nullish(),
  isArchived: z.boolean().default(false),
});
export type Account = z.infer<typeof accountSchema>;

export const categorySchema = z.object({
  id,
  name: z.string().min(1),
  parentId: id.nullish(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
  isArchived: z.boolean().default(false),
});
export type Category = z.infer<typeof categorySchema>;

export const personSchema = z.object({
  id,
  name: z.string().min(1),
  phone: z.string().nullish(),
  email: z.string().email().nullish(),
  avatarUri: z.string().nullish(),
  isArchived: z.boolean().default(false),
});
export type Person = z.infer<typeof personSchema>;

export const expenseSplitSchema = z.object({
  id,
  expenseId: id,
  personId: id,
  amountCents: nonNegativeCents,
  note: z.string().nullish(),
  notifiedAt: isoDate.nullish(),
  acceptedAt: isoDate.nullish(),
});
export type ExpenseSplit = z.infer<typeof expenseSplitSchema>;

export const expenseSchema = z.object({
  id,
  accountId: id.nullish(),
  categoryId: id.nullish(),
  status: z.enum(EXPENSE_STATUSES),
  source: z.enum(EXPENSE_SOURCES),
  /** Valor completo de la transaccion, sin importar con quien se comparta. */
  amountTotalCents: nonNegativeCents,
  /** Lo que realmente consume mi presupuesto. Se recalcula desde los splits. */
  myShareCents: nonNegativeCents,
  currency: z.string().length(3).default('COP'),
  merchantRaw: z.string().nullish(),
  merchantNormalized: z.string().nullish(),
  description: z.string().nullish(),
  notes: z.string().nullish(),
  occurredAt: isoDate,
  confirmedAt: isoDate.nullish(),
  recurringExpenseId: id.nullish(),
  createdAt: isoDate,
  updatedAt: isoDate,
  deletedAt: isoDate.nullish(),
});
export type Expense = z.infer<typeof expenseSchema>;

export const settlementSchema = z.object({
  id,
  personId: id,
  amountCents: nonNegativeCents,
  paidAt: isoDate,
  method: z.string().nullish(),
  note: z.string().nullish(),
});
export type Settlement = z.infer<typeof settlementSchema>;

/** Un abono puede cubrir varios splits, y un split puede recibir varios abonos. */
export const settlementAllocationSchema = z.object({
  id,
  settlementId: id,
  splitId: id,
  amountCents: nonNegativeCents,
});
export type SettlementAllocation = z.infer<typeof settlementAllocationSchema>;

/**
 * Mi parte de un gasto que pago otra persona.
 *
 * No es un gasto reversado ni un reparto negativo: del gasto de otro no se
 * conoce nada mas que lo que esa persona comparta, asi que se guarda suelto,
 * con el nombre de lo que fue y el dia.
 */
export const owedShareSchema = z.object({
  id,
  personId: id,
  amountCents: nonNegativeCents,
  description: z.string().nullish(),
  occurredAt: isoDate,
  /** Con fecha, ya se le pago. */
  settledAt: isoDate.nullish(),
});
export type OwedShare = z.infer<typeof owedShareSchema>;

export const budgetCategoryLimitSchema = z.object({
  id,
  budgetId: id,
  categoryId: id,
  limitCents: nonNegativeCents,
});
export type BudgetCategoryLimit = z.infer<typeof budgetCategoryLimitSchema>;

export const budgetSchema = z.object({
  id,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  totalCents: nonNegativeCents,
  /** Umbrales de alerta como fracciones: 0.5, 0.8, 1. */
  alertThresholds: z.array(z.number().positive()).default([0.5, 0.8, 1]),
});
export type Budget = z.infer<typeof budgetSchema>;

export const recurringExpenseSchema = z.object({
  id,
  name: z.string().min(1),
  categoryId: id.nullish(),
  accountId: id.nullish(),
  /** Estimado cuando el monto varia mes a mes (servicios publicos). */
  amountCents: nonNegativeCents,
  isVariable: z.boolean().default(false),
  dueDay: z.number().int().min(1).max(31).default(1),
  isActive: z.boolean().default(true),
  startMonth: z.string().nullish(),
  endMonth: z.string().nullish(),
});
export type RecurringExpense = z.infer<typeof recurringExpenseSchema>;

export const recurringInstanceSchema = z.object({
  id,
  recurringExpenseId: id,
  month: z.string(),
  status: z.enum(RECURRING_INSTANCE_STATUSES),
  /** Monto reservado en el presupuesto mientras no se ha pagado. */
  plannedCents: nonNegativeCents,
  expenseId: id.nullish(),
  dueDate: isoDate,
});
export type RecurringInstance = z.infer<typeof recurringInstanceSchema>;

import { z } from 'zod';
import { CATEGORIES } from './analytics/summarize';

/**
 * Every API route validates its body through one of these before anything
 * touches the database. The split engine throws on bad input too, but a 400
 * with a readable message beats a 500 from deep inside allocate().
 */

const minor = z.number().int().safe();
const positiveMinor = minor.refine((v) => v > 0, 'Amount must be greater than zero');

export const splitSpecSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('EQUAL'),
    participants: z.array(z.string().min(1)).min(1, 'Pick at least one person'),
  }),
  z.object({
    mode: z.literal('EXACT'),
    amounts: z.record(z.string(), minor),
  }),
  z.object({
    mode: z.literal('PERCENT'),
    basisPoints: z.record(z.string(), z.number().int().min(0).max(10_000)),
  }),
  z.object({
    mode: z.literal('SHARES'),
    shares: z.record(z.string(), z.number().min(0).max(1000)),
  }),
  z.object({
    mode: z.literal('ITEMIZED'),
    participants: z.array(z.string().min(1)).min(1),
    items: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1).max(120),
      amountMinor: positiveMinor,
      participants: z.array(z.string().min(1)),
    })).min(1, 'Add at least one item'),
    taxMinor: minor.optional(),
    tipMinor: minor.optional(),
    discountMinor: minor.min(0).optional(),
  }),
]);

export const createExpenseSchema = z.object({
  description: z.string().trim().min(1, 'Give the expense a description').max(140),
  totalMinor: positiveMinor,
  category: z.enum(CATEGORIES).default('OTHER'),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
  receiptUrl: z.string().max(500).optional(),
  /** userId -> amount fronted. Must sum to totalMinor. */
  payments: z.record(z.string(), minor).refine(
    (p) => Object.values(p).length > 0,
    'Somebody has to have paid',
  ),
  split: splitSpecSchema,
});

export const settleSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amountMinor: positiveMinor,
  method: z.enum(['CASH', 'UPI', 'BANK', 'OTHER']).default('CASH'),
  note: z.string().trim().max(200).optional(),
}).refine((v) => v.fromUserId !== v.toUserId, {
  message: 'A settlement needs two different people',
  path: ['toUserId'],
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1, 'Give the group a name').max(60),
  description: z.string().trim().max(200).optional(),
  currency: z.string().trim().length(3).toUpperCase().default('INR'),
  emoji: z.string().trim().max(8).optional(),
  /** Emails of people to add. Unknown emails are reported back, not invented. */
  memberEmails: z.array(z.string().email()).max(50).default([]),
});

export const createRecurringSchema = z.object({
  description: z.string().trim().min(1).max(140),
  totalMinor: positiveMinor,
  category: z.enum(CATEGORIES).default('OTHER'),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  interval: z.number().int().min(1).max(52).default(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  payments: z.record(z.string(), minor),
  split: splitSpecSchema,
});

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'What should we call you?').max(60),
  email: z.string().trim().toLowerCase().email('That does not look like an email address'),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  upiId: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Enter your password'),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;

import 'server-only';

// Type-only - erased at build time, so the real import stays dynamic.
import type { Row } from 'exceljs';

import { exponentOf, type Minor } from '../money';
import type { GroupAnalytics, ExpenseRecord } from '../analytics/summarize';
import { categoryMeta } from '../analytics/summarize';
import type { Transfer, UserId } from '../split/types';

/**
 * Builds the .xlsx export.
 *
 * One rule shapes the whole thing: every amount is written as a real number
 * with a currency number format, never as a pre-formatted string. An export
 * people cannot SUM() over is a screenshot with extra steps - and the first
 * thing anyone does with a spreadsheet of expenses is select a column and look
 * at the total.
 */

export interface ExportInput {
  groupName: string;
  currency: string;
  members: Array<{ id: UserId; name: string }>;
  expenses: ExpenseRecord[];
  analytics: GroupAnalytics;
  settleUp: Transfer[];
  settlements: Array<{ from: UserId; to: UserId; amountMinor: Minor; settledAt: Date; method: string }>;
  generatedAt?: Date;
}

const HEADER_FILL = 'FF1B1E27';
const HEADER_FONT = 'FFFFFFFF';
const ACCENT = 'FF10B981';

/** 1 -> A, 26 -> Z, 27 -> AA. Naive charCode math breaks past column Z. */
function columnLetter(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Minor units -> the decimal number Excel should hold. */
function toNumber(minor: Minor, currency: string): number {
  return minor / 10 ** exponentOf(currency);
}

/** An Excel number format string for the currency, e.g. '₹#,##0.00'. */
function numFmt(currency: string): string {
  const exp = exponentOf(currency);
  const decimals = exp === 0 ? '' : `.${'0'.repeat(exp)}`;
  const symbols: Record<string, string> = {
    INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
  };
  const sym = symbols[currency.toUpperCase()] ?? '';
  return `"${sym}"#,##0${decimals};[Red]-"${sym}"#,##0${decimals}`;
}

export async function buildWorkbook(input: ExportInput): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const generatedAt = input.generatedAt ?? new Date();

  wb.creator = 'SplitSmart';
  wb.created = generatedAt;

  const fmt = numFmt(input.currency);
  const nameOf = new Map(input.members.map((m) => [m.id, m.name]));
  const who = (id: UserId) => nameOf.get(id) ?? id;

  const styleHeader = (row: Row) => {
    row.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    row.alignment = { vertical: 'middle' };
    row.height = 22;
  };

  // ---------------------------------------------------------------- Summary
  {
    const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: ACCENT } } });
    ws.columns = [{ width: 28 }, { width: 24 }];

    ws.addRow([input.groupName]).font = { bold: true, size: 16 };
    ws.addRow([`Exported ${generatedAt.toLocaleString()}`]).font = { italic: true, size: 9, color: { argb: 'FF8591AA' } };
    ws.addRow([]);

    const a = input.analytics;
    const rows: Array<[string, string | number, boolean?]> = [
      ['Total spend', toNumber(a.totalMinor, input.currency), true],
      ['Expenses recorded', a.expenseCount],
      ['Average expense', toNumber(a.averageMinor, input.currency), true],
      ['Largest expense', a.largest ? a.largest.description : '-'],
      ['Largest amount', a.largest ? toNumber(a.largest.totalMinor, input.currency) : 0, true],
      ['Top category', a.topCategory ? categoryMeta(a.topCategory.category).label : '-'],
      ['Busiest month', a.busiestMonth ? a.busiestMonth.label : '-'],
      ['Members', input.members.length],
      ['Payments to settle up', input.settleUp.length],
    ];
    for (const [label, value, isMoney] of rows) {
      const r = ws.addRow([label, value]);
      r.getCell(1).font = { bold: true };
      if (isMoney) r.getCell(2).numFmt = fmt;
    }
  }

  // --------------------------------------------------------------- Expenses
  {
    const ws = wb.addWorksheet('Expenses');
    // A column per member holding that member's share, so the sheet doubles as
    // a full audit trail you can pivot on.
    const header = ['Date', 'Description', 'Category', 'Total', 'Paid by', ...input.members.map((m) => `${m.name} owes`)];
    ws.columns = [
      { width: 12 }, { width: 34 }, { width: 16 }, { width: 14 }, { width: 24 },
      ...input.members.map(() => ({ width: 14 })),
    ];
    styleHeader(ws.addRow(header));
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const sorted = [...input.expenses].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (const e of sorted) {
      const payers = Object.entries(e.payments)
        .filter(([, amt]) => amt !== 0)
        .map(([id]) => who(id))
        .join(', ');
      const row = ws.addRow([
        e.date,
        e.description,
        categoryMeta(e.category).label,
        toNumber(e.totalMinor, input.currency),
        payers || '-',
        ...input.members.map((m) => toNumber(e.shares[m.id] ?? 0, input.currency)),
      ]);
      row.getCell(1).numFmt = 'dd mmm yyyy';
      for (let c = 4; c <= header.length; c++) {
        if (c === 5) continue;
        row.getCell(c).numFmt = fmt;
      }
    }

    // A real SUM row, not a hardcoded figure - it keeps working if rows are edited.
    if (sorted.length > 0) {
      const last = sorted.length + 1;
      const totals = ws.addRow(['', 'TOTAL', '', { formula: `SUM(D2:D${last})` }, '',
        ...input.members.map((_, i) => {
          const col = columnLetter(6 + i); // member columns start at F
          return { formula: `SUM(${col}2:${col}${last})` };
        }),
      ]);
      totals.font = { bold: true };
      totals.border = { top: { style: 'double' } };
      for (let c = 4; c <= header.length; c++) {
        if (c === 5) continue;
        totals.getCell(c).numFmt = fmt;
      }
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
  }

  // --------------------------------------------------------------- Balances
  {
    const ws = wb.addWorksheet('Balances');
    ws.columns = [{ width: 24 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 28 }];
    styleHeader(ws.addRow(['Member', 'Paid', 'Owed', 'Net', 'Position']));

    for (const m of input.analytics.byMember) {
      const row = ws.addRow([
        who(m.userId),
        toNumber(m.paidMinor, input.currency),
        toNumber(m.owedMinor, input.currency),
        toNumber(m.netMinor, input.currency),
        m.netMinor > 0 ? 'Is owed' : m.netMinor < 0 ? 'Owes the group' : 'Settled',
      ]);
      for (let c = 2; c <= 4; c++) row.getCell(c).numFmt = fmt;
      row.getCell(4).font = {
        bold: true,
        color: { argb: m.netMinor > 0 ? 'FF059669' : m.netMinor < 0 ? 'FFDC2626' : 'FF64748B' },
      };
    }
  }

  // --------------------------------------------------------------- Settle up
  {
    const ws = wb.addWorksheet('Settle up');
    ws.columns = [{ width: 24 }, { width: 24 }, { width: 16 }];
    ws.addRow([`${input.settleUp.length} payment(s) clear every balance in this group`]).font = {
      italic: true, color: { argb: 'FF8591AA' },
    };
    ws.addRow([]);
    styleHeader(ws.addRow(['From', 'To', 'Amount']));
    for (const t of input.settleUp) {
      const row = ws.addRow([who(t.from), who(t.to), toNumber(t.amountMinor, input.currency)]);
      row.getCell(3).numFmt = fmt;
    }
    if (input.settleUp.length === 0) ws.addRow(['Everyone is settled up.']);
  }

  // ------------------------------------------------------- Categories + log
  {
    const ws = wb.addWorksheet('By category');
    ws.columns = [{ width: 22 }, { width: 16 }, { width: 12 }, { width: 12 }];
    styleHeader(ws.addRow(['Category', 'Total', 'Expenses', 'Share']));
    for (const c of input.analytics.byCategory) {
      const row = ws.addRow([
        categoryMeta(c.category).label,
        toNumber(c.totalMinor, input.currency),
        c.count,
        c.share,
      ]);
      row.getCell(2).numFmt = fmt;
      row.getCell(4).numFmt = '0.0%';
    }
  }

  {
    const ws = wb.addWorksheet('Settlements');
    ws.columns = [{ width: 14 }, { width: 24 }, { width: 24 }, { width: 16 }, { width: 14 }];
    styleHeader(ws.addRow(['Date', 'From', 'To', 'Amount', 'Method']));
    for (const s of input.settlements) {
      const row = ws.addRow([
        s.settledAt, who(s.from), who(s.to), toNumber(s.amountMinor, input.currency), s.method,
      ]);
      row.getCell(1).numFmt = 'dd mmm yyyy';
      row.getCell(4).numFmt = fmt;
    }
    if (input.settlements.length === 0) ws.addRow(['No settlements recorded yet.']);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * CSV alternative - one flat table, no dependencies, opens anywhere.
 * Offered alongside .xlsx because plenty of people just want to paste it
 * somewhere else.
 */
export function buildCsv(input: ExportInput): string {
  const nameOf = new Map(input.members.map((m) => [m.id, m.name]));
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ['Date', 'Description', 'Category', `Total (${input.currency})`, 'Paid by',
    ...input.members.map((m) => `${m.name} owes`)];
  const lines = [header.map(esc).join(',')];

  for (const e of [...input.expenses].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const payers = Object.entries(e.payments)
      .filter(([, amt]) => amt !== 0)
      .map(([id]) => nameOf.get(id) ?? id)
      .join(' + ');
    lines.push([
      e.date.toISOString().slice(0, 10),
      e.description,
      categoryMeta(e.category).label,
      toNumber(e.totalMinor, input.currency).toFixed(exponentOf(input.currency)),
      payers || '-',
      ...input.members.map((m) =>
        toNumber(e.shares[m.id] ?? 0, input.currency).toFixed(exponentOf(input.currency))),
    ].map(esc).join(','));
  }
  return lines.join('\n');
}

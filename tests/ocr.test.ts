import { describe, expect, it } from 'vitest';
import { parseReceiptText, unaccounted } from '@/lib/ocr/parse';

// A realistic Indian restaurant printout, including the noise Tesseract
// actually produces: inconsistent spacing, a GSTIN, a phone number, and a
// payment line after the total.
const RESTAURANT = `
BARBEQUE CORNER
12 MG Road, Bengaluru 560001
GSTIN: 29AABCU9603R1ZJ
Tel: 080-41234567
Bill No: 4471        Table: 12
Date: 14/03/2026

2 x Paneer Tikka            450.00
1 Butter Naan                70.00
Dal Makhani                 320.00
3 x Masala Chai             120.00
Gulab Jamun                 140.00

Sub Total                  1100.00
CGST 2.5%                    27.50
SGST 2.5%                    27.50
Service Charge              110.00
Grand Total                1265.00

Paid by UPI                1265.00
Thank you! Visit again
`;

describe('parseReceiptText - restaurant bill', () => {
  const r = parseReceiptText(RESTAURANT);

  it('pulls out the line items and nothing else', () => {
    expect(r.items.map((i) => i.label)).toEqual([
      'Paneer Tikka',
      'Butter Naan',
      'Dal Makhani',
      'Masala Chai',
      'Gulab Jamun',
    ]);
  });

  it('reads quantities off the front of the line', () => {
    expect(r.items[0]).toMatchObject({ label: 'Paneer Tikka', quantity: 2, amountMinor: 45000 });
    expect(r.items[3]).toMatchObject({ label: 'Masala Chai', quantity: 3, amountMinor: 12000 });
  });

  it('separates tax, service charge and total', () => {
    expect(r.taxMinor).toBe(5500); // 27.50 CGST + 27.50 SGST
    expect(r.tipMinor).toBe(11000); // service charge
    expect(r.subtotalMinor).toBe(110000);
    expect(r.totalMinor).toBe(126500);
  });

  it('ignores the GSTIN, phone number and payment line', () => {
    const labels = r.items.map((i) => i.label.toLowerCase()).join(' ');
    expect(labels).not.toMatch(/gstin|tel|paid|upi|bill no/);
  });

  it('grabs the date and merchant', () => {
    expect(r.merchant).toBe('BARBEQUE CORNER');
    expect(r.date).toBe('14/03/2026');
  });

  it('reconciles, so it reports high confidence and no warnings', () => {
    // 1100 + 55 + 110 = 1265 exactly.
    expect(unaccounted(r)).toBe(0);
    expect(r.warnings).toEqual([]);
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('parseReceiptText - groceries with a discount', () => {
  const r = parseReceiptText(`
BIGBASKET
Milk 1L                      66.00
Amul Butter 500g            265.00
Brown Bread                  45.00
Eggs x10                     90.00
Subtotal                    466.00
Discount - FIRST50           50.00
Total Payable               416.00
`);

  it('treats the discount as a subtraction, not an item', () => {
    expect(r.discountMinor).toBe(5000);
    expect(r.items.map((i) => i.label)).not.toContain('Discount - FIRST50');
  });

  it('reads a trailing quantity', () => {
    expect(r.items.find((i) => i.label === 'Eggs')).toMatchObject({ quantity: 10, amountMinor: 9000 });
  });

  it('still balances', () => {
    expect(unaccounted(r)).toBe(0);
    expect(r.warnings).toEqual([]);
  });
});

describe('parseReceiptText - when OCR goes wrong', () => {
  it('flags a bill that does not add up instead of returning it quietly', () => {
    const r = parseReceiptText(`
CAFE
Latte                       250.00
Croissant                   180.00
Total                      1430.00
`);
    expect(r.warnings.join(' ')).toMatch(/printed total/i);
    expect(r.confidence).toBeLessThan(0.8);
    expect(unaccounted(r)).toBe(100000);
  });

  it('says so plainly when nothing could be read', () => {
    const r = parseReceiptText('~~~ ### ???');
    expect(r.items).toEqual([]);
    expect(r.confidence).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/no line items/i);
  });

  it('does not mistake a phone number for a price', () => {
    const r = parseReceiptText('Contact us 9876543210\nChai 20.00\nTotal 20.00');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].label).toBe('Chai');
  });

  it('handles a receipt with no total at all', () => {
    const r = parseReceiptText('Chai 20.00\nSamosa 30.00');
    expect(r.totalMinor).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/no total/i);
  });
});

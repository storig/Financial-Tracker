import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CATEGORY_SLOTS,
  computeDashboardSummary,
  computeIncomeSavingsLoans,
  computePurposeAndMethods,
  computeWeeklyBreakdown,
  computeYearly12MMatrix,
  matchCategoryInPlace,
  parseSmartDateInPlace,
  parseSmartMethodInPlace,
  resolveActiveMonth,
} from './financialEngine';
import { INITIAL_SEED_TRANSACTIONS } from './seedData';

test('matchCategoryInPlace resolves shorthand codes and routes FlowType accurately', () => {
  const sal = matchCategoryInPlace('sal', DEFAULT_CATEGORY_SLOTS);
  assert.deepEqual(sal, { name: 'Salary', flow: 'Incoming' });

  const fod = matchCategoryInPlace('fod', DEFAULT_CATEGORY_SLOTS);
  assert.deepEqual(fod, { name: 'Food & Dining', flow: 'Outgoing' });

  const prot = matchCategoryInPlace('whey', DEFAULT_CATEGORY_SLOTS);
  assert.deepEqual(prot, { name: 'Protein & Supplements', flow: 'Outgoing' });

  const rec = matchCategoryInPlace('loan rec', DEFAULT_CATEGORY_SLOTS);
  assert.deepEqual(rec, { name: 'Loan Recovery', flow: 'Incoming' });
});

test('parseSmartMethodInPlace resolves payment method shorthand', () => {
  assert.equal(parseSmartMethodInPlace('dig'), 'Digital');
  assert.equal(parseSmartMethodInPlace('d'), 'Digital');
  assert.equal(parseSmartMethodInPlace('online'), 'Digital');
  assert.equal(parseSmartMethodInPlace('c'), 'Cash');
  assert.equal(parseSmartMethodInPlace('cash'), 'Cash');
  assert.equal(parseSmartMethodInPlace('cr'), 'Credit');
  assert.equal(parseSmartMethodInPlace('card'), 'Credit');
});

test('parseSmartDateInPlace parses day numbers, relative dates, and enforces 1-month rule', () => {
  const refNow = new Date(2026, 9, 23); // Oct 23, 2026 (month 9)

  const singleDay = parseSmartDateInPlace('12', 2026, 9, refNow);
  assert.equal(singleDay.dateStr, '2026-10-12');
  assert.equal(singleDay.monthChanged, false);

  const yesterday = parseSmartDateInPlace('yesterday', 2026, 9, refNow);
  assert.equal(yesterday.dateStr, '2026-10-22');
  assert.equal(yesterday.monthChanged, false);

  // Different month ("15 sep 2026") should keep day 15 in October 2026 and flag monthChanged = true
  const diffMonth = parseSmartDateInPlace('15 sep 2026', 2026, 9, refNow);
  assert.equal(diffMonth.dateStr, '2026-10-15');
  assert.equal(diffMonth.monthChanged, true);
});

test('resolveActiveMonth parses month strings and keywords', () => {
  const refNow = new Date(2026, 9, 23);
  assert.equal(resolveActiveMonth('', refNow).label, 'October 2026');
  assert.equal(resolveActiveMonth('current', refNow).label, 'October 2026');
  assert.equal(resolveActiveMonth('nov 26', refNow).label, 'November 2026');
});

test('computeDashboardSummary calculates exact incoming, outgoing, savings, and category allocations', () => {
  const refNow = new Date(2026, 9, 23);
  const summary = computeDashboardSummary(
    INITIAL_SEED_TRANSACTIONS,
    DEFAULT_CATEGORY_SLOTS,
    '',
    refNow
  );

  // Incoming: Salary 185000 + Bonus 25000 + Loans 20000 + Loan Recovery 5000 + Gifts 5000 = 240,000
  assert.equal(summary.totalIncoming, 240000);

  // Shopping & Personal has 7% of 240,000 = 16,800 limit, spent 18,500 -> EXCEEDED (+Rs. 1,700)
  const shoppingRow = summary.categoryRows.find((r) => r.name === 'Shopping & Personal');
  assert.ok(shoppingRow);
  assert.equal(shoppingRow.allocatedLimit, 16800);
  assert.equal(shoppingRow.actualSpent, 18500);
  assert.equal(shoppingRow.isSafe, false);
  assert.equal(shoppingRow.statusText, 'EXCEEDED (+Rs. 1,700)');

  // Sadaqah has 5% of 240,000 = 12,000 limit, spent 6,500 -> Rs. 5,500 Left to Give
  assert.equal(summary.sadaqahGoalText, 'Rs. 5,500 Left to Give');

  // Dual Loans: Payable = 20,000 (Loans) - 8,000 (Loan Repayment) = 12,000
  assert.equal(summary.netPayableLoans, 12000);
  // Receivable = 12,000 (Giving Loan) - 5,000 (Loan Recovery) = 7,000
  assert.equal(summary.netReceivableLoans, 7000);

  // Default allocated % sum = 85%, so Unallocated Target % = 15% (Rs. 36,000)
  assert.equal(Math.round(summary.totalAllocatedPct * 100), 85);
  assert.equal(Math.round(summary.unallocatedPlannedPct * 100), 15);
  assert.equal(summary.unallocatedPlannedRs, 36000);
});

test('computeIncomeSavingsLoans, computeWeeklyBreakdown, computePurposeAndMethods, and computeYearly12MMatrix stay consistent', () => {
  const refNow = new Date(2026, 9, 23);
  const summary = computeDashboardSummary(
    INITIAL_SEED_TRANSACTIONS,
    DEFAULT_CATEGORY_SLOTS,
    '',
    refNow
  );
  const isl = computeIncomeSavingsLoans(INITIAL_SEED_TRANSACTIONS, summary);
  assert.equal(isl.totalIncomingMonthly, summary.totalIncoming);
  assert.equal(isl.savingsMechanics.length, 10);

  const weekly = computeWeeklyBreakdown(INITIAL_SEED_TRANSACTIONS, summary);
  assert.equal(weekly.totalOutgoingSum, summary.totalSpent);
  assert.equal(weekly.totalIncomingSum, summary.totalIncoming);

  const pm = computePurposeAndMethods(INITIAL_SEED_TRANSACTIONS, summary);
  assert.equal(pm.totalMethodStats.monthlyIncoming, summary.totalIncoming);
  assert.equal(pm.totalMethodStats.monthlyOutgoing, summary.totalSpent);

  const yr = computeYearly12MMatrix(INITIAL_SEED_TRANSACTIONS, DEFAULT_CATEGORY_SLOTS, 2026);
  // October is index 9
  assert.equal(yr.totalIncomingRow.months[9], summary.totalIncoming);
  assert.equal(yr.totalOutgoingRow.months[9], summary.totalSpent);
});

test('XLSX workbook export and import round-trip preserves transactions and 16 category allocation slots', async () => {
  const { generateWorkbookBuffer, parseWorkbookBuffer } = await import('./xlsxHelper');
  const buf = generateWorkbookBuffer(INITIAL_SEED_TRANSACTIONS, DEFAULT_CATEGORY_SLOTS, 'Oct 2026');
  assert.ok(buf.byteLength > 1000);

  const parsed = parseWorkbookBuffer(buf, DEFAULT_CATEGORY_SLOTS, 2026, 9);
  assert.equal(parsed.importedTxCount, INITIAL_SEED_TRANSACTIONS.length);
  assert.equal(parsed.importedCatCount, 12);
  assert.ok(parsed.categorySlots);
  assert.equal(parsed.categorySlots.length, 16);

  const origIn = INITIAL_SEED_TRANSACTIONS.reduce((a, t) => a + t.inAmount, 0);
  const origOut = INITIAL_SEED_TRANSACTIONS.reduce((a, t) => a + t.outAmount, 0);
  const importedIn = parsed.transactions.reduce((a, t) => a + t.inAmount, 0);
  const importedOut = parsed.transactions.reduce((a, t) => a + t.outAmount, 0);

  assert.equal(importedIn, origIn);
  assert.equal(importedOut, origOut);
});

test('hashCredential produces deterministic non-trivial hashes per username and password', async () => {
  const { hashCredential } = await import('./authVault');
  const h1 = hashCredential('Ahmad', 'secret123');
  const h2 = hashCredential('ahmad', 'secret123');
  const h3 = hashCredential('ahmad', 'wrongpass');

  assert.equal(h1, h2); // case-insensitive username normalization
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 14);
});


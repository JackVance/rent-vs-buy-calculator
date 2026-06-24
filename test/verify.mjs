// Verifies the JS model against the source workbook's cached values.
// Years 0-11 must match the workbook exactly. (Years 12+ intentionally differ:
// the corrected schedule is used here.) Run: node test/verify.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { computeModel } from '../src/rent-vs-buy.js';

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, 'golden.json'), 'utf8'));
const { rows, fixedPayment } = computeModel(golden.inputs, 35);

const cols = ['homeValue', 'saleRevATF', 'loanBalance', 'netRevAtSale', 'cumInterest',
  'cumPrincipal', 'cumAddl', 'totalPayments', 'cumRent', 'cumTaxSavings',
  'costOfRevenue', 'pl', 'roi', 'annROI'];

let fails = 0, checks = 0, maxRel = 0;
for (let y = 0; y <= 11; y++) {
  const g = golden.rows[y], j = rows[y];
  for (const c of cols) {
    const gv = g[c];
    if (typeof gv !== 'number' || j[c] == null) continue;
    checks++;
    const rel = Math.abs(j[c] - gv) / Math.max(Math.abs(gv), 1e-9);
    maxRel = Math.max(maxRel, rel);
    if (rel > 1e-6) { fails++; if (fails <= 10) console.log(`FAIL y${y} ${c}: ${j[c]} vs ${gv}`); }
  }
}

const payOk = Math.abs(fixedPayment - 2561.2438443004826) < 1e-6;
console.log(`years 0-11: ${checks} checks, ${fails} failures, maxRelErr=${maxRel.toExponential(2)}`);
console.log(`monthly payment: ${fixedPayment.toFixed(4)} (expected 2561.2438) -> ${payOk ? 'OK' : 'FAIL'}`);

// Opportunity-cost model is a strict generalization: with 0% expected return and
// investment-gains tax off, the renter's wealth == cumulative cost, so the new
// "net advantage" (wealthGap) must collapse onto the original P/L exactly.
const { rows: zero } = computeModel({ ...golden.inputs, investReturn: 0, capGainsTax: 0, taxInvestGains: false }, 35);
let gapFails = 0, gapMax = 0;
for (let y = 0; y <= 35; y++) {
  const d = Math.abs(zero[y].wealthGap - zero[y].pl);
  gapMax = Math.max(gapMax, d);
  if (d > 1e-6) gapFails++;
}
console.log(`wealthGap==pl at 0% return, tax off: ${36 - gapFails}/36 years match, maxAbsDiff=${gapMax.toExponential(2)} -> ${gapFails === 0 ? 'OK' : 'FAIL'}`);

// IRR sanity: a renter who invests at 7% with no capital-gains tax must earn
// exactly 7% (money-weighted), regardless of contribution timing.
const { rows: noTax } = computeModel({ ...golden.inputs, investReturn: 0.07, taxInvestGains: false }, 35);
let irrFails = 0, irrMax = 0, irrChecked = 0;
for (let y = 1; y <= 35; y++) {
  if (noTax[y].renterIrr == null) continue;
  irrChecked++;
  const d = Math.abs(noTax[y].renterIrr - 0.07);
  irrMax = Math.max(irrMax, d);
  if (d > 1e-4) irrFails++;
}
console.log(`renter IRR == 7% when untaxed: ${irrChecked - irrFails}/${irrChecked} years, maxDiff=${irrMax.toExponential(2)} -> ${irrFails === 0 ? 'OK' : 'FAIL'}`);

if (fails === 0 && payOk && gapFails === 0 && irrFails === 0)
  console.log('\n✅ PASS — workbook match, reframe reduces to it, and IRR is money-weighted.');
else { console.log('\n❌ FAIL'); process.exit(1); }

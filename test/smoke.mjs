// Headless smoke test of the <rent-vs-buy> UI logic (no real browser).
// Requires the optional devDependency `jsdom`; skips cleanly if it's absent.
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch { console.log('⏭  smoke test skipped — run `npm install` to enable (needs jsdom)'); process.exit(0); }

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
const { window } = dom;
// Stub canvas 2d context (jsdom has no canvas backend).
const noop = () => {};
window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
  get: (t, p) => (p === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop),
});
// Wire globals the module expects.
for (const k of ['window', 'document', 'customElements', 'HTMLElement', 'devicePixelRatio'])
  globalThis[k] = window[k];
globalThis.window = window;
globalThis.devicePixelRatio = 1;

await import('../src/rent-vs-buy.js');

const el = window.document.createElement('rent-vs-buy');
window.document.body.appendChild(el); // triggers connectedCallback

const sr = el.shadowRoot;
const text = (s) => sr.querySelector(s).textContent.trim();

let pass = true;
const assert = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) pass = false; };

// 1. Renders inputs, cards, verdict, tables
assert(sr.querySelectorAll('.field').length === 20, '20 input fields rendered');
assert(sr.querySelectorAll('.card').length === 10, '10 summary cards rendered (4 deal + 3 buyer + 3 renter)');
assert(sr.querySelector('.subhead.buyer') && sr.querySelector('.subhead.renter'), 'buyer & renter sections present');
assert(sr.querySelectorAll('input.check').length === 2, 'two checkboxes (invest-tax + mortgage write-off)');
assert(sr.querySelectorAll('.card.expandable').length === 2, 'two expandable breakdown cards (payment + cost)');
assert(/invest/i.test(text('#verdict')), 'verdict references investing');
assert(sr.querySelectorAll('#cftable tbody tr').length === 36, 'cash-flow table has 36 yearly rows');
const amRows = sr.querySelectorAll('#amtable tbody tr').length;
assert(amRows === 360, `amortization table has 360 monthly rows (got ${amRows})`);

// 2. Default break-even accounts for opportunity cost (year 11 at 7% return, 2026 std deduction + SALT cap)
assert(el.breakeven === 11, `default break-even is year 11 (got ${el.breakeven})`);

// 3. Monthly payment card shows the workbook value
assert(/\$2,561\.24/.test(sr.querySelector('#cards').textContent), 'monthly P&I shows $2,561.24');

// 4. $/% toggle: switch down payment to $, value should become 100000 of 500000
const plBefore = el.result.rows[10].pl;
const downToggle = [...sr.querySelectorAll('.toggle')].find(b => sr.querySelectorAll('.field')[1].contains(b));
const beforeUnit = el.state[1].unit;
downToggle.click();
assert(el.state[1].unit === '$' && Math.abs(el.state[1].value - 100000) < 1e-6,
  `down-payment toggle ${beforeUnit}→$ converts 20% to $100,000 (got ${el.state[1].value})`);
// model unchanged by a pure unit toggle (compare to pre-toggle value, no hard-coded number)
assert(Math.abs(el.result.rows[10].pl - plBefore) < 1e-6, 'P/L @10y stable after pure unit toggle');

// 5. Investment-tax checkbox: turning the tax OFF raises the renter's net worth,
//    which lowers buying's net advantage at the horizon.
const gapTaxed = el.result.rows[20].wealthGap;
const taxBox = sr.querySelector('input.check');
taxBox.checked = false; taxBox.dispatchEvent(new window.Event('change', { bubbles: true }));
const gapUntaxed = el.result.rows[20].wealthGap;
assert(gapUntaxed < gapTaxed, `untaxing investment gains lowers buying's edge @20y (${Math.round(gapTaxed)} -> ${Math.round(gapUntaxed)})`);
taxBox.checked = true; taxBox.dispatchEvent(new window.Event('change', { bubbles: true }));

// 5b. Breakdown cards: components sum to the headline figures.
const bd = el.result.breakdown;
assert(Math.abs((bd.interest + bd.principal) - el.result.fixedPayment) < 1e-6,
  'payment breakdown: interest + principal == P&I');
const totalMonthly = el.result.fixedPayment + el.result.addlMonthlyRate * el.inp.purchasePrice;
assert(Math.abs((el.result.fixedPayment + bd.tax + bd.insurance + bd.hoa + bd.misc) - totalMonthly) < 1e-6,
  'cost breakdown: P&I + tax + ins + hoa + misc == total monthly');
// expandable card opens on click
const payCard = sr.querySelector('.card.expandable[data-exp="pay"]');
payCard.click();
assert(payCard.classList.contains('open'), 'payment card expands on click');

// 5c. Mortgage write-off checkbox: turning it OFF removes the tax savings, which
//     raises the buyer's deployed capital and lowers buying's net advantage & ROI.
const gapWriteoff = el.result.rows[15].wealthGap;
const roiWriteoff = el.result.rows[15].roi;
const writeoffBox = sr.querySelectorAll('input.check')[1];
writeoffBox.checked = false; writeoffBox.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(el.result.rows[15].wealthGap < gapWriteoff && el.result.rows[15].roi < roiWriteoff,
  `disabling mortgage write-off lowers buying's advantage @15y (gap ${Math.round(gapWriteoff)} -> ${Math.round(el.result.rows[15].wealthGap)})`);
writeoffBox.checked = true; writeoffBox.dispatchEvent(new window.Event('change', { bubbles: true }));

// 5d. SALT cap: a lower cap deducts less property tax in later years (when the tax
//     bill exceeds the cap), reducing buying's advantage at a long horizon.
const gapSalt = el.result.rows[30].wealthGap;
const saltInput = [...sr.querySelectorAll('.field')].find(f => /SALT/i.test(f.textContent)).querySelector('input');
saltInput.value = '10000'; saltInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(el.result.rows[30].wealthGap < gapSalt, `lowering SALT cap to $10k reduces buying advantage @30y (${Math.round(gapSalt)} -> ${Math.round(el.result.rows[30].wealthGap)})`);
saltInput.value = '40400'; saltInput.dispatchEvent(new window.Event('input', { bubbles: true }));

// 6. Higher expected return makes buying look worse (break-even later or never)
const beBefore = el.breakeven;
const investInput = [...sr.querySelectorAll('.field')].find(f => /investment return/i.test(f.textContent)).querySelector('input');
investInput.value = '12'; investInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(el.breakeven === null || el.breakeven > beBefore, `12% return pushes break-even out (${beBefore} -> ${el.breakeven})`);

// 7. Horizon slider updates the summary
const hz = sr.querySelector('#hz'); hz.value = '30'; hz.dispatchEvent(new window.Event('input'));
assert(/30y/.test(sr.querySelector('#cards').textContent), 'horizon slider updates cards to 30y');

// 8. Changing an input recomputes (raise rate -> higher payment)
const rateInput = sr.querySelectorAll('input[type=number]')[2];
rateInput.value = '10'; rateInput.dispatchEvent(new window.Event('input', { bubbles: true }));
assert(el.result.fixedPayment > 2561.24, 'raising rate to 10% increases the payment');

console.log(pass ? '\n✅ UI smoke test PASSED' : '\n❌ UI smoke test FAILED');
process.exit(pass ? 0 : 1);

// rent-vs-buy.js
// Self-contained <rent-vs-buy> web component: financial model + UI in one file.
// Drop in with: <script type="module" src="/rent-vs-buy.js"></script> then <rent-vs-buy></rent-vs-buy>
// Also exports the pure model functions for testing (Node-safe: no DOM at import time).

/* ----------------------------- model ----------------------------- */

// Excel PMT(rate, nper, pv); pass pv = -loan to get a positive payment.
export function pmt(rate, nper, pv) {
  if (rate === 0) return -pv / nper;
  return (-pv * rate) / (1 - Math.pow(1 + rate, -nper));
}

// 360-month amortization with optional extra monthly prepayment.
export function amortize(loan, annualRate, fixedPayment, prepay, months = 360) {
  const r = annualRate / 12;
  const bal = [loan], cumI = [0], cumP = [0];
  for (let m = 1; m <= months; m++) {
    const prev = bal[m - 1];
    const interest = prev * r;
    const pay = fixedPayment + prepay;
    const principal = pay >= prev + interest ? prev : pay - interest;
    bal.push(Math.max(prev - principal, 0));
    cumI.push(cumI[m - 1] + interest);
    cumP.push(cumP[m - 1] + principal);
  }
  return { bal, cumI, cumP };
}

// Money-weighted annual return (IRR). contribs[t] is the cash invested at year t
// (outflow); terminal is the value received at the final year. Returns the annual
// rate that equates them, or null if there's no sign change (undefined IRR).
export function irr(contribs, terminal) {
  const H = contribs.length - 1;
  if (H < 1) return null;
  const npv = (r) => {
    let s = -contribs[0];                                   // t = 0 (undiscounted)
    for (let t = 1; t <= H; t++) s += -contribs[t] / Math.pow(1 + r, t);
    return s + terminal / Math.pow(1 + r, H);
  };
  let lo = -0.99, hi = 10, nlo = npv(lo), nhi = npv(hi);
  if (!(nlo > 0 && nhi < 0)) return null;                   // not bracketed → undefined
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, nm = npv(mid);
    if (Math.abs(nm) < 1e-7) return mid;
    if (nm > 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// inp keys (percentages as fractions): purchasePrice, downPct, rate, prepay,
// propTaxPct, insPct, hoaAnnual, miscPct, propValPct, reGrowth, txFees,
// equivRent, rentGrowth, marginalTax, stdDeduction.
export function computeModel(inp, years = 35) {
  const P = inp.purchasePrice;
  const downPayment = inp.downPct * P;
  const loan = P - downPayment;
  const fixedPayment = pmt(inp.rate / 12, 360, -loan);

  const annAdditional =
    inp.propTaxPct * P + inp.insPct * P + inp.hoaAnnual + inp.miscPct * P;
  const addlMonthlyRate = annAdditional / 12 / P;

  const propValuation = inp.propValPct * P;
  const am = amortize(loan, inp.rate, fixedPayment, inp.prepay);

  // Opportunity cost: the renter invests the same cash the buyer ties up
  // (down payment + the yearly owning-minus-rent difference) at this return.
  const investReturn = inp.investReturn ?? 0.07;
  const capGainsTax = inp.capGainsTax ?? 0.15;
  const taxInvestGains = inp.taxInvestGains ?? true;
  const taxWriteoff = inp.taxWriteoff ?? true; // mortgage-interest + property-tax deduction
  const saltCap = inp.saltCap ?? 40400;        // 2026 state-and-local-tax deduction cap

  // First-month / first-year monthly cost components (match the workbook's Main sheet).
  const mInterest = (loan * inp.rate) / 12;          // Main G11
  const breakdown = {
    interest: mInterest,                             // initial monthly interest
    principal: fixedPayment - mInterest,             // initial monthly principal (Main G13)
    tax: (inp.propTaxPct * P) / 12,                  // Main G22
    insurance: (inp.insPct * P) / 12,                // Main G23
    hoa: inp.hoaAnnual / 12,                         // Main G24
    misc: (inp.miscPct * P) / 12,                    // Main G25
  };

  const rows = [];
  let cumAddl = 0, cumRent = 0, cumTaxSavings = 0, prevHome = propValuation, prevCumI = 0;
  let renterPortfolio = 0, prevCost = 0;
  const contributions = []; // yearly capital each party deploys (same for both)

  for (let y = 0; y <= years; y++) {
    const homeValue = y === 0 ? propValuation : prevHome * (1 + inp.reGrowth);
    const saleRevATF = homeValue * (1 - inp.txFees);
    // Loan term is 360 months; past payoff the balance is 0 and the
    // cumulative interest/principal plateau, so clamp to the schedule end.
    const month = Math.min(y * 12, am.bal.length - 1);
    const loanBalance = am.bal[month];
    const cumInterest = am.cumI[month];
    const cumPrincipal = am.cumP[month];
    const netRevAtSale = saleRevATF - loanBalance;

    const addlAnnual = y === 0 ? 0 : prevHome * addlMonthlyRate * 12;
    cumAddl += addlAnnual;
    const totalPayments = cumInterest + cumPrincipal + cumAddl;

    const annRent = y === 0 ? 0 : inp.equivRent * Math.pow(1 + inp.rentGrowth, y - 1) * 12;
    cumRent += annRent;
    const netCostsWrtRent = totalPayments - cumRent;

    const annInterest = cumInterest - prevCumI;
    const annPropTaxYr = y === 0 ? 0 : prevHome * inp.propTaxPct;
    let deductible;
    if (y === 0) deductible = 0;
    else if (annPropTaxYr <= saltCap) deductible = annInterest + annPropTaxYr - inp.stdDeduction;
    else deductible = annInterest + saltCap - inp.stdDeduction; // property tax capped at SALT limit
    const annTaxSavings = (y === 0 || !taxWriteoff) ? 0 : deductible * inp.marginalTax;
    if (annTaxSavings > 0) cumTaxSavings += annTaxSavings;

    const costOfRevenue = downPayment + netCostsWrtRent - cumTaxSavings;
    // Original (no-opportunity-cost) comparison, kept for reference.
    const pl = netRevAtSale - costOfRevenue;
    const roi = costOfRevenue > 0 ? netRevAtSale / costOfRevenue - 1 : null;
    const annROI = costOfRevenue > 0 && y > 0 && 1 + roi > 0 ? Math.pow(1 + roi, 1 / y) - 1 : null;

    // Renter invests the same capital stream. costOfRevenue is the cumulative
    // contribution; its yearly increment is what the renter invests that year.
    const contribution = costOfRevenue - prevCost;
    renterPortfolio = renterPortfolio * (1 + investReturn) + contribution;
    const investBasis = costOfRevenue;                       // total contributed
    const investGain = renterPortfolio - investBasis;
    const investTax = taxInvestGains ? capGainsTax * Math.max(investGain, 0) : 0;
    const renterWealth = renterPortfolio - investTax;        // after-tax portfolio
    const buyerWealth = netRevAtSale;                        // equity proceeds at sale
    const wealthGap = buyerWealth - renterWealth;            // headline: + means buying wins

    // Total return on the SAME deployed capital (costOfRevenue) for each path.
    const renterRoi = costOfRevenue > 0 ? renterWealth / costOfRevenue - 1 : null;

    // Money-weighted annual return (IRR) on the identical yearly cash flows.
    // The renter's comes out to the expected return itself (less any gains tax).
    contributions.push(contribution);
    const buyerIrr = irr(contributions, buyerWealth);
    const renterIrr = irr(contributions, renterWealth);
    prevCost = costOfRevenue;

    rows.push({
      year: y, homeValue, saleRevATF, loanBalance, netRevAtSale, cumInterest,
      cumPrincipal, cumAddl, totalPayments, cumRent, cumTaxSavings,
      netCostsWrtRent, costOfRevenue, pl, roi, annROI,
      equity: homeValue - loanBalance,
      renterPortfolio, investTax, renterWealth, buyerWealth, wealthGap,
      renterRoi, buyerIrr, renterIrr,
    });

    prevHome = homeValue;
    prevCumI = cumInterest;
  }
  return { downPayment, loan, fixedPayment, addlMonthlyRate, breakdown, rows, monthly: am };
}

/* --------------------------- input schema --------------------------- */
// type: money ($), pct (% standalone), toggle ($ or % of purchase price).
const INPUTS = [
  { key: 'purchasePrice', label: 'Purchase price', type: 'money', value: 500000, group: 'Home & loan' },
  { key: 'down', label: 'Down payment', type: 'toggle', value: 0.2, unit: '%', group: 'Home & loan' },
  { key: 'rate', label: 'Interest rate', type: 'pct', value: 6.625, group: 'Home & loan' },
  { key: 'prepay', label: 'Extra monthly payment', type: 'money', value: 0, group: 'Home & loan' },
  { key: 'propTax', label: 'Annual property tax', type: 'toggle', value: 0.0181, unit: '%', group: 'Carrying costs' },
  { key: 'insurance', label: 'Annual insurance', type: 'toggle', value: 0.0072, unit: '%', group: 'Carrying costs' },
  { key: 'hoa', label: 'Annual HOA', type: 'toggle', value: 600, unit: '$', group: 'Carrying costs' },
  { key: 'maint', label: 'Maintenance / misc (annual)', type: 'toggle', value: 0.01, unit: '%', group: 'Carrying costs' },
  { key: 'propVal', label: 'Current valuation', type: 'toggle', value: 1, unit: '%', group: 'Projections' },
  { key: 'reGrowth', label: 'Annual home appreciation', type: 'pct', value: 4, group: 'Projections' },
  { key: 'txFees', label: 'Selling costs', type: 'pct', value: 8, group: 'Projections' },
  { key: 'rent', label: 'Equivalent monthly rent', type: 'money', value: 2500, group: 'Renting & investing' },
  { key: 'rentGrowth', label: 'Annual rent growth', type: 'pct', value: 4, group: 'Renting & investing' },
  { key: 'investReturn', label: 'Expected investment return', type: 'pct', value: 7, group: 'Renting & investing' },
  { key: 'taxInvest', label: 'Tax investment gains', type: 'check', value: true, group: 'Renting & investing' },
  { key: 'capGains', label: 'Capital gains tax rate', type: 'pct', value: 15, group: 'Renting & investing' },
  { key: 'marginalTax', label: 'Marginal income tax rate', type: 'pct', value: 24, group: 'Taxes' },
  { key: 'stdDeduction', label: 'Standard deduction', type: 'money', value: 16100, group: 'Taxes' },
  { key: 'saltCap', label: 'SALT deduction cap', type: 'money', value: 40400, group: 'Taxes' },
  { key: 'taxWriteoff', label: 'Apply mortgage write-off', type: 'check', value: true, group: 'Taxes' },
];

/* ----------------------------- formatting ----------------------------- */
const fmtMoney = (n) =>
  n == null || !isFinite(n) ? '—'
    : (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtMoney2 = (n) =>
  n == null || !isFinite(n) ? '—'
    : (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (f) => (f == null || !isFinite(f) ? '—' : (f * 100).toFixed(1) + '%');

/* ----------------------------- component ----------------------------- */
export function defineRentVsBuy() {
  if (typeof customElements === 'undefined' || customElements.get('rent-vs-buy')) return;

  class RentVsBuy extends HTMLElement {
    connectedCallback() {
      this.state = INPUTS.map((i) => ({ ...i }));
      this.horizon = 10;
      this.openCards = new Set(); // which expandable summary cards are open
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = this.template();
      this.$ = (s) => this.shadowRoot.querySelector(s);
      this.buildInputs();
      this.wireGlobal();
      this.recompute();
      window.addEventListener('resize', () => this.drawChart());
    }

    template() {
      return `
<style>
  :host{
    --rvb-accent:#2f6f4f; --rvb-accent-2:#b8472d; --rvb-bg:#fff; --rvb-fg:#1c1c1c;
    --rvb-muted:#666; --rvb-line:#e3e3e3; --rvb-soft:#f6f6f4; --rvb-pos:#2f6f4f; --rvb-neg:#b8472d;
    --rvb-buy:#2f6fb0; --rvb-rent:#c0392b;
    /* Text/labels that sit directly on the host page background (not inside a
       panel). Default to the in-panel colors so a white host is unaffected; a
       dark host can override these to stay legible. */
    --rvb-on-bg:var(--rvb-fg); --rvb-buy-label:var(--rvb-buy); --rvb-rent-label:var(--rvb-rent);
    --rvb-slider:var(--rvb-accent);
    display:block; color:var(--rvb-fg);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    line-height:1.45; container-type:inline-size;
  }
  *{box-sizing:border-box}
  .wrap{display:grid; grid-template-columns:320px 1fr; gap:24px}
  @container (max-width:760px){ .wrap{grid-template-columns:1fr} }
  h2,h3{margin:0 0 .5em; font-weight:600}
  h2{font-size:1.05rem; letter-spacing:.02em; text-transform:uppercase; color:var(--rvb-muted)}
  .panel{background:var(--rvb-bg); border:1px solid var(--rvb-line); border-radius:12px; padding:16px}
  .group{margin-bottom:16px}
  .group h2{margin-bottom:8px; font-size:.74rem; font-weight:800; color:var(--rvb-fg); border-bottom:1px solid var(--rvb-line); padding-bottom:5px}
  .field{display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0}
  .field label{font-size:.85rem; color:#333; flex:1}
  .control{display:flex; align-items:stretch; border:1px solid var(--rvb-line); border-radius:8px; overflow:hidden; background:var(--rvb-soft)}
  .control .pre{display:flex; align-items:center; padding:0 7px; color:var(--rvb-muted); font-size:.8rem; background:#efefec}
  .control input{border:0; background:transparent; width:92px; padding:6px 8px; font:inherit; text-align:right; color:var(--rvb-fg)}
  .control input:focus{outline:none}
  .control input::-webkit-outer-spin-button,.control input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
  .control input[type=number]{-moz-appearance:textfield}
  .toggle{cursor:pointer; border:0; background:#e7ebe7; color:var(--rvb-accent); font:inherit; font-weight:600; padding:0 9px; min-width:30px}
  .toggle:hover{background:#dbe4db}
  #cards{margin-bottom:16px}
  .cards-row{display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px}
  .card{background:var(--rvb-soft); border:1px solid var(--rvb-line); border-radius:10px; padding:11px 13px}
  .card .k{font-size:.72rem; color:var(--rvb-muted); text-transform:uppercase; letter-spacing:.03em}
  .card .v{font-size:1.2rem; font-weight:650; margin-top:3px}
  .card.expandable{cursor:pointer}
  .card.expandable .caret{display:inline-block; transition:transform .15s; color:var(--rvb-accent); font-size:.7em}
  .card.expandable.open .caret{transform:rotate(90deg)}
  .card-detail{display:none; margin-top:9px; padding-top:8px; border-top:1px dashed var(--rvb-line)}
  .card.expandable.open .card-detail{display:block}
  .drow{display:flex; justify-content:space-between; gap:10px; font-size:.8rem; padding:2px 0; color:#333}
  .drow.muted span{color:var(--rvb-muted)}
  .drow .lab{color:var(--rvb-muted)}
  .dnote{font-size:.7rem; color:var(--rvb-muted); margin-top:5px; font-style:italic}
  .cmp{display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:14px}
  @container (max-width:620px){ .cmp{grid-template-columns:1fr} }
  .cmp-col .cards-row{grid-template-columns:repeat(3,1fr)}
  .subhead{font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.04em; margin:0 0 7px; padding-bottom:4px; border-bottom:2px solid}
  .subhead.buyer{color:var(--rvb-buy-label); border-color:var(--rvb-buy-label)}
  .subhead.renter{color:var(--rvb-rent-label); border-color:var(--rvb-rent-label)}
  .advantage{margin-top:14px; padding:11px 15px; border-radius:10px; text-align:center; font-size:1rem; border:1px solid var(--rvb-line)}
  .advantage.pos{background:#eef5ee; color:var(--rvb-pos)}
  .advantage.neg{background:#f7ece9; color:var(--rvb-neg)}
  .advantage b{font-size:1.2rem}
  .pos{color:var(--rvb-pos)} .neg{color:var(--rvb-neg)}
  .verdict{border-radius:12px; padding:14px 16px; margin-bottom:16px; font-size:1.02rem; border:1px solid var(--rvb-line); background:var(--rvb-soft)}
  .verdict b{font-weight:700}
  .horizon{display:flex; align-items:center; gap:12px; margin:6px 0 18px; color:var(--rvb-on-bg)}
  .horizon input[type=range]{flex:1; accent-color:var(--rvb-slider)}
  .horizon .yv{font-weight:650; min-width:64px}
  canvas{width:100%; height:280px; display:block}
  .chartwrap{background:var(--rvb-bg); border:1px solid var(--rvb-line); border-radius:12px; padding:14px; margin-bottom:18px}
  .legend{display:flex; gap:16px; flex-wrap:wrap; font-size:.78rem; color:var(--rvb-muted); margin-top:8px}
  .legend span{display:inline-flex; align-items:center; gap:6px}
  .swatch{width:11px; height:11px; border-radius:3px; display:inline-block}
  details{border:1px solid var(--rvb-line); border-radius:12px; margin-bottom:12px; overflow:hidden}
  summary{cursor:pointer; padding:12px 16px; font-weight:600; background:var(--rvb-soft); list-style:none}
  summary::-webkit-details-marker{display:none}
  summary::before{content:"▸"; display:inline-block; margin-right:8px; transition:transform .15s; color:var(--rvb-accent)}
  details[open] summary::before{transform:rotate(90deg)}
  .tablescroll{max-height:420px; overflow:auto}
  table{border-collapse:collapse; width:100%; font-size:.8rem}
  th,td{padding:6px 10px; text-align:right; white-space:nowrap; border-bottom:1px solid var(--rvb-line)}
  th{position:sticky; top:0; background:#fff; color:var(--rvb-muted); font-weight:600; text-align:right; z-index:1}
  th:first-child,td:first-child{text-align:left}
  tbody tr:hover{background:var(--rvb-soft)}
  .note{font-size:.74rem; color:var(--rvb-on-bg); margin:2px 0 0}
  .check{width:17px; height:17px; accent-color:var(--rvb-accent); cursor:pointer; margin:0 6px 0 0}
  .breakeven-row{background:#eef5ee !important}
</style>
<div class="wrap">
  <div>
    <div class="panel" id="inputs"></div>
    <p class="note">Toggle <b>$/%</b> to enter a dollar amount or a percent of purchase price.</p>
  </div>
  <div>
    <div class="verdict" id="verdict"></div>
    <div class="horizon">
      <label for="hz"><b>If you sell after</b></label>
      <input type="range" id="hz" min="1" max="35" value="10" step="1">
      <span class="yv" id="hzv">10 yrs</span>
    </div>
    <div id="cards"></div>
    <div class="chartwrap">
      <h3>Net worth over time: buying vs. renting &amp; investing</h3>
      <canvas id="chart"></canvas>
      <div class="legend">
        <span><i class="swatch" style="background:var(--rvb-buy)"></i> Buying net worth</span>
        <span><i class="swatch" style="background:var(--rvb-rent)"></i> Renting + investing net worth</span>
        <span><i class="swatch" style="background:#999"></i> Break-even</span>
      </div>
    </div>
    <details id="cf"><summary>Year-by-year cash flow</summary>
      <div class="tablescroll"><table id="cftable"></table></div>
    </details>
    <details id="am"><summary>Monthly amortization schedule</summary>
      <div class="tablescroll"><table id="amtable"></table></div>
    </details>
  </div>
</div>`;
    }

    buildInputs() {
      const groups = {};
      this.state.forEach((f, i) => { (groups[f.group] ||= []).push(i); });
      let html = '';
      for (const [g, idxs] of Object.entries(groups)) {
        html += `<div class="group"><h2>${g}</h2>`;
        for (const i of idxs) html += this.fieldHTML(this.state[i], i);
        html += `</div>`;
      }
      this.$('#inputs').innerHTML = html;
      this.$('#inputs').addEventListener('change', (e) => {
        const i = e.target.dataset.idx;
        if (i == null || this.state[i].type !== 'check') return;
        this.state[i].value = e.target.checked;
        this.recompute();
      });
      this.$('#inputs').addEventListener('input', (e) => {
        const i = e.target.dataset.idx;
        if (i == null) return;
        const f = this.state[i];
        if (f.type === 'check') return; // handled on 'change'
        const raw = parseFloat(e.target.value);
        if (isNaN(raw)) return;
        if (f.type === 'toggle') f.value = f.unit === '%' ? raw / 100 : raw;
        else if (f.type === 'pct') f.value = raw; // stored as percent, /100 at resolve
        else f.value = raw;
        this.recompute();
      });
      this.$('#inputs').addEventListener('click', (e) => {
        if (!e.target.classList.contains('toggle')) return;
        const i = e.target.dataset.idx;
        const f = this.state[i];
        const price = this.state[0].value;
        if (f.unit === '%') { f.value = f.value * price; f.unit = '$'; }
        else { f.value = price ? f.value / price : 0; f.unit = '%'; }
        this.refreshField(i);
        this.recompute();
      });
    }

    fieldHTML(f, i) {
      if (f.type === 'check') {
        return `<div class="field">
          <label>${f.label}</label>
          <input type="checkbox" class="check" data-idx="${i}" ${f.value ? 'checked' : ''}>
        </div>`;
      }
      const disp = this.displayValue(f);
      const pre = f.type === 'money' ? '$' : '';
      const post = f.type === 'pct' ? '%' : '';
      const toggle = f.type === 'toggle'
        ? `<button class="toggle" data-idx="${i}" title="Switch $/%">${f.unit}</button>` : '';
      const preEl = pre ? `<span class="pre">${pre}</span>` : '';
      const postEl = post ? `<span class="pre">${post}</span>` : (f.type === 'toggle' && f.unit === '$' ? `` : '');
      return `<div class="field">
        <label>${f.label}</label>
        <span class="control">${f.type === 'toggle' && f.unit === '$' ? '<span class="pre">$</span>' : preEl}
          <input type="number" inputmode="decimal" data-idx="${i}" value="${disp}" step="any">
          ${post ? `<span class="pre">%</span>` : ''}${toggle}</span>
      </div>`;
    }

    displayValue(f) {
      if (f.type === 'toggle') return f.unit === '%' ? +(f.value * 100).toFixed(4) : +f.value.toFixed(2);
      return f.value;
    }

    refreshField(i) {
      const f = this.state[i];
      // rebuild just this field's control (unit/prefix may have changed)
      const field = this.shadowRoot.querySelectorAll('.field')[i];
      if (field) field.outerHTML = this.fieldHTML(f, i);
    }

    wireGlobal() {
      const hz = this.$('#hz');
      hz.addEventListener('input', () => {
        this.horizon = +hz.value;
        this.$('#hzv').textContent = this.horizon + ' yr' + (this.horizon === 1 ? '' : 's');
        this.renderSummary();
        this.drawChart();
      });
      // expand/collapse the breakdown cards (state survives re-renders)
      this.$('#cards').addEventListener('click', (e) => {
        const card = e.target.closest('.card.expandable');
        if (!card) return;
        const key = card.dataset.exp;
        if (this.openCards.has(key)) this.openCards.delete(key); else this.openCards.add(key);
        card.classList.toggle('open');
      });
    }

    resolveInputs() {
      const s = Object.fromEntries(this.state.map((f) => [f.key, f]));
      const price = s.purchasePrice.value;
      const tog = (f) => (f.unit === '%' ? f.value : f.value / price);
      return {
        purchasePrice: price,
        downPct: tog(s.down),
        rate: s.rate.value / 100,
        prepay: s.prepay.value,
        propTaxPct: tog(s.propTax),
        insPct: tog(s.insurance),
        hoaAnnual: s.hoa.unit === '$' ? s.hoa.value : s.hoa.value * price,
        miscPct: tog(s.maint),
        propValPct: tog(s.propVal),
        reGrowth: s.reGrowth.value / 100,
        txFees: s.txFees.value / 100,
        equivRent: s.rent.value,
        rentGrowth: s.rentGrowth.value / 100,
        investReturn: s.investReturn.value / 100,
        capGainsTax: s.capGains.value / 100,
        taxInvestGains: s.taxInvest.value,
        marginalTax: s.marginalTax.value / 100,
        stdDeduction: s.stdDeduction.value,
        saltCap: s.saltCap.value,
        taxWriteoff: s.taxWriteoff.value,
      };
    }

    recompute() {
      this.inp = this.resolveInputs();
      this.result = computeModel(this.inp, 35);
      this.breakeven = this.result.rows.find((r) => r.wealthGap >= 0 && r.year > 0)?.year ?? null;
      this.renderSummary();
      this.drawChart();
      this.renderTables();
    }

    renderSummary() {
      const r = this.result, row = r.rows[this.horizon];
      const monthlyAddl = r.addlMonthlyRate * this.inp.purchasePrice;
      const totalMonthly = r.fixedPayment + monthlyAddl;

      const be = this.breakeven;
      const ret = fmtPct(this.inp.investReturn);
      const verdict = this.$('#verdict');
      if (be == null) {
        verdict.innerHTML = `Over 35 years, <b class="neg">renting and investing wins</b> — buying never beats putting the same money in the market at ${ret}.`;
      } else {
        verdict.innerHTML = `Buying overtakes renting-and-investing after <b class="pos">${be} year${be === 1 ? '' : 's'}</b> ` +
          `(vs. investing the difference at ${ret}). Sell before then and renting would have won.`;
      }

      const H = this.horizon;
      const bd = r.breakdown;
      const gapCls = row.wealthGap >= 0 ? 'pos' : 'neg';
      const card = (k, v, c = '') => `<div class="card"><div class="k">${k}</div><div class="v ${c}">${v}</div></div>`;
      const cardRow = (arr) => `<div class="cards-row">${arr.map((a) => card(...a)).join('')}</div>`;
      const drow = (lab, val, cls = '') => `<div class="drow ${cls}"><span class="lab">${lab}</span><span>${val}</span></div>`;
      const expCard = (key, k, v, detail) => `
        <div class="card expandable ${this.openCards.has(key) ? 'open' : ''}" data-exp="${key}">
          <div class="k">${k} <span class="caret">▸</span></div>
          <div class="v">${v}</div>
          <div class="card-detail">${detail}</div>
        </div>`;

      const payDetail =
        drow('Init. Interest', fmtMoney2(bd.interest)) +
        drow('Init. Principal', fmtMoney2(bd.principal)) +
        `<div class="dnote">Principal builds equity — it is not counted as a cost in the comparison.</div>`;
      const costDetail =
        drow('Mortgage (P&amp;I)', fmtMoney2(r.fixedPayment)) +
        drow('Property tax', fmtMoney2(bd.tax)) +
        drow('Insurance', fmtMoney2(bd.insurance)) +
        drow('HOA', fmtMoney2(bd.hoa)) +
        drow('Maintenance / misc', fmtMoney2(bd.misc));

      const deal =
        `<div class="cards-row">` +
        expCard('pay', 'Monthly payment (P&I)', fmtMoney2(r.fixedPayment), payDetail) +
        expCard('cost', 'Total monthly cost', fmtMoney2(totalMonthly), costDetail) +
        card(`Home value @ ${H}y`, fmtMoney(row.homeValue)) +
        card(`Loan balance @ ${H}y`, fmtMoney(row.loanBalance)) +
        `</div>`;
      const buyer = cardRow([
        ['Net worth', fmtMoney(row.buyerWealth)],
        ['Total ROI', fmtPct(row.roi), (row.roi >= 0 ? 'pos' : 'neg')],
        ['Annual return (IRR)', fmtPct(row.buyerIrr), (row.buyerIrr >= 0 ? 'pos' : 'neg')],
      ]);
      const renter = cardRow([
        ['Net worth', fmtMoney(row.renterWealth)],
        ['Total ROI', fmtPct(row.renterRoi), (row.renterRoi >= 0 ? 'pos' : 'neg')],
        ['Annual return (IRR)', fmtPct(row.renterIrr), (row.renterIrr >= 0 ? 'pos' : 'neg')],
      ]);
      const advantage = `<div class="advantage ${gapCls}">Net advantage to buying @ ${H}y: <b>${fmtMoney(row.wealthGap)}</b></div>`;

      this.$('#cards').innerHTML =
        deal +
        `<div class="cmp">
          <div class="cmp-col"><div class="subhead buyer">Buyer @ ${H}y</div>${buyer}</div>
          <div class="cmp-col"><div class="subhead renter">Renting + investing @ ${H}y</div>${renter}</div>
        </div>` +
        advantage;
    }

    drawChart() {
      const cv = this.$('#chart');
      if (!cv) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = cv.clientWidth || 600, cssH = cv.clientHeight || 280;
      cv.width = cssW * dpr; cv.height = cssH * dpr;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const rows = this.result.rows;
      const padL = 64, padR = 14, padT = 12, padB = 24;
      const w = cssW - padL - padR, h = cssH - padT - padB;
      const buyerY = rows.map((r) => r.buyerWealth);
      const renterY = rows.map((r) => r.renterWealth);
      const ymin = Math.min(0, ...buyerY, ...renterY);
      const ymax = Math.max(0, ...buyerY, ...renterY);
      const X = (yr) => padL + (yr / 35) * w;
      const Y = (v) => padT + h - ((v - ymin) / (ymax - ymin || 1)) * h;

      // grid + y labels
      ctx.font = '11px sans-serif'; ctx.textBaseline = 'middle';
      const ticks = 5;
      for (let i = 0; i <= ticks; i++) {
        const v = ymin + (i / ticks) * (ymax - ymin);
        const y = Y(v);
        ctx.strokeStyle = '#eee';
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
        ctx.fillStyle = '#999'; ctx.textAlign = 'right';
        ctx.fillText(this.shortMoney(v), padL - 8, y);
      }

      const buyerColor = '#2f6fb0', renterColor = '#c0392b';
      const drawLine = (arr, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
        arr.forEach((v, i) => { const x = X(rows[i].year), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      };
      drawLine(renterY, renterColor);
      drawLine(buyerY, buyerColor);

      // break-even (where the two net-worth lines cross)
      if (this.breakeven != null) {
        const bx = X(this.breakeven);
        ctx.strokeStyle = '#999'; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(bx, padT); ctx.lineTo(bx, padT + h); ctx.stroke();
        ctx.setLineDash([]);
      }
      // horizon markers on both lines
      const hr = rows[this.horizon];
      for (const [v, color] of [[hr.buyerWealth, buyerColor], [hr.renterWealth, renterColor]]) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(X(hr.year), Y(v), 4.5, 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }

      // x labels
      ctx.fillStyle = '#999'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      [0, 5, 10, 15, 20, 25, 30, 35].forEach((yr) =>
        ctx.fillText(yr + 'y', X(yr), padT + h + 6));
    }

    shortMoney(v) {
      const a = Math.abs(v), s = v < 0 ? '-' : '';
      if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
      if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'k';
      return s + '$' + Math.round(a);
    }

    renderTables() {
      // Cash flow (annual)
      const cf = this.result.rows;
      const cfHead = ['Year', 'Home value', 'Loan balance', 'Buyer net worth', 'Renter net worth',
        'Net advantage', 'Buyer IRR', 'Renter IRR'];
      let cfHtml = '<thead><tr>' + cfHead.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
      cf.forEach((r) => {
        const be = r.year === this.breakeven ? ' class="breakeven-row"' : '';
        cfHtml += `<tr${be}><td>${r.year}</td><td>${fmtMoney(r.homeValue)}</td>` +
          `<td>${fmtMoney(r.loanBalance)}</td><td>${fmtMoney(r.buyerWealth)}</td>` +
          `<td>${fmtMoney(r.renterWealth)}</td>` +
          `<td class="${r.wealthGap >= 0 ? 'pos' : 'neg'}">${fmtMoney(r.wealthGap)}</td>` +
          `<td>${fmtPct(r.buyerIrr)}</td><td>${fmtPct(r.renterIrr)}</td></tr>`;
      });
      this.$('#cftable').innerHTML = cfHtml + '</tbody>';

      // Amortization (monthly, until payoff)
      const m = this.result.monthly;
      const amHead = ['Month', 'Payment', 'Interest', 'Principal', 'Balance'];
      let amHtml = '<thead><tr>' + amHead.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
      for (let i = 1; i < m.bal.length; i++) {
        const interest = m.cumI[i] - m.cumI[i - 1];
        const principal = m.cumP[i] - m.cumP[i - 1];
        if (interest + principal < 0.005 && m.bal[i] === 0) break;
        amHtml += `<tr><td>${i}</td><td>${fmtMoney2(interest + principal)}</td>` +
          `<td>${fmtMoney2(interest)}</td><td>${fmtMoney2(principal)}</td>` +
          `<td>${fmtMoney(m.bal[i])}</td></tr>`;
      }
      this.$('#amtable').innerHTML = amHtml + '</tbody>';
    }
  }

  customElements.define('rent-vs-buy', RentVsBuy);
}

if (typeof customElements !== 'undefined') defineRentVsBuy();

// ─── HST / TAX CALCULATOR ────────────────────────────────────
export function updateHst(prefix: string) {
  const cost = parseFloat((document.getElementById(prefix+'Cost') as HTMLInputElement)?.value)||0;
  const taxPct = parseFloat((document.getElementById(prefix+'TaxRate') as HTMLInputElement)?.value ?? '13')||0;
  const box = document.getElementById(prefix+'HstBox')!;
  const totalEl = document.getElementById(prefix+'TotalEdit') as HTMLInputElement;
  if (cost > 0) {
    const taxAmt = cost * (taxPct / 100);
    const total = cost + taxAmt;
    document.getElementById(prefix+'PreTax')!.textContent = '$'+cost.toFixed(2);
    document.getElementById(prefix+'HstAmt')!.textContent = ' = $'+taxAmt.toFixed(2);
    if (totalEl && !totalEl.dataset.manualOverride) totalEl.value = total.toFixed(2);
    box.classList.add('visible');
  } else {
    box.classList.remove('visible');
  }
}

export function overrideTotal(prefix: string) {
  const totalEl = document.getElementById(prefix+'TotalEdit') as HTMLInputElement;
  const taxPct = parseFloat((document.getElementById(prefix+'TaxRate') as HTMLInputElement)?.value ?? '13')||0;
  const total = parseFloat(totalEl?.value)||0;
  if (total > 0) {
    totalEl.dataset.manualOverride = '1';
    const pretax = total / (1 + taxPct / 100);
    const taxAmt = total - pretax;
    document.getElementById(prefix+'PreTax')!.textContent = '$'+pretax.toFixed(2);
    document.getElementById(prefix+'HstAmt')!.textContent = ' = $'+taxAmt.toFixed(2);
    (document.getElementById(prefix+'Cost') as HTMLInputElement).value = pretax.toFixed(2);
  } else {
    totalEl.dataset.manualOverride = '';
  }
}

export function updateKm() {
  const curr = parseFloat((document.getElementById('aMileage') as HTMLInputElement)?.value)||0;
  const interval = parseFloat((document.getElementById('aKmInterval') as HTMLInputElement)?.value)||0;
  const kmBox = document.getElementById('aKmBox')!;
  if (curr > 0 && interval > 0) {
    const target = curr + interval;
    (document.getElementById('aNextMileage') as HTMLInputElement).value = String(target);
    document.getElementById('aKmCurrent')!.textContent = curr.toLocaleString('en-CA') + ' km';
    document.getElementById('aKmIntervalDisp')!.textContent = interval.toLocaleString('en-CA') + ' km';
    document.getElementById('aKmTarget')!.textContent = target.toLocaleString('en-CA') + ' km';
    kmBox.classList.add('visible');
  } else {
    (document.getElementById('aNextMileage') as HTMLInputElement).value = '';
    kmBox.classList.remove('visible');
  }
}

export function updateHomeDuration() {
  const val = parseInt((document.getElementById('hDurVal') as HTMLInputElement)?.value)||1;
  const unit = (document.getElementById('hDurUnit') as HTMLSelectElement)?.value||'months';
  let days = val;
  if (unit === 'months') days = Math.round(val * 30.44);
  else if (unit === 'years') days = val * 365;
  const freqEl = document.getElementById('hFreq') as HTMLInputElement;
  if (freqEl) freqEl.value = String(days);
}

export function durLabel(val: any, unit: string) {
  if (!val) return 'Custom';
  const u = unit||'months';
  const v = parseInt(val);
  if (u === 'days') return v === 1 ? 'Daily' : `Every ${v} Days`;
  if (u === 'months') return v === 1 ? 'Monthly' : v === 3 ? 'Quarterly' : v === 6 ? 'Semi-Annual' : v === 12 ? 'Annual' : `Every ${v} Months`;
  if (u === 'years') return v === 1 ? 'Yearly' : `Every ${v} Years`;
  return 'Custom';
}

const CYCLE_MONTHS = Object.freeze({ month: 1, year: 12, week: 4.345 })

export function monthlyFeeCny(plan, usdCnyRate) {
  if (!plan || typeof plan.monthlyFee !== 'number' || !Number.isFinite(plan.monthlyFee) || plan.monthlyFee <= 0) return null
  const months = CYCLE_MONTHS[plan.cycle]
  if (!months) return null
  const monthly = plan.monthlyFee / months
  const currency = String(plan.currency || 'CNY').toUpperCase()
  if (currency === 'CNY') return monthly
  if (currency === 'USD') {
    const rate = Number(usdCnyRate)
    return Number.isFinite(rate) && rate > 0 ? monthly * rate : null
  }
  return null
}

export function calculatePlanRoi(plan, equivalentAmountCny, usdCnyRate) {
  const amount = Number(equivalentAmountCny)
  const monthly = monthlyFeeCny(plan, usdCnyRate)
  const feeRegistered = !!(plan && Number(plan.monthlyFee) > 0)
  if (!feeRegistered) return { status: 'unregistered', monthlyFeeCny: null, amountCny: Number.isFinite(amount) ? amount : 0, ratio: null, differenceCny: null }
  if (monthly == null) return { status: 'fx-unavailable', monthlyFeeCny: null, amountCny: Number.isFinite(amount) ? amount : 0, ratio: null, differenceCny: null }
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0
  const differenceCny = safeAmount - monthly
  return {
    status: 'ready',
    monthlyFeeCny: monthly,
    amountCny: safeAmount,
    ratio: safeAmount / monthly,
    differenceCny
  }
}

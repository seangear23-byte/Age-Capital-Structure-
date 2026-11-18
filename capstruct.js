"use strict";

function summarize(rows, key) {
  if (rows.some(row => row[key] === null)) return { mean: null, deviation: null, cv: null };
  const mean = rows.reduce((sum, row) => sum + row.probability * row[key], 0);
  const deviation = Math.sqrt(rows.reduce(
    (sum, row) => sum + row.probability * (row[key] - mean) ** 2, 0
  ));
  return { mean, deviation, cv: mean ? deviation / mean : null };
}

function exampleFirm(assets, debt, rate, tax, scenarios) {
  const equity = assets - debt;
  const interest = debt * rate;
  const rows = scenarios.map(({ probability, sales, operating_costs: operatingCosts }) => {
    const ebit = sales - operatingCosts;
    const ebt = ebit - interest;
    const taxes = ebt * tax;
    const income = ebt - taxes;
    return { assets, equity, probability, sales, operatingCosts, ebit, interest, ebt, taxes,
      income, roe: income / equity, tie: interest ? ebit / interest : null };
  });
  return { rows, roe: summarize(rows, "roe"), tie: summarize(rows, "tie") };
}

function cdssResults(company, tax, schedule) {
  const { sales, variable_cost_rate, fixed_costs, total_assets: assets,
    shares_outstanding: originalShares, share_price: originalPrice } = company;
  const ebit = sales * (1 - variable_cost_rate) - fixed_costs;

  return schedule.map(({ debt, cost_of_debt: debtRate, cost_of_equity: equityRate }) => {
    const interest = debt * (debtRate ?? 0);
    const income = (ebit - interest) * (1 - tax);
    const equityValue = income / equityRate;
    const firmValue = equityValue + debt;
    const price = firmValue / originalShares;

    function buyback(purchasePrice, equityWeight, debtWeight) {
      const repurchased = debt / purchasePrice;
      const remaining = originalShares - repurchased;
      return {
        repurchased, remaining, eps: income / remaining,
        wacc: debtWeight * (debtRate ?? 0) * (1 - tax) + equityWeight * equityRate
      };
    }

    const fixed = buyback(originalPrice, (assets - debt) / assets, debt / assets);
    const market = buyback(price, equityValue / firmValue, debt / firmValue);
    return { debt, interest, income, tie: interest ? ebit / interest : null,
      fixed: { ...fixed, price: fixed.eps / equityRate }, market: { ...market, price } };
  });
}

function roundHalfUp(value, digits) {
  const scale = 10 ** digits;
  return Math.round(Number((value * scale).toPrecision(12))) / scale;
}

if (typeof module !== "undefined") {
  module.exports = { exampleFirm, cdssResults, roundHalfUp };
}

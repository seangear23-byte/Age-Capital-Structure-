"use strict";

async function readCsv(name) {
  const response = await fetch(`./data/${name}.csv`);
  if (!response.ok) throw new Error(`Could not load ${name}.csv.`);
  const [header, ...lines] = (await response.text()).trim().split(/\r?\n/);
  // The case CSVs use unquoted fields. Ignore note columns after the numeric data.
  const columns = header.split(",");
  return lines.map(line => {
    const fields = line.split(",");
    return Object.fromEntries(columns.map((column, index) => [column, fields[index]?.trim()]));
  });
}

function keyed(rows, key) {
  return Object.fromEntries(rows.map(row => [row[key], Number(row.value)]));
}

function format(value, digits, prefix = "", suffix = "") {
  if (value === null) return "n/a";
  return prefix + roundHalfUp(value, digits).toLocaleString("en-US", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }) + suffix;
}

const dollars = value => format(value, 0, "$");
const cents = value => format(value, 2, "$");
const percent = value => value === null ? "n/a" : format(value * 100, 2, "", "%");
const multiple = value => format(value, 2, "", "×");
const shares = value => format(value, 2);

function table(parent, title, headings, rows) {
  const card = document.createElement("div");
  card.className = "card";
  const element = document.createElement("table");
  const caption = element.createCaption();
  caption.textContent = title;
  const header = element.createTHead().insertRow();
  for (const label of headings) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  const body = element.createTBody();
  for (const [label, ...values] of rows) {
    const row = body.insertRow();
    const cell = document.createElement("th");
    cell.scope = "row";
    cell.textContent = label;
    row.append(cell);
    for (const value of values) row.insertCell().textContent = value;
  }
  card.append(element);
  parent.append(card);
}

function showFirm(title, firm) {
  const scenarios = [
    ["Assets", "assets", dollars], ["Equity", "equity", dollars],
    ["Probability", "probability", percent], ["Sales", "sales", dollars],
    ["Operating costs", "operatingCosts", dollars], ["EBIT", "ebit", dollars],
    ["Interest", "interest", dollars], ["Earnings before tax", "ebt", dollars],
    ["Taxes", "taxes", dollars], ["Net income", "income", dollars],
    ["ROE", "roe", percent], ["TIE", "tie", multiple]
  ];
  const parent = document.querySelector("#firm-tables");
  table(parent, title, ["Metric", "Low", "Middle", "High"],
    scenarios.map(([label, key, display]) => [label, ...firm.rows.map(row => display(row[key]))]));
}

function showDebt(rows, originalPrice) {
  const parent = document.querySelector("#debt-tables");
  const metrics = [
    ["Shares repurchased", "repurchased", shares], ["Shares remaining", "remaining", shares],
    ["EPS", "eps", cents], ["Share price", "price", cents], ["WACC", "wacc", percent]
  ];
  for (const row of rows) {
    const values = metrics.map(([label, key, display]) => [label, display(row.fixed[key]), display(row.market[key])]);
    values.splice(3, 0, ["TIE", multiple(row.tie), multiple(row.tie)]);
    table(parent, `${dollars(row.debt)} borrowed`,
      ["Metric", `Buy back at ${cents(originalPrice)} · book WACC`, "Buy back at new price · market WACC"],
      values);
  }

  function best(method, key, direction) {
    return rows.reduce((winner, row) => {
      const difference = direction * (row[method][key] - winner[method][key]);
      return difference > 0 || (difference === 0 && row.debt < winner.debt) ? row : winner;
    }).debt;
  }
  const fixedPrice = best("fixed", "price", 1);
  const marketPrice = best("market", "price", 1);
  const bookWacc = best("fixed", "wacc", -1);
  const marketWacc = best("market", "wacc", -1);
  document.querySelector("#extrema").textContent =
    `Highest share price: ${dollars(fixedPrice)} of debt at the case buyback price and ${dollars(marketPrice)} at the new price. ` +
    `Lowest WACC: ${dollars(bookWacc)} of debt with book weights and ${dollars(marketWacc)} with market weights.` +
    (new Set([fixedPrice, marketPrice, bookWacc, marketWacc]).size > 1 ? " The criteria select different debt amounts." : "");
  const baseline = rows.find(row => row.debt === 0);
  if (!baseline || Math.abs(baseline.fixed.price - originalPrice) > 1e-8) {
    const warning = document.querySelector("#warning");
    warning.textContent = "The schedule’s zero-debt price could not be reconciled with the starting price in the company data.";
    warning.hidden = false;
  }
}

async function load() {
  const [assumptions, company, firms, scenarioRows, scheduleRows] = await Promise.all(
    ["assumptions", "cdss", "example_firms", "ebit_scenarios", "banker_schedule"].map(readCsv)
  );
  const { tax_rate: tax } = keyed(assumptions, "assumption");
  const cdss = keyed(company, "item");
  const { total_assets: assets, firm_l_debt: firmDebt, interest_rate: interestRate } = keyed(firms, "item");
  const scenarios = scenarioRows.map(({ probability, sales, operating_costs }) =>
    ({ probability: Number(probability), sales: Number(sales), operating_costs: Number(operating_costs) }));
  const schedule = scheduleRows.map(({ debt, cost_of_debt, cost_of_equity }) =>
    ({ debt: Number(debt), cost_of_debt: cost_of_debt === "" ? null : Number(cost_of_debt),
      cost_of_equity: Number(cost_of_equity) }));
  const firmU = exampleFirm(assets, 0, interestRate, tax, scenarios);
  const firmL = exampleFirm(assets, firmDebt, interestRate, tax, scenarios);
  showFirm("Firm U", firmU);
  showFirm("Firm L", firmL);
  table(document.querySelector("#firms"), "Expected return and risk", ["Metric", "Firm U", "Firm L"], [
    ["Expected ROE", percent(firmU.roe.mean), percent(firmL.roe.mean)],
    ["ROE standard deviation", percent(firmU.roe.deviation), percent(firmL.roe.deviation)],
    ["ROE coefficient of variation", multiple(firmU.roe.cv), multiple(firmL.roe.cv)],
    ["Expected TIE", multiple(firmU.tie.mean), multiple(firmL.tie.mean)],
    ["TIE standard deviation", multiple(firmU.tie.deviation), multiple(firmL.tie.deviation)]
  ]);
  showDebt(cdssResults(cdss, tax, schedule), cdss.share_price);
  document.querySelector("#status").hidden = true;
  document.querySelector("#results").hidden = false;
}

load().catch(error => {
  const status = document.querySelector("#status");
  status.classList.add("error");
  status.textContent = error.message;
});

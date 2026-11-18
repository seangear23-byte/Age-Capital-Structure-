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

  const fixedPrice = bestDebt(rows, "fixed", "price", 1);
  const marketPrice = bestDebt(rows, "market", "price", 1);
  const bookWacc = bestDebt(rows, "fixed", "wacc", -1);
  const marketWacc = bestDebt(rows, "market", "wacc", -1);
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

function bestDebt(rows, method, key, direction) {
  return rows.reduce((winner, row) => {
    const difference = direction * (row[method][key] - winner[method][key]);
    return difference > 0 || (difference === 0 && row.debt < winner.debt) ? row : winner;
  }).debt;
}

function showSliderValue(slider, output, debt) {
  const value = dollars(debt);
  output.textContent = value;
  slider.setAttribute("aria-valuetext", value);
}

function setupFirmSlider(assets, caseDebt, maxDebt, interestRate, tax, scenarios) {
  const slider = document.querySelector("#firm-debt");
  const output = document.querySelector("#firm-debt-value");
  const comparison = document.querySelector("#firm-comparison");
  const firmTables = document.querySelector("#firm-tables");
  const firmU = exampleFirm(assets, 0, interestRate, tax, scenarios);
  slider.max = maxDebt;
  slider.value = caseDebt;
  document.querySelector("#firm-rate").textContent =
    `Firm L’s borrowing rate stays at ${percent(interestRate)} as debt changes.`;

  function render() {
    const debt = slider.valueAsNumber;
    showSliderValue(slider, output, debt);
    const firmL = exampleFirm(assets, debt, interestRate, tax, scenarios);
    const states = ["Low", "Middle", "High"];
    const rows = states.flatMap((state, index) => [
      [`${state} ROE`, percent(firmU.rows[index].roe), percent(firmL.rows[index].roe)],
      [`${state} TIE`, multiple(firmU.rows[index].tie), multiple(firmL.rows[index].tie)]
    ]);
    rows.push(
      ["Expected ROE", percent(firmU.roe.mean), percent(firmL.roe.mean)],
      ["ROE standard deviation", percent(firmU.roe.deviation), percent(firmL.roe.deviation)],
      ["ROE coefficient of variation", multiple(firmU.roe.cv), multiple(firmL.roe.cv)],
      ["Expected TIE", multiple(firmU.tie.mean), multiple(firmL.tie.mean)],
      ["TIE standard deviation", multiple(firmU.tie.deviation), multiple(firmL.tie.deviation)]
    );
    comparison.replaceChildren();
    table(comparison, "Return and risk by firm", ["Metric", "Firm U", "Firm L"], rows);
    firmTables.replaceChildren();
    showFirm("Firm U", firmU);
    showFirm("Firm L", firmL);
  }

  slider.addEventListener("input", render);
  document.querySelector("#case-debt").addEventListener("click", () => {
    slider.value = caseDebt;
    render();
  });
  render();
}

function setupCdssSlider(rows, originalPrice, startingDebt) {
  const slider = document.querySelector("#cdss-debt");
  const output = document.querySelector("#cdss-debt-value");
  const selected = document.querySelector("#selected-debt");
  const note = document.querySelector("#cdss-action-note");
  const indexForDebt = debt => rows.findIndex(row => row.debt === debt);
  slider.max = rows.length - 1;
  slider.value = Math.max(0, indexForDebt(startingDebt));

  function ownership(result) {
    if (result.managementOwnership === null) return "Management would have to sell shares.";
    const stake = percent(result.managementOwnership);
    return result.allOutsideSharesRepurchased ? `${stake} · No outside shareholders left` : stake;
  }

  function render() {
    const { debt, tie, fixed, market } = rows[slider.valueAsNumber];
    showSliderValue(slider, output, debt);
    const metrics = [
      ["Share price", "price", cents], ["Shares repurchased", "repurchased", shares],
      ["Shares remaining", "remaining", shares], ["EPS", "eps", cents], ["DPS", "dps", cents],
      ["WACC", "wacc", percent]
    ];
    const values = metrics.map(([label, key, display]) => [label, display(fixed[key]), display(market[key])]);
    values.splice(5, 0, ["TIE", multiple(tie), multiple(tie)]);
    values.push(["Management ownership", ownership(fixed), ownership(market)]);
    selected.replaceChildren();
    table(selected, `Results at ${dollars(debt)} of debt`,
      ["Metric", `Buy back at ${cents(originalPrice)} · book WACC`, "Buy back at new price · market WACC"],
      values);
  }

  function jumpToBest(key, label) {
    const fixed = bestDebt(rows, "fixed", key, 1);
    const market = bestDebt(rows, "market", key, 1);
    slider.value = indexForDebt(fixed);
    note.hidden = fixed === market;
    note.textContent = fixed === market ? "" :
      `${label} occurs at ${dollars(fixed)} with the case buyback and ${dollars(market)} with the new-price buyback. Showing the case amount.`;
    render();
  }

  slider.addEventListener("input", () => {
    note.hidden = true;
    note.textContent = "";
    render();
  });
  document.querySelector("#best-price").addEventListener("click", () => jumpToBest("price", "Best price"));
  document.querySelector("#highest-eps").addEventListener("click", () => jumpToBest("eps", "Highest EPS"));
  render();
}

async function load() {
  const [assumptions, company, firms, scenarioRows, scheduleRows] = await Promise.all(
    ["assumptions", "cdss", "example_firms", "ebit_scenarios", "banker_schedule"].map(readCsv)
  );
  const { tax_rate: tax } = keyed(assumptions, "assumption");
  const cdss = keyed(company, "item");
  const { total_assets: assets, firm_l_debt: firmDebt, slider_max: firmMax,
    interest_rate: interestRate } = keyed(firms, "item");
  const scenarios = scenarioRows.map(({ probability, sales, operating_costs }) =>
    ({ probability: Number(probability), sales: Number(sales), operating_costs: Number(operating_costs) }));
  const schedule = scheduleRows.map(({ debt, cost_of_debt, cost_of_equity }) =>
    ({ debt: Number(debt), cost_of_debt: cost_of_debt === "" ? null : Number(cost_of_debt),
      cost_of_equity: Number(cost_of_equity) }));
  setupFirmSlider(assets, firmDebt, firmMax, interestRate, tax, scenarios);
  const results = cdssResults(cdss, tax, schedule);
  showDebt(results, cdss.share_price);
  setupCdssSlider(results, cdss.share_price, cdss.debt);
  document.querySelector("#status").hidden = true;
  document.querySelector("#results").hidden = false;
}

load().catch(error => {
  const status = document.querySelector("#status");
  status.classList.add("error");
  status.textContent = error.message;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(error => {
    console.warn("Offline setup failed.", error);
  });
}

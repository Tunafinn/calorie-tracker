(function () {
  const START_ISO = "2026-10-24T01:00:00-05:00";
  const START_MS = Date.parse(START_ISO);
  const BURN_PER_DAY = 3400;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const KCAL_PER_LB = 3500;
  const GOAL_LB = 120;
  const GOAL_DEFICIT = GOAL_LB * KCAL_PER_LB;
  const START_WEIGHT = 345;
  const GOAL_WEIGHT = 225;
  const STORAGE_KEY = "calorie-tracker-v1";
  const THEME_KEY = "calorie-tracker-theme";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function uid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function baseBurn(nowMs) {
    const elapsed = Math.max(0, nowMs - START_MS);
    return (elapsed / MS_PER_DAY) * BURN_PER_DAY;
  }

  function cleanName(value) {
    if (typeof value !== "string") return "";
    return value.trim().replace(/\s+/g, " ");
  }

  function cleanEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const type = raw.type === "food" || raw.type === "workout" ? raw.type : null;
    if (!type) return null;
    const name = cleanName(raw.name);
    if (!name || name.length > 80) return null;
    const calories = typeof raw.calories === "number" ? raw.calories : Number(raw.calories);
    if (!Number.isFinite(calories) || calories <= 0 || calories > 100000) return null;
    const timeMs = Date.parse(raw.time);
    if (!Number.isFinite(timeMs)) return null;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : uid();
    return {
      id: id,
      type: type,
      name: name,
      calories: round2(calories),
      time: new Date(timeMs).toISOString(),
    };
  }

  function cleanWeight(raw) {
    if (!raw || typeof raw !== "object") return null;
    const lb = typeof raw.lb === "number" ? raw.lb : Number(raw.lb);
    if (!Number.isFinite(lb) || lb <= 0 || lb > 1500) return null;
    const timeMs = Date.parse(raw.time);
    if (!Number.isFinite(timeMs)) return null;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : uid();
    return { id: id, lb: round2(lb), time: new Date(timeMs).toISOString() };
  }

  function dedupeIds(items) {
    const seen = new Set();
    return items.map(function (item) {
      if (seen.has(item.id)) return Object.assign({}, item, { id: uid() });
      seen.add(item.id);
      return item;
    });
  }

  function sanitize(data) {
    const source = data && typeof data === "object" ? data : {};
    const rawEntries = Array.isArray(source.entries) ? source.entries : [];
    const rawWeights = Array.isArray(source.weights) ? source.weights : [];
    const entries = [];
    const weights = [];
    let skipped = 0;
    rawEntries.forEach(function (row) {
      const clean = cleanEntry(row);
      if (clean) entries.push(clean);
      else skipped += 1;
    });
    rawWeights.forEach(function (row) {
      const clean = cleanWeight(row);
      if (clean) weights.push(clean);
      else skipped += 1;
    });
    return { entries: dedupeIds(entries), weights: dedupeIds(weights), skipped: skipped };
  }

  function summarize(state, nowMs) {
    let eaten = 0;
    let workout = 0;
    (state.entries || []).forEach(function (entry) {
      if (entry.type === "food") eaten += entry.calories;
      else if (entry.type === "workout") workout += entry.calories;
    });
    const base = baseBurn(nowMs);
    const burned = base + workout;
    const net = burned - eaten;
    const weights = (state.weights || []).slice().sort(function (a, b) {
      const delta = Date.parse(a.time) - Date.parse(b.time);
      if (delta) return delta;
      return String(a.id).localeCompare(String(b.id));
    });
    const current = weights.length ? weights[weights.length - 1].lb : START_WEIGHT;
    return {
      base: base,
      workout: workout,
      eaten: eaten,
      burned: burned,
      net: net,
      lbs: net / KCAL_PER_LB,
      pct: (net / GOAL_DEFICIT) * 100,
      kcalLeft: Math.max(0, GOAL_DEFICIT - net),
      currentWeight: current,
      lostLb: START_WEIGHT - current,
      remainingLb: current - GOAL_WEIGHT,
    };
  }

  function latestIndex(entries) {
    let best = -1;
    for (let i = 0; i < entries.length; i += 1) {
      if (best < 0) {
        best = i;
        continue;
      }
      const delta = Date.parse(entries[i].time) - Date.parse(entries[best].time);
      if (delta > 0 || (delta === 0 && i > best)) best = i;
    }
    return best;
  }

  function undoLast(entries) {
    const index = latestIndex(entries);
    if (index < 0) return { entries: entries.slice(), removed: null };
    return {
      entries: entries.slice(0, index).concat(entries.slice(index + 1)),
      removed: entries[index],
    };
  }

  function clearLog(state) {
    return { entries: [], weights: state.weights.slice() };
  }

  function parsePositive(raw, max) {
    if (typeof raw !== "string") return null;
    const cleaned = raw.trim().replace(",", ".");
    if (!cleaned) return null;
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value <= 0 || value > max) return null;
    return round2(value);
  }

  function parseBackup(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("That file is not valid JSON.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("That file is not a tracker backup.");
    }
    if (!Object.prototype.hasOwnProperty.call(data, "entries") && !Object.prototype.hasOwnProperty.call(data, "weights")) {
      throw new Error("That file has no food, workout, or weight data.");
    }
    if (Object.prototype.hasOwnProperty.call(data, "entries") && !Array.isArray(data.entries)) {
      throw new Error("The food and workout log is not a list.");
    }
    if (Object.prototype.hasOwnProperty.call(data, "weights") && !Array.isArray(data.weights)) {
      throw new Error("The weight log is not a list.");
    }
    const cleaned = sanitize(data);
    const hadRows = (Array.isArray(data.entries) && data.entries.length > 0) || (Array.isArray(data.weights) && data.weights.length > 0);
    if (hadRows && cleaned.entries.length === 0 && cleaned.weights.length === 0) {
      throw new Error("No valid entries were found in that file.");
    }
    return cleaned;
  }

  function layoutChart(weights, nowMs) {
    const width = 360;
    const height = 220;
    const pad = { l: 46, r: 14, t: 16, b: 32 };
    const pts = [{ t: START_MS, lb: START_WEIGHT, kind: "start" }];
    const sorted = (weights || []).slice().sort(function (a, b) {
      const delta = Date.parse(a.time) - Date.parse(b.time);
      if (delta) return delta;
      return String(a.id).localeCompare(String(b.id));
    });
    sorted.forEach(function (row) {
      pts.push({ t: Date.parse(row.time), lb: row.lb, kind: "log", id: row.id });
    });

    const values = pts.map(function (p) { return p.lb; }).concat([GOAL_WEIGHT]);
    let minY = Math.min.apply(null, values);
    let maxY = Math.max.apply(null, values);
    if (minY === maxY) {
      minY -= 5;
      maxY += 5;
    }
    const yPad = (maxY - minY) * 0.14;
    minY -= yPad;
    maxY += yPad;

    let minX = Math.min.apply(null, pts.map(function (p) { return p.t; }));
    let maxX = Math.max.apply(null, pts.map(function (p) { return p.t; }).concat([nowMs]));
    const spanX = Math.max(maxX - minX, 60 * 60 * 1000);
    const xPad = spanX * 0.08;
    minX -= xPad;
    maxX += xPad;
    if (!(maxX > minX)) {
      minX -= 3600000;
      maxX += 3600000;
    }

    function xScale(t) {
      return pad.l + ((t - minX) / (maxX - minX)) * (width - pad.l - pad.r);
    }
    function yScale(lb) {
      return pad.t + ((maxY - lb) / (maxY - minY)) * (height - pad.t - pad.b);
    }

    const points = pts.map(function (p) {
      return { t: p.t, lb: p.lb, kind: p.kind, id: p.id, x: xScale(p.t), y: yScale(p.lb) };
    });

    const hi = Math.max.apply(null, pts.map(function (p) { return p.lb; }));
    const lo = Math.min.apply(null, pts.map(function (p) { return p.lb; }));
    const candidates = [
      { lb: GOAL_WEIGHT, text: "225", goal: true },
      { lb: hi, text: formatAxisLb(hi), goal: false },
      { lb: lo, text: formatAxisLb(lo), goal: false },
    ];
    const yLabels = [];
    candidates.sort(function (a, b) { return Number(b.goal) - Number(a.goal); }).forEach(function (candidate) {
      const y = yScale(candidate.lb);
      if (yLabels.some(function (label) { return Math.abs(label.y - y) < 16; })) return;
      yLabels.push({ lb: candidate.lb, text: candidate.text, goal: candidate.goal, y: y });
    });

    const xLabels = [{ t: points[0].t, x: points[0].x, anchor: "start" }];
    const last = points[points.length - 1];
    if (last.t - points[0].t > 60 * 1000) {
      xLabels.push({ t: last.t, x: last.x, anchor: "end" });
    }
    if (xLabels.length === 2 && Math.abs(xLabels[0].x - xLabels[1].x) < 90) {
      xLabels.shift();
      xLabels[0].anchor = "middle";
    }

    return {
      width: width,
      height: height,
      pad: pad,
      points: points,
      goalY: yScale(GOAL_WEIGHT),
      minX: minX,
      maxX: maxX,
      minY: minY,
      maxY: maxY,
      yLabels: yLabels,
      xLabels: xLabels,
      plotLeft: pad.l,
      plotRight: width - pad.r,
    };
  }

  function formatAxisLb(lb) {
    if (Math.abs(lb - Math.round(lb)) < 0.05) return String(Math.round(lb));
    return lb.toFixed(1);
  }

  const api = {
    START_ISO: START_ISO,
    START_MS: START_MS,
    BURN_PER_DAY: BURN_PER_DAY,
    KCAL_PER_LB: KCAL_PER_LB,
    GOAL_DEFICIT: GOAL_DEFICIT,
    START_WEIGHT: START_WEIGHT,
    GOAL_WEIGHT: GOAL_WEIGHT,
    STORAGE_KEY: STORAGE_KEY,
    baseBurn: baseBurn,
    summarize: summarize,
    sanitize: sanitize,
    parseBackup: parseBackup,
    undoLast: undoLast,
    clearLog: clearLog,
    layoutChart: layoutChart,
    parsePositive: parsePositive,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof document === "undefined") return;

  const clockFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const entryDayFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  });
  const entryClockFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
  const axisDayFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  });
  const axisTimeFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const netValue = document.getElementById("net-value");
  const asOf = document.getElementById("as-of");
  const burnedValue = document.getElementById("burned-value");
  const burnSplit = document.getElementById("burn-split");
  const eatenValue = document.getElementById("eaten-value");
  const goalPercent = document.getElementById("goal-percent");
  const goalBar = document.getElementById("goal-bar");
  const goalFill = document.getElementById("goal-fill");
  const lbsEst = document.getElementById("lbs-est");
  const kcalLeft = document.getElementById("kcal-left");
  const foodForm = document.getElementById("food-form");
  const workoutForm = document.getElementById("workout-form");
  const formStatus = document.getElementById("form-status");
  const undoBtn = document.getElementById("undo-btn");
  const clearBtn = document.getElementById("clear-btn");
  const logTable = document.getElementById("log-table");
  const logBody = document.getElementById("log-body");
  const logEmpty = document.getElementById("log-empty");
  const wtCurrent = document.getElementById("wt-current");
  const wtLost = document.getElementById("wt-lost");
  const wtLeft = document.getElementById("wt-left");
  const weightForm = document.getElementById("weight-form");
  const weightStatus = document.getElementById("weight-status");
  const weightChart = document.getElementById("weight-chart");
  const weightList = document.getElementById("weight-list");
  const weightEmpty = document.getElementById("weight-empty");
  const exportBtn = document.getElementById("export-btn");
  const importBtn = document.getElementById("import-btn");
  const importFile = document.getElementById("import-file");
  const backupStatus = document.getElementById("backup-status");
  const themeToggle = document.getElementById("theme-toggle");
  const notice = document.getElementById("notice");
  const chartDesc = document.getElementById("chart-desc");

  let state = { entries: [], weights: [] };

  function formatKcal(value, digits) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function formatLb(value, digits) {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) + " lb";
  }

  function formatElapsed(ms) {
    const total = Math.floor(ms / 1000);
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hoursTotal = Math.floor(total / 3600);
    const days = Math.floor(hoursTotal / 24);
    const hours = hoursTotal % 24;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    if (days > 0) return days + "d " + hours + "h " + mm + "m " + ss + "s";
    return hours + "h " + mm + "m " + ss + "s";
  }

  function showNotice(message) {
    if (!message) {
      notice.hidden = true;
      notice.textContent = "";
      return;
    }
    notice.hidden = false;
    notice.textContent = message;
  }

  function loadState() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return {
        entries: [],
        weights: [],
        warning: "This browser is blocking local storage, so logs will not stay after you leave.",
      };
    }
    if (!raw) return { entries: [], weights: [], skipped: 0 };
    try {
      const cleaned = sanitize(JSON.parse(raw));
      return {
        entries: cleaned.entries,
        weights: cleaned.weights,
        skipped: cleaned.skipped,
        warning: cleaned.skipped > 0 ? "Some saved rows were invalid and were ignored." : "",
      };
    } catch (e) {
      return {
        entries: [],
        weights: [],
        warning: "Saved data could not be read. Starting with an empty log.",
      };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        entries: state.entries,
        weights: state.weights,
      }));
      return true;
    } catch (e) {
      showNotice("Could not save on this device. Allow storage for this site and try again.");
      return false;
    }
  }

  function renderTotals(nowMs) {
    const summary = summarize(state, nowMs);
    netValue.textContent = formatKcal(summary.net, 2);
    burnedValue.textContent = formatKcal(summary.burned, 2);
    eatenValue.textContent = formatKcal(summary.eaten, 1);
    burnSplit.textContent = "Base " + formatKcal(summary.base, 1) + " + workouts " + formatKcal(summary.workout, 1);
    goalPercent.textContent = summary.pct.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + "%";
    const clamped = Math.min(100, Math.max(0, summary.pct));
    goalFill.style.width = clamped + "%";
    goalBar.setAttribute("aria-valuenow", String(Math.round(clamped)));
    goalBar.setAttribute("aria-valuetext", goalPercent.textContent + " of 420,000 kcal");
    lbsEst.textContent = formatLb(summary.lbs, 2);
    kcalLeft.textContent = summary.net >= GOAL_DEFICIT ? "Goal reached" : formatKcal(summary.kcalLeft, 0) + " kcal";
    asOf.textContent = nowMs < START_MS
      ? "Starts 1:00 AM CT · Oct 24, 2026"
      : "Elapsed " + formatElapsed(nowMs - START_MS) + " · " + clockFormat.format(nowMs);
    return summary;
  }

  function renderLog() {
    logBody.textContent = "";
    const rows = state.entries.map(function (entry, index) {
      return { entry: entry, index: index };
    }).sort(function (a, b) {
      const delta = Date.parse(b.entry.time) - Date.parse(a.entry.time);
      if (delta) return delta;
      return b.index - a.index;
    });
    rows.forEach(function (row) {
      const entry = row.entry;
      const tr = document.createElement("tr");
      const timeCell = document.createElement("td");
      const day = document.createElement("span");
      day.className = "when-day";
      day.textContent = entryDayFormat.format(new Date(entry.time));
      const clock = document.createElement("span");
      clock.className = "when-clock";
      clock.textContent = entryClockFormat.format(new Date(entry.time));
      timeCell.append(day, clock);

      const typeCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge " + entry.type;
      badge.textContent = entry.type === "food" ? "Food" : "Workout";
      typeCell.appendChild(badge);

      const itemCell = document.createElement("td");
      itemCell.textContent = entry.name;

      const kcalCell = document.createElement("td");
      kcalCell.className = "num " + (entry.type === "food" ? "kcal-food" : "kcal-workout");
      const amount = formatKcal(entry.calories, 1);
      kcalCell.textContent = entry.type === "food" ? "−" + amount : "+" + amount;

      tr.append(timeCell, typeCell, itemCell, kcalCell);
      logBody.appendChild(tr);
    });
    const empty = rows.length === 0;
    logTable.hidden = empty;
    logEmpty.hidden = !empty;
    undoBtn.disabled = empty;
    clearBtn.disabled = empty;
  }

  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(function (key) {
      el.setAttribute(key, attrs[key]);
    });
    return el;
  }

  function renderChart(summary, nowMs) {
    const layout = layoutChart(state.weights, nowMs);
    chartDesc.textContent = "Weight starts at 345 pounds. The goal line is 225 pounds. Current weight is " +
      summary.currentWeight.toFixed(1) + " pounds.";
    const existing = weightChart.querySelector("#chart-shapes");
    if (existing) existing.remove();
    const group = svgEl("g", { id: "chart-shapes" });

    layout.yLabels.forEach(function (label) {
      group.appendChild(svgEl("line", {
        class: "chart-shape chart-grid",
        x1: String(layout.plotLeft),
        x2: String(layout.plotRight),
        y1: label.y.toFixed(2),
        y2: label.y.toFixed(2),
      }));
    });

    group.appendChild(svgEl("line", {
      class: "chart-shape chart-goal",
      x1: String(layout.plotLeft),
      x2: String(layout.plotRight),
      y1: layout.goalY.toFixed(2),
      y2: layout.goalY.toFixed(2),
    }));

    if (layout.points.length > 1) {
      const commands = layout.points.map(function (point, index) {
        return (index === 0 ? "M" : "L") + point.x.toFixed(2) + "," + point.y.toFixed(2);
      }).join(" ");
      const last = layout.points[layout.points.length - 1];
      const first = layout.points[0];
      const baseline = layout.height - layout.pad.b;
      group.appendChild(svgEl("path", {
        class: "chart-shape chart-area",
        d: commands + " L" + last.x.toFixed(2) + "," + baseline + " L" + first.x.toFixed(2) + "," + baseline + " Z",
      }));
      group.appendChild(svgEl("path", { class: "chart-shape chart-line", d: commands }));
    }

    layout.points.forEach(function (point, index) {
      const latestLog = point.kind === "log" && index === layout.points.length - 1;
      const cls = point.kind === "start"
        ? "chart-shape chart-dot chart-dot-start"
        : latestLog
          ? "chart-shape chart-dot chart-dot-latest"
          : "chart-shape chart-dot";
      group.appendChild(svgEl("circle", {
        class: cls,
        cx: point.x.toFixed(2),
        cy: point.y.toFixed(2),
        r: latestLog ? "5.5" : "4",
      }));
    });

    layout.yLabels.forEach(function (label) {
      const text = svgEl("text", {
        class: label.goal ? "chart-shape chart-goal-label" : "chart-shape chart-label",
        x: "4",
        y: label.y.toFixed(2),
        "dominant-baseline": "middle",
      });
      text.textContent = label.text;
      group.appendChild(text);
    });

    const span = layout.maxX - layout.minX;
    layout.xLabels.forEach(function (label) {
      const text = svgEl("text", {
        class: "chart-shape chart-label",
        x: label.x.toFixed(2),
        y: String(layout.height - 8),
        "text-anchor": label.anchor,
      });
      const when = span < 2 * MS_PER_DAY ? axisTimeFormat : axisDayFormat;
      text.textContent = when.format(new Date(label.t));
      group.appendChild(text);
    });

    weightChart.appendChild(group);
  }

  function renderWeights(summary, nowMs) {
    wtCurrent.textContent = formatLb(summary.currentWeight, 1);
    wtLost.textContent = formatLb(summary.lostLb, 2);
    wtLeft.textContent = summary.remainingLb <= 0 ? "Goal reached" : formatLb(summary.remainingLb, 2);
    renderChart(summary, nowMs);

    weightList.textContent = "";
    const rows = state.weights.slice().sort(function (a, b) {
      return Date.parse(b.time) - Date.parse(a.time);
    });
    rows.forEach(function (row) {
      const li = document.createElement("li");
      const when = document.createElement("span");
      when.className = "when";
      const at = new Date(row.time);
      when.textContent = entryDayFormat.format(at) + " · " + entryClockFormat.format(at);
      const lb = document.createElement("span");
      lb.className = "lb";
      lb.textContent = formatLb(row.lb, 1);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.id = row.id;
      button.textContent = "Remove";
      li.append(when, lb, button);
      weightList.appendChild(li);
    });
    weightEmpty.hidden = rows.length > 0;
  }

  function renderAll() {
    const now = Date.now();
    const summary = renderTotals(now);
    renderLog();
    renderWeights(summary, now);
  }

  function readItem(form) {
    return cleanName(form.querySelector('[name="item"]').value);
  }

  foodForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const name = readItem(foodForm);
    const calories = parsePositive(foodForm.querySelector('[name="calories"]').value, 100000);
    if (!name) {
      formStatus.textContent = "Enter a food name.";
      foodForm.querySelector('[name="item"]').focus();
      return;
    }
    if (calories == null) {
      formStatus.textContent = "Enter calories greater than 0.";
      foodForm.querySelector('[name="calories"]').focus();
      return;
    }
    state.entries.push({
      id: uid(),
      type: "food",
      name: name,
      calories: calories,
      time: new Date().toISOString(),
    });
    save();
    foodForm.reset();
    renderAll();
    formStatus.textContent = "Logged " + name + ", " + formatKcal(calories, 1) + " kcal of food.";
    foodForm.querySelector('[name="item"]').focus();
  });

  workoutForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const name = readItem(workoutForm);
    const calories = parsePositive(workoutForm.querySelector('[name="calories"]').value, 100000);
    if (!name) {
      formStatus.textContent = "Enter a workout name.";
      workoutForm.querySelector('[name="item"]').focus();
      return;
    }
    if (calories == null) {
      formStatus.textContent = "Enter calories greater than 0.";
      workoutForm.querySelector('[name="calories"]').focus();
      return;
    }
    state.entries.push({
      id: uid(),
      type: "workout",
      name: name,
      calories: calories,
      time: new Date().toISOString(),
    });
    save();
    workoutForm.reset();
    renderAll();
    formStatus.textContent = "Logged " + name + ", " + formatKcal(calories, 1) + " kcal burned.";
    workoutForm.querySelector('[name="item"]').focus();
  });

  undoBtn.addEventListener("click", function () {
    const result = undoLast(state.entries);
    if (!result.removed) return;
    state.entries = result.entries;
    save();
    renderAll();
    const removed = result.removed;
    formStatus.textContent = "Removed " + removed.name + " (" + removed.type + ", " + formatKcal(removed.calories, 1) + " kcal).";
  });

  clearBtn.addEventListener("click", function () {
    if (!state.entries.length) return;
    const ok = window.confirm("Clear all food and workout entries? The start time and weight log will stay.");
    if (!ok) return;
    state = clearLog(state);
    save();
    renderAll();
    formStatus.textContent = "Cleared the food and workout log.";
  });

  weightForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const lb = parsePositive(weightForm.querySelector('[name="lb"]').value, 1500);
    if (lb == null) {
      weightStatus.textContent = "Enter a weight in pounds greater than 0.";
      weightForm.querySelector('[name="lb"]').focus();
      return;
    }
    state.weights.push({ id: uid(), lb: lb, time: new Date().toISOString() });
    save();
    weightForm.reset();
    renderAll();
    weightStatus.textContent = "Logged " + formatLb(lb, 1) + ".";
    weightForm.querySelector('[name="lb"]').focus();
  });

  weightList.addEventListener("click", function (event) {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const id = button.getAttribute("data-id");
    const item = button.closest("li");
    const next = item && item.nextElementSibling && item.nextElementSibling.querySelector("button");
    const prev = item && item.previousElementSibling && item.previousElementSibling.querySelector("button");
    const nextId = next ? next.getAttribute("data-id") : prev ? prev.getAttribute("data-id") : "";
    state.weights = state.weights.filter(function (row) { return row.id !== id; });
    save();
    renderAll();
    weightStatus.textContent = "Removed that weigh-in.";
    let focusTarget = weightForm.querySelector('[name="lb"]');
    if (nextId) {
      weightList.querySelectorAll("button[data-id]").forEach(function (candidate) {
        if (candidate.getAttribute("data-id") === nextId) focusTarget = candidate;
      });
    }
    if (focusTarget) focusTarget.focus();
  });

  exportBtn.addEventListener("click", function () {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      startTime: START_ISO,
      baselineKcalPerDay: BURN_PER_DAY,
      startWeightLb: START_WEIGHT,
      goalWeightLb: GOAL_WEIGHT,
      kcalPerLb: KCAL_PER_LB,
      goalDeficitKcal: GOAL_DEFICIT,
      entries: state.entries,
      weights: state.weights,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    link.href = url;
    link.download = "calorie-tracker-" + day + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    backupStatus.textContent = "Backup downloaded. It stays on this device unless you move the file.";
  });

  importBtn.addEventListener("click", function () {
    importFile.click();
  });

  importFile.addEventListener("change", function () {
    const file = importFile.files && importFile.files[0];
    importFile.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const next = parseBackup(String(reader.result));
        const ok = window.confirm("Replace the food, workout, and weight logs on this device with this file?");
        if (!ok) {
          backupStatus.textContent = "Import canceled.";
          return;
        }
        state = { entries: next.entries, weights: next.weights };
        save();
        renderAll();
        const skipped = next.skipped ? " Skipped " + next.skipped + " invalid rows." : "";
        backupStatus.textContent = "Imported " + next.entries.length + " log entries and " + next.weights.length + " weigh-ins." + skipped;
      } catch (error) {
        backupStatus.textContent = error.message || "Could not import that file.";
      }
    };
    reader.onerror = function () {
      backupStatus.textContent = "Could not read that file.";
    };
    reader.readAsText(file);
  });

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function activeTheme() {
    const set = document.documentElement.getAttribute("data-theme");
    return set === "light" || set === "dark" ? set : systemTheme();
  }

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
    const current = activeTheme();
    themeToggle.textContent = current === "dark" ? "Light" : "Dark";
    themeToggle.setAttribute("aria-label", current === "dark" ? "Switch to light mode" : "Switch to dark mode");
    themeToggle.setAttribute("aria-pressed", current === "dark" ? "true" : "false");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", current === "dark" ? "#0c1410" : "#eef3ea");
  }

  themeToggle.addEventListener("click", function () {
    const next = activeTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
  });

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if (!document.documentElement.getAttribute("data-theme")) applyTheme(null);
  });

  let storedTheme = null;
  try { storedTheme = localStorage.getItem(THEME_KEY); } catch (e) {}
  applyTheme(storedTheme === "light" || storedTheme === "dark" ? storedTheme : null);

  const loaded = loadState();
  state = { entries: loaded.entries, weights: loaded.weights };
  if (loaded.warning) showNotice(loaded.warning);
  if (loaded.skipped > 0) save();
  renderAll();
  window.setInterval(function () { renderTotals(Date.now()); }, 1000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(function () {});
  }
})();

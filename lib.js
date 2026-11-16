/* Pure logic: dates, workout sequencing, totals, trends, calendar file.
   No DOM in here, so it can be tested in Node (see test/lib.test.js). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./plan.js'));
  else root.Lib = factory(root.PLAN);
})(typeof self !== 'undefined' ? self : this, function (PLAN) {
  /* ---------- dates (local calendar days as 'YYYY-MM-DD') ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return fmt(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function weekday(s) { return parse(s).getDay(); } /* 0 = Sunday */
  function trainingWeek(start, today) {
    var d = diffDays(start, today);
    return d < 0 ? 0 : Math.floor(d / 7) + 1;
  }

  /* ---------- workouts ---------- */
  function dayDef(id) { return id === 'B' ? PLAN.bonus : PLAN.days[id - 1]; }
  function totalSets(def) { return def.exercises.reduce(function (n, e) { return n + e.sets; }, 0); }
  function doneSetCount(session) {
    var n = 0;
    Object.keys(session.sets || {}).forEach(function (k) {
      session.sets[k].forEach(function (s) { if (s && s.done) n++; });
    });
    return n;
  }
  /* A session counts as complete once it is finished, or 60% of its sets are ticked. */
  function isComplete(session) {
    if (session.end) return true;
    var def = dayDef(session.day);
    return def ? doneSetCount(session) >= Math.ceil(totalSets(def) * 0.6) : false;
  }
  function sortSessions(list) {
    return list.slice().sort(function (a, b) { return a.d === b.d ? (a.start || 0) - (b.start || 0) : (a.d < b.d ? -1 : 1); });
  }
  /* "Missed a day: do the next day in order. Never double up." */
  function nextInOrder(sessions) {
    var strength = sortSessions(sessions.filter(function (s) { return s.day !== 'B' && isComplete(s); }));
    if (!strength.length) return 1;
    return (strength[strength.length - 1].day % 5) + 1;
  }
  function todayWorkout(sessions, date) {
    var mine = sessions.filter(function (s) { return s.d === date && s.day !== 'B'; });
    var done = mine.filter(isComplete)[0];
    if (done) return { kind: 'train', day: done.day, done: true };
    var started = mine.filter(function (s) { return doneSetCount(s) > 0; })[0];
    if (started) return { kind: 'train', day: started.day, started: true };
    var wd = weekday(date);
    if (wd === 0) return { kind: 'off' };
    if (wd === 6) return { kind: 'bonus', next: nextInOrder(sessions) };
    return { kind: 'train', day: nextInOrder(sessions) };
  }
  function dayType(state, date) {
    var rec = state.days[date];
    if (rec && rec.dayType) return rec.dayType;
    var wd = weekday(date);
    return wd >= 1 && wd <= 5 ? 'train' : 'rest';
  }

  /* ---------- routine ---------- */
  function routineFor(type, wd) {
    var out = [];
    PLAN.routine.forEach(function (r) {
      var text;
      if (type === 'train') text = r.train;
      else if (wd === 6 && r.sat !== undefined) text = r.sat;
      else if (wd === 0 && r.sun !== undefined) text = r.sun;
      else text = r.rest;
      if (text == null) return;
      var row = {}; for (var k in r) row[k] = r[k];
      row.text = text;
      out.push(row);
    });
    return out;
  }
  function currentRowId(rows, nowHHMM) {
    var cur = null;
    rows.forEach(function (r) { if (r.at <= nowHHMM) cur = r.id; });
    return cur;
  }

  /* ---------- food ---------- */
  var SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];
  function mealValue(slot, pick) {
    if (!pick || pick === 'skip') return { kcal: 0, protein: 0 };
    if (typeof pick === 'object') return { kcal: +pick.kcal || 0, protein: +pick.protein || 0 };
    var o = PLAN.meals[slot].filter(function (m) { return m.id === pick; })[0];
    return o ? { kcal: o.kcal, protein: o.protein } : { kcal: 0, protein: 0 };
  }
  function dayTotals(rec, type) {
    var kcal = 0, protein = 0;
    rec = rec || {};
    SLOTS.forEach(function (slot) {
      var v = mealValue(slot, rec.meals && rec.meals[slot]);
      kcal += v.kcal; protein += v.protein;
    });
    var scoops = (rec.wheyPost ? 1 : 0) + (rec.wheyExtra ? 1 : 0);
    kcal += scoops * PLAN.whey.kcal; protein += scoops * PLAN.whey.protein;
    return { kcal: kcal, protein: protein, target: PLAN.targets[type] };
  }
  function rowDone(row, rec, type, workoutDone) {
    rec = rec || {};
    var done = rec.done || {};
    if (row.kind === 'meal') return !!(rec.meals && rec.meals[row.meal] !== undefined);
    if (row.kind === 'whey-post') return !!rec.wheyPost;
    if (row.kind === 'extra') return type === 'train' ? !!rec.wheyExtra : !!(rec.meals && rec.meals.snack !== undefined);
    if (row.kind === 'gym') return !!(workoutDone || done.gym);
    return !!done[row.id];
  }

  /* ---------- weight ---------- */
  function weightList(weights) {
    return Object.keys(weights).sort().map(function (d) { return { d: d, kg: weights[d] }; });
  }
  function avgWindow(weights, date, days) {
    var from = addDays(date, -(days - 1)), sum = 0, n = 0;
    Object.keys(weights).forEach(function (d) {
      if (d >= from && d <= date) { sum += weights[d]; n++; }
    });
    return n ? { avg: sum / n, n: n } : null;
  }
  function slope(points) {
    var n = points.length;
    if (n < 2) return null;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += points[i].x; my += points[i].y; }
    mx /= n; my /= n;
    var num = 0, den = 0;
    for (i = 0; i < n; i++) { num += (points[i].x - mx) * (points[i].y - my); den += (points[i].x - mx) * (points[i].x - mx); }
    return den === 0 ? null : num / den;
  }
  /* kg per week over the last 14 days, or null until there is enough data */
  function weeklyTrend(weights, date) {
    var from = addDays(date, -13), pts = [];
    Object.keys(weights).forEach(function (d) {
      if (d >= from && d <= date) pts.push({ x: diffDays(from, d), y: weights[d] });
    });
    if (pts.length < 5) return null;
    var xs = pts.map(function (p) { return p.x; });
    if (Math.max.apply(null, xs) - Math.min.apply(null, xs) < 10) return null;
    var s = slope(pts);
    return s === null ? null : s * 7;
  }
  function trendVerdict(perWeek) {
    var loss = -perWeek;
    if (loss < 0.25) return { band: 'slow', text: 'Under 0.25 kg/week. The rule says cut about 100 kcal.' };
    if (loss > 0.5) return { band: 'fast', text: 'Over 0.5 kg/week. The rule says add about 100 kcal.' };
    return { band: 'ok', text: 'Inside the 0.25–0.5 kg/week range. Change nothing.' };
  }

  /* ---------- lift history ---------- */
  function history(sessions, key, excludeId) {
    var list = sortSessions(sessions).filter(function (s) { return s.id !== excludeId; }).reverse();
    var out = [];
    list.forEach(function (s) {
      var sets = (s.sets && s.sets[key] || []).filter(function (x) { return x && x.done; });
      if (sets.length) out.push({ d: s.d, sets: sets });
    });
    return out; /* newest first */
  }
  function topSet(entry) {
    var best = null;
    entry.sets.forEach(function (s) {
      if (s.kg === undefined || s.kg === null || s.kg === '') return;
      if (!best || s.kg > best.kg || (s.kg === best.kg && (s.reps || 0) > (best.reps || 0))) best = s;
    });
    return best;
  }
  function progressionHint(last, ex) {
    if (!last || ex.type !== 'load' || !ex.max) return null;
    var top = topSet(last);
    if (!top) return null;
    var allSets = last.sets.length >= ex.sets;
    var allTop = last.sets.every(function (s) { return (s.reps || 0) >= ex.max; });
    if (allSets && allTop) return { up: true, text: 'Top reps on every set last time. Go up one small step.' };
    return { up: false, text: 'Stay at ' + fmtKg(top.kg) + ' kg. Aim for ' + ex.max + ' reps on every set.' };
  }
  function fmtKg(n) { return (Math.round(n * 100) / 100).toString(); }

  /* ---------- calendar file ---------- */
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function fold(line) {
    var out = [], rest = line;
    while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
    out.push(rest);
    return out.join('\r\n');
  }
  function compact(date) { return date.replace(/-/g, ''); }
  function reminderRows() { return PLAN.routine.filter(function (r) { return r.ics; }); }
  /* options: { startDate, weeks, stampISO, ids } - times are floating (they fire at the wall-clock time). */
  function buildIcs(opts) {
    var start = opts.startDate, weeks = opts.weeks || 12;
    var ids = opts.ids || reminderRows().map(function (r) { return r.id; });
    var stamp = (opts.stampISO || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+/, '');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plan app//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Plan reminders'];
    reminderRows().forEach(function (r) {
      if (ids.indexOf(r.id) < 0) return;
      var weekdays = r.trainOnly ? 'MO,TU,WE,TH,FR' : 'MO,TU,WE,TH,FR,SA,SU';
      var count = (r.trainOnly ? 5 : 7) * weeks;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:plan-' + r.id + '@plan-app');
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART:' + compact(start) + 'T' + r.at.replace(':', '') + '00');
      lines.push('DURATION:PT15M');
      lines.push('RRULE:FREQ=WEEKLY;BYDAY=' + weekdays + ';COUNT=' + count);
      lines.push('SUMMARY:' + icsEscape(r.ics));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:PT0M');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + icsEscape(r.ics));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  /* ---------- backup nudge ---------- */
  function earliestDate(state) {
    var all = [];
    Object.keys(state.weights).forEach(function (d) { all.push(d); });
    Object.keys(state.days).forEach(function (d) { all.push(d); });
    state.sessions.forEach(function (s) { all.push(s.d); });
    all.sort();
    return all[0] || null;
  }
  function backupDue(state, today, nowMs) {
    var first = earliestDate(state);
    if (!first) return false;
    if (!state.lastBackup) return diffDays(first, today) >= 3;
    return nowMs - state.lastBackup > 7 * 86400000;
  }

  /* ---------- moving a day's times ---------- */
  /* A late start moves rows for that day only. Gym trips and whey follow the gym; everything else stays. */
  var GYM_CHAIN = ['travel-out', 'gym', 'whey-post', 'travel-home'];
  function toMin(hhmm) { return +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5); }
  function toHHMM(m) { m = Math.max(0, Math.min(1439, m)); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  /* Length in minutes of a plan range like "7:15–8:30 AM". 0 for a single time. */
  function spanMin(row) {
    var m = /[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/.exec(row.time || '');
    if (!m) return 0;
    var end = ((+m[1] % 12) + (m[3] === 'PM' ? 12 : 0)) * 60 + +m[2], d = end - toMin(row.at);
    return d > 0 && d <= 360 ? d : 0;
  }
  function clock12(min) { var h = Math.floor(min / 60) % 24; return { t: (h % 12 || 12) + ':' + pad(min % 60), ap: h < 12 ? 'AM' : 'PM' }; }
  function rangeText(startMin, span) {
    var a = clock12(startMin);
    if (!span) return a.t + ' ' + a.ap;
    var b = clock12(startMin + span);
    return a.ap === b.ap ? a.t + '–' + b.t + ' ' + b.ap : a.t + ' ' + a.ap + '–' + b.t + ' ' + b.ap;
  }
  /* The day's rows with its moved times applied, in time order. Ties keep the plan's order. */
  function withTimes(rows, times) {
    times = times || {};
    var out = rows.map(function (r, i) {
      var row = {}; for (var k in r) row[k] = r[k];
      row.planAt = r.at; row.order = i;
      if (times[r.id] && /^\d{2}:\d{2}$/.test(times[r.id])) {
        row.at = times[r.id]; row.time = rangeText(toMin(times[r.id]), spanMin(r)); row.moved = true;
      }
      return row;
    });
    out.sort(function (a, b) { return a.at < b.at ? -1 : (a.at > b.at ? 1 : a.order - b.order); });
    return out;
  }
  function cleanTimes(rows, times) {
    var out = {};
    rows.forEach(function (r) { if (times[r.id] && times[r.id] !== r.at) out[r.id] = times[r.id]; });
    return out;
  }
  /* Move the gym to newAt. The trips and the whey keep their gaps. */
  function moveGym(rows, times, newAt) {
    var cur = withTimes(rows, times), gym = cur.filter(function (r) { return r.id === 'gym'; })[0];
    if (!gym) return times;
    var delta = toMin(newAt) - toMin(gym.at), out = {}, k;
    for (k in times) out[k] = times[k];
    cur.forEach(function (r) { if (GYM_CHAIN.indexOf(r.id) >= 0) out[r.id] = toHHMM(toMin(r.at) + delta); });
    return cleanTimes(rows, out);
  }
  /* "I woke at": move the wake row, and the gym if a time is given. */
  function setWake(rows, times, wakeAt, gymAt) {
    var out = {}, k;
    for (k in times) out[k] = times[k];
    if (wakeAt) out.wake = wakeAt;
    out = cleanTimes(rows, out);
    return gymAt ? moveGym(rows, out, gymAt) : out;
  }

  /* ---------- missed days ---------- */
  /* Calendar plan: Mon to Fri = Day 1 to 5, Sat = bonus, Sun = off. 0 means off. */
  function planDayFor(date) {
    var wd = weekday(date);
    return wd === 0 ? 0 : (wd === 6 ? 'B' : wd);
  }
  function mondayOf(date) { return addDays(date, -((weekday(date) + 6) % 7)); }
  /* What happened on one date. A finished lift wins over a skip mark.
     Statuses: done, short (finished with fewer sets than planned), bonus, missed, rest, today, upcoming, before. */
  function dayStatus(sessions, skips, date, today, start) {
    var plan = planDayFor(date);
    var mine = sessions.filter(function (s) { return s.d === date && isComplete(s); });
    var lift = mine.filter(function (s) { return s.day !== 'B'; })[0];
    if (lift) {
      var def = dayDef(lift.day), total = def ? totalSets(def) : 0, n = doneSetCount(lift);
      return { status: n < total ? 'short' : 'done', plan: plan, lifted: lift.day, sets: n, total: total };
    }
    if (mine.length) return { status: 'bonus', plan: plan, lifted: 'B' };
    if (start && date < start) return { status: 'before', plan: plan };
    if (date > today) return { status: 'upcoming', plan: plan };
    var mark = skips && skips[date];
    if (mark) return { status: 'missed', plan: plan, skipped: true, why: mark.why || '' };
    if (date === today) return { status: 'today', plan: plan };
    if (typeof plan === 'number' && plan > 0) return { status: 'missed', plan: plan, skipped: false, why: '' };
    return { status: 'rest', plan: plan };
  }
  /* One Monday-to-Sunday week. Reachable: could 5 lifts still fit, counting every open day (a missed lift slides to the weekend). */
  function weekView(sessions, skips, weekStart, today, start) {
    var days = [], lifts = 0, missed = 0, open = 0;
    for (var i = 0; i < 7; i++) {
      var d = addDays(weekStart, i), st = dayStatus(sessions, skips, d, today, start);
      st.d = d; days.push(st);
      if (st.status === 'done' || st.status === 'short') lifts++;
      else if (st.status === 'missed') missed++;
      else if (st.status === 'today' || st.status === 'upcoming') open++;
    }
    return { start: weekStart, end: addDays(weekStart, 6), days: days, lifts: lifts, missed: missed, open: open,
      left: Math.max(0, 5 - lifts), reachable: lifts + open >= 5, over: weekStart <= today && addDays(weekStart, 6) < today };
  }

  return {
    planDayFor: planDayFor, mondayOf: mondayOf, dayStatus: dayStatus, weekView: weekView,
    GYM_CHAIN: GYM_CHAIN, toMin: toMin, toHHMM: toHHMM, spanMin: spanMin, rangeText: rangeText, withTimes: withTimes, cleanTimes: cleanTimes, moveGym: moveGym, setWake: setWake,
    fmt: fmt, parse: parse, addDays: addDays, diffDays: diffDays, weekday: weekday, trainingWeek: trainingWeek,
    dayDef: dayDef, totalSets: totalSets, doneSetCount: doneSetCount, isComplete: isComplete, sortSessions: sortSessions,
    nextInOrder: nextInOrder, todayWorkout: todayWorkout, dayType: dayType,
    routineFor: routineFor, currentRowId: currentRowId,
    SLOTS: SLOTS, mealValue: mealValue, dayTotals: dayTotals, rowDone: rowDone,
    weightList: weightList, avgWindow: avgWindow, slope: slope, weeklyTrend: weeklyTrend, trendVerdict: trendVerdict,
    history: history, topSet: topSet, progressionHint: progressionHint, fmtKg: fmtKg,
    buildIcs: buildIcs, reminderRows: reminderRows, backupDue: backupDue, earliestDate: earliestDate
  };
});

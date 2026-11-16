/* Plan app: Today, Lift, Progress, More. Everything is stored on this phone. */
(function () {
  'use strict';
  const PLAN = window.PLAN, L = window.Lib, Charts = window.Charts;
  const KEY = 'plan-app:v1';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const TICK = '<i><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg></i>';

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : null; };
  const nowStr = () => L.fmt(new Date());
  const sd = () => state.startDate || PLAN.startDate;
  const hasPlan = () => !PLAN.empty && PLAN.days.length === 5;
  const fmtShort = d => { const p = L.parse(d); return p.getDate() + ' ' + MON[p.getMonth()]; };
  const fmtLong = d => DOW[L.weekday(d)] + ' ' + fmtShort(d);
  const thousands = n => Math.round(n).toLocaleString('en-IN');
  const kgText = n => (Math.round(n * 10) / 10).toFixed(1);
  const to12 = at => { const h = +at.slice(0, 2), m = at.slice(3); return (h % 12 || 12) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const dayLabel = x => fmtShort(L.fmt(new Date(x * 86400000)));

  /* ---------- state + storage ---------- */
  const blank = () => ({ v: 1, startDate: '', days: {}, weights: {}, skips: {}, measures: [], sessions: [], lastBackup: 0, reminderIds: null });
  function normalize(o) {
    const b = blank();
    if (!o || typeof o !== 'object') return b;
    ['days', 'weights'].forEach(k => { if (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])) b[k] = o[k]; });
    if (o.skips && typeof o.skips === 'object' && !Array.isArray(o.skips)) {
      Object.keys(o.skips).forEach(d => { if (/^\d{4}-\d{2}-\d{2}$/.test(d) && o.skips[d] && typeof o.skips[d] === 'object') b.skips[d] = { why: String(o.skips[d].why || '').slice(0, 40) }; });
    }
    if (Array.isArray(o.measures)) b.measures = o.measures.filter(m => m && typeof m.d === 'string');
    if (Array.isArray(o.sessions)) {
      b.sessions = o.sessions.filter(s => s && typeof s.d === 'string' && (s.day === 'B' || (s.day >= 1 && s.day <= 5))).map(s => { s.sets = s.sets && typeof s.sets === 'object' ? s.sets : {}; s.id = s.id || s.d + '-' + s.day; return s; });
    }
    if (typeof o.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.startDate)) b.startDate = o.startDate;
    b.lastBackup = +o.lastBackup || 0;
    if (Array.isArray(o.reminderIds)) b.reminderIds = o.reminderIds;
    return b;
  }
  let state, saveFailed = false, loadNote = '';
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? normalize(JSON.parse(raw)) : blank();
  } catch (e) {
    loadNote = 'The saved data could not be read, so the app started empty. The old data is kept under a backup key on this phone.';
    try { localStorage.setItem(KEY + ':unreadable:' + Date.now(), localStorage.getItem(KEY) || ''); } catch (_) { /* nothing more to do */ }
    state = blank();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); saveFailed = false; }
    catch (e) { saveFailed = true; }
  }
  const peek = d => state.days[d] || {};
  const rec = d => state.days[d] || (state.days[d] = {});
  const findSession = (d, day) => state.sessions.filter(s => s.d === d && s.day === day)[0];
  function session(d, day) {
    let s = findSession(d, day);
    if (!s) { s = { id: d + '-' + day, d, day, start: Date.now(), sets: {} }; state.sessions.push(s); }
    return s;
  }

  const ui = { tab: 'today', date: nowStr(), missWeek: 0, liftDay: null, openMeal: null, timer: null, weightTable: false, liftKey: null, sheet: null };

  /* ---------- small helpers ---------- */
  const plate = (color, text, size) => '<span class="plate" data-c="' + color + '"' + (size ? ' style="--s:' + size + 'px"' : '') + ' aria-hidden="true">' + text + '</span>';
  const tick = (act, attrs, pressed, label) => '<button class="tick" data-act="' + act + '" ' + (attrs || '') + ' aria-pressed="' + !!pressed + '" aria-label="' + esc(label) + '">' + TICK + '</button>';
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.innerHTML = ''; }, 2400);
  }
  const restText = s => (s >= 120 && s % 60 === 0 ? s / 60 + ' min' : s + ' sec');

  /* ---------- rest timer ---------- */
  let timerId = null, audio = null;
  function ensureAudio() {
    try {
      if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); }
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) { /* sound is optional */ }
  }
  function beep() {
    try {
      if (!audio) return;
      [0, 0.28].forEach(off => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        const t = audio.currentTime + off;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t); o.stop(t + 0.25);
      });
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } catch (e) { /* ignore */ }
  }
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  function drawTimer(full) {
    const box = $('#timer');
    if (!ui.timer) { box.hidden = true; box.innerHTML = ''; document.body.classList.remove('has-timer'); return; }
    box.hidden = false; document.body.classList.add('has-timer');
    if (full || !box.firstChild) {
      box.className = '';
      box.innerHTML = '<div class="box"><div class="t" id="tmr-t"></div><div class="lbl" id="tmr-l"></div><button data-act="timer-add">+15 s</button><button data-act="timer-skip">Skip</button></div>';
    }
    $('#tmr-l').textContent = ui.timer.label;
    $('#tmr-t').textContent = mmss(Math.max(0, Math.ceil((ui.timer.end - Date.now()) / 1000)));
  }
  function tickTimer() {
    const t = ui.timer;
    if (!t) { clearInterval(timerId); timerId = null; return; }
    const left = Math.ceil((t.end - Date.now()) / 1000);
    if (left > 0) { $('#tmr-t').textContent = mmss(left); return; }
    if (!t.fired) {
      t.fired = true; t.dismissAt = Date.now() + 8000; beep();
      $('#timer').className = 'go'; $('#tmr-t').textContent = 'Go'; $('#tmr-l').textContent = 'Next set';
    } else if (Date.now() > t.dismissAt) stopTimer();
  }
  function startTimer(sec, label) {
    ensureAudio();
    ui.timer = { end: Date.now() + sec * 1000, label, fired: false };
    drawTimer(true);
    if (!timerId) timerId = setInterval(tickTimer, 250);
  }
  function stopTimer() { ui.timer = null; drawTimer(); clearInterval(timerId); timerId = null; }

  /* ---------- keep the screen on while lifting ---------- */
  let wake = null;
  async function holdScreen(on) {
    try {
      if (on && !wake && navigator.wakeLock) {
        wake = await navigator.wakeLock.request('screen');
        wake.addEventListener('release', () => { wake = null; });
      } else if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { wake = null; }
  }

  /* ---------- sheets ---------- */
  let sheetCb = null;
  function openSheet(html) {
    $('#sheet-root').innerHTML = '<div class="scrim" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    const first = $('#sheet-root input');
    if (first) { first.focus(); if (first.select) first.select(); }
  }
  function closeSheet() { $('#sheet-root').innerHTML = ''; sheetCb = null; }
  /* fields: [{id,label,value,mode:'decimal'|'numeric',suffix}] */
  function fieldsSheet(o) {
    sheetCb = o.onSave;
    const f = o.fields.map((x, i) => '<div class="field"><label for="sf' + i + '">' + esc(x.label) + '</label><input type="text" id="sf' + i + '" inputmode="' + (x.mode || 'decimal') + '" autocomplete="off" value="' + (x.value == null ? '' : esc(x.value)) + '"' + (x.placeholder ? ' placeholder="' + esc(x.placeholder) + '"' : '') + '></div>').join('');
    const cols = o.fields.length > 1 ? '<div class="row2">' + f + '</div>' : f;
    openSheet('<h3>' + esc(o.title) + '</h3>' + (o.note ? '<p class="small muted" style="margin-top:6px">' + esc(o.note) + '</p>' : '') + cols +
      '<div class="actions"><button class="btn quiet" data-act="sheet-close">Cancel</button><button class="btn" data-act="sheet-save">' + esc(o.saveLabel || 'Save') + '</button></div>');
  }
  function confirmSheet(o) {
    sheetCb = o.onConfirm;
    openSheet('<h3>' + esc(o.title) + '</h3><p style="margin-top:8px">' + esc(o.text) + '</p><div class="actions"><button class="btn quiet" data-act="sheet-close">Cancel</button><button class="btn" data-act="sheet-confirm">' + esc(o.confirmLabel) + '</button></div>');
  }
  function waterSheet() {
    const ml = peek(ui.date).water || 0;
    openSheet('<h3>Water</h3><p class="bignum" style="margin-top:10px" id="wtot">' + (ml / 1000).toFixed(2).replace(/0$/, '') + '<small>L of 2.5–3 L</small></p>' +
      '<div class="quick"><button class="pill" data-act="water" data-ml="250">+250 mL</button><button class="pill" data-act="water" data-ml="500">+500 mL</button><button class="pill" data-act="water" data-ml="750">+750 mL</button><button class="pill" data-act="water" data-ml="-250">−250 mL</button></div>' +
      '<div class="actions" style="grid-template-columns:1fr"><button class="btn" data-act="sheet-close">Done</button></div>');
  }

  /* ---------- moving times ---------- */
  const planRowsFor = date => L.routineFor(L.dayType(state, date), L.weekday(date));
  const clockNow = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  function timeSheet(rowId) {
    const rows = L.withTimes(planRowsFor(ui.date), peek(ui.date).times), row = rows.filter(x => x.id === rowId)[0];
    if (!row) return;
    const chain = L.GYM_CHAIN.indexOf(rowId) >= 0 && rowId === 'gym';
    openSheet('<h3>' + esc(row.text.replace(' (1 option)', '')) + '</h3>' +
      '<p class="small muted" style="margin-top:6px">This day only. ' + (chain ? 'The trips and the whey move with the gym. Breakfast and shower stay.' : 'Nothing else moves.') + '</p>' +
      '<div class="field"><label for="tm">Starts at</label><input type="time" id="tm" value="' + row.at + '"></div>' +
      '<div class="actions"><button class="btn quiet" data-act="sheet-close">Cancel</button><button class="btn" data-act="time-save" data-row="' + rowId + '">Save</button></div>' +
      (row.moved ? '<button class="btn quiet block" style="margin-top:10px" data-act="time-reset" data-row="' + rowId + '">Back to the plan time (' + esc(L.rangeText(L.toMin(row.planAt), L.spanMin({ at: row.planAt, time: planRowsFor(ui.date).filter(x => x.id === rowId)[0].time }))) + ')</button>' : ''));
  }
  function wakeSheet() {
    const plan = planRowsFor(ui.date), eff = L.withTimes(plan, peek(ui.date).times);
    const w = eff.filter(x => x.id === 'wake')[0], g = eff.filter(x => x.id === 'gym')[0];
    if (!w) return;
    const gap = g ? L.toMin(g.planAt) - L.toMin(w.planAt) : 45;
    const startW = ui.date === nowStr() && clockNow() > w.at ? clockNow().slice(0, 4) + '0' : w.at;
    const startG = g ? L.toHHMM(L.toMin(startW) + gap) : '';
    openSheet('<h3>Woke later?</h3><p class="small muted" style="margin-top:6px">This day only. The gym keeps the gap your plan has after waking. Change it, or clear it to leave the gym alone. Trips and whey follow the gym. Breakfast and shower stay.</p>' +
      '<div class="field"><label for="wk">I woke at</label><input type="time" id="wk" value="' + startW + '"></div>' +
      (g ? '<div class="field"><label for="gy">Gym at</label><input type="time" id="gy" value="' + startG + '"></div>' : '') +
      '<div class="actions"><button class="btn quiet" data-act="sheet-close">Cancel</button><button class="btn" data-act="wake-save">Move</button></div>');
  }

  /* ---------- missed day ---------- */
  const WHY = ['Woke late', 'Work', 'Tired', 'Shoulder sore', 'Sick or away', 'Other'];
  function skipSheet() {
    const cur = (state.skips[ui.date] || {}).why;
    openSheet('<h3>' + (ui.date === nowStr() ? 'Skip today?' : 'Missed ' + fmtLong(ui.date)) + '</h3>' +
      '<p class="small muted" style="margin-top:6px">Pick a reason. The next lift stays the next day in order. Never double up.</p>' +
      '<div class="quick">' + WHY.map(w => '<button class="pill" data-act="skip-why" data-why="' + esc(w) + '" aria-pressed="' + (w === cur) + '">' + esc(w) + '</button>').join('') + '</div>' +
      '<div class="actions" style="grid-template-columns:1fr"><button class="btn quiet" data-act="sheet-close">Cancel</button></div>');
  }

  /* ---------- weight, steps, sleep ---------- */
  function weightSheet() {
    const cur = state.weights[ui.date];
    fieldsSheet({
      title: 'Weigh-in, ' + fmtLong(ui.date), note: 'Morning, after the toilet, before food. Leave empty and save to remove this day\'s entry.',
      fields: [{ id: 'kg', label: 'Weight (kg)', value: cur != null ? cur : '' }],
      onSave: v => {
        const n = num(v[0]);
        if (v[0].trim() === '') { delete state.weights[ui.date]; }
        else if (n === null || n < 25 || n > 250) { toast('Enter a weight in kg, like 62.8'); return false; }
        else state.weights[ui.date] = Math.round(n * 10) / 10;
        save(); render(); toast(v[0].trim() === '' ? 'Weigh-in removed' : 'Weigh-in saved');
      }
    });
  }
  function stepsSheet() {
    fieldsSheet({
      title: 'Steps, ' + fmtLong(ui.date), note: 'Target 8,000–10,000. Read it off your phone\'s Health or Fitness app.',
      fields: [{ id: 's', label: 'Steps', mode: 'numeric', value: peek(ui.date).steps || '' }],
      onSave: v => {
        const n = num(v[0]);
        if (v[0].trim() !== '' && (n === null || n < 0 || n > 100000)) { toast('Enter the step count as a number'); return false; }
        if (v[0].trim() === '') delete rec(ui.date).steps; else rec(ui.date).steps = Math.round(n);
        save(); render();
      }
    });
  }
  function sleepSheet() {
    fieldsSheet({
      title: 'Sleep, night before ' + fmtLong(ui.date), note: 'Hours asleep, like 6.5. Target 7–8 at steady times.',
      fields: [{ id: 'h', label: 'Hours', value: peek(ui.date).sleep != null ? peek(ui.date).sleep : '' }],
      onSave: v => {
        const n = num(v[0]);
        if (v[0].trim() !== '' && (n === null || n < 0 || n > 16)) { toast('Enter hours, like 6.5'); return false; }
        if (v[0].trim() === '') delete rec(ui.date).sleep; else rec(ui.date).sleep = Math.round(n * 10) / 10;
        save(); render();
      }
    });
  }
  function otherMealSheet(slot) {
    const cur = peek(ui.date).meals && peek(ui.date).meals[slot];
    const o = cur && typeof cur === 'object' ? cur : {};
    fieldsSheet({
      title: PLAN.mealNames[slot] + ': something else', note: 'A rough guess is fine. Figures are about ±15% anyway.',
      fields: [{ id: 'k', label: 'Calories (kcal)', mode: 'numeric', value: o.kcal || '' }, { id: 'p', label: 'Protein (g)', mode: 'numeric', value: o.protein || '' }],
      onSave: v => {
        const k = num(v[0]), p = num(v[1]);
        if (k === null || k < 0 || k > 3000) { toast('Enter the calories as a number'); return false; }
        const r = rec(ui.date); r.meals = r.meals || {};
        r.meals[slot] = { other: true, kcal: Math.round(k), protein: Math.round(p || 0) };
        ui.openMeal = null; save(); render();
      }
    });
  }
  function measureSheet() {
    fieldsSheet({
      title: 'Measurements', note: 'Same spot each time. Fill what you measured, in cm.',
      fields: [{ id: 'w', label: 'Waist (cm)', value: '' }, { id: 'h', label: 'Hips (cm)', value: '' }, { id: 't', label: 'Thigh (cm)', value: '' }],
      onSave: v => {
        const vals = v.map(x => num(x));
        if (vals.every(x => x === null)) { toast('Enter at least one measurement'); return false; }
        if (vals.some((x, i) => v[i].trim() !== '' && (x === null || x < 10 || x > 250))) { toast('Check the numbers: they are in cm'); return false; }
        state.measures = state.measures.filter(m => m.d !== ui.date);
        state.measures.push({ d: ui.date, waist: vals[0], hips: vals[1], thigh: vals[2] });
        state.measures.sort((a, b) => a.d < b.d ? -1 : 1);
        save(); render(); toast('Measurements saved');
      }
    });
  }

  /* ---------- TODAY ---------- */
  function renderToday() {
    const date = ui.date, isToday = date === nowStr();
    const type = L.dayType(state, date), r = peek(date), wd = L.weekday(date);
    const tw = L.todayWorkout(state.sessions, date);
    const week = L.trainingWeek(sd(), date);
    let h = '';

    if (loadNote) h += '<div class="banner warn">' + esc(loadNote) + '</div>';
    if (saveFailed) h += '<div class="banner warn">This phone is not letting the app save. Export a backup from More before closing the app.</div>';

    h += '<div class="top"><div><h1>' + (isToday ? 'Today' : DOW_LONG[wd]) + '</h1><div class="date">' + fmtLong(date) + (week > 0 ? ' · Week ' + week : ' · Starts ' + fmtLong(sd())) + '</div></div>' +
      '<div class="inline-actions" style="margin:0"><button class="pill" data-act="date-prev" aria-label="Previous day">‹</button>' +
      (isToday ? '' : '<button class="pill" data-act="date-today">Today</button>') +
      '<button class="pill" data-act="date-next" aria-label="Next day"' + (isToday ? ' disabled style="opacity:.35"' : '') + '>›</button></div></div>';

    if (L.backupDue(state, nowStr(), Date.now())) {
      h += '<div class="banner"><span>Your data lives only on this phone. Time for a backup.</span><button class="btn small" data-act="export">Back up</button></div>';
    }

    /* hero */
    let hero, openDay = null, openLabel = '', alt = '';
    if (tw.kind === 'train') {
      const def = L.dayDef(tw.day), s = findSession(date, tw.day), dn = s ? L.doneSetCount(s) : 0;
      hero = { plate: plate(def.plate, tw.day), title: def.name, sub: 'Day ' + tw.day + ' of 5' + (def.sub ? ' · ' + def.sub : '') };
      openDay = tw.day;
      openLabel = tw.done ? 'Finished · ' + dn + ' sets. View' : dn ? 'Continue · ' + dn + ' of ' + L.totalSets(def) + ' sets' : 'Open workout';
    } else if (tw.kind === 'bonus') {
      hero = { plate: plate('chrome', 'B'), title: 'Bonus day', sub: 'Optional. Easy walk, mobility, core.' };
      openDay = 'B'; openLabel = 'Open bonus';
      alt = '<button class="btn quiet block" style="margin-top:8px" data-act="open-lift" data-day="' + tw.next + '">Train Day ' + tw.next + ' instead</button>';
    } else {
      hero = { plate: plate('off', '·'), title: 'Rest day', sub: 'Off. A walk is plenty.' };
      alt = '<button class="btn quiet block" style="margin-top:8px" data-act="open-lift" data-day="' + L.nextInOrder(state.sessions) + '">Train Day ' + L.nextInOrder(state.sessions) + ' anyway</button>';
    }
    h += '<div class="hero">' + hero.plate + '<div><h2>' + esc(hero.title) + '</h2><p>' + esc(hero.sub) + '</p></div></div>';
    if (openDay !== null) h += '<button class="btn block" style="margin-top:10px" data-act="open-lift" data-day="' + openDay + '">' + esc(openLabel) + '</button>';
    h += alt;
    if (hasPlan() && wd >= 1 && wd <= 5 && tw.kind === 'train' && !tw.done && !tw.started) {
      const ds = L.dayStatus(state.sessions, state.skips, date, nowStr(), sd());
      if (ds.status === 'missed') {
        h += '<div class="banner"><span><b>Missed</b>' + (ds.why ? ': ' + esc(ds.why) : ' · no reason logged') + '. Day ' + tw.day + ' stays next in order.</span>' +
          '<span class="inline-actions" style="margin:0;flex-wrap:nowrap"><button class="btn small quiet" data-act="skip-sheet">' + (ds.why ? 'Change' : 'Add reason') + '</button>' +
          (ds.skipped ? '<button class="btn small quiet" data-act="skip-undo">Undo</button>' : '') + '</span></div>';
      } else if (ds.status === 'today') {
        h += '<button class="btn quiet block" style="margin-top:8px" data-act="skip-sheet">Skip today</button>';
      }
    }

    h += '<div class="inline-actions" style="margin-top:14px"><span class="small muted">Food and routine for</span><span class="seg" role="group" aria-label="Day type">' +
      '<button data-act="daytype" data-type="train" aria-pressed="' + (type === 'train') + '">Training day</button>' +
      '<button data-act="daytype" data-type="rest" aria-pressed="' + (type === 'rest') + '">Rest day</button></span></div>';

    /* habit tiles */
    const ml = r.water || 0, st = r.steps, sl = r.sleep, wt = state.weights[date];
    h += '<div class="panel"><div class="tiles">' +
      '<button class="tile' + (ml >= PLAN.targets.waterLowMl ? ' ok' : '') + '" data-act="water-sheet"><div class="v">' + (ml / 1000).toFixed(1) + '</div><div class="l">Water, L</div><div class="t">of 2.5–3</div></button>' +
      '<button class="tile' + (st >= PLAN.targets.stepsLow ? ' ok' : '') + '" data-act="steps-sheet"><div class="v">' + (st ? thousands(st) : '—') + '</div><div class="l">Steps</div><div class="t">8–10k</div></button>' +
      '<button class="tile' + (sl >= PLAN.targets.sleepLow ? ' ok' : '') + '" data-act="sleep-sheet"><div class="v">' + (sl != null ? sl : '—') + '</div><div class="l">Sleep, h</div><div class="t">7–8</div></button>' +
      '<button class="tile" data-act="weight-sheet"><div class="v">' + (wt != null ? kgText(wt) : '—') + '</div><div class="l">Weight, kg</div><div class="t">mornings</div></button>' +
      '</div></div>';

    /* food */
    const tot = L.dayTotals(r, type), kp = Math.min(100, tot.kcal / tot.target.kcal * 100), pp = Math.min(100, tot.protein / tot.target.protein * 100);
    h += '<div class="panel"><div class="head"><h3>Food</h3><span class="small muted">' + (type === 'train' ? 'Training day' : 'Rest day') + ' target</span></div><div class="pad">' +
      '<div class="bar"><div class="row"><span>Calories</span><span><b>' + thousands(tot.kcal) + '</b> of ' + thousands(tot.target.kcal) + '</span></div><div class="track"><div class="fill" style="width:' + kp.toFixed(1) + '%"></div></div></div>' +
      '<div class="bar"><div class="row"><span>Protein</span><span><b>' + Math.round(tot.protein) + '</b> of ' + tot.target.protein + ' g</span></div><div class="track"><div class="fill" style="width:' + pp.toFixed(1) + '%"></div></div></div>' +
      '<p class="small muted" style="margin-top:10px">Figures are about ±15%. Skipped a meal? Make up the protein, not the calories.</p></div></div>';

    /* schedule */
    const planRows = L.routineFor(type, wd), rows = L.withTimes(planRows, r.times);
    const moved = Object.keys(r.times || {}).length > 0;
    const d2 = new Date(), hhmm = String(d2.getHours()).padStart(2, '0') + ':' + String(d2.getMinutes()).padStart(2, '0');
    const nowId = isToday ? L.currentRowId(rows, hhmm) : null;
    h += '<div class="panel"><div class="head"><h3>Schedule</h3><span class="small muted">' + (moved ? '<button class="link" data-act="times-reset">Reset times</button> · ' : '') + (type === 'train' ? 'Training day' : 'Rest day') + '</span></div><ul class="tl">';
    rows.forEach(row => {
      const done = L.rowDone(row, r, type, tw.done);
      let extra = '', optsHtml = '', act = row.kind === 'gym' ? 'gym-tick' : 'row-done', label = row.text;
      if (row.kind === 'wake') {
        extra = '<div class="inline-actions"><button class="pill" data-act="weight-sheet">' + (wt != null ? 'Weight ' + kgText(wt) + ' kg' : 'Log weight') + '</button><button class="pill" data-act="wake-sheet">Woke later?</button></div>';
      } else if (row.kind === 'gym' && !(type === 'rest' && wd === 0)) {
        const target = tw.kind === 'train' ? tw.day : tw.kind === 'bonus' ? 'B' : null;
        if (target !== null) extra = '<div class="inline-actions"><button class="pill" data-act="open-lift" data-day="' + target + '">' + (tw.kind === 'bonus' ? 'Open bonus' : 'Open workout') + '</button></div>';
      } else if (row.kind === 'meal' || (row.kind === 'extra' && type === 'rest')) {
        const slot = row.meal, pick = r.meals && r.meals[slot];
        act = 'meal-tick';
        if (pick === undefined) extra = '<div class="inline-actions"><button class="pill" data-act="meal-open" data-row="' + row.id + '">Choose 1 of 3</button></div>';
        else {
          let sum;
          if (pick === 'skip') sum = 'Skipped';
          else if (typeof pick === 'object') sum = 'Something else: ' + pick.kcal + ' kcal, ' + pick.protein + ' g protein';
          else { const o = PLAN.meals[slot].filter(m => m.id === pick)[0]; sum = o.id + '. ' + o.text + ' (' + o.kcal + ' kcal, ' + o.protein + ' g)'; }
          extra = '<div class="picked">' + esc(sum) + '</div>';
        }
        if (row.supplement) extra += '<div class="inline-actions"><button class="pill" data-act="supplement" aria-pressed="' + !!r.supplement + '">' + esc(PLAN.supplement.label) + (r.supplement ? ' taken' : '') + '</button></div>';
        if (pick !== undefined) extra += '<div class="inline-actions"><button class="pill" data-act="meal-open" data-row="' + row.id + '">Change</button></div>';
        if (ui.openMeal === row.id) optsHtml = mealOptions(slot, pick);
      } else if (row.kind === 'extra') act = 'extra-tick';
      else if (row.kind === 'whey-post') act = 'whey-tick';
      const text = row.kind === 'meal' || row.kind === 'extra' ? row.text.replace(' (1 option)', '') : row.text;
      h += '<li data-row="' + row.id + '" class="' + (row.id === nowId ? 'now ' : '') + (done ? 'done' : '') + '"><div class="time"><button class="tbtn' + (row.moved ? ' moved' : '') + '" data-act="time-sheet" data-row="' + row.id + '" aria-label="Change the time of ' + esc(text) + '">' + esc(row.time) + '</button>' + (row.moved ? '<small class="mv">moved</small>' : '') + '</div><div><div class="what">' + esc(text) + (row.id === nowId ? '<span class="nowtag">Now</span>' : '') + '</div>' +
        (row.note ? '<div class="note">' + esc(row.note) + '</div>' : '') + extra + '</div>' +
        tick(act, 'data-row="' + row.id + '"', done, label) + (optsHtml ? '<div class="optwrap">' + optsHtml + '</div>' : '') + '</li>';
    });
    h += '</ul></div>';
    return h;
  }
  function mealOptions(slot, pick) {
    let h = '<div class="opts" role="group" aria-label="' + PLAN.mealNames[slot] + ' options">';
    PLAN.meals[slot].forEach(o => {
      h += '<button class="opt" data-act="meal-pick" data-slot="' + slot + '" data-id="' + o.id + '" aria-pressed="' + (pick === o.id) + '"><span class="id">' + o.id + '</span><span>' + esc(o.text) + '<div class="m">' + o.kcal + ' kcal · ' + o.protein + ' g protein' + (o.note ? ' · ' + esc(o.note) : '') + '</div></span></button>';
    });
    h += '<button class="opt" data-act="meal-pick" data-slot="' + slot + '" data-id="skip" aria-pressed="' + (pick === 'skip') + '"><span class="id">–</span><span>Skipped it</span></button>';
    h += '<button class="opt" data-act="meal-other" data-slot="' + slot + '" aria-pressed="' + (!!pick && typeof pick === 'object') + '"><span class="id">+</span><span>Something else<div class="m">Enter calories and protein</div></span></button></div>';
    return h;
  }

  /* ---------- LIFT ---------- */
  function lastText(entry) {
    const kgs = entry.sets.map(s => s.kg);
    const same = kgs.every(k => k === kgs[0] && k != null);
    const reps = entry.sets.map(s => s.reps != null ? s.reps : '?');
    const body = same ? L.fmtKg(kgs[0]) + ' kg × ' + reps.join(', ') : entry.sets.map(s => (s.kg != null ? L.fmtKg(s.kg) + ' kg' : 'bodyweight') + ' × ' + (s.reps != null ? s.reps : '?')).join(' · ');
    return 'Last: ' + body + ' · ' + fmtShort(entry.d);
  }
  function renderLift() {
    const date = ui.date, tw = L.todayWorkout(state.sessions, date);
    const planned = tw.kind === 'train' ? tw.day : tw.kind === 'bonus' ? 'B' : L.nextInOrder(state.sessions);
    const sel = ui.liftDay || planned;
    const def = L.dayDef(sel), s = findSession(date, sel);
    const week = Math.max(1, L.trainingWeek(sd(), date));
    let h = '<div class="top"><div><h1>Lift</h1><div class="date">' + fmtLong(date) + '</div></div></div>';

    h += '<div class="chips" role="group" aria-label="Pick a day">';
    PLAN.days.concat([PLAN.bonus]).forEach(d => {
      h += '<button class="chip" data-act="lift-day" data-day="' + d.id + '" aria-pressed="' + (d.id === sel) + '">' + plate(d.plate, d.id) + '<span>' + d.name + (d.id === planned ? '<br><span class="muted" style="font-weight:400">up next</span>' : '') + '</span></button>';
    });
    h += '</div>';

    const cue = week <= 2 ? 'Weeks 1–2: stop each set 3–4 reps short of failure.' : 'Week 3 on: stop each set 1–2 reps short of failure.';
    h += '<div class="cue">' + cue + ' Tempo: 3 sec down, 1 sec up.</div>';
    const dn = s ? L.doneSetCount(s) : 0, tot = L.totalSets(def);
    h += '<div class="progressline" id="progressline">' + dn + ' of ' + tot + ' sets done' + (s && s.end ? ' · finished' : '') + '</div>';

    h += '<div class="sheetlog">';
    def.exercises.forEach((ex, idx) => {
      const hist = L.history(state.sessions, ex.key, s && s.id);
      const last = hist[0];
      const cls = 'ex' + (ex.group === 'ss' && idx > 0 && def.exercises[idx - 1].group === 'ss' ? ' group' : '');
      let meta = ex.sets + ' × ' + ex.reps + (ex.rest ? ' · rest ' + restText(ex.rest) : '');
      if (ex.group === 'ss' && ex.rest === 0) meta = ex.sets + ' × ' + ex.reps + ' · then straight to B';
      h += '<section class="' + cls + '"><h3>' + esc(ex.name) + '</h3><div class="meta">' + esc(meta) + '</div>';
      if (ex.type === 'load' && last) {
        h += '<div class="last">' + esc(lastText(last)) + '</div>';
        const hint = L.progressionHint(last, ex);
        if (hint) h += '<div class="hint' + (hint.up ? ' up' : '') + '">' + esc(hint.text) + '</div>';
      }
      if (ex.note) h += '<div class="exnote">' + esc(ex.note) + '</div>';
      h += '<div class="sets">';
      const mine = (s && s.sets[ex.key]) || [];
      for (let i = 0; i < ex.sets; i++) {
        const cur = mine[i] || {};
        if (ex.type === 'check') {
          h += '<div class="set chk" data-ex="' + ex.key + '" data-i="' + i + '"><span class="n">Set ' + (i + 1) + '</span>' + tick('set-done', '', cur.done, ex.name + ' set ' + (i + 1) + ' done') + '</div>';
        } else {
          const ref = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : (mine[i - 1] || null);
          const pk = ref && ref.kg != null ? ref.kg : '', pr = ref && ref.reps != null ? ref.reps : '';
          h += '<div class="set' + (cur.done ? ' done' : '') + '" data-ex="' + ex.key + '" data-i="' + i + '"><span class="n">Set ' + (i + 1) + '</span>' +
            '<label class="f kg"><span class="sr">Set ' + (i + 1) + ' weight in kg</span><input data-f="kg" inputmode="decimal" autocomplete="off" value="' + (cur.kg != null ? cur.kg : '') + '" placeholder="' + pk + '"></label><span class="x">×</span>' +
            '<label class="f rp"><span class="sr">Set ' + (i + 1) + ' reps</span><input data-f="reps" inputmode="numeric" autocomplete="off" value="' + (cur.reps != null ? cur.reps : '') + '" placeholder="' + pr + '"></label>' +
            tick('set-done', '', cur.done, ex.name + ' set ' + (i + 1) + ' done') + '</div>';
        }
      }
      h += '</div></section>';
    });
    h += '<div class="finish">' + (s && s.end ? '<button class="btn quiet block" data-act="lift-reopen">Reopen workout</button>' : '<button class="btn block" data-act="lift-finish"' + (dn ? '' : ' disabled') + '>Finish workout</button>') + '</div></div>';
    h += '<p class="small muted" style="margin:10px 4px 0">Tap the circle to log a set. Empty boxes use last time\'s numbers (grey). The rest timer starts by itself.</p>';
    return h;
  }
  function onSetInput(e) {
    const row = e.target.closest('.set'); if (!row || !e.target.dataset.f) return;
    const ex = findEx(row.dataset.ex); if (!ex) return;
    const s = session(ui.date, currentLiftDay());
    const arr = s.sets[ex.key] = s.sets[ex.key] || [];
    const cur = arr[+row.dataset.i] = arr[+row.dataset.i] || {};
    const v = num(e.target.value);
    if (e.target.dataset.f === 'kg') cur.kg = v === null ? undefined : v;
    else cur.reps = v === null ? undefined : Math.round(v);
    save();
  }
  function currentLiftDay() {
    const tw = L.todayWorkout(state.sessions, ui.date);
    const planned = tw.kind === 'train' ? tw.day : tw.kind === 'bonus' ? 'B' : L.nextInOrder(state.sessions);
    return ui.liftDay || planned;
  }
  function findEx(key) {
    const def = L.dayDef(currentLiftDay());
    return def.exercises.filter(e => e.key === key)[0];
  }
  function setDone(row) {
    const ex = findEx(row.dataset.ex), i = +row.dataset.i; if (!ex) return;
    const s = session(ui.date, currentLiftDay());
    const arr = s.sets[ex.key] = s.sets[ex.key] || [];
    const cur = arr[i] = arr[i] || {};
    if (cur.done) { cur.done = false; save(); render(); return; }
    if (ex.type === 'load') {
      const kgIn = $('input[data-f="kg"]', row), rIn = $('input[data-f="reps"]', row);
      const kg = num(kgIn.value !== '' ? kgIn.value : kgIn.placeholder), reps = num(rIn.value !== '' ? rIn.value : rIn.placeholder);
      if (kg !== null) cur.kg = kg;
      if (reps !== null) cur.reps = Math.round(reps);
    }
    cur.done = true; save();
    if (ex.rest > 0) startTimer(ex.rest, ex.name.replace(/^Superset [AB]: /, '') + ' · set ' + (i + 1) + ' done');
    render();
  }

  /* ---------- PROGRESS ---------- */
  const dayNum = d => L.parse(d).getTime() / 86400000;
  function renderProgress() {
    let h = '<div class="top"><div><h1>Progress</h1><div class="date">Judge by the 2-week trend, never one day</div></div></div>';
    const list = L.weightList(state.weights), today = nowStr();

    /* weight */
    h += '<div class="panel"><div class="head"><h3>Weight</h3><button class="btn small" data-act="weight-sheet">Log weigh-in</button></div>';
    if (!list.length) {
      h += '<div class="pad"><p>No weigh-ins yet.</p><p class="small muted" style="margin-top:4px">Weigh 3–4 mornings a week, after the toilet and before food. The first one sets your starting point.</p></div>';
    } else {
      const lastD = list[list.length - 1].d, a = L.avgWindow(state.weights, lastD, 7);
      const first = list[0].kg, togo = a.avg - PLAN.targets.goalKg;
      h += '<div class="pad"><div class="bignum">' + kgText(a.avg) + '<small>kg, 7-day average</small></div>' +
        '<p class="small muted" style="margin-top:6px">Started at ' + kgText(first) + ' kg · goal ' + PLAN.targets.goalKg + ' kg · ' + (togo > 0 ? kgText(togo) + ' kg to go' : 'goal reached') + '</p>';
      const tr = L.weeklyTrend(state.weights, today);
      if (tr === null) {
        const n = list.filter(x => x.d >= L.addDays(today, -13)).length;
        h += '<p class="status">Trend needs 5 weigh-ins spread over 10 days. You have ' + n + ' in the last 14 days.</p>';
      } else {
        const v = L.trendVerdict(tr);
        h += '<p class="status' + (v.band === 'ok' ? '' : ' bad') + '"><b>' + (tr > 0 ? '+' : '−') + Math.abs(tr).toFixed(2) + ' kg/week</b> over the last 14 days. ' + esc(v.text) + '</p>';
      }
      h += '</div><div class="chartwrap" id="wchart"></div><div class="legend"><span><i class="dot"></i>Weigh-in</span><span><i class="ln"></i>7-day average</span></div>' +
        '<div class="tablink"><button class="link" data-act="wtable">' + (ui.weightTable ? 'Hide table' : 'Show as table') + '</button></div>';
      if (ui.weightTable) {
        h += '<div class="pad" style="padding-top:0"><table class="t"><tr><th>Date</th><th class="n">Weight</th><th class="n">7-day avg</th></tr>';
        list.slice().reverse().slice(0, 30).forEach(x => {
          const av = L.avgWindow(state.weights, x.d, 7);
          h += '<tr><td>' + fmtLong(x.d) + '</td><td class="n">' + kgText(x.kg) + '</td><td class="n">' + kgText(av.avg) + '</td></tr>';
        });
        h += '</table></div>';
      }
    }
    h += '</div>';

    /* missed days: one Monday-to-Sunday week at a time */
    if (hasPlan() && today >= sd()) {
      const startMon = L.mondayOf(sd()), curMon = L.mondayOf(today);
      const back = Math.round(L.diffDays(startMon, curMon) / 7);
      ui.missWeek = Math.max(-back, Math.min(0, ui.missWeek));
      const wk = L.weekView(state.sessions, state.skips, L.addDays(curMon, ui.missWeek * 7), today, sd());
      const wkNo = Math.round(L.diffDays(startMon, wk.start) / 7) + 1;
      const label = p => p === 0 ? 'Off' : p === 'B' ? 'Bonus (optional)' : 'Day ' + p + ' · ' + L.dayDef(p).name;
      const pillText = { done: 'Done', short: 'Short', bonus: 'Bonus', missed: 'Missed', rest: 'Rest', today: 'Today', upcoming: '', before: '' };
      let line, bad = false;
      if (wk.left === 0) line = 'Five lifts done. Anything more is a bonus.';
      else if (wk.over) { line = 'Ended ' + wk.left + ' short of 5.'; bad = true; }
      else if (wk.reachable) line = 'Still reachable: ' + wk.left + ' more in ' + wk.open + ' open day' + (wk.open === 1 ? '' : 's') + '.';
      else { line = '5 is out of reach this week. Best is ' + (wk.lifts + wk.open) + '. Do not double up to catch up.'; bad = true; }
      h += '<div class="panel"><div class="head"><h3>Missed days</h3><span class="small muted">Week ' + wkNo + ' · ' + fmtShort(wk.start) + '–' + fmtShort(wk.end) + '</span></div>' +
        '<div class="pad" style="padding-bottom:8px"><div class="bignum" style="font-size:28px">' + wk.lifts + ' of 5<small>lifts' + (wk.missed ? ' · ' + wk.missed + ' missed' : '') + '</small></div>' +
        '<p class="status' + (bad ? ' bad' : '') + '">' + esc(line) + '</p></div>';
      wk.days.forEach(x => {
        let sub = '';
        if (x.lifted && x.lifted !== 'B' && x.lifted !== x.plan) sub = 'Did Day ' + x.lifted + ' · ' + L.dayDef(x.lifted).name;
        if (x.status === 'short') sub += (sub ? ' · ' : '') + x.sets + ' of ' + x.total + ' sets';
        if (x.status === 'missed') sub = x.why || 'No reason logged';
        h += '<div class="wkrow ' + x.status + '"><span class="wd">' + DOW[L.weekday(x.d)] + ' ' + L.parse(x.d).getDate() + '</span>' +
          '<span class="pl">' + esc(label(x.plan)) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
          '<span class="st">' + pillText[x.status] + '</span></div>';
      });
      h += '<div class="inline-actions" style="padding:10px 16px 0;justify-content:space-between"><button class="pill" data-act="miss-week" data-step="-1"' + (ui.missWeek <= -back ? ' disabled style="opacity:.35"' : '') + '>‹ Earlier</button>' +
        '<button class="pill" data-act="miss-week" data-step="1"' + (ui.missWeek >= 0 ? ' disabled style="opacity:.35"' : '') + '>Later ›</button></div>' +
        '<p class="small muted" style="padding:10px 16px 12px">Missed a day? Do the next day in order, never double up. Eat to plan either way.</p></div>';
    }

    /* consistency */
    const wd = L.weekday(today), monday = L.addDays(today, -((wd + 6) % 7)), start = L.addDays(monday, -21);
    const byDate = {};
    state.sessions.forEach(s => { if (L.isComplete(s)) byDate[s.d] = s; });
    let thisWeek = 0;
    for (let i = 0; i < 7; i++) { const s = byDate[L.addDays(monday, i)]; if (s && s.day !== 'B') thisWeek++; }
    h += '<div class="panel"><div class="head"><h3>Last 4 weeks</h3><span class="small muted">This week ' + thisWeek + ' of 5 lifts</span></div><div class="grid28">';
    'MTWTFSS'.split('').forEach(c => { h += '<span class="dh">' + c + '</span>'; });
    for (let i = 0; i < 28; i++) {
      const d = L.addDays(start, i), s = byDate[d], dom = L.parse(d).getDate();
      if (s) h += plate(L.dayDef(s.day).plate, s.day);
      else h += '<span class="none' + (d === today ? ' today' : '') + (d > today ? ' future' : '') + (hasPlan() && L.dayStatus(state.sessions, state.skips, d, today, sd()).status === 'missed' ? ' missed' : '') + '">' + dom + '</span>';
    }
    h += '</div><p class="small muted" style="padding:0 16px 12px">Each disc is a finished lift, in that day\'s plate colour. An orange ring is a missed day.</p></div>';

    /* lifts */
    const loads = []; const seen = {};
    PLAN.days.forEach(d => d.exercises.forEach(e => { if (e.type === 'load' && !seen[e.key]) { seen[e.key] = 1; loads.push(e); } }));
    const withData = loads.filter(e => L.history(state.sessions, e.key).some(x => L.topSet(x)));
    if (!ui.liftKey || !seen[ui.liftKey]) ui.liftKey = (withData[0] || loads[0]).key;
    h += '<div class="panel"><div class="head"><h3>Lifts</h3></div><div class="pad"><select class="sel" id="liftsel" aria-label="Exercise">' +
      loads.map(e => '<option value="' + e.key + '"' + (e.key === ui.liftKey ? ' selected' : '') + '>' + esc(e.name.replace(/^Superset [AB]: /, '')) + (withData.indexOf(e) >= 0 ? '' : ' (no data)') + '</option>').join('') + '</select></div>';
    const hist = L.history(state.sessions, ui.liftKey).filter(x => L.topSet(x));
    if (hist.length < 2) h += '<div class="pad" style="padding-top:0"><p class="small muted">' + (hist.length ? 'One session so far: ' + esc(lastText(hist[0]).replace('Last: ', '')) + '. A line appears after the second.' : 'Log this lift in two sessions to see a line.') + '</p></div>';
    else h += '<div class="chartwrap" id="lchart"></div><p class="small muted" style="padding:0 16px 12px">Heaviest set of each session.</p>';
    h += '</div>';

    /* measurements */
    const ms = state.measures, lastM = ms[ms.length - 1];
    const due = !lastM || L.diffDays(lastM.d, today) >= 14;
    h += '<div class="panel"><div class="head"><h3>Measurements</h3><button class="btn small" data-act="measure-sheet">Add</button></div><div class="pad">';
    if (!ms.length) h += '<p class="small muted">Waist, hips and thigh every 2 weeks, same spot each time. Take the first one this week.</p>';
    else {
      h += '<p class="status' + (due ? ' bad' : '') + '" style="margin-top:0">' + (due ? 'Due now. Last was ' + fmtShort(lastM.d) + '.' : 'Next one around ' + fmtShort(L.addDays(lastM.d, 14)) + '.') + '</p>';
      h += '<table class="t" style="margin-top:6px"><tr><th>Date</th><th class="n">Waist</th><th class="n">Hips</th><th class="n">Thigh</th></tr>';
      ms.slice().reverse().forEach((m, idx, arr) => {
        const prev = arr[idx + 1];
        const cell = k => m[k] == null ? '—' : m[k] + (prev && prev[k] != null ? ' <span class="muted">(' + (m[k] - prev[k] > 0 ? '+' : m[k] - prev[k] < 0 ? '−' : '') + Math.abs(Math.round((m[k] - prev[k]) * 10) / 10) + ')</span>' : '');
        h += '<tr><td>' + fmtShort(m.d) + '</td><td class="n">' + cell('waist') + '</td><td class="n">' + cell('hips') + '</td><td class="n">' + cell('thigh') + '</td></tr>';
      });
      h += '</table>';
    }
    h += '</div></div>';
    return h;
  }
  function drawCharts() {
    const wc = $('#wchart');
    if (wc) {
      const list = L.weightList(state.weights);
      const dots = list.map(x => {
        const av = L.avgWindow(state.weights, x.d, 7);
        return { x: dayNum(x.d), y: x.kg, tip: fmtLong(x.d) + ': ' + kgText(x.kg) + ' kg · 7-day avg ' + kgText(av.avg) };
      });
      const avg = list.map(x => ({ x: dayNum(x.d), y: L.avgWindow(state.weights, x.d, 7).avg }));
      Charts.line(wc, {
        series: [{ kind: 'dots', points: dots }, { kind: 'line', points: avg }],
        goal: { y: PLAN.targets.goalKg, label: 'Goal ' + PLAN.targets.goalKg + ' kg' },
        xMax: dayNum(nowStr()), xLabel: dayLabel,
        yLabel: y => String(Math.round(y * 10) / 10),
        alt: 'Weight chart. Latest 7-day average ' + kgText(L.avgWindow(state.weights, list[list.length - 1].d, 7).avg) + ' kg.'
      });
    }
    const lc = $('#lchart');
    if (lc) {
      const hist = L.history(state.sessions, ui.liftKey).filter(x => L.topSet(x)).reverse();
      const pts = hist.map(x => { const t = L.topSet(x); return { x: dayNum(x.d), y: t.kg, tip: fmtShort(x.d) + ': ' + L.fmtKg(t.kg) + ' kg × ' + (t.reps != null ? t.reps : '?') }; });
      Charts.line(lc, {
        series: [{ kind: 'line', markers: true, points: pts }],
        xLabel: dayLabel,
        yLabel: y => String(Math.round(y * 10) / 10),
        alt: 'Heaviest set per session for the selected lift, ' + pts.length + ' sessions.'
      });
    }
  }

  /* ---------- MORE ---------- */
  function renderMore() {
    const reminders = L.reminderRows();
    const picked = state.reminderIds || reminders.map(r => r.id);
    let h = '<div class="top"><div><h1>More</h1></div></div>';
    const stored = window.PlanStore.stored();
    h += '<div class="panel"><div class="head"><h3>Your plan</h3></div><div class="pad"><p class="small muted">' +
      (hasPlan() ? (stored ? 'Loaded from the file you imported. It lives only on this phone.' : 'Built into this copy of the app.') : 'No plan loaded yet.') +
      '</p><div class="inline-actions" style="margin-top:10px"><button class="btn small' + (hasPlan() ? ' quiet' : '') + '" data-act="plan-import">Import plan</button>' +
      (stored ? '<button class="btn small quiet" data-act="plan-remove">Remove plan</button>' : '') + '</div></div></div>';
    if (hasPlan()) {

    /* reminders */
    h += '<div class="panel"><div class="head"><h3>Reminders</h3></div><div class="pad"><p class="small muted">A web app on iPhone can\'t schedule its own alerts. So this makes a calendar file: repeating events with an alert at each time, for 12 weeks from ' + fmtLong(sd()) + '.</p><div class="checks" style="margin-top:8px">';
    reminders.forEach(r => {
      h += '<label><input type="checkbox" data-rem="' + r.id + '"' + (picked.indexOf(r.id) >= 0 ? ' checked' : '') + '> <span>' + to12(r.at) + ' · ' + esc(r.ics) + (r.trainOnly ? ' <span class="muted">(Mon–Fri)</span>' : '') + '</span></label>';
    });
    h += '</div><button class="btn block" style="margin-top:12px" data-act="ics">Add to Calendar</button>' +
      '<p class="small muted" style="margin-top:8px">Calendar asks which calendar to use. Make a new one called Plan so you can delete all of these in one go. Times are your wall-clock times.</p></div></div>';

    /* reference */
    h += '<div class="panel"><div class="head"><h3>The plan</h3></div><div style="margin-top:6px">';
    h += '<details class="acc"><summary>Workout chart</summary><div class="body">';
    PLAN.days.concat([PLAN.bonus]).forEach(d => {
      h += '<div class="inline-actions" style="margin-top:14px">' + plate(d.plate, d.id, 30) + '<b class="serif" style="font-size:17px">' + (d.id === 'B' ? 'Bonus' : 'Day ' + d.id + ' · ' + d.name) + '</b></div><table class="t" style="margin-top:6px">';
      d.exercises.forEach(e => { h += '<tr><td>' + esc(e.name) + '</td><td class="n">' + e.sets + ' × ' + esc(e.reps) + '</td></tr>'; });
      h += '</table>';
    });
    h += '</div></details>';
    h += '<details class="acc"><summary>Meal options</summary><div class="body">';
    Object.keys(PLAN.meals).forEach(slot => {
      h += '<p class="serif" style="font-weight:700;font-size:17px;margin-top:14px">' + PLAN.mealNames[slot] + (slot === 'snack' ? ' (rest days)' : '') + '</p>';
      PLAN.meals[slot].forEach(o => { h += '<div class="rule" style="grid-template-columns:24px 1fr"><b>' + o.id + '</b><span>' + esc(o.text) + '<br><span class="muted">' + o.kcal + ' kcal · ' + o.protein + ' g protein' + (o.note ? ' · ' + esc(o.note) : '') + '</span></span></div>'; });
    });
    h += (PLAN.mealNote ? '<p class="small muted" style="margin-top:12px">' + esc(PLAN.mealNote) + '</p>' : '') + '</div></details>';
    h += '<details class="acc"><summary>Rules</summary><div class="body">';
    let area = '';
    PLAN.rules.forEach(r => {
      if (r[0] !== area) { area = r[0]; h += '<div class="rule"><span class="area">' + esc(area) + '</span></div>'; }
      h += '<div class="rule"><b>' + esc(r[1]) + '</b><span>' + esc(r[2]) + '</span></div>';
    });
    h += '</div></details></div></div>';

    /* settings */
    h += '<div class="panel"><div class="head"><h3>Settings</h3></div><div class="pad"><div class="field" style="margin-top:0"><label for="startdate">Plan start date</label><input type="date" id="startdate" value="' + esc(sd()) + '"></div>' +
      '<p class="small muted" style="margin-top:8px">Sets the week number (weeks 1–2 are the gentler weeks) and when reminders begin.</p></div></div>';

    }

    /* data */
    const counts = state.sessions.length + ' lifts, ' + Object.keys(state.weights).length + ' weigh-ins, ' + state.measures.length + ' measurements';
    h += '<div class="panel"><div class="head"><h3>Your data</h3></div><div class="pad"><p class="small muted">Stored only on this phone: ' + counts + '. ' +
      (state.lastBackup ? 'Last backup ' + fmtShort(L.fmt(new Date(state.lastBackup))) + '.' : 'Never backed up.') + '</p>' +
      '<p class="status" id="persist-status"></p>' +
      '<div class="inline-actions" style="margin-top:12px"><button class="btn small" data-act="export">Back up</button><button class="btn small quiet" data-act="import">Restore</button><button class="btn small quiet" data-act="erase">Erase all</button></div>' +
      '</div></div>';

    /* app */
    const standalone = window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    h += '<div class="panel"><div class="head"><h3>App</h3></div><div class="pad">' +
      (standalone ? '<p class="small muted">Installed on the Home Screen. Works offline.</p>' : '<p class="small muted">Not installed yet. In Safari: Share, then Add to Home Screen. Then open it from the Home Screen.</p>') +
      '<p class="status" id="sw-status"></p><div class="inline-actions" style="margin-top:10px"><button class="btn small quiet" data-act="refresh-app">Refresh app files</button></div></div></div>';
    return h;
  }
  async function deliver(name, mime, text, title) {
    const file = new File([text], name, { type: mime });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return true; }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }
  async function exportData() {
    const text = JSON.stringify({ app: 'plan', exported: new Date().toISOString(), data: state, plan: window.PlanStore.stored() }, null, 1);
    const ok = await deliver('plan-backup-' + nowStr() + '.json', 'application/json', text, 'Plan backup');
    if (ok) { state.lastBackup = Date.now(); save(); render(); toast('Backup ready. Save it to Files.'); }
  }
  async function exportIcs() {
    const ids = state.reminderIds || L.reminderRows().map(r => r.id);
    if (!ids.length) { toast('Tick at least one reminder'); return; }
    const text = L.buildIcs({ startDate: sd(), weeks: 12, ids });
    await deliver('plan-reminders.ics', 'text/calendar', text, 'Plan reminders');
  }
  function importFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const o = JSON.parse(rd.result);
        const data = o && o.app === 'plan' && o.data ? normalize(o.data) : null;
        if (!data) throw new Error('not a backup');
        confirmSheet({
          title: 'Restore this backup?', text: 'It has ' + data.sessions.length + ' lifts, ' + Object.keys(data.weights).length + ' weigh-ins and ' + data.measures.length + ' measurements. It replaces everything on this phone now.',
          confirmLabel: 'Replace and restore', onConfirm: () => {
            state = data; save();
            if (o.plan && !window.PlanStore.validate(o.plan)) { window.PlanStore.save(o.plan); location.reload(); return; }
            ui.date = nowStr(); render(); toast('Restored');
          }
        });
      } catch (e) { toast('That file is not a Plan backup'); }
    };
    rd.readAsText(file);
  }

  function importPlanFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      let o;
      try { o = JSON.parse(rd.result); } catch (e) { toast('That file is not a plan file'); return; }
      if (o && o.app === 'plan-file' && o.plan) o = o.plan;
      const problem = window.PlanStore.validate(o);
      if (problem) { toast(problem); return; }
      const apply = () => {
        try { window.PlanStore.save(o); } catch (e) { toast('This phone would not save the plan'); return; }
        location.reload();
      };
      if (hasPlan()) confirmSheet({ title: 'Replace your plan?', text: 'Your logs stay. Only the exercises, meals, schedule and targets change.', confirmLabel: 'Replace plan', onConfirm: apply });
      else apply();
    };
    rd.readAsText(file);
  }
  function renderNoPlan(title) {
    return '<div class="top"><div><h1>' + title + '</h1></div></div>' +
      '<div class="panel"><div class="head"><h3>Load your plan</h3></div><div class="pad"><p>This app starts empty. Your workouts, meals and schedule come from a plan file that stays on your phone.</p>' +
      '<ol class="small" style="margin:10px 0 0;padding-left:20px;display:grid;gap:6px"><li>Get <b>my-plan.json</b> onto this iPhone: AirDrop it, or save it in the Files app.</li><li>Tap Import plan and pick the file.</li></ol>' +
      '<button class="btn block" style="margin-top:14px" data-act="plan-import">Import plan</button></div></div>';
  }

  /* ---------- render + events ---------- */
  const view = $('#view');
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => { if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    const y = window.scrollY;
    view.innerHTML = ui.tab === 'more' ? renderMore() : !hasPlan() ? renderNoPlan(ui.tab === 'today' ? 'Today' : ui.tab === 'lift' ? 'Lift' : 'Progress') : ui.tab === 'today' ? renderToday() : ui.tab === 'lift' ? renderLift() : renderProgress();
    window.scrollTo(0, y);
    if (ui.tab === 'progress' && hasPlan()) drawCharts();
    if (ui.tab === 'more') moreStatus();
    holdScreen(ui.tab === 'lift');
  }
  async function moreStatus() {
    const p = $('#persist-status');
    if (p && navigator.storage && navigator.storage.persisted) {
      try {
        let ok = await navigator.storage.persisted();
        if (!ok && navigator.storage.persist) ok = await navigator.storage.persist();
        p.textContent = ok ? 'Storage is marked persistent, so Safari should not clear it.' : 'Safari may clear this data if the phone runs low on space. Back up now and then.';
        if (!ok) p.className = 'status bad';
      } catch (e) { /* ignore */ }
    }
    const s = $('#sw-status');
    if (s) s.textContent = 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'Offline files are saved. Open the app with no signal any time.' : 'Offline files not saved yet. Open the app once with signal, then reopen it.') : 'This browser cannot save offline files.';
  }
  function setTab(t) {
    ui.tab = t; ui.openMeal = null;
    render(); window.scrollTo(0, 0);
    if (t === 'today' && ui.date === nowStr()) scrollToNow();
  }
  function scrollToNow() {
    const n = $('.tl li.now');
    if (n) { const top = n.getBoundingClientRect().top + window.scrollY - 140; window.scrollTo(0, Math.max(0, top)); }
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act], [data-tab]');
    if (!t) return;
    if (t.dataset.tab) { setTab(t.dataset.tab); return; }
    const a = t.dataset.act, r = () => rec(ui.date);
    switch (a) {
      case 'date-prev': ui.date = L.addDays(ui.date, -1); ui.openMeal = null; render(); break;
      case 'date-next': if (ui.date < nowStr()) { ui.date = L.addDays(ui.date, 1); ui.openMeal = null; render(); } break;
      case 'date-today': ui.date = nowStr(); render(); scrollToNow(); break;
      case 'daytype': r().dayType = t.dataset.type; save(); render(); break;
      case 'open-lift': ui.liftDay = t.dataset.day === 'B' ? 'B' : +t.dataset.day; setTab('lift'); break;
      case 'lift-day': ui.liftDay = t.dataset.day === 'B' ? 'B' : +t.dataset.day; render(); break;
      case 'set-done': setDone(t.closest('.set')); break;
      case 'lift-finish': {
        const s = findSession(ui.date, currentLiftDay());
        if (s) { s.end = Date.now(); save(); ui.liftDay = null; stopTimer(); toast('Workout saved'); render(); }
        break;
      }
      case 'lift-reopen': { const s = findSession(ui.date, currentLiftDay()); if (s) { delete s.end; save(); render(); } break; }
      case 'timer-add': if (ui.timer) { ui.timer.end = Math.max(Date.now(), ui.timer.end) + 15000; if (ui.timer.fired) { ui.timer.fired = false; } drawTimer(true); } break;
      case 'timer-skip': stopTimer(); break;
      case 'time-sheet': timeSheet(t.dataset.row); break;
      case 'time-save': {
        const v = ($('#tm') || {}).value;
        if (!/^\d{2}:\d{2}$/.test(v || '')) { toast('Pick a time'); break; }
        const plan = planRowsFor(ui.date), cur = peek(ui.date).times || {}, id = t.dataset.row;
        const next = id === 'gym' ? L.moveGym(plan, cur, v) : L.cleanTimes(plan, Object.assign({}, cur, { [id]: v }));
        r().times = next; if (!Object.keys(next).length) delete r().times;
        save(); closeSheet(); render(); break;
      }
      case 'time-reset': {
        const x = r(), id = t.dataset.row, tm = Object.assign({}, x.times || {});
        if (id === 'gym') L.GYM_CHAIN.forEach(k => { delete tm[k]; }); else delete tm[id];
        if (Object.keys(tm).length) x.times = tm; else delete x.times;
        save(); closeSheet(); render(); break;
      }
      case 'times-reset': { delete r().times; save(); toast('Back to the plan times'); render(); break; }
      case 'wake-sheet': wakeSheet(); break;
      case 'wake-save': {
        const wv = ($('#wk') || {}).value, gv = ($('#gy') || {}).value || '';
        if (!/^\d{2}:\d{2}$/.test(wv || '') || (gv && !/^\d{2}:\d{2}$/.test(gv))) { toast('Pick a time'); break; }
        const next = L.setWake(planRowsFor(ui.date), peek(ui.date).times || {}, wv, gv);
        if (Object.keys(next).length) r().times = next; else delete r().times;
        save(); closeSheet(); toast('Times moved for this day'); render(); break;
      }
      case 'skip-sheet': skipSheet(); break;
      case 'skip-why': { state.skips[ui.date] = { why: String(t.dataset.why).slice(0, 40) }; save(); closeSheet(); toast('Marked missed'); render(); break; }
      case 'skip-undo': { delete state.skips[ui.date]; save(); toast('Skip removed'); render(); break; }
      case 'miss-week': ui.missWeek += +t.dataset.step; render(); break;
      case 'water-sheet': waterSheet(); break;
      case 'water': { const v = Math.max(0, (peek(ui.date).water || 0) + (+t.dataset.ml)); r().water = v; save(); const w = $('#wtot'); if (w) w.innerHTML = (v / 1000).toFixed(2).replace(/0$/, '') + '<small>L of 2.5–3 L</small>'; render(); break; }
      case 'steps-sheet': stepsSheet(); break;
      case 'sleep-sheet': sleepSheet(); break;
      case 'weight-sheet': weightSheet(); break;
      case 'measure-sheet': measureSheet(); break;
      case 'row-done': { const row = t.dataset.row, d = r().done = r().done || {}; d[row] = !d[row]; save(); render(); break; }
      case 'gym-tick': { const tw = L.todayWorkout(state.sessions, ui.date); if (tw.done) { toast('Finished in Lift'); break; } const d = r().done = r().done || {}; d.gym = !d.gym; save(); render(); break; }
      case 'whey-tick': r().wheyPost = !peek(ui.date).wheyPost; save(); render(); break;
      case 'extra-tick': r().wheyExtra = !peek(ui.date).wheyExtra; save(); render(); break;
      case 'supplement': r().supplement = !peek(ui.date).supplement; save(); render(); break;
      case 'meal-tick': {
        const row = PLAN.routine.filter(x => x.id === t.dataset.row)[0], m = peek(ui.date).meals;
        if (m && m[row.meal] !== undefined) { delete r().meals[row.meal]; save(); ui.openMeal = null; render(); } else { ui.openMeal = row.id; render(); }
        break;
      }
      case 'meal-open': ui.openMeal = ui.openMeal === t.dataset.row ? null : t.dataset.row; render(); break;
      case 'meal-pick': { const x = r(); x.meals = x.meals || {}; x.meals[t.dataset.slot] = t.dataset.id; ui.openMeal = null; save(); render(); break; }
      case 'meal-other': otherMealSheet(t.dataset.slot); break;
      case 'wtable': ui.weightTable = !ui.weightTable; render(); break;
      case 'ics': exportIcs(); break;
      case 'export': exportData(); break;
      case 'import': $('#importfile').click(); break;
      case 'plan-import': $('#planfile').click(); break;
      case 'plan-remove':
        confirmSheet({ title: 'Remove your plan?', text: 'Your logs stay on this phone. The app goes back to empty until you import a plan again.', confirmLabel: 'Remove plan', onConfirm: () => { window.PlanStore.clear(); location.reload(); } });
        break;
      case 'erase':
        confirmSheet({ title: 'Erase everything?', text: 'This deletes every log on this phone. Back up first if you might want it back.', confirmLabel: 'Erase all', onConfirm: () => { state = blank(); save(); ui.date = nowStr(); ui.liftDay = null; render(); toast('Erased'); } });
        break;
      case 'refresh-app': refreshApp(); break;
      case 'sheet-close': closeSheet(); break;
      case 'sheet-save': {
        const vals = Array.from(document.querySelectorAll('#sheet-root input')).map(i => i.value);
        const cb = sheetCb; if (cb && cb(vals) !== false) closeSheet();
        break;
      }
      case 'sheet-confirm': { const cb = sheetCb; closeSheet(); if (cb) cb(); break; }
    }
  });
  document.addEventListener('input', e => {
    if (e.target.matches('.set input')) onSetInput(e);
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'liftsel') { ui.liftKey = t.value; render(); }
    else if (t.id === 'startdate') { if (/^\d{4}-\d{2}-\d{2}$/.test(t.value)) { state.startDate = t.value; save(); toast('Start date saved'); } }
    else if (t.dataset && t.dataset.rem) {
      const ids = Array.from(document.querySelectorAll('input[data-rem]:checked')).map(i => i.dataset.rem);
      state.reminderIds = ids; save();
    } else if (t.id === 'importfile' && t.files[0]) { importFile(t.files[0]); t.value = ''; }
    else if (t.id === 'planfile' && t.files[0]) { importPlanFile(t.files[0]); t.value = ''; }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('#sheet-root').firstChild) closeSheet();
    if (e.key === 'Enter' && e.target.matches('#sheet-root input')) { e.preventDefault(); const b = $('#sheet-root [data-act="sheet-save"]'); if (b) b.click(); }
  });

  async function refreshApp() {
    try {
      if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); }
    } catch (e) { /* ignore */ }
    location.reload();
  }

  /* ---------- keep "now" fresh, roll over at midnight ---------- */
  let lastToday = nowStr();
  function refreshClock() {
    const t = nowStr();
    if (t !== lastToday) { if (ui.date === lastToday) ui.date = t; lastToday = t; }
    const typing = document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName);
    if (ui.tab === 'today' && !$('#sheet-root').firstChild && !typing && ui.date === t) render();
  }
  setInterval(refreshClock, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { refreshClock(); if (ui.timer) tickTimer(); holdScreen(ui.tab === 'lift'); }
  });
  let rz = null;
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (ui.tab === 'progress') drawCharts(); } }, 200);
  });

  /* ---------- go ---------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline files need https */ });
  }
  render();
  scrollToNow();
  window.__plan = { get state() { return state; }, ui, render, L }; /* handy for testing in the console */
})();

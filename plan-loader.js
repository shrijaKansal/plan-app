/* Lets the plan come from a file on the phone instead of from the hosted code.
   An imported plan is kept in localStorage and laid over the built-in PLAN
   before the app starts. validate() guards the app against a bad file. */
(function (root) {
  var KEY = 'plan-app:plan';
  var KINDS = ['wake', 'plain', 'gym', 'whey-post', 'meal', 'extra'];
  var PLATES = ['red', 'blue', 'yellow', 'green', 'white', 'chrome'];
  var SLOTS = ['breakfast', 'lunch', 'snack', 'dinner'];
  var num = function (x) { return typeof x === 'number' && isFinite(x); };
  var str = function (x) { return typeof x === 'string' && x.length > 0; };

  function checkExercise(e, where) {
    if (!e || !str(e.key) || !str(e.name)) return where + ' has an exercise without a key or name.';
    if (!num(e.sets) || e.sets < 1 || e.sets > 12) return e.name + ' needs a set count.';
    if (typeof e.reps !== 'string') return e.name + ' needs a reps text.';
    if (!num(e.rest) || e.rest < 0) return e.name + ' needs a rest time in seconds.';
    if (e.type !== 'load' && e.type !== 'check') return e.name + ' needs a type of load or check.';
    if (e.type === 'load' && !(num(e.min) && num(e.max) && e.max >= e.min)) return e.name + ' needs a min and max rep count.';
    return null;
  }

  function validate(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return 'That file is not a plan.';
    if (!Array.isArray(p.days) || p.days.length !== 5) return 'The plan needs exactly 5 training days.';
    var i, j, bad;
    for (i = 0; i < 5; i++) {
      var d = p.days[i];
      if (!d || d.id !== i + 1 || !str(d.name) || PLATES.indexOf(d.plate) < 0) return 'Day ' + (i + 1) + ' needs an id, a name and a plate colour.';
      if (!Array.isArray(d.exercises) || !d.exercises.length) return 'Day ' + (i + 1) + ' has no exercises.';
      for (j = 0; j < d.exercises.length; j++) { bad = checkExercise(d.exercises[j], 'Day ' + (i + 1)); if (bad) return bad; }
    }
    if (!p.bonus || !Array.isArray(p.bonus.exercises)) return 'The plan needs a bonus day.';
    for (j = 0; j < p.bonus.exercises.length; j++) { bad = checkExercise(p.bonus.exercises[j], 'Bonus'); if (bad) return bad; }
    if (!p.meals) return 'The plan needs meals.';
    for (i = 0; i < SLOTS.length; i++) {
      var opts = p.meals[SLOTS[i]];
      if (!Array.isArray(opts) || !opts.length) return 'The plan needs at least one ' + SLOTS[i] + ' option.';
      for (j = 0; j < opts.length; j++) {
        var o = opts[j];
        if (!o || !str(o.id) || !str(o.text) || !num(o.kcal) || !num(o.protein)) return 'A ' + SLOTS[i] + ' option is missing its text, calories or protein.';
      }
    }
    if (!p.mealNames || SLOTS.some(function (s) { return !str(p.mealNames[s]); })) return 'The plan needs meal names.';
    if (!Array.isArray(p.routine) || !p.routine.length) return 'The plan needs a daily schedule.';
    for (i = 0; i < p.routine.length; i++) {
      var r = p.routine[i];
      if (!r || !str(r.id) || !/^\d\d:\d\d$/.test(r.at || '') || !str(r.time) || KINDS.indexOf(r.kind) < 0 || !str(r.train)) return 'Schedule row ' + (i + 1) + ' is missing its id, time, kind or text.';
      if ((r.kind === 'meal' || r.kind === 'extra') && SLOTS.indexOf(r.meal) < 0) return 'Schedule row ' + r.id + ' needs a meal slot.';
    }
    var t = p.targets;
    if (!t || !t.train || !t.rest || !num(t.train.kcal) || !num(t.train.protein) || !num(t.rest.kcal) || !num(t.rest.protein)) return 'The plan needs calorie and protein targets.';
    ['waterMl', 'waterLowMl', 'stepsLow', 'stepsHigh', 'sleepLow', 'sleepHigh', 'goalKg'].forEach(function (k) { if (!num(t[k])) bad = 'The targets are missing ' + k + '.'; });
    if (bad && /targets/.test(bad)) return bad;
    if (!p.whey || !num(p.whey.kcal) || !num(p.whey.protein)) return 'The plan needs whey numbers (use 0 if you do not take it).';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startDate || '')) return 'The plan needs a start date like 2026-11-16.';
    if (p.rules !== undefined && !Array.isArray(p.rules)) return 'Rules must be a list.';
    return null;
  }

  function stored() {
    try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  var api = {
    key: KEY, validate: validate, stored: stored,
    save: function (o) { localStorage.setItem(KEY, JSON.stringify(o)); },
    clear: function () { localStorage.removeItem(KEY); }
  };
  root.PlanStore = api;

  var P = root.PLAN, o = stored();
  if (P && o && !validate(o)) {
    for (var k in o) P[k] = o[k];
    P.empty = false;
  }
})(typeof self !== 'undefined' ? self : this);

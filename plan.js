/* Empty plan: this is what ships in the public build. No personal data.
   The real plan is loaded on the phone from my-plan.json (More, Import plan). */
(function (root) {
  var d = new Date(), p = function (n) { return n < 10 ? '0' + n : '' + n; };
  root.PLAN = {
    empty: true,
    startDate: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),
    targets: {
      train: { kcal: 0, protein: 0 }, rest: { kcal: 0, protein: 0 },
      waterMl: 3000, waterLowMl: 2500, stepsLow: 8000, stepsHigh: 10000, sleepLow: 7, sleepHigh: 8, goalKg: 0
    },
    whey: { kcal: 0, protein: 0 },
    supplement: { label: 'Supplement' },
    days: [],
    bonus: { id: 'B', name: 'Bonus', sub: '', plate: 'chrome', exercises: [] },
    meals: { breakfast: [], lunch: [], snack: [], dinner: [] },
    mealNames: { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' },
    routine: [],
    rules: []
  };
})(typeof self !== 'undefined' ? self : this);

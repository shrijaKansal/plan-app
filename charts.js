/* A small SVG line chart with a hover/touch crosshair and tooltip. No libraries. */
(function (root) {
  var NS = 'http://www.w3.org/2000/svg';

  function niceTicks(min, max, want) {
    if (max - min < 1e-9) { min -= 1; max += 1; }
    var raw = (max - min) / want, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= raw; })[0];
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (var v = lo; v <= hi + step / 2; v += step) t.push(Math.round(v * 1000) / 1000);
    return t;
  }
  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* o: { series:[{kind:'dots'|'line', points:[{x,y,tip}]}], goal:{y,label}, xLabel(x), yLabel(y), height, alt }
     x is any number (days); tip is the tooltip string for a point. */
  function line(host, o) {
    host.innerHTML = '';
    var W = Math.max(280, host.clientWidth || 340), H = o.height || 230;
    var m = { l: 40, r: 14, t: 14, b: 28 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;
    var pts = [];
    o.series.forEach(function (s) { s.points.forEach(function (p) { pts.push(p); }); });
    if (!pts.length) return null;

    var xmin = Math.min.apply(null, pts.map(function (p) { return p.x; }));
    var xmax = Math.max.apply(null, pts.map(function (p) { return p.x; }));
    if (o.xMin !== undefined) xmin = Math.min(xmin, o.xMin);
    if (o.xMax !== undefined) xmax = Math.max(xmax, o.xMax);
    if (xmax - xmin < 6) { xmax = xmin + 6; }
    var ys = pts.map(function (p) { return p.y; });
    if (o.goal && o.goal.include) ys.push(o.goal.y);
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    var pad = Math.max((ymax - ymin) * 0.12, 0.4);
    var ticks = niceTicks(ymin - pad, ymax + pad, 4);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];

    function X(x) { return m.l + (x - xmin) / (xmax - xmin) * iw; }
    function Y(y) { return m.t + (1 - (y - y0) / (y1 - y0)) * ih; }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': o.alt || 'Chart' });
    ticks.forEach(function (t) {
      svg.appendChild(el('line', { class: 'grid', x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
      svg.appendChild(el('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, o.yLabel ? o.yLabel(t) : String(t)));
    });
    svg.appendChild(el('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }));
    var nx = Math.min(4, Math.max(1, Math.floor(iw / 80)));
    for (var i = 0; i <= nx; i++) {
      var xv = xmin + (xmax - xmin) * i / nx;
      svg.appendChild(el('text', { x: X(xv), y: H - 7, 'text-anchor': i === 0 ? 'start' : (i === nx ? 'end' : 'middle') }, o.xLabel ? o.xLabel(xv) : String(Math.round(xv))));
    }
    if (o.goal && o.goal.y >= y0 && o.goal.y <= y1) {
      svg.appendChild(el('line', { class: 'goal', x1: m.l, x2: W - m.r, y1: Y(o.goal.y), y2: Y(o.goal.y) }));
      svg.appendChild(el('text', { x: W - m.r, y: Y(o.goal.y) - 5, 'text-anchor': 'end' }, o.goal.label));
    }
    o.series.forEach(function (s) {
      var sorted = s.points.slice().sort(function (a, b) { return a.x - b.x; });
      if (s.kind === 'line' && sorted.length > 1) {
        var d = sorted.map(function (p, idx) { return (idx ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join('');
        svg.appendChild(el('path', { class: 'avg', d: d }));
      }
      if (s.kind === 'dots' || s.markers || sorted.length === 1) {
        sorted.forEach(function (p) { svg.appendChild(el('circle', { class: 'pt', cx: X(p.x), cy: Y(p.y), r: 4.5 })); });
      }
    });

    var cross = el('line', { class: 'cross', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
    var hot = el('circle', { class: 'hot', r: 5.5, visibility: 'hidden' });
    svg.appendChild(cross); svg.appendChild(hot);
    host.appendChild(svg);
    var tip = document.createElement('div');
    tip.className = 'tip'; tip.hidden = true; host.appendChild(tip);

    var hoverable = pts.filter(function (p) { return p.tip; });
    function show(evt) {
      var r = svg.getBoundingClientRect();
      var px = (evt.clientX - r.left) / r.width * W;
      var best = null, bd = 1e9;
      hoverable.forEach(function (p) { var dd = Math.abs(X(p.x) - px); if (dd < bd) { bd = dd; best = p; } });
      if (!best) return;
      var cx = X(best.x), cy = Y(best.y);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      hot.setAttribute('cx', cx); hot.setAttribute('cy', cy); hot.setAttribute('visibility', 'visible');
      tip.textContent = best.tip; tip.hidden = false;
      var left = cx / W * r.width + (svg.getBoundingClientRect().left - host.getBoundingClientRect().left);
      var w = tip.offsetWidth / 2;
      left = Math.max(w + 2, Math.min(host.clientWidth - w - 2, left));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(cy / H * r.height - 10, tip.offsetHeight + 2) + 'px';
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); hot.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    var hideTimer = null;
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', function (e) { clearTimeout(hideTimer); show(e); });
    /* a finger lifts the moment you tap, so on touch keep the tooltip up for a few seconds */
    svg.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') hideTimer = setTimeout(hide, 3500); });
    svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('pointercancel', function () { hideTimer = setTimeout(hide, 1500); });
    return { svg: svg };
  }

  root.Charts = { line: line, niceTicks: niceTicks };
})(typeof self !== 'undefined' ? self : this);

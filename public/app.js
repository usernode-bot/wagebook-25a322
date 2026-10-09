// WageBook: the page. Seven screens, routed by path:
//   /            the dashboard
//   /log         "Log today's work", three steps
//   /advance     "Take an advance"
//   /profile     your name, photo, work and town
//   /prices      "Prices and profit", your items and this week's ranking
//   /prices/new  add an item
//   /prices/:id  one item: costs, suggested price, price history
// Class names are written as whole literals so the Tailwind build sees them.
(function () {
  'use strict';

  var app = document.getElementById('app');
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var demo = params.get('demo') === '1';

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function now() {
    return (window.usernode && typeof usernode.now === 'function') ? usernode.now() : new Date();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return isoDate(now()); }
  function yesterday() { var d = now(); d.setDate(d.getDate() - 1); return isoDate(d); }
  function parseDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function shortDate(s) { return parseDate(s).toLocaleDateString('en', { month: 'short', day: 'numeric' }); }
  function longDate(s) { return parseDate(s).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' }); }
  var numFmt = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
  function money(cents) { return numFmt.format((cents || 0) / 100); }
  function num(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : NaN; }

  // The price maths, a copy of the server's rules in wagebook.js: the
  // suggested price is cost ÷ (1 − goal), rounded up to a whole unit, and
  // profit % is taken on the selling price.
  function suggestedPrice(cost, pct) {
    return Math.ceil((cost * 100) / (100 - pct) / 100) * 100;
  }
  function priceFacts(cost, sell, pct) {
    var profit = sell - cost;
    return {
      profitCents: profit,
      marginPct: Math.floor((profit * 100) / sell),
      belowGoal: profit * 100 < pct * sell,
      suggestedCents: suggestedPrice(cost, pct),
    };
  }
  function profitWords(cents) {
    return cents < 0 ? 'You lose ' + money(-cents) : 'You make ' + money(cents);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'content-type': 'application/json' };
    if (token) headers['x-usernode-token'] = token;
    if (window.usernode && usernode.previewNow) headers['x-usernode-now'] = now().toISOString();
    var method = opts.method || 'GET';
    if (method === 'GET' && demo) path += (path.indexOf('?') < 0 ? '?' : '&') + 'demo=1';
    return fetch(path, { method: method, headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) {
            var err = new Error(data.error === 'account_required' ? 'Make an account to save your work.'
              : (data.error || 'Could not reach WageBook.'));
            err.status = r.status;
            throw err;
          }
          return data;
        });
      });
  }

  // A save always lands in the person's own book, so leave the read-only
  // demo view and show it.
  function saved(msg, path) {
    demo = false;
    toast(msg);
    go(path || '/');
  }

  function toast(msg) {
    if (window.unNative && unNative.toast) unNative.toast(msg);
  }

  var ICONS = {
    plus: '<path d="M5 12h14M12 5v14"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    tag: '<path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4z"/><circle cx="7" cy="7" r="1.5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'h-6 w-6') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  // ── Routing ──────────────────────────────────────────────────────────────
  function href(path) { return path + (demo ? '?demo=1' : ''); }
  function go(path) {
    history.pushState(null, '', href(path));
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', render);
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    go(a.getAttribute('data-nav'));
  });

  var me = null;
  function loadMe() {
    return api('/api/me').then(function (d) { me = d; return d; });
  }

  function render() {
    var p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === '/log') return renderLog();
    if (p === '/advance') return renderAdvance();
    if (p === '/profile') return renderProfile();
    if (p === '/prices') return renderPrices();
    if (p === '/prices/new') return renderItem(null);
    var pm = p.match(/^\/prices\/(\d+)$/);
    if (pm) return renderItem(Number(pm[1]));
    return renderDashboard();
  }

  function demoNote() {
    return me && me.demo
      ? '<p class="rounded-lg bg-raised px-3 py-2 text-small text-muted">Showing staging demo data. Anything you save goes to your own book.</p>'
      : '';
  }

  function backBar(title, label, target) {
    var t = target || '/';
    var where = t === '/prices' ? 'prices' : 'dashboard';
    return '<header class="flex items-center gap-2">' +
      '<a href="' + href(t) + '" data-nav="' + t + '" class="btn-secondary px-3" aria-label="' + (label ? 'Cancel and go back to the ' + where : 'Back to ' + where) + '">' + icon('back', 'h-5 w-5') + '<span>' + (label || 'Back') + '</span></a>' +
      '<h1 class="text-heading">' + esc(title) + '</h1></header>';
  }

  function errorState(msg, retry, title) {
    app.innerHTML = '<div class="state-error card"><p class="text-heading">' + esc(title || 'Could not load your wage book') + '</p>' +
      '<p class="text-body text-muted">' + esc(msg) + ' Nothing you saved is lost.</p>' +
      '<button type="button" class="btn-primary mt-2" id="retry">Retry</button></div>';
    document.getElementById('retry').onclick = retry;
  }

  // ── Dashboard ────────────────────────────────────────────────────────────
  function renderDashboard() {
    app.innerHTML =
      '<div class="flex flex-col gap-4" aria-busy="true">' +
      '<div class="skeleton h-9 w-40"></div><div class="skeleton h-16 w-full"></div>' +
      '<div class="skeleton h-48 w-full"></div><div class="skeleton h-40 w-full"></div></div>';
    Promise.all([loadMe(), api('/api/dashboard?today=' + today())])
      .then(function (r) { drawDashboard(r[1]); })
      .catch(function (err) { errorState(err.message, renderDashboard); });
  }

  function drawDashboard(d) {
    var prof = me.profile || {};
    var name = prof.name || me.username || '';
    var avatar = prof.photo_url
      ? '<img src="' + esc(prof.photo_url) + '" alt="" class="h-11 w-11 rounded-full object-cover">'
      : '<span class="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-muted">' + icon('user') + '</span>';
    var hasData = d.recent.length > 0;

    var html =
      '<header class="flex items-center justify-between gap-3">' +
        '<div><h1 class="text-title">WageBook</h1>' +
        (name ? '<p class="text-body text-muted">' + esc(name) + '</p>' : '') + '</div>' +
        '<a href="' + href('/profile') + '" data-nav="/profile" class="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label="Your profile">' + avatar + '</a>' +
      '</header>' + demoNote() +
      '<div class="flex flex-col gap-3">' +
        '<a href="' + href('/log') + '" data-nav="/log" class="btn-primary min-h-16 text-heading" id="log-work">' + icon('plus', 'h-7 w-7') + 'Log today\'s work</a>' +
        '<a href="' + href('/advance') + '" data-nav="/advance" class="btn-secondary min-h-14 text-heading" id="take-advance">' + icon('banknote', 'h-6 w-6') + 'Take an advance</a>' +
        '<a href="' + href('/prices') + '" data-nav="/prices" class="btn-secondary min-h-14 text-heading" id="open-prices">' + icon('tag', 'h-6 w-6') + 'Prices and profit</a>' +
      '</div>';

    // An item selling below its profit goal, shown even on an empty wage
    // book: a vendor who never logs a work day still prices goods.
    var alerts = d.priceAlerts || [];
    if (alerts.length) {
      html += '<section id="price-alerts"><h2 class="section-label">Prices to check</h2><ul class="list">' +
        alerts.map(function (a) {
          var lead = a.costRoseCents > 0 ? 'Costs went up. ' : '';
          return '<li><a class="list-row justify-between" href="' + href('/prices/' + a.id) + '" data-nav="/prices/' + a.id + '">' +
            '<span class="shrink-0 text-danger">' + icon('alert') + '</span>' +
            '<div class="min-w-0 flex-1"><p class="truncate text-body font-medium">' + esc(a.name) + '</p>' +
            '<p class="text-small text-muted">' + lead + 'Profit is ' + a.marginPct + '%, your goal is ' + a.goalPct + '%.</p></div>' +
            '<div class="shrink-0 text-right"><p class="text-small text-muted">Suggested price</p>' +
            '<p class="text-body font-semibold tabular-nums">' + money(a.suggestedCents) + '</p></div></a></li>';
        }).join('') + '</ul></section>';
    }

    if (!hasData) {
      html += '<section class="state-empty card" id="empty-book">' +
        '<p class="text-heading">Your wage book is empty</p>' +
        '<p class="text-body text-muted">Tap Log today\'s work above after a day of work. Your earnings, unpaid wages and advances show up here.</p></section>';
      app.innerHTML = html;
      return;
    }

    html += '<section aria-label="Summary" id="summary" class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">' +
      tile('calendar', 'Earned this month', d.monthCents, d.monthDays + (d.monthDays === 1 ? ' day worked' : ' days worked')) +
      tile('clock', 'Earned this week', d.weekCents, 'Since Monday') +
      tile('wallet', 'Unpaid wages owed to you', d.owedCents, 'After advances') +
      tile('banknote', 'Advances still to work off', d.advanceLeftCents, 'Not covered by wages yet') +
      '</section>';

    html += chart(d.weeks);

    html += '<section><h2 class="section-label">Money by client</h2><ul class="list" id="client-balances">' +
      d.clients.map(function (c) {
        var line, cls = 'text-muted';
        if (c.owedCents > 0) { line = 'Owes you ' + money(c.owedCents); cls = 'text-fg font-semibold'; }
        else if (c.advanceLeftCents > 0) { line = 'Advance left ' + money(c.advanceLeftCents); cls = 'text-accent font-semibold'; }
        else line = 'All settled';
        var detail = c.advancedCents > 0
          ? 'Unpaid ' + money(c.unpaidCents) + ', advances ' + money(c.advancedCents)
          : (c.unpaidCents > 0 ? 'No advances' : '');
        return '<li class="list-row justify-between"><div class="min-w-0"><p class="truncate text-body font-medium">' + esc(c.name) + '</p>' +
          (detail ? '<p class="text-small text-muted">' + esc(detail) + '</p>' : '') + '</div>' +
          '<p class="shrink-0 text-right text-body ' + cls + '">' + esc(line) + '</p></li>';
      }).join('') + '</ul></section>';

    html += '<section><h2 class="section-label">Recent entries</h2><ul class="list" id="recent">' +
      d.recent.map(entryRow).join('') + '</ul></section>';

    app.innerHTML = html;
    wireChart(d.weeks);
  }

  function tile(ic, label, cents, sub) {
    return '<div class="flex flex-col gap-1 bg-surface p-4">' +
      '<span class="text-accent">' + icon(ic, 'h-7 w-7') + '</span>' +
      '<p class="text-small font-medium text-muted">' + esc(label) + '</p>' +
      '<p class="text-title tabular-nums">' + money(cents) + '</p>' +
      '<p class="text-small text-muted">' + esc(sub) + '</p></div>';
  }

  // The signature: every entry carries a date stamp, like a page in a paper
  // wage book.
  function stamp(date) {
    var dt = parseDate(date);
    return '<div class="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border border-line bg-raised leading-none">' +
      '<span class="text-heading">' + dt.getDate() + '</span>' +
      '<span class="text-small text-muted">' + dt.toLocaleDateString('en', { month: 'short' }) + '</span></div>';
  }

  var STATUS = {
    paid: { label: 'Paid', cls: 'text-good' },
    unpaid: { label: 'Unpaid', cls: 'text-danger' },
    partial: { label: 'Partly paid', cls: 'text-accent' },
  };

  function entryRow(e) {
    if (e.kind === 'advance') {
      return '<li class="list-row">' + stamp(e.date) +
        '<div class="min-w-0 flex-1"><p class="truncate text-body font-medium">Advance from ' + esc(e.client) + '</p>' +
        '<p class="text-small text-muted">Taken from unpaid wages</p></div>' +
        '<p class="shrink-0 text-body font-semibold tabular-nums">' + money(e.cents) + '</p></li>';
    }
    var st = STATUS[e.status];
    var amount = e.quantity + (e.payBasis === 'day' ? (e.quantity === 1 ? ' day' : ' days') : (e.quantity === 1 ? ' hour' : ' hours'));
    var sub = [e.workType, amount].filter(Boolean).join(', ');
    return '<li class="list-row">' + stamp(e.date) +
      '<div class="min-w-0 flex-1"><p class="truncate text-body font-medium">' + esc(e.client) + '</p>' +
      '<p class="truncate text-small text-muted">' + esc(sub) + (e.photoUrl ? ', photo' : '') + '</p></div>' +
      '<div class="shrink-0 text-right"><p class="text-body font-semibold tabular-nums">' + money(e.cents) + '</p>' +
      '<p class="text-small font-medium ' + st.cls + '">' + st.label +
      (e.status === 'partial' ? ' ' + money(e.paidCents) : '') + '</p></div></li>';
  }

  // Earnings by week: one series, so no legend; the readout above the bars
  // names the week you tap, and the list below is the same data as text.
  function chart(weeks) {
    var max = Math.max.apply(null, weeks.map(function (w) { return w.cents; })) || 1;
    var last = weeks.length - 1;
    var bars = weeks.map(function (w, i) {
      var h = Math.round((w.cents / max) * 100);
      var dt = parseDate(w.start);
      var top = i === last ? 'This' : String(dt.getDate());
      var bottom = i === last ? 'week' : dt.toLocaleDateString('en', { month: 'short' });
      return '<button type="button" class="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" data-week="' + i + '" aria-label="Week of ' + esc(shortDate(w.start)) + ': ' + money(w.cents) + '">' +
        '<span class="flex w-full flex-1 items-end justify-center px-1">' +
          '<span class="block w-full max-w-8 rounded-t bg-accent ' + (i === last ? '' : 'opacity-50 group-hover:opacity-75') + '" style="height:' + Math.max(h, w.cents ? 3 : 1) + '%"></span>' +
        '</span>' +
        '<span class="flex w-full flex-col text-center text-small leading-tight text-muted"><span>' + esc(top) + '</span><span>' + esc(bottom) + '</span></span></button>';
    }).join('');
    return '<section id="weekly-chart"><h2 class="section-label">Earnings by week</h2>' +
      '<div class="card"><p class="text-body" id="week-readout"></p>' +
      '<div class="mt-3 flex h-44 items-stretch gap-1 border-b border-line" role="group" aria-label="Earnings for the last 8 weeks">' + bars + '</div>' +
      '<ul class="sr-only">' + weeks.map(function (w) { return '<li>Week of ' + esc(shortDate(w.start)) + ': ' + money(w.cents) + '</li>'; }).join('') + '</ul>' +
      '</div></section>';
  }

  function wireChart(weeks) {
    var readout = document.getElementById('week-readout');
    function show(i) {
      var w = weeks[i];
      readout.innerHTML = (i === weeks.length - 1 ? 'This week' : 'Week of ' + esc(shortDate(w.start))) +
        ': <strong class="font-semibold tabular-nums">' + money(w.cents) + '</strong>';
    }
    show(weeks.length - 1);
    app.querySelectorAll('[data-week]').forEach(function (b) {
      var i = +b.getAttribute('data-week');
      b.addEventListener('click', function () { show(i); });
      b.addEventListener('mouseenter', function () { show(i); });
      b.addEventListener('focus', function () { show(i); });
    });
  }

  // ── Shared form parts ────────────────────────────────────────────────────
  function dateField(id, label, value) {
    var t = today(), y = yesterday();
    return '<div class="flex flex-col gap-2"><label for="' + id + '" class="text-body font-medium">' + esc(label) + '</label>' +
      '<div class="flex gap-2">' +
        '<button type="button" class="btn-secondary flex-1" data-date="' + t + '" aria-pressed="' + (value === t) + '">Today</button>' +
        '<button type="button" class="btn-secondary flex-1" data-date="' + y + '" aria-pressed="' + (value === y) + '">Yesterday</button>' +
      '</div>' +
      '<input type="date" id="' + id + '" class="field" value="' + esc(value) + '" max="' + t + '" required></div>';
  }
  function wireDate(id, onChange) {
    var input = document.getElementById(id);
    var btns = app.querySelectorAll('[data-date]');
    function sync() { btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-date') === input.value)); }); }
    btns.forEach(function (b) {
      b.addEventListener('click', function () { input.value = b.getAttribute('data-date'); sync(); onChange(input.value); });
    });
    input.addEventListener('change', function () { sync(); onChange(input.value); });
  }

  function clientPicker(clients, value) {
    var chips = clients.map(function (c) {
      return '<button type="button" class="btn-secondary max-w-full" data-client="' + esc(c.name) + '" aria-pressed="' + (c.name.toLowerCase() === value.toLowerCase()) + '"><span class="truncate">' + esc(c.name) + '</span></button>';
    }).join('');
    return '<div class="flex flex-col gap-2"><label for="client" class="text-body font-medium">Who did you work for?</label>' +
      (chips ? '<div class="flex flex-wrap gap-2" id="client-chips">' + chips + '</div>' : '') +
      '<input id="client" class="field" autocomplete="off" maxlength="80" value="' + esc(value) + '" placeholder="' + (chips ? 'Or type a new name' : 'e.g. Pak Budi, Green Cafe') + '"></div>';
  }
  function wireClient(onChange) {
    var input = document.getElementById('client');
    var chips = app.querySelectorAll('[data-client]');
    function sync() {
      var v = input.value.trim().toLowerCase();
      chips.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-client').toLowerCase() === v)); });
    }
    chips.forEach(function (b) {
      b.addEventListener('click', function () { input.value = b.getAttribute('data-client'); sync(); onChange(input.value, true); });
    });
    input.addEventListener('input', function () { sync(); onChange(input.value, false); });
  }
  function findClient(clients, name) {
    var v = (name || '').trim().toLowerCase();
    for (var i = 0; i < clients.length; i++) if (clients[i].name.toLowerCase() === v) return clients[i];
    return null;
  }

  function formError(msg) {
    var el = document.getElementById('form-error');
    el.textContent = msg || '';
    el.hidden = !msg;
    if (msg) el.focus();
  }
  var errorBox = '<p id="form-error" class="rounded-lg border border-danger px-3 py-2 text-body text-danger" role="alert" tabindex="-1" hidden></p>';

  function loadForm(draw) {
    app.innerHTML = '<div class="flex flex-col gap-4" aria-busy="true"><div class="skeleton h-11 w-48"></div><div class="skeleton h-24 w-full"></div><div class="skeleton h-24 w-full"></div></div>';
    Promise.all([me ? me : loadMe(), api('/api/clients')])
      .then(function (r) { draw(r[1]); })
      .catch(function (err) { errorState(err.message, function () { loadForm(draw); }); });
  }

  // ── Log today's work: three steps ────────────────────────────────────────
  function renderLog() { loadForm(drawLog); }

  function drawLog(data) {
    var s = {
      step: 1, date: today(), client: '', workType: '', payBasis: 'day',
      quantity: '1', rate: '', total: '', totalEdited: false,
      status: 'paid', paid: '', photoUrl: null, uploading: false,
    };

    function calcTotal() {
      if (s.totalEdited) return;
      var q = num(s.quantity), r = num(s.rate);
      s.total = (isFinite(q) && isFinite(r)) ? String(Math.round(q * r * 100) / 100) : '';
    }

    function applyClient(name) {
      var c = findClient(data.clients, name);
      if (!c || !c.last) return;
      if (c.last.workType) s.workType = c.last.workType;
      s.payBasis = c.last.payBasis;
      s.quantity = s.payBasis === 'day' ? '1' : String(c.last.quantity);
      s.rate = String(c.last.rateCents / 100);
      s.totalEdited = false;
      calcTotal();
    }

    function stepHead(title) {
      return backBar('Log today\'s work', 'Cancel') + demoNote() +
        '<div class="flex flex-col gap-2"><p class="text-small font-medium text-muted" id="step-label">Step ' + s.step + ' of 3</p>' +
        '<div class="flex gap-1" aria-hidden="true">' + [1, 2, 3].map(function (i) {
          return '<span class="h-1.5 flex-1 rounded-full ' + (i <= s.step ? 'bg-accent' : 'bg-line') + '"></span>';
        }).join('') + '</div><h2 class="text-title">' + esc(title) + '</h2></div>';
    }

    function draw() {
      if (s.step === 1) drawStep1();
      else if (s.step === 2) drawStep2();
      else drawStep3();
      window.scrollTo(0, 0);
    }

    function drawStep1() {
      app.innerHTML = stepHead('Day and client') +
        '<form id="step-form" class="flex flex-col gap-5" novalidate>' +
        dateField('date', 'Day worked', s.date) +
        clientPicker(data.clients, s.client) +
        '<div class="flex flex-col gap-2"><label for="work-type" class="text-body font-medium">Type of work (optional)</label>' +
        '<input id="work-type" class="field" list="work-types" maxlength="80" value="' + esc(s.workType) + '" placeholder="e.g. Painting, Deliveries">' +
        '<datalist id="work-types">' + data.workTypes.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div>' +
        errorBox +
        '<button type="submit" class="btn-primary min-h-14 text-heading">Next: pay</button></form>';
      wireDate('date', function (v) { s.date = v; });
      wireClient(function (v, picked) {
        s.client = v;
        if (picked) { applyClient(v); document.getElementById('work-type').value = s.workType; }
      });
      document.getElementById('work-type').addEventListener('input', function (e) { s.workType = e.target.value; });
      document.getElementById('step-form').addEventListener('submit', function (e) {
        e.preventDefault();
        s.client = document.getElementById('client').value.trim();
        s.date = document.getElementById('date').value;
        if (!s.date) return formError('Pick the day you worked.');
        if (!s.client) return formError('Add who you worked for.');
        if (!s.rate) applyClient(s.client);
        s.step = 2; draw();
      });
    }

    function drawStep2() {
      var day = s.payBasis === 'day';
      app.innerHTML = stepHead('How much') +
        '<form id="step-form" class="flex flex-col gap-5" novalidate>' +
        '<fieldset class="flex flex-col gap-2"><legend class="mb-2 text-body font-medium">How are you paid?</legend>' +
          '<div class="grid grid-cols-2 gap-2">' +
          '<button type="button" class="btn-secondary min-h-14" data-basis="day" aria-pressed="' + day + '">By the day</button>' +
          '<button type="button" class="btn-secondary min-h-14" data-basis="hour" aria-pressed="' + !day + '">By the hour</button>' +
          '</div></fieldset>' +
        '<div class="grid grid-cols-2 gap-3">' +
          '<div class="flex flex-col gap-2"><label for="quantity" class="text-body font-medium">' + (day ? 'Days worked' : 'Hours worked') + '</label>' +
          '<input id="quantity" class="field tabular-nums" inputmode="decimal" value="' + esc(s.quantity) + '" placeholder="' + (day ? 'e.g. 1' : 'e.g. 8') + '"></div>' +
          '<div class="flex flex-col gap-2"><label for="rate" class="text-body font-medium">' + (day ? 'Pay per day' : 'Pay per hour') + '</label>' +
          '<input id="rate" class="field tabular-nums" inputmode="decimal" value="' + esc(s.rate) + '" placeholder="e.g. 150000"></div>' +
        '</div>' +
        '<div class="flex flex-col gap-2"><label for="total" class="text-body font-medium">Total wage</label>' +
          '<input id="total" class="field text-heading tabular-nums" inputmode="decimal" value="' + esc(s.total) + '">' +
          '<p class="text-small text-muted" id="total-hint">' + (s.totalEdited ? 'You changed this yourself.' : 'Worked out for you. You can change it.') + '</p></div>' +
        errorBox +
        '<div class="grid grid-cols-2 gap-3"><button type="button" class="btn-secondary min-h-14" id="prev">Back</button>' +
        '<button type="submit" class="btn-primary min-h-14 text-heading">Next: payment</button></div></form>';

      var q = document.getElementById('quantity'), r = document.getElementById('rate'), t = document.getElementById('total');
      function recalc() {
        s.quantity = q.value; s.rate = r.value; calcTotal();
        if (!s.totalEdited) t.value = s.total;
      }
      q.addEventListener('input', recalc);
      r.addEventListener('input', recalc);
      t.addEventListener('input', function () {
        s.total = t.value; s.totalEdited = t.value !== '';
        document.getElementById('total-hint').textContent = s.totalEdited ? 'You changed this yourself.' : 'Worked out for you. You can change it.';
        if (!s.totalEdited) recalc();
      });
      app.querySelectorAll('[data-basis]').forEach(function (b) {
        b.addEventListener('click', function () {
          var basis = b.getAttribute('data-basis');
          if (basis === s.payBasis) return;
          s.payBasis = basis;
          s.quantity = basis === 'day' ? '1' : '';
          s.rate = ''; s.totalEdited = false; calcTotal();
          drawStep2();
        });
      });
      document.getElementById('prev').onclick = function () { s.step = 1; draw(); };
      document.getElementById('step-form').addEventListener('submit', function (e) {
        e.preventDefault();
        if (!(num(s.quantity) > 0)) return formError(day ? 'Enter how many days you worked.' : 'Enter how many hours you worked.');
        if (!(num(s.total) >= 0)) return formError('Enter the total wage as a number.');
        if (!(num(s.rate) >= 0)) s.rate = String(num(s.total) / num(s.quantity));
        s.step = 3; draw();
      });
    }

    function drawStep3() {
      var opts = [['paid', 'Paid', 'I got all of it'], ['unpaid', 'Unpaid', 'They still owe me'], ['partial', 'Partly paid', 'I got some of it']];
      app.innerHTML = stepHead('Were you paid?') +
        '<form id="step-form" class="flex flex-col gap-5" novalidate>' +
        '<p class="text-body text-muted">' + esc(s.client) + ', ' + esc(longDate(s.date)) + ': <strong class="text-fg tabular-nums">' + money(Math.round(num(s.total) * 100)) + '</strong></p>' +
        '<fieldset class="flex flex-col gap-2"><legend class="sr-only">Payment</legend>' +
        opts.map(function (o) {
          var on = s.status === o[0];
          return '<button type="button" class="btn-secondary min-h-14 justify-start text-left" data-status="' + o[0] + '" aria-pressed="' + on + '">' +
            '<span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ' + (on ? 'border-accent bg-accent text-on-accent' : 'border-line') + '">' + (on ? icon('check', 'h-4 w-4') : '') + '</span>' +
            '<span class="flex flex-col"><span class="font-semibold">' + o[1] + '</span><span class="text-small text-muted">' + o[2] + '</span></span></button>';
        }).join('') + '</fieldset>' +
        (s.status === 'partial'
          ? '<div class="flex flex-col gap-2"><label for="paid" class="text-body font-medium">Amount paid so far</label>' +
            '<input id="paid" class="field tabular-nums" inputmode="decimal" value="' + esc(s.paid) + '" placeholder="e.g. 50000"></div>'
          : '') +
        '<div class="flex flex-col gap-2"><span class="text-body font-medium">Photo as proof (optional)</span>' +
          (s.photoUrl ? '<img src="' + esc(s.photoUrl) + '" alt="Your proof photo" class="max-h-48 w-full rounded-lg border border-line object-cover">' : '') +
          '<label class="btn-secondary cursor-pointer">' + icon('camera', 'h-5 w-5') +
          '<span id="photo-label">' + (s.uploading ? 'Uploading…' : (s.photoUrl ? 'Change photo' : 'Add a receipt or job site photo')) + '</span>' +
          '<input type="file" id="photo" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only"' + (s.uploading ? ' disabled' : '') + '></label>' +
          '<p class="text-small text-danger" id="photo-error" hidden></p></div>' +
        errorBox +
        '<div class="grid grid-cols-2 gap-3"><button type="button" class="btn-secondary min-h-14" id="prev">Back</button>' +
        '<button type="submit" class="btn-primary min-h-14 text-heading" id="save"' + (s.uploading ? ' disabled' : '') + '>Save work</button></div></form>';

      app.querySelectorAll('[data-status]').forEach(function (b) {
        b.addEventListener('click', function () { keepPaid(); s.status = b.getAttribute('data-status'); drawStep3(); });
      });
      function keepPaid() { var p = document.getElementById('paid'); if (p) s.paid = p.value; }
      document.getElementById('photo').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        keepPaid();
        s.uploading = true; drawStep3();
        uploadPhoto(file).then(function (url) {
          s.photoUrl = url; s.uploading = false; drawStep3();
        }).catch(function (err) {
          s.uploading = false; drawStep3();
          var pe = document.getElementById('photo-error');
          pe.textContent = err.message; pe.hidden = false;
        });
      });
      document.getElementById('prev').onclick = function () { keepPaid(); s.step = 2; draw(); };
      document.getElementById('step-form').addEventListener('submit', function (e) {
        e.preventDefault();
        keepPaid();
        var btn = document.getElementById('save');
        btn.disabled = true;
        api('/api/work-logs', { method: 'POST', body: {
          date: s.date, client: s.client, workType: s.workType.trim(), payBasis: s.payBasis,
          quantity: num(s.quantity), rate: num(s.rate), total: num(s.total),
          status: s.status, paid: s.status === 'partial' ? num(s.paid) : null, photoUrl: s.photoUrl,
        } }).then(function () {
          saved('Work saved');
        }).catch(function (err) {
          btn.disabled = false;
          formError(err.message);
        });
      });
    }

    draw();
  }

  // Phone photos are often over the 5 MB upload limit: shrink to 1600 px
  // as a JPEG first, then hand it to the platform's file storage.
  function uploadPhoto(file) {
    if (!window.usernode || typeof usernode.uploadFile !== 'function') {
      return Promise.reject(new Error('Photos cannot be added here. You can still save without one.'));
    }
    return shrink(file).then(function (blob) {
      return usernode.uploadFile(blob, { visibility: 'public' });
    }).then(function (stored) { return stored.url; }, function () {
      throw new Error('That photo could not be added. Try another one, or save without it.');
    });
  }
  function shrink(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, 1600 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { resolve(b ? new File([b], 'proof.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  // ── Take an advance ──────────────────────────────────────────────────────
  function renderAdvance() { loadForm(drawAdvance); }

  function drawAdvance(data) {
    var s = { date: today(), client: '', amount: '' };
    app.innerHTML = backBar('Take an advance', 'Cancel') + demoNote() +
      '<p class="text-body text-muted">An advance is money a client gives you before your wages are paid. WageBook takes it from the unpaid wages that client owes you.</p>' +
      '<form id="advance-form" class="flex flex-col gap-5" novalidate>' +
      dateField('date', 'Day you got it', s.date) +
      clientPicker(data.clients, s.client).replace('Who did you work for?', 'Who gave you the advance?') +
      '<div class="flex flex-col gap-2"><label for="amount" class="text-body font-medium">Amount</label>' +
      '<input id="amount" class="field text-heading tabular-nums" inputmode="decimal" placeholder="e.g. 100000"></div>' +
      '<div id="advance-effect" class="rounded-lg bg-raised px-3 py-3 text-body" hidden></div>' +
      errorBox +
      '<button type="submit" class="btn-primary min-h-14 text-heading">Save advance</button></form>';

    var effect = document.getElementById('advance-effect');
    function preview() {
      var c = findClient(data.clients, s.client);
      var amt = Math.round(num(s.amount) * 100);
      if (!s.client.trim()) { effect.hidden = true; return; }
      var owed = c ? c.unpaidCents : 0, adv = c ? c.advancedCents : 0;
      var lines = [];
      lines.push(c ? (c.owedCents > 0 ? esc(c.name) + ' owes you <strong class="tabular-nums">' + money(c.owedCents) + '</strong> now.'
        : (c.advanceLeftCents > 0 ? 'You already have <strong class="tabular-nums">' + money(c.advanceLeftCents) + '</strong> in advances from ' + esc(c.name) + '.'
        : esc(c.name) + ' owes you nothing right now.'))
        : esc(s.client.trim()) + ' is new. They will be saved for next time.');
      if (amt > 0) {
        var after = Math.max(0, owed - adv - amt), left = Math.max(0, adv + amt - owed);
        lines.push(left > 0
          ? 'After this advance: <strong class="tabular-nums">' + money(left) + '</strong> left to work off.'
          : 'After this advance they owe you <strong class="tabular-nums">' + money(after) + '</strong>.');
      }
      effect.innerHTML = lines.map(function (l) { return '<p>' + l + '</p>'; }).join('');
      effect.hidden = false;
    }
    wireDate('date', function (v) { s.date = v; });
    wireClient(function (v) { s.client = v; preview(); });
    document.getElementById('amount').addEventListener('input', function (e) { s.amount = e.target.value; preview(); });
    document.getElementById('advance-form').addEventListener('submit', function (e) {
      e.preventDefault();
      s.date = document.getElementById('date').value;
      s.client = document.getElementById('client').value.trim();
      if (!s.date) return formError('Pick the day you got the advance.');
      if (!s.client) return formError('Add who gave you the advance.');
      if (!(num(s.amount) > 0)) return formError('Enter the advance amount.');
      var btn = e.submitter || app.querySelector('#advance-form [type=submit]');
      btn.disabled = true;
      api('/api/advances', { method: 'POST', body: { date: s.date, client: s.client, amount: num(s.amount) } })
        .then(function () { saved('Advance saved'); })
        .catch(function (err) { btn.disabled = false; formError(err.message); });
    });
  }

  // ── Prices and profit ────────────────────────────────────────────────────
  function pricesSkeleton() {
    return '<div class="flex flex-col gap-4" aria-busy="true">' +
      '<div class="skeleton h-11 w-48"></div><div class="skeleton h-14 w-full"></div>' +
      '<div class="skeleton h-40 w-full"></div><div class="skeleton h-40 w-full"></div></div>';
  }

  function renderPrices() {
    app.innerHTML = pricesSkeleton();
    Promise.all([me ? Promise.resolve(me) : loadMe(), api('/api/products?today=' + today())])
      .then(function (r) { drawPrices(r[1]); })
      .catch(function (err) { errorState(err.message, renderPrices, 'Could not load your prices'); });
  }

  function drawPrices(d) {
    var items = d.products || [];
    var html = backBar('Prices and profit') + demoNote() +
      '<a href="' + href('/prices/new') + '" data-nav="/prices/new" class="btn-primary min-h-14 text-heading" id="add-item">' +
      icon('plus', 'h-6 w-6') + 'Add an item</a>';
    if (!items.length) {
      html += '<section class="state-empty card" id="empty-prices">' +
        '<p class="text-heading">No items yet</p>' +
        '<p class="text-body text-muted">Add an item you sell and what it costs you. WageBook suggests a price and shows your profit.</p></section>';
      app.innerHTML = html;
      return;
    }
    html += '<section><h2 class="section-label">Your items</h2><ul class="list" id="price-items">' +
      items.map(function (p) {
        var sub = p.belowGoal
          ? '<p class="text-small text-danger">Below your ' + p.goalPct + '% profit goal. Suggested price ' + money(p.suggestedCents) + '</p>'
          : '<p class="text-small text-muted">Profit goal ' + p.goalPct + '%, now ' + p.marginPct + '%</p>';
        var prof = p.profitCents < 0
          ? 'You lose ' + money(-p.profitCents) + ' per item'
          : 'Profit ' + money(p.profitCents);
        return '<li><a class="list-row justify-between" href="' + href('/prices/' + p.id) + '" data-nav="/prices/' + p.id + '">' +
          '<div class="min-w-0 flex-1"><p class="truncate text-body font-medium">' + esc(p.name) + '</p>' + sub + '</div>' +
          '<div class="shrink-0 text-right"><p class="text-body font-semibold tabular-nums">' + money(p.sellCents) + '</p>' +
          '<p class="text-small text-muted tabular-nums">' + prof + '</p></div></a></li>';
      }).join('') + '</ul></section>';
    // With one item there is nothing to rank.
    if (items.length >= 2) html += weekSummary(d.week);
    app.innerHTML = html;
  }

  function weekSummary(week) {
    return '<section id="week-summary"><h2 class="section-label">This week, most profitable first</h2><ul class="list">' +
      week.map(function (w, i) {
        var lines = '';
        if (i === 0) lines += '<p class="text-small font-semibold">Most profitable</p>';
        else if (i === week.length - 1) lines += '<p class="text-small font-semibold">Least profitable</p>';
        if (w.weekCostChangeCents > 0) {
          lines += '<p class="text-small text-accent">Cost up ' + money(w.weekCostChangeCents) + ' since Monday</p>';
        }
        var per = w.profitCents < 0
          ? 'You lose ' + money(-w.profitCents) + ' per item'
          : money(w.profitCents) + ' per item';
        return '<li class="list-row justify-between"><div class="min-w-0 flex-1">' +
          '<p class="truncate text-body font-medium">' + esc(w.name) + '</p>' + lines + '</div>' +
          '<div class="shrink-0 text-right"><p class="text-body font-semibold tabular-nums' + (w.belowGoal ? ' text-danger' : '') + '">' + w.marginPct + '%</p>' +
          '<p class="text-small text-muted tabular-nums">' + per + '</p></div></li>';
      }).join('') + '</ul></section>';
  }

  function renderItem(id) {
    var existing = id != null;
    app.innerHTML = pricesSkeleton();
    var load = existing
      ? Promise.all([me ? Promise.resolve(me) : loadMe(), api('/api/products/' + id + '?today=' + today())])
      : (me ? Promise.resolve(me) : loadMe()).then(function (m) { return [m, null]; });
    load.then(function (r) { drawItem(r[0], r[1], existing); }).catch(function (err) {
      if (err.status === 404) {
        app.innerHTML = '<div class="state-error card"><p class="text-heading">That item is not in your book</p>' +
          '<p class="text-body text-muted">It may belong to someone else, or the link is old.</p>' +
          '<a href="' + href('/prices') + '" data-nav="/prices" class="btn-primary mt-2">Back to prices</a></div>';
        return;
      }
      errorState(err.message, function () { renderItem(id); }, 'Could not load your prices');
    });
  }

  function priceHistory(history) {
    if (!history || !history.length) return '';
    return '<section id="price-history"><h2 class="section-label">Price history</h2><ul class="list">' +
      history.map(function (h) {
        var prof = h.profitCents < 0
          ? 'You lose ' + money(-h.profitCents) + ' per item'
          : 'Profit ' + money(h.profitCents) + ' per item';
        return '<li class="list-row">' + stamp(h.date) +
          '<div class="min-w-0 flex-1"><p class="text-body font-medium tabular-nums">Cost ' + money(h.costCents) + ', sold at ' + money(h.sellCents) + '</p>' +
          '<p class="text-small text-muted tabular-nums">' + prof + '</p></div>' +
          '<p class="shrink-0 text-body font-semibold tabular-nums' + (h.belowGoal ? ' text-danger' : '') + '">' + h.marginPct + '%</p></li>';
      }).join('') + '</ul></section>';
  }

  function drawItem(m, data, existing) {
    var p = existing ? data.product : null;
    var s = {
      costs: p ? p.costs.map(function (c) { return { name: c.name, amount: String(c.cents / 100) }; })
              : [{ name: 'Ingredients', amount: '' }, { name: 'Packaging', amount: '' }, { name: 'Gas', amount: '' }],
      batchSize: p ? String(p.batchSize) : '1',
      goal: p ? String(p.goalPct) : '20',
      sell: p ? String(p.sellCents / 100) : '',
      // A new item takes the suggestion until the person types their own
      // price; an existing one keeps its saved price.
      sellTouched: !!p,
      suggested: 0,
    };

    var warn = '';
    if (p && p.belowGoal) {
      var rise = p.costRoseCents > 0
        ? 'Your costs went up from ' + money(p.costCents - p.costRoseCents) + ' to ' + money(p.costCents) + ' per item. '
        : '';
      warn = '<div class="rounded-lg border border-danger px-3 py-3 text-body" id="item-warning" role="alert">' +
        '<p class="font-semibold text-danger">Below your profit goal</p>' +
        '<p>' + rise + 'At your price of <strong class="tabular-nums">' + money(p.sellCents) + '</strong> ' +
        profitWords(p.profitCents).toLowerCase() + ' per item (' + p.marginPct + '%). Your goal is ' + p.goalPct + '%.</p></div>';
    }

    app.innerHTML = backBar(p ? p.name : 'Add an item', null, '/prices') + demoNote() + warn +
      '<form id="item-form" class="flex flex-col gap-5" novalidate>' +
      '<div class="flex flex-col gap-2"><label for="item-name" class="text-body font-medium">Item name</label>' +
      '<input id="item-name" class="field" maxlength="80" value="' + esc(p ? p.name : '') + '" placeholder="e.g. Iced tea"></div>' +
      '<fieldset class="flex flex-col gap-2"><legend class="mb-2 text-body font-medium">Costs</legend>' +
      '<p class="text-small text-muted">What you paid for one batch.</p>' +
      '<div class="flex gap-2 px-1 text-small text-muted"><span class="min-w-0 flex-1">Cost</span>' +
      '<span class="w-28 shrink-0">You paid</span><span class="w-11 shrink-0"></span></div>' +
      '<div id="cost-rows" class="flex flex-col gap-2"></div>' +
      '<button type="button" class="btn-secondary" id="add-cost">' + icon('plus', 'h-5 w-5') + 'Add another cost</button></fieldset>' +
      '<div class="grid grid-cols-2 gap-3">' +
      '<div class="flex flex-col gap-2"><label for="batch-size" class="text-body font-medium">Items it makes</label>' +
      '<input id="batch-size" class="field tabular-nums" inputmode="numeric" value="' + esc(s.batchSize) + '"></div>' +
      '<div class="flex flex-col gap-2"><label for="goal" class="text-body font-medium">Profit goal (%)</label>' +
      '<input id="goal" class="field tabular-nums" inputmode="numeric" value="' + esc(s.goal) + '"></div></div>' +
      '<p class="text-small text-muted" id="cost-per"></p>' +
      '<div class="rounded-lg bg-raised px-3 py-3" id="price-result"></div>' +
      '<div class="flex flex-col gap-2"><label for="sell" class="text-body font-medium">Your selling price</label>' +
      '<div class="grid grid-cols-2 gap-2">' +
      '<input id="sell" class="field text-heading tabular-nums" inputmode="decimal" value="' + esc(s.sell) + '">' +
      '<button type="button" class="btn-secondary" id="use-suggested">Use</button></div>' +
      '<p class="text-small text-muted" id="live-readout"></p></div>' +
      errorBox +
      '<button type="submit" class="btn-primary min-h-14 text-heading" id="save-item">' +
      (existing ? 'Save new prices' : 'Save item') + '</button></form>' +
      (existing ? priceHistory(data.history) : '');

    var useBtn = document.getElementById('use-suggested');

    function drawCostRows() {
      var box = document.getElementById('cost-rows');
      box.innerHTML = s.costs.map(function (c, i) {
        return '<div class="flex items-center gap-2">' +
          '<input class="field min-w-0 flex-1" maxlength="40" value="' + esc(c.name) + '" data-cost-name="' + i + '" aria-label="Cost name">' +
          '<input class="field w-28 shrink-0 tabular-nums" inputmode="decimal" value="' + esc(c.amount) + '" data-cost-amount="' + i + '" aria-label="You paid" placeholder="e.g. 54000">' +
          '<button type="button" class="btn-secondary shrink-0 px-0' + (s.costs.length === 1 ? ' hidden' : '') + '" data-remove="' + i + '" aria-label="Remove ' + esc(c.name) + '">' + icon('x', 'h-5 w-5') + '</button></div>';
      }).join('');
    }
    drawCostRows();

    var rows = document.getElementById('cost-rows');
    rows.addEventListener('input', function (e) {
      var t = e.target, i = Number(t.getAttribute('data-cost-name') || t.getAttribute('data-cost-amount'));
      if (t.getAttribute('data-cost-name') != null) s.costs[i].name = t.value;
      else if (t.getAttribute('data-cost-amount') != null) s.costs[i].amount = t.value;
      if (!Number.isNaN(i)) recalc();
    });
    rows.addEventListener('click', function (e) {
      var b = e.target.closest('[data-remove]');
      if (!b) return;
      s.costs.splice(Number(b.getAttribute('data-remove')), 1);
      drawCostRows();
      recalc();
    });
    document.getElementById('add-cost').addEventListener('click', function () {
      if (s.costs.length >= 12) return;
      s.costs.push({ name: '', amount: '' });
      drawCostRows();
      var last = rows.querySelector('[data-cost-name="' + (s.costs.length - 1) + '"]');
      if (last) last.focus();
    });

    function recalc() {
      s.batchSize = document.getElementById('batch-size').value;
      s.goal = document.getElementById('goal').value;
      var batch = Math.round(num(s.batchSize));
      var goal = Math.round(num(s.goal));
      var sum = 0;
      s.costs.forEach(function (c) {
        var v = num(c.amount);
        if (v > 0) sum += Math.round(v * 100);
      });
      var costPer = batch >= 1 && sum > 0 ? Math.round(sum / batch) : 0;
      var goalOk = goal >= 0 && goal <= 90;
      s.suggested = costPer > 0 && goalOk ? suggestedPrice(costPer, goal) : 0;
      document.getElementById('cost-per').innerHTML = costPer > 0
        ? 'Cost per item: <strong class="text-fg tabular-nums">' + money(costPer) + '</strong>' : '';
      var result = document.getElementById('price-result');
      if (s.suggested > 0) {
        result.innerHTML = '<p class="text-small font-medium text-muted">Suggested price</p>' +
          '<p class="text-title tabular-nums">' + money(s.suggested) + '</p>' +
          '<p class="text-small text-muted">Profit per item at that price: ' + money(s.suggested - costPer) + ' (' + goal + '%)</p>';
        useBtn.textContent = 'Use ' + money(s.suggested);
        useBtn.disabled = false;
        if (!s.sellTouched) {
          s.sell = String(s.suggested / 100);
          document.getElementById('sell').value = s.sell;
        }
      } else {
        result.innerHTML = '<p class="text-small text-muted">Enter your costs to see it.</p>';
        useBtn.textContent = 'Use';
        useBtn.disabled = true;
      }
      var readout = document.getElementById('live-readout');
      var sellC = Math.round(num(s.sell) * 100);
      if (sellC > 0 && costPer > 0 && goalOk) {
        var f = priceFacts(costPer, sellC, goal);
        readout.textContent = 'At ' + money(sellC) + ' ' + profitWords(f.profitCents).toLowerCase() +
          ' per item (' + f.marginPct + '%)' + (f.belowGoal ? ', below your goal.' : '.');
        readout.className = f.belowGoal ? 'text-small text-danger' : 'text-small text-muted';
      } else {
        readout.textContent = '';
        readout.className = 'text-small text-muted';
      }
    }
    ['batch-size', 'goal', 'sell'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function (e) {
        if (id === 'sell') { s.sell = e.target.value; s.sellTouched = true; }
        recalc();
      });
    });
    useBtn.addEventListener('click', function () {
      if (!s.suggested) return;
      s.sellTouched = true;
      s.sell = String(s.suggested / 100);
      document.getElementById('sell').value = s.sell;
      recalc();
    });

    document.getElementById('item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = document.getElementById('save-item');
      btn.disabled = true;
      var body = {
        name: document.getElementById('item-name').value,
        goalPct: Math.round(num(s.goal)),
        batchSize: Math.round(num(s.batchSize)),
        costs: s.costs.map(function (c) { return { name: c.name, amount: num(c.amount) }; }),
        sell: num(s.sell),
        date: today(),
      };
      // A demo save copies the item into the person's own book, so it is
      // always a POST; a saved item of their own is an update.
      var put = existing && !(m && m.demo);
      var req = put
        ? api('/api/products/' + p.id, { method: 'PUT', body: body })
        : api('/api/products', { method: 'POST', body: body });
      req.then(function () {
        saved(put ? 'Prices saved' : 'Item saved', '/prices');
      }).catch(function (err) {
        btn.disabled = false;
        formError(err.message);
      });
    });

    recalc();
  }

  // ── Profile ──────────────────────────────────────────────────────────────
  function renderProfile() {
    app.innerHTML = '<div class="flex flex-col gap-4" aria-busy="true"><div class="skeleton h-11 w-48"></div><div class="skeleton h-24 w-24 rounded-full"></div><div class="skeleton h-40 w-full"></div></div>';
    loadMe().then(drawProfile).catch(function (err) { errorState(err.message, renderProfile); });
  }

  function drawProfile() {
    var p = me.profile || {};
    var s = { photoUrl: p.photo_url || null };
    function photoHtml() {
      return s.photoUrl
        ? '<img src="' + esc(s.photoUrl) + '" alt="Your photo" class="h-24 w-24 rounded-full object-cover">'
        : '<span class="flex h-24 w-24 items-center justify-center rounded-full bg-raised text-muted">' + icon('user', 'h-10 w-10') + '</span>';
    }
    app.innerHTML = backBar('Your profile') + demoNote() +
      '<form id="profile-form" class="flex flex-col gap-5" novalidate>' +
      '<div class="flex items-center gap-4"><div id="photo-preview">' + photoHtml() + '</div>' +
        '<label class="btn-secondary cursor-pointer">' + icon('camera', 'h-5 w-5') + '<span id="photo-label">' + (s.photoUrl ? 'Change photo' : 'Add a photo') + '</span>' +
        '<input type="file" id="photo" accept="image/png,image/jpeg,image/webp,image/gif" class="sr-only"></label></div>' +
      '<p class="text-small text-danger" id="photo-error" hidden></p>' +
      '<div class="flex flex-col gap-2"><label for="name" class="text-body font-medium">Your name</label>' +
        '<input id="name" class="field" maxlength="80" autocomplete="name" value="' + esc(p.name || '') + '"></div>' +
      '<div class="flex flex-col gap-2"><label for="occupation" class="text-body font-medium">Your work</label>' +
        '<select id="occupation" class="field"><option value="">Choose one</option>' +
        me.occupations.map(function (o) { return '<option' + (p.occupation === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
        '</select></div>' +
      '<div class="flex flex-col gap-2"><label for="location" class="text-body font-medium">Town or city</label>' +
        '<input id="location" class="field" maxlength="120" value="' + esc(p.location || '') + '" placeholder="e.g. Bandung"></div>' +
      errorBox +
      '<button type="submit" class="btn-primary min-h-14 text-heading">Save profile</button></form>';

    document.getElementById('photo').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var label = document.getElementById('photo-label'), pe = document.getElementById('photo-error');
      label.textContent = 'Uploading…'; pe.hidden = true;
      uploadPhoto(file).then(function (url) {
        s.photoUrl = url;
        document.getElementById('photo-preview').innerHTML = photoHtml();
        label.textContent = 'Change photo';
      }).catch(function (err) {
        label.textContent = s.photoUrl ? 'Change photo' : 'Add a photo';
        pe.textContent = err.message; pe.hidden = false;
      });
    });
    document.getElementById('profile-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = app.querySelector('#profile-form [type=submit]');
      btn.disabled = true;
      api('/api/profile', { method: 'PUT', body: {
        name: document.getElementById('name').value,
        occupation: document.getElementById('occupation').value,
        location: document.getElementById('location').value,
        photoUrl: s.photoUrl,
      } }).then(function (d) {
        me.profile = d.profile;
        saved('Profile saved');
      }).catch(function (err) { btn.disabled = false; formError(err.message); });
    });
  }

  render();
})();

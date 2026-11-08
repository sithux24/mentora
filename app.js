(function () {
  'use strict';
  const L = window.Lib, esc = L.esc;
  const KEY = 'mentora.v1';
  const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#e11d48', '#7c3aed', '#0d9488', '#ea580c'];
  const PRESETS = ['Combined Maths', 'Physics', 'Chemistry', 'Biology', 'ICT', 'Economics', 'Accounting', 'English', 'Mathematics', 'Science'];
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------------- state ---------------- */
  const def = () => ({
    profile: { name: '', examDate: '', level: 'A/L' },
    settings: { key: '', model: 'gemini-flash-latest', lang: 'en-US', speak: false, theme: 'auto' },
    goal: 120, mode: 'hints', tutorSubject: '',
    subjects: [], sessions: [], marks: [], tasks: [], quizzes: [], chat: [], plan: null, timer: null, tutor: null
  });
  function load() {
    const d = def();
    try {
      const r = JSON.parse(localStorage.getItem(KEY));
      if (r) return Object.assign(d, r, { profile: Object.assign(d.profile, r.profile), settings: Object.assign(d.settings, r.settings) });
    } catch (e) { /* first run or blocked */ }
    return d;
  }
  let S = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S, (k, v) => (k === 'data' ? undefined : v))); }
    catch (e) { toast('Could not save (storage full or blocked)'); }
  }

  /* ---------------- helpers ---------------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const fmtMin = m => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');
  const minsOn = d => S.sessions.filter(x => x.date === d).reduce((a, b) => a + b.min, 0);
  const subj = id => S.subjects.find(s => s.id === id);
  const sname = id => (subj(id) ? subj(id).name : 'General');
  const scolor = id => (subj(id) ? subj(id).color : '#64748b');
  const pct = m => (m.max ? Math.round((m.score / m.max) * 1000) / 10 : 0);
  function streak() {
    let d = today(), n = 0;
    if (!minsOn(d)) d = addDays(d, -1);
    while (minsOn(d) > 0) { n++; d = addDays(d, -1); }
    return n;
  }
  function avgMark(id) {
    const ms = S.marks.filter(m => !id || m.subjectId === id);
    return ms.length ? Math.round(ms.reduce((a, m) => a + pct(m), 0) / ms.length) : null;
  }
  function weakTopics() {
    const by = {};
    S.quizzes.slice(-30).forEach(q => { const k = q.topic + '|' + q.subjectId; (by[k] = by[k] || []).push(q.score / q.total * 100); });
    return Object.entries(by).map(([k, v]) => ({ topic: k.split('|')[0], subjectId: k.split('|')[1], avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length) }))
      .filter(x => x.avg < 60).sort((a, b) => a.avg - b.avg);
  }
  const opts = (sel, withAll) => (withAll ? '<option value="">General</option>' : '') +
    S.subjects.map(s => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  const md = t => L.md(t, window.katex);
  let toastTimer;
  function toast(m) {
    const t = $('#toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  const go = v => { location.hash = '#/' + v; };

  /* ---------------- Gemini ---------------- */
  let abortCtl = null;
  function friendly(status, msg) {
    if (status === 400 && /API key/i.test(msg)) return 'Your API key looks invalid. Check it in Settings.';
    if (status === 403) return 'The API key was rejected (403). Check it in Settings.';
    if (status === 404) return 'That model name was not found. Pick another model in Settings.';
    if (status === 429) return 'Free quota reached for now. Wait a minute (or until tomorrow) and try again, or switch model in Settings.';
    if (status >= 500) return 'The AI service is busy. Please try again in a moment.';
    return msg || 'Request failed (' + status + ')';
  }
  async function listModels(key) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new Error(friendly(r.status, ''));
    const j = await r.json();
    const ver = n => parseFloat((n.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    const rank = n => (/flash-lite/.test(n) ? 1 : /flash/.test(n) ? 0 : 2);
    const pre = n => (/preview|exp/.test(n) ? 1 : 0);
    return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, '')).filter(n => /^gemini-/.test(n) && !/tts|image|live|audio|embed|robotics|computer|vision|native|thinking/.test(n))
      .sort((x, y) => (rank(x) - rank(y)) || (pre(x) - pre(y)) || (ver(y) - ver(x)));
  }
  async function gem(o) {
    const key = S.settings.key.trim();
    if (!key) throw new Error('Add your free Gemini API key in Settings first.');
    const model = o.model || S.settings.model || 'gemini-flash-latest';
    const body = { contents: o.contents, generationConfig: { temperature: o.temp ?? 0.5 } };
    if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
    if (o.json) body.generationConfig.responseMimeType = 'application/json';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) +
      (o.stream ? ':streamGenerateContent?alt=sse' : ':generateContent');
    const doFetch = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: o.signal });
    let r = await doFetch();
    if (r.status === 503) { await new Promise(s => setTimeout(s, 1500)); r = await doFetch(); }
    if (r.status === 404 && !o.retried) {
      const names = await listModels(key).catch(() => []);
      for (const c of names.filter(n => n !== model).slice(0, 5)) {
        try {
          const out = await gem(Object.assign({}, o, { model: c, retried: true }));
          S.settings.model = c; save(); toast('Switched to model ' + c); return out;
        } catch (e) { if (!/not found/i.test(e.message)) throw e; }
      }
      throw new Error('That model was not found, and no other model worked. Models your key lists: ' + (names.slice(0, 8).join(', ') || 'none') + '. Type one into Settings → Model.');
    }
    if (!r.ok) { let m = ''; try { m = (await r.json()).error.message; } catch (e) { /* ignore */ } throw new Error(friendly(r.status, m)); }
    const textOf = j => {
      const c = j.candidates && j.candidates[0];
      if (!c) { const b = j.promptFeedback && j.promptFeedback.blockReason; if (b) throw new Error('The request was blocked (' + b + ').'); return ''; }
      return (c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '');
    };
    if (!o.stream) return textOf(await r.json());
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (!p || p === '[DONE]') continue;
        try { full += textOf(JSON.parse(p)); o.onChunk && o.onChunk(full); } catch (e) { if (e.message && /blocked/.test(e.message)) throw e; }
      }
    }
    return full;
  }
  const ask = (prompt, system) => gem({ system, contents: [{ role: 'user', parts: [{ text: prompt }] }] });

  function studentContext() {
    const subs = S.subjects.map(s => {
      const ms = S.marks.filter(m => m.subjectId === s.id).sort((a, b) => a.date.localeCompare(b.date)).slice(-3).map(m => pct(m) + '%');
      const wk = [...Array(7)].reduce((a, _, i) => a + S.sessions.filter(x => x.subjectId === s.id && x.date === addDays(today(), -i)).reduce((q, w) => q + w.min, 0), 0);
      return `${s.name} (target ${s.target}%${ms.length ? ', recent marks ' + ms.join(', ') : ''}, ${fmtMin(wk)} studied in last 7 days)`;
    }).join('; ') || 'no subjects added yet';
    const open = S.tasks.filter(t => !t.done).slice(0, 8).map(t => t.title + (t.due ? ' (due ' + t.due + ')' : '')).join('; ') || 'none';
    const weak = weakTopics().slice(0, 5).map(w => `${w.topic} (${w.avg}% in quizzes)`).join('; ') || 'none yet';
    let exam = '';
    if (S.profile.examDate) { const d = Math.ceil((new Date(S.profile.examDate + 'T00:00') - new Date()) / 864e5); if (d >= 0) exam = `Exam in ${d} days. `; }
    return `Student: ${S.profile.name || 'unnamed'}, level ${S.profile.level}. ${exam}Subjects: ${subs}. Open tasks: ${open}. Weak quiz topics: ${weak}. Study streak: ${streak()} days; today ${fmtMin(minsOn(today()))} of ${S.goal} min goal.`;
  }
  function tutorSystem() {
    const sub = S.tutorSubject ? sname(S.tutorSubject) : 'any subject';
    const mode = S.mode === 'hints'
      ? 'MODE = SOCRATIC HINTS: do not reveal the final answer at first. Give one short hint or one guiding question at a time, let the student try, praise correct steps, and only give a full solution if they ask for it or are stuck after two attempts.'
      : 'MODE = FULL WORKED SOLUTION: give a complete, numbered, step-by-step solution with the reason for each step, state the final answer clearly, then add a one-line check (substitute back / sanity check) and the common mistake to avoid.';
    return `You are Mentora, a patient, accurate expert tutor for ${S.profile.level} students (Sri Lankan A/L and O/L, also IB and A-Level). Current subject: ${sub}.
${mode}
Rules:
- Write maths in LaTeX: inline $...$ and display $$...$$. Never use plain-text fractions for hard expressions.
- To draw a graph, output a fenced block with the language "plot": one expression in x per line (e.g. x^2-3x+2, sin(x)), optionally "range: -5,5" and "yrange: -3,3". Use it whenever a picture helps.
- Double-check every calculation before stating it. If you are unsure, say so.
- If the student uploads a photo or PDF of their working, read it carefully, go line by line, say what is right, and point to the first mistake and why.
- Keep replies focused and not too long. Match the student's language (English, Sinhala or Tamil).
- Be encouraging. Finish with a short next step or question when helpful.
Student context (use it to personalise, do not recite it): ${studentContext()}`;
  }

  /* ---------------- views ---------------- */
  const NAV = [['dashboard', '🏠', 'Home'], ['tutor', '🎓', 'Tutor'], ['study', '⏱️', 'Study'], ['marks', '📊', 'Marks'], ['tasks', '✅', 'Tasks'], ['quiz', '🧠', 'Quiz'], ['subjects', '📚', 'Subjects'], ['settings', '⚙️', 'Settings']];
  const route = () => location.hash.replace(/^#\/?/, '') || 'dashboard';
  const VIEWS = {}, AFTER = {};

  /* ---- dashboard ---- */
  VIEWS.dashboard = () => {
    const t = today(), tm = minsOn(t), g = S.goal || 120;
    const week = [...Array(7)].map((_, i) => { const d = addDays(t, i - 6); return { d, m: minsOn(d) }; });
    const mw = Math.max(60, ...week.map(w => w.m));
    const wtotal = week.reduce((a, w) => a + w.m, 0);
    const start = addDays(t, -((new Date().getDay() + 6) % 7) - 77);
    let cells = '';
    for (let i = 0; i < 84; i++) {
      const d = addDays(start, i), m = minsOn(d);
      const lv = d > t ? 'f' : m === 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4;
      cells += `<i class="hm l${lv}" title="${d}: ${fmtMin(m)}"></i>`;
    }
    const greet = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
    const avg = avgMark();
    const subjRows = S.subjects.map(s => {
      const a = avgMark(s.id), w = week.reduce((q, x) => q + S.sessions.filter(z => z.subjectId === s.id && z.date === x.d).reduce((p, r) => p + r.min, 0), 0);
      return `<div class="srow"><b style="color:${s.color}">${esc(s.name)}</b><div class="bar"><span style="width:${Math.min(100, a || 0)}%;background:${s.color}"></span><u style="left:${s.target}%"></u></div><small>${a == null ? '–' : a + '%'} / target ${s.target}% · ${fmtMin(w)} this week</small></div>`;
    }).join('');
    const overdue = S.tasks.filter(x => !x.done && x.due && x.due < t).length;
    return `
    <header class="top"><div><h1>${greet}${S.profile.name ? ', ' + esc(S.profile.name) : ''} 👋</h1><p class="muted">Track your study, then let the AI tutor close the gaps.</p></div></header>
    ${S.subjects.length ? '' : `<section class="card hero"><h3>Start here</h3><p>Add your subjects, then add your free Gemini key in <a href="#/settings">Settings</a> to unlock the tutor.</p><div class="chips">${PRESETS.map(p => `<button class="chip" data-act="quickSubject" data-name="${esc(p)}">+ ${esc(p)}</button>`).join('')}</div></section>`}
    <div class="grid stats">
      <div class="card stat"><small>Today</small><b>${fmtMin(tm)}</b><div class="bar"><span style="width:${Math.min(100, tm / g * 100)}%"></span></div><small>goal ${fmtMin(g)}</small></div>
      <div class="card stat"><small>Streak</small><b>🔥 ${streak()}</b><small>days in a row</small></div>
      <div class="card stat"><small>Average mark</small><b>${avg == null ? '–' : avg + '%'}</b><small>${avg == null ? 'add a mark' : L.grade(avg) + ' grade'}</small></div>
      <div class="card stat"><small>This week</small><b>${fmtMin(wtotal)}</b><small>${overdue ? '⚠️ ' + overdue + ' overdue task' + (overdue > 1 ? 's' : '') : 'no overdue tasks'}</small></div>
    </div>
    ${S.profile.examDate ? `<section class="card cd"><small>⏳ Exam countdown · ${esc(S.profile.examDate)}</small><div id="cd" class="cdgrid"></div></section>` : `<section class="card muted">Set your exam date in <a href="#/settings">Settings</a> to see a live countdown.</section>`}
    <div class="grid two">
      <section class="card"><h3>Last 7 days</h3><div class="wk">${week.map(w => `<div><span style="height:${Math.round(w.m / mw * 100)}%"></span><small>${['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(w.d + 'T00:00').getDay()]}</small></div>`).join('')}</div></section>
      <section class="card"><h3>Consistency (12 weeks)</h3><div class="heat">${cells}</div></section>
    </div>
    <section class="card"><h3>Subjects</h3>${subjRows || '<p class="muted">No subjects yet.</p>'}</section>
    <section class="card"><div class="row between"><h3>✨ AI plan for today</h3><button class="btn" data-act="plan">${S.plan && S.plan.date === t ? 'Refresh' : 'Plan my day'}</button></div>
      <div id="plan" class="md">${S.plan && S.plan.date === t ? md(S.plan.text) : '<p class="muted">The tutor reads your marks, tasks and weak topics and builds a realistic plan.</p>'}</div></section>`;
  };
  AFTER.dashboard = () => { tickCountdown(); };
  let cdTimer;
  function tickCountdown() {
    clearInterval(cdTimer);
    const el = $('#cd'); if (!el || !S.profile.examDate) return;
    const f = () => {
      const e = $('#cd'); if (!e) return clearInterval(cdTimer);
      let ms = Math.max(0, new Date(S.profile.examDate + 'T00:00') - new Date());
      const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
      e.innerHTML = [[d, 'days'], [h, 'hrs'], [m, 'min'], [s, 'sec']].map(([n, l]) => `<div><b>${pad(n)}</b><small>${l}</small></div>`).join('');
    };
    f(); cdTimer = setInterval(f, 1000);
  }

  /* ---- study ---- */
  VIEWS.study = () => {
    const rows = [...S.sessions].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).slice(0, 40);
    return `<header class="top"><h1>Study log</h1></header>
    <section class="card"><h3>Timer</h3>
      <div class="row wrap"><select id="tsub">${opts(S.timer && S.timer.subjectId, true)}</select>
      <div id="clock" class="clock">00:00:00</div>
      <button class="btn ${S.timer ? 'danger' : 'primary'}" data-act="${S.timer ? 'timerStop' : 'timerStart'}">${S.timer ? '■ Stop & save' : '▶ Start'}</button></div></section>
    <section class="card"><h3>Add a session manually</h3>
      <form data-form="session" class="fgrid">
        <label>Subject<select name="subjectId">${opts('', true)}</select></label>
        <label>Minutes<input name="min" type="number" min="1" max="720" required value="45"></label>
        <label>Date<input name="date" type="date" value="${today()}" required></label>
        <label class="wide">Notes<input name="note" placeholder="What did you cover?"></label>
        <button class="btn primary">Add session</button></form></section>
    <section class="card"><h3>Recent sessions</h3>${rows.length ? `<div class="list">${rows.map(r => `<div class="item"><i class="dot" style="background:${scolor(r.subjectId)}"></i><div><b>${esc(sname(r.subjectId))}</b> · ${fmtMin(r.min)}<small>${r.date}${r.note ? ' · ' + esc(r.note) : ''}</small></div><button class="x" data-act="delSession" data-id="${r.id}" aria-label="Delete">✕</button></div>`).join('')}</div>` : '<p class="muted">Nothing logged yet.</p>'}</section>`;
  };
  let clockTimer;
  AFTER.study = () => {
    clearInterval(clockTimer);
    const f = () => {
      const c = $('#clock'); if (!c) return clearInterval(clockTimer);
      const s = S.timer ? Math.floor((Date.now() - S.timer.start) / 1000) : 0;
      c.textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    };
    f(); clockTimer = setInterval(f, 1000);
  };

  /* ---- marks ---- */
  function lineChart() {
    const series = S.subjects.map(s => ({ s, pts: S.marks.filter(m => m.subjectId === s.id).sort((a, b) => a.date.localeCompare(b.date)).map(m => [new Date(m.date + 'T00:00').getTime(), pct(m)]) })).filter(x => x.pts.length);
    if (!series.length) return '<p class="muted">Add marks to see your progress chart.</p>';
    const all = series.flatMap(x => x.pts.map(p => p[0]));
    const t0 = Math.min(...all), t1 = Math.max(...all, t0 + 864e5);
    const W = 520, H = 220, p = 28;
    const sx = t => p + (t - t0) / (t1 - t0) * (W - 2 * p), sy = v => H - p - v / 100 * (H - 2 * p);
    let g = [0, 25, 50, 75, 100].map(v => `<line x1="${p}" x2="${W - p}" y1="${sy(v)}" y2="${sy(v)}" class="gl"/><text x="${p - 4}" y="${sy(v) + 3}" text-anchor="end" class="gt">${v}</text>`).join('');
    series.forEach(x => {
      g += `<line x1="${p}" x2="${W - p}" y1="${sy(x.s.target)}" y2="${sy(x.s.target)}" stroke="${x.s.color}" stroke-dasharray="3 4" opacity=".35"/>`;
      g += `<path d="${x.pts.map((q, i) => (i ? 'L' : 'M') + sx(q[0]).toFixed(1) + ' ' + sy(q[1]).toFixed(1)).join(' ')}" fill="none" stroke="${x.s.color}" stroke-width="2.2"/>`;
      g += x.pts.map(q => `<circle cx="${sx(q[0]).toFixed(1)}" cy="${sy(q[1]).toFixed(1)}" r="3.5" fill="${x.s.color}"/>`).join('');
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Marks over time">${g}</svg><div class="legend">${series.map(x => `<span><i style="background:${x.s.color}"></i>${esc(x.s.name)}</span>`).join('')}<span class="muted">dashed = target</span></div>`;
  }
  VIEWS.marks = () => {
    const rows = [...S.marks].sort((a, b) => b.date.localeCompare(a.date));
    return `<header class="top"><h1>Marks</h1></header>
    <section class="card"><h3>Progress</h3>${lineChart()}</section>
    <section class="card"><h3>Add a result</h3>${S.subjects.length ? `<form data-form="mark" class="fgrid">
      <label>Subject<select name="subjectId" required>${opts('')}</select></label>
      <label>Exam / paper<input name="name" placeholder="Term test 1" required></label>
      <label>Score<input name="score" type="number" step="0.1" min="0" required></label>
      <label>Out of<input name="max" type="number" step="0.1" min="1" value="100" required></label>
      <label>Date<input name="date" type="date" value="${today()}" required></label>
      <button class="btn primary">Save result</button></form>` : '<p class="muted">Add a subject first.</p>'}</section>
    <section class="card"><div class="row between"><h3>Results</h3><button class="btn" data-act="analyse">✨ Analyse my marks</button></div>
      <div id="analysis" class="md"></div>
      ${rows.length ? `<div class="list">${rows.map(m => `<div class="item"><i class="dot" style="background:${scolor(m.subjectId)}"></i><div><b>${esc(m.name)}</b> · ${esc(sname(m.subjectId))}<small>${m.date} · ${m.score}/${m.max}</small></div><span class="gr g${L.grade(pct(m))}">${pct(m)}% · ${L.grade(pct(m))}</span><button class="x" data-act="delMark" data-id="${m.id}" aria-label="Delete">✕</button></div>`).join('')}</div>` : '<p class="muted">No results yet.</p>'}</section>`;
  };

  /* ---- tasks ---- */
  VIEWS.tasks = () => {
    const t = today(), po = { high: 0, med: 1, low: 2 };
    const rows = [...S.tasks].sort((a, b) => (a.done - b.done) || (po[a.pri] - po[b.pri]) || ((a.due || '9') .localeCompare(b.due || '9')));
    return `<header class="top"><h1>Tasks</h1></header>
    <section class="card"><form data-form="task" class="fgrid">
      <label class="wide">Task<input name="title" placeholder="Past paper 2019 – Paper II" required></label>
      <label>Subject<select name="subjectId">${opts('', true)}</select></label>
      <label>Priority<select name="pri"><option value="high">High</option><option value="med" selected>Medium</option><option value="low">Low</option></select></label>
      <label>Due<input name="due" type="date"></label>
      <button class="btn primary">Add task</button></form></section>
    <section class="card">${rows.length ? `<div class="list">${rows.map(k => `<div class="item ${k.done ? 'done' : ''}"><input type="checkbox" data-act="toggleTask" data-id="${k.id}" ${k.done ? 'checked' : ''} aria-label="Done"><div><b>${esc(k.title)}</b><small><span class="pri ${k.pri}">${k.pri}</span> ${esc(sname(k.subjectId))}${k.due ? ' · due ' + k.due + (!k.done && k.due < t ? ' <em class="late">overdue</em>' : '') : ''}</small></div><button class="x" data-act="delTask" data-id="${k.id}" aria-label="Delete">✕</button></div>`).join('')}</div>` : '<p class="muted">No tasks yet.</p>'}</section>`;
  };

  /* ---- subjects ---- */
  VIEWS.subjects = () => `<header class="top"><h1>Subjects</h1></header>
    <section class="card"><form data-form="subject" class="fgrid">
      <label>Name<input name="name" required placeholder="Physics"></label>
      <label>Target %<input name="target" type="number" min="1" max="100" value="75" required></label>
      <label>Colour<input name="color" type="color" value="${COLORS[S.subjects.length % COLORS.length]}"></label>
      <button class="btn primary">Add subject</button></form>
      <div class="chips">${PRESETS.filter(p => !S.subjects.some(s => s.name === p)).map(p => `<button class="chip" data-act="quickSubject" data-name="${esc(p)}">+ ${esc(p)}</button>`).join('')}</div></section>
    <section class="card">${S.subjects.length ? `<div class="list">${S.subjects.map(s => {
      const tot = S.sessions.filter(x => x.subjectId === s.id).reduce((a, b) => a + b.min, 0), a = avgMark(s.id);
      return `<div class="item"><i class="dot" style="background:${s.color}"></i><div><b>${esc(s.name)}</b><small>target ${s.target}% · avg ${a == null ? '–' : a + '%'} · ${fmtMin(tot)} studied</small></div><button class="x" data-act="delSubject" data-id="${s.id}" aria-label="Delete">✕</button></div>`;
    }).join('')}</div>` : '<p class="muted">No subjects yet.</p>'}</section>`;

  /* ---- settings ---- */
  VIEWS.settings = () => `<header class="top"><h1>Settings</h1></header>
    <section class="card"><h3>You</h3><form data-form="profile" class="fgrid">
      <label>Name<input name="name" value="${esc(S.profile.name)}"></label>
      <label>Level<select name="level">${['A/L', 'O/L', 'Grade 5 Scholarship', 'IB', 'A-Level', 'IGCSE', 'University'].map(x => `<option${x === S.profile.level ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Exam date<input name="examDate" type="date" value="${esc(S.profile.examDate)}"></label>
      <label>Daily goal (min)<input name="goal" type="number" min="15" max="720" value="${S.goal}"></label>
      <button class="btn primary">Save</button></form></section>
    <section class="card"><h3>AI tutor</h3>
      <p class="muted">The tutor uses Google Gemini. Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> and paste it here. It is stored only in this browser and sent only to Google.</p>
      <form data-form="ai" class="fgrid">
        <label class="wide">Gemini API key<input name="key" type="password" autocomplete="off" value="${esc(S.settings.key)}" placeholder="AIza..."></label>
        <label>Model<input name="model" list="models" value="${esc(S.settings.model)}"></label>
        <datalist id="models"><option>gemini-flash-latest</option><option>gemini-3.8-flash</option><option>gemini-3.6-flash</option><option>gemini-3.5-flash-lite</option><option>gemini-3.1-flash-lite</option></datalist>
        <label>Voice language<select name="lang">${[['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['si-LK', 'Sinhala'], ['ta-LK', 'Tamil']].map(([v, n]) => `<option value="${v}"${v === S.settings.lang ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="speak" ${S.settings.speak ? 'checked' : ''}> Read replies aloud automatically</label>
        <button class="btn primary">Save</button><button type="button" class="btn" data-act="testKey">Test key</button><button type="button" class="btn" data-act="findModels">Find my models</button></form></section>
    <section class="card"><h3>Appearance & app</h3><div class="row wrap">
      <select id="theme">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, n]) => `<option value="${v}"${v === S.settings.theme ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn" data-act="install" id="installBtn" hidden>Install app</button></div></section>
    <section class="card"><h3>Your data</h3><p class="muted">Everything lives in this browser. Export a backup now and then.</p><div class="row wrap">
      <button class="btn" data-act="export">Export backup</button>
      <label class="btn">Import backup<input type="file" id="imp" accept="application/json" hidden></label>
      <button class="btn danger" data-act="reset">Erase everything</button></div></section>`;

  /* ---- quiz ---- */
  let Q = { phase: 'setup', items: [], meta: {}, err: '' };
  VIEWS.quiz = () => {
    if (Q.phase === 'loading') return `<header class="top"><h1>Quiz</h1></header><section class="card"><p>🧠 Writing your questions…</p></section>`;
    if (Q.phase === 'run' || Q.phase === 'done') {
      const done = Q.phase === 'done';
      const score = done ? Q.items.filter((q, i) => Q.answers[i] === q.answer).length : 0;
      return `<header class="top"><h1>${esc(Q.meta.topic)}</h1><p class="muted">${esc(sname(Q.meta.subjectId))} · ${Q.items.length} questions</p></header>
      ${done ? `<section class="card hero"><h3>Score: ${score}/${Q.items.length} (${Math.round(score / Q.items.length * 100)}%)</h3><button class="btn primary" data-act="quizNew">New quiz</button></section>` : ''}
      <form data-form="quizsubmit">${Q.items.map((q, i) => `<section class="card q"><div class="md"><b>${i + 1}.</b> ${md(q.q)}</div>
        ${q.options.map((o, j) => `<label class="opt ${done ? (j === q.answer ? 'right' : Q.answers[i] === j ? 'wrong' : '') : ''}"><input type="radio" name="q${i}" value="${j}" ${done ? 'disabled' : ''} ${Q.answers[i] === j ? 'checked' : ''}><span>${md(o)}</span></label>`).join('')}
        ${done ? `<div class="expl md">${md(q.explain || '')}</div>${Q.answers[i] !== q.answer ? `<button type="button" class="btn" data-act="askTutor" data-i="${i}">Ask the tutor about this</button>` : ''}` : ''}</section>`).join('')}
      ${done ? '' : '<button class="btn primary big">Submit answers</button>'}</form>`;
    }
    const weak = weakTopics();
    return `<header class="top"><h1>Practice quiz</h1></header>
    ${Q.err ? `<section class="card err">${esc(Q.err)}</section>` : ''}
    <section class="card"><form data-form="quizstart" class="fgrid">
      <label>Subject<select name="subjectId">${opts(S.tutorSubject, true)}</select></label>
      <label class="wide">Topic<input name="topic" id="qtopic" required placeholder="e.g. Integration by parts, Projectile motion"></label>
      <label>Questions<select name="n">${[3, 5, 8, 10].map(n => `<option${n === 5 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Difficulty<select name="diff"><option>easy</option><option selected>medium</option><option>hard</option><option>exam-level</option></select></label>
      <button class="btn primary">Make quiz</button></form>
      ${weak.length ? `<p class="muted">Needs work:</p><div class="chips">${weak.map(w => `<button class="chip" data-act="fillTopic" data-topic="${esc(w.topic)}" data-sub="${w.subjectId}">${esc(w.topic)} · ${w.avg}%</button>`).join('')}</div>` : ''}</section>
    ${S.quizzes.length ? `<section class="card"><h3>History</h3><div class="list">${[...S.quizzes].reverse().slice(0, 10).map(q => `<div class="item"><i class="dot" style="background:${scolor(q.subjectId)}"></i><div><b>${esc(q.topic)}</b><small>${q.date} · ${esc(sname(q.subjectId))}</small></div><span class="gr g${L.grade(q.score / q.total * 100)}">${q.score}/${q.total}</span></div>`).join('')}</div></section>` : ''}`;
  };
  async function makeQuiz(f) {
    const subjectId = f.subjectId.value, topic = f.topic.value.trim(), n = +f.n.value, diff = f.diff.value;
    Q = { phase: 'loading', items: [], meta: { subjectId, topic, n, diff }, err: '' }; render();
    const prompt = `Create ${n} multiple-choice questions for a ${S.profile.level} student.
Subject: ${sname(subjectId)}. Topic: ${topic}. Difficulty: ${diff}.
Return ONLY JSON: {"questions":[{"q":"question text","options":["A","B","C","D"],"answer":0,"explain":"short worked explanation"}]}
Rules: exactly 4 options per question; "answer" is the 0-based index of the single correct option; write maths in LaTeX using $...$; make sure the keyed answer is truly correct (re-check calculations); vary the correct position; plausible distractors based on common mistakes. Student context: ${studentContext()}`;
    try {
      const raw = await gem({ contents: [{ role: 'user', parts: [{ text: prompt }] }], json: true, temp: 0.7 });
      const j = L.parseJsonLoose(raw);
      const items = (j.questions || []).filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
      if (!items.length) throw new Error('The AI returned no usable questions. Try again.');
      Q = { phase: 'run', items, answers: [], meta: Q.meta, err: '' };
    } catch (e) { Q = { phase: 'setup', items: [], meta: {}, err: e.message }; }
    if (route() === 'quiz') render();
  }

  /* ---- tutor ---- */
  let pending = [], busy = false, voiceMode = false, rec = null, speaking = false, pendingPrompt = '';
  const msgHTML = (m, i) => `<div class="msg ${m.role}" data-i="${i}"><div class="bub ${m.err ? 'err' : ''}">${m.role === 'ai'
    ? (m.text ? md(m.text) : '<span class="typing"><i></i><i></i><i></i></span>')
    : (m.att && m.att.length ? '<div class="atts">' + m.att.map(a => '📎 ' + esc(a.name)).join('<br>') + '</div>' : '') + '<p>' + esc(m.text).replace(/\n/g, '<br>') + '</p>'}</div>
    ${m.role === 'ai' && m.text && !m.err ? `<div class="mact"><button class="x" data-act="speak" data-i="${i}" aria-label="Read aloud">🔊</button><button class="x" data-act="copy" data-i="${i}" aria-label="Copy">⧉</button></div>` : ''}</div>`;
  VIEWS.tutor = () => `<div class="tutor">
    <div class="tbar"><select id="tsubject" aria-label="Subject">${opts(S.tutorSubject, true)}</select>
      <div class="seg"><button data-act="mode" data-m="hints" class="${S.mode === 'hints' ? 'on' : ''}">💡 Hints</button><button data-act="mode" data-m="worked" class="${S.mode === 'worked' ? 'on' : ''}">📝 Worked</button></div>
      <button class="btn sm" data-act="logTutor" title="Add this tutoring time to your study log">⏱ Log time</button>
      <button class="btn sm" data-act="clearChat">New chat</button></div>
    <div id="msgs">${S.chat.length ? S.chat.map(msgHTML).join('') : `<div class="empty"><h2>Ask me anything 🎓</h2><p>Type, speak, or attach a photo or PDF of a question or your working. I'll ${S.mode === 'hints' ? 'guide you with hints' : 'show full worked solutions'}.</p>
      <div class="chips">${['Explain integration by parts', 'Help me solve x² − 5x + 6 = 0', 'Plot y = sin(x) and y = cos(x)', 'Make me a revision plan'].map(p => `<button class="chip" data-act="sample" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div></div>`}</div>
    <div id="attach"></div>
    <form id="chatform" data-form="chat">
      <label class="ib" title="Attach image or PDF">📎<input type="file" id="fpick" accept="image/*,application/pdf" multiple hidden></label>
      <label class="ib" title="Take a photo">📷<input type="file" id="fcam" accept="image/*" capture="environment" hidden></label>
      <button type="button" class="ib ${voiceMode ? 'live' : ''}" data-act="mic" id="micBtn" title="Voice chat">🎤</button>
      <textarea id="chatin" rows="1" placeholder="Ask a question…" aria-label="Message"></textarea>
      <button class="btn primary" id="sendBtn" data-act="${busy ? 'stop' : 'send'}">${busy ? '■' : '➤'}</button></form></div>`;
  AFTER.tutor = () => {
    const m = $('#msgs'); m.scrollTop = m.scrollHeight;
    renderAttach();
    if (pendingPrompt) { $('#chatin').value = pendingPrompt; pendingPrompt = ''; $('#chatin').focus(); }
  };
  function renderAttach() {
    const a = $('#attach'); if (!a) return;
    a.innerHTML = pending.map((p, i) => `<span class="pill">${p.mime === 'application/pdf' ? '📄' : '🖼️'} ${esc(p.name)} <button class="x" data-act="rmAttach" data-i="${i}">✕</button></span>`).join('');
  }
  function renderMsgs(keepScroll) {
    const m = $('#msgs'); if (!m) return;
    const near = m.scrollHeight - m.scrollTop - m.clientHeight < 140;
    m.innerHTML = S.chat.length ? S.chat.map(msgHTML).join('') : '';
    if (!keepScroll || near) m.scrollTop = m.scrollHeight;
    const b = $('#sendBtn'); if (b) { b.dataset.act = busy ? 'stop' : 'send'; b.textContent = busy ? '■' : '➤'; }
  }
  async function toPart(f) {
    if (f.type.startsWith('image/')) {
      const bmp = await createImageBitmap(f);
      const sc = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return { name: f.name || 'photo.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
    }
    if (f.type === 'application/pdf') {
      if (f.size > 15 * 1024 * 1024) throw new Error('PDF is over 15 MB. Use a smaller file or fewer pages.');
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(f); });
      return { name: f.name, mime: 'application/pdf', data };
    }
    throw new Error('Only images and PDFs can be attached.');
  }
  async function addFiles(files) {
    for (const f of files) {
      try { pending.push(await toPart(f)); } catch (e) { toast(e.message || 'Could not read that file'); }
    }
    renderAttach();
  }
  function flushTutor(force) {
    const t = S.tutor; if (!t) return;
    const mins = Math.round((t.last - t.start) / 60000);
    if (force || Date.now() - t.last > 20 * 60000) {
      if (mins >= 1) { S.sessions.push({ id: uid(), subjectId: t.subjectId || '', min: Math.min(mins, 240), date: ymd(new Date(t.start)), note: 'AI tutor session' }); if (force) toast('Logged ' + fmtMin(mins) + ' of tutoring'); }
      else if (force) toast('Nothing to log yet');
      S.tutor = null; save();
    }
  }
  async function send(text) {
    if (busy) return;
    text = (text || '').trim();
    if (!text && !pending.length) return;
    flushTutor(false);
    const att = pending.splice(0);
    S.chat.push({ role: 'user', text: text || 'Please look at the attached file and help me.', att, t: Date.now() });
    const ai = { role: 'ai', text: '', t: Date.now() };
    S.chat.push(ai);
    const now = Date.now();
    S.tutor = S.tutor ? Object.assign(S.tutor, { last: now }) : { start: now - 60000, last: now, subjectId: S.tutorSubject };
    busy = true; abortCtl = new AbortController(); renderAttach(); renderMsgs();
    const hist = S.chat.slice(0, -1).slice(-17);
    const lastUsers = hist.map((m, i) => (m.role === 'user' ? i : -1)).filter(i => i >= 0).slice(-3);
    const contents = hist.map((m, i) => {
      const parts = [];
      if (m.role === 'user' && lastUsers.includes(i)) (m.att || []).forEach(a => { if (a.data) parts.push({ inlineData: { mimeType: a.mime, data: a.data } }); });
      parts.push({ text: m.text || ' ' });
      return { role: m.role === 'ai' ? 'model' : 'user', parts };
    });
    while (contents.length && contents[0].role !== 'user') contents.shift();
    try {
      await gem({ system: tutorSystem(), contents, stream: true, signal: abortCtl.signal, temp: 0.4, onChunk: t => { ai.text = t; const el = $('#msgs .msg:last-child .bub'); if (el) { el.innerHTML = md(t); const m = $('#msgs'); if (m.scrollHeight - m.scrollTop - m.clientHeight < 160) m.scrollTop = m.scrollHeight; } } });
      if (!ai.text) { ai.text = 'I could not produce an answer. Please rephrase or try again.'; ai.err = true; }
    } catch (e) {
      if (e.name === 'AbortError') { if (!ai.text) ai.text = '(stopped)'; }
      else { ai.text = (ai.text ? ai.text + '\n\n' : '') + '⚠️ ' + e.message; ai.err = true; }
    }
    busy = false; abortCtl = null;
    if (S.chat.length > 80) S.chat = S.chat.slice(-80);
    S.tutor.last = Date.now(); save(); renderMsgs();
    if (!ai.err && (voiceMode || S.settings.speak)) speak(ai.text, () => { if (voiceMode) listen(); });
    else if (voiceMode) { voiceMode = false; updMic(); }
  }
  function speak(text, done) {
    if (!('speechSynthesis' in window)) { toast('Reading aloud is not supported here'); done && done(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(L.speakable(text)); u.lang = S.settings.lang; u.rate = 0.95;
    speaking = true; u.onend = u.onerror = () => { speaking = false; done && done(); };
    speechSynthesis.speak(u);
  }
  const updMic = () => { const b = $('#micBtn'); if (b) b.classList.toggle('live', voiceMode); };
  function listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice input is not supported in this browser. Try Chrome.'); voiceMode = false; updMic(); return; }
    if (rec) { try { rec.abort(); } catch (e) { /* ignore */ } }
    rec = new SR(); rec.lang = S.settings.lang; rec.interimResults = true; rec.continuous = false;
    let heard = '';
    rec.onresult = e => { heard = [...e.results].map(r => r[0].transcript).join(' '); const ta = $('#chatin'); if (ta) ta.value = heard; };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('Microphone permission was blocked.'); voiceMode = false; updMic(); } };
    rec.onend = () => {
      if (!voiceMode) return;
      if (heard.trim()) { const ta = $('#chatin'); if (ta) ta.value = ''; send(heard); }
      else if (!busy && !speaking) setTimeout(() => voiceMode && !busy && !speaking && listen(), 400);
    };
    try { rec.start(); } catch (e) { /* already started */ }
  }

  /* ---------------- events ---------------- */
  const ACT = {
    quickSubject(el) { if (!S.subjects.some(s => s.name === el.dataset.name)) { S.subjects.push({ id: uid(), name: el.dataset.name, target: 75, color: COLORS[S.subjects.length % COLORS.length] }); save(); render(); } },
    delSubject(el) { if (confirm('Delete this subject? Its logs stay but show as General.')) { S.subjects = S.subjects.filter(s => s.id !== el.dataset.id); save(); render(); } },
    delSession(el) { S.sessions = S.sessions.filter(s => s.id !== el.dataset.id); save(); render(); },
    delMark(el) { S.marks = S.marks.filter(s => s.id !== el.dataset.id); save(); render(); },
    delTask(el) { S.tasks = S.tasks.filter(s => s.id !== el.dataset.id); save(); render(); },
    toggleTask(el) { const t = S.tasks.find(x => x.id === el.dataset.id); if (t) { t.done = el.checked; save(); render(); } },
    timerStart() { S.timer = { start: Date.now(), subjectId: $('#tsub').value }; save(); render(); },
    timerStop() {
      const mins = Math.round((Date.now() - S.timer.start) / 60000), sid = S.timer.subjectId;
      if (mins >= 1) { S.sessions.push({ id: uid(), subjectId: sid, min: mins, date: ymd(new Date(S.timer.start)), note: 'Timer' }); toast('Saved ' + fmtMin(mins)); } else toast('Too short to save');
      S.timer = null; save(); render();
    },
    async plan(el) {
      el.disabled = true; $('#plan').innerHTML = '<p class="muted">Thinking…</p>';
      try {
        const t = await ask(`Build today's study plan (today is ${today()}). Use the student's data below. Give 4-6 time-boxed blocks that add up to about ${S.goal} minutes, put weakest subjects and nearest deadlines first, include one short active-recall or past-paper block, and end with one motivating sentence. Use markdown bullets.\n${studentContext()}`, 'You are a practical, encouraging study coach. Be concise.');
        S.plan = { date: today(), text: t }; save();
      } catch (e) { $('#plan') && ($('#plan').innerHTML = '<p class="late">' + esc(e.message) + '</p>'); }
      if (route() === 'dashboard') render();
    },
    async analyse(el) {
      if (!S.marks.length) return toast('Add some marks first');
      el.disabled = true; $('#analysis').innerHTML = '<p class="muted">Analysing…</p>';
      const lines = S.marks.map(m => `${m.date} ${sname(m.subjectId)} ${m.name}: ${pct(m)}%`).join('\n');
      try { $('#analysis').innerHTML = md(await ask(`Analyse these exam results. Say what is improving, what is slipping, which subject needs attention first and 3 concrete actions.\n${lines}\n${studentContext()}`, 'You are a supportive academic coach. Be concise and specific.')); }
      catch (e) { $('#analysis').innerHTML = '<p class="late">' + esc(e.message) + '</p>'; }
      el.disabled = false;
    },
    mode(el) { S.mode = el.dataset.m; save(); $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.m === S.mode)); toast(S.mode === 'hints' ? 'Hints mode: the tutor guides you step by step' : 'Worked mode: full solutions'); },
    sample(el) { send(el.dataset.p); },
    send() { const ta = $('#chatin'); const v = ta.value; ta.value = ''; ta.style.height = ''; send(v); },
    stop() { abortCtl && abortCtl.abort(); },
    clearChat() { if (!S.chat.length || confirm('Start a new chat? (Your study log keeps the time.)')) { flushTutor(true); S.chat = []; pending = []; save(); render(); } },
    logTutor() { flushTutor(true); },
    rmAttach(el) { pending.splice(+el.dataset.i, 1); renderAttach(); },
    speak(el) { const m = S.chat[+el.dataset.i]; if (m) { if (speaking) { speechSynthesis.cancel(); speaking = false; } else speak(m.text); } },
    copy(el) { const m = S.chat[+el.dataset.i]; if (m && navigator.clipboard) navigator.clipboard.writeText(m.text).then(() => toast('Copied')); },
    mic() { voiceMode = !voiceMode; updMic(); if (voiceMode) { speechSynthesis.cancel(); listen(); } else { try { rec && rec.abort(); } catch (e) { /* ignore */ } speechSynthesis.cancel(); } },
    fillTopic(el) { $('#qtopic').value = el.dataset.topic; const s = $('select[name=subjectId]'); if (s) s.value = el.dataset.sub; },
    quizNew() { Q = { phase: 'setup', items: [], meta: {}, err: '' }; render(); },
    askTutor(el) {
      const q = Q.items[+el.dataset.i];
      pendingPrompt = `I got this quiz question wrong. Please help me understand it.\n\nQuestion: ${q.q}\nMy answer: ${q.options[Q.answers[+el.dataset.i]] || '(none)'}\nCorrect answer: ${q.options[q.answer]}`;
      S.tutorSubject = Q.meta.subjectId || ''; go('tutor');
    },
    async findModels(el) {
      const f = el.closest('form'), key = f.key.value.trim();
      if (!key) return toast('Paste your API key first');
      el.disabled = true;
      try {
        const names = await listModels(key);
        if (!names.length) return toast('No Gemini Flash models found for this key');
        $('#models').innerHTML = names.map(n => `<option>${n}</option>`).join('');
        f.model.value = names[0]; toast('Found ' + names.length + ' models. Using ' + names[0] + '. Press Save.');
      } catch (e) { toast(e.message); }
      el.disabled = false;
    },
    async testKey(el) {
      const f = el.closest('form'); S.settings.key = f.key.value.trim(); S.settings.model = f.model.value.trim() || 'gemini-flash-latest'; save();
      el.disabled = true; el.textContent = 'Testing…';
      try { await ask('Reply with the single word: OK'); toast('✅ Key works'); } catch (e) { toast(e.message); }
      el.disabled = false; el.textContent = 'Test key';
    },
    export() {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, (k, v) => (k === 'data' || k === 'key' ? undefined : v), 2)], { type: 'application/json' }));
      a.download = 'mentora-backup-' + today() + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    reset() { if (confirm('Erase ALL data in this browser? This cannot be undone.') && confirm('Really erase everything?')) { localStorage.removeItem(KEY); S = def(); render(); toast('All data erased'); } },
    install() { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; } }
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT' && el.type === 'checkbox') return;
    if (ACT[el.dataset.act]) { if (el.type === 'submit') e.preventDefault(); ACT[el.dataset.act](el); }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.act === 'toggleTask') return ACT.toggleTask(el);
    if (el.id === 'tsubject') { S.tutorSubject = el.value; save(); }
    else if (el.id === 'theme') { S.settings.theme = el.value; save(); applyTheme(); }
    else if (el.id === 'fpick' || el.id === 'fcam') { addFiles([...el.files]); el.value = ''; }
    else if (el.id === 'imp') {
      const f = el.files[0]; if (!f) return;
      f.text().then(t => { const j = JSON.parse(t); if (!j || typeof j !== 'object' || !Array.isArray(j.subjects)) throw 0; const k = S.settings.key; S = Object.assign(def(), j); S.settings = Object.assign(def().settings, j.settings, { key: k }); save(); render(); toast('Backup imported'); }).catch(() => toast('That is not a valid backup file'));
    }
  });
  document.addEventListener('input', e => { if (e.target.id === 'chatin') { e.target.style.height = 'auto'; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; } });
  document.addEventListener('keydown', e => { if (e.target.id === 'chatin' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ACT.send(); } });
  document.addEventListener('paste', e => { if (e.target.id === 'chatin') { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } } });
  document.addEventListener('submit', e => {
    const f = e.target, k = f.dataset.form; if (!k) return;
    e.preventDefault();
    const v = n => f.elements[n] && f.elements[n].value;
    if (k === 'chat') return ACT.send();
    if (k === 'session') { S.sessions.push({ id: uid(), subjectId: v('subjectId'), min: Math.max(1, +v('min')), date: v('date'), note: v('note').trim() }); }
    else if (k === 'mark') { S.marks.push({ id: uid(), subjectId: v('subjectId'), name: v('name').trim(), score: +v('score'), max: +v('max'), date: v('date') }); }
    else if (k === 'task') { S.tasks.push({ id: uid(), title: v('title').trim(), subjectId: v('subjectId'), pri: v('pri'), due: v('due'), done: false }); }
    else if (k === 'subject') { S.subjects.push({ id: uid(), name: v('name').trim(), target: Math.min(100, Math.max(1, +v('target'))), color: v('color') }); }
    else if (k === 'profile') { S.profile.name = v('name').trim(); S.profile.level = v('level'); S.profile.examDate = v('examDate'); S.goal = Math.max(15, +v('goal') || 120); }
    else if (k === 'ai') { S.settings.key = v('key').trim(); S.settings.model = v('model').trim() || 'gemini-flash-latest'; S.settings.lang = v('lang'); S.settings.speak = f.elements.speak.checked; }
    else if (k === 'quizstart') { return makeQuiz(f); }
    else if (k === 'quizsubmit') {
      Q.answers = Q.items.map((_, i) => { const c = f.querySelector(`input[name=q${i}]:checked`); return c ? +c.value : -1; });
      if (Q.answers.includes(-1) && !confirm('Some questions are unanswered. Submit anyway?')) return;
      const score = Q.items.filter((q, i) => Q.answers[i] === q.answer).length;
      S.quizzes.push({ id: uid(), date: today(), subjectId: Q.meta.subjectId, topic: Q.meta.topic, score, total: Q.items.length }); Q.phase = 'done'; save(); render(); window.scrollTo(0, 0); return;
    }
    save(); toast('Saved'); render();
  });

  /* ---------------- shell ---------------- */
  function applyTheme() { document.documentElement.dataset.theme = S.settings.theme; }
  function renderNav(v) {
    $('#nav').innerHTML = '<div class="brand"><span>🎓</span><b>Mentora</b></div>' + NAV.map(([id, ic, n]) => `<a href="#/${id}" class="${id === v ? 'on' : ''}"><span>${ic}</span><em>${n}</em></a>`).join('');
  }
  function render() {
    const v = route();
    if (!VIEWS[v]) return go('dashboard');
    renderNav(v); document.body.dataset.view = v;
    const view = $('#view'); view.innerHTML = VIEWS[v]();
    (AFTER[v] || (() => { }))();
    if (v !== 'tutor') window.scrollTo(0, 0);
  }
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; const b = $('#installBtn'); if (b) b.hidden = false; });
  window.addEventListener('hashchange', () => { if (route() !== 'tutor' && voiceMode) { voiceMode = false; try { rec && rec.abort(); } catch (e) { /* ignore */ } speechSynthesis.cancel(); } render(); });
  window.addEventListener('load', () => { if (window.katex) render(); });
  window.addEventListener('pagehide', () => { flushTutor(false); });
  applyTheme(); render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__mentora = { get S() { return S; }, render, send };
})();

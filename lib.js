/* Mentora core helpers: pure functions, usable in browser (window.Lib) and node (tests). */
(function (root) {
  'use strict';

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Sri Lankan A/L style grade bands */
  function grade(p) {
    if (p == null || isNaN(p)) return '-';
    if (p >= 75) return 'A';
    if (p >= 65) return 'B';
    if (p >= 50) return 'C';
    if (p >= 35) return 'S';
    return 'F';
  }

  /* Parse JSON from a model. LaTeX backslashes (\frac, \theta ...) collide with JSON escapes,
     so every single backslash not followed by a quote is doubled first. */
  function parseJsonLoose(s) {
    s = String(s).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const fix = x => x.replace(/\\\\|\\(?!")/g, m => (m.length === 2 ? m : '\\\\'));
    const tries = [fix(s)];
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) tries.push(fix(s.slice(a, b + 1)));
    for (const t of tries) { try { return JSON.parse(t); } catch (e) { /* next */ } }
    throw new Error('Could not read the AI response as JSON');
  }

  /* Turn LaTeX-ish text into something a speech engine reads naturally */
  function speakable(t) {
    return String(t)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, ' $1 over $2 ')
      .replace(/\\sqrt\{([^}]*)\}/g, ' square root of $1 ')
      .replace(/\^2(?!\d)/g, ' squared ')
      .replace(/\^3(?!\d)/g, ' cubed ')
      .replace(/\^\{([^}]*)\}/g, ' to the power $1 ')
      .replace(/\^(\w)/g, ' to the power $1 ')
      .replace(/_\{([^}]*)\}/g, ' sub $1 ')
      .replace(/_(\w)/g, ' sub $1 ')
      .replace(/\\(cdot|times)(?![a-z])/g, ' times ')
      .replace(/\\div(?![a-z])/g, ' divided by ')
      .replace(/\\pm(?![a-z])/g, ' plus or minus ')
      .replace(/\\leq?(?![a-z])/g, ' less than or equal to ')
      .replace(/\\geq?(?![a-z])/g, ' greater than or equal to ')
      .replace(/\\neq?(?![a-z])/g, ' not equal to ')
      .replace(/\\pi(?![a-z])/g, ' pi ')
      .replace(/\\theta(?![a-z])/g, ' theta ')
      .replace(/\\int(?![a-z])/g, ' integral of ')
      .replace(/\\sum(?![a-z])/g, ' sum of ')
      .replace(/\\infty(?![a-z])/g, ' infinity ')
      .replace(/\\lim(?![a-z])/g, ' limit ')
      .replace(/\\to(?![a-z])/g, ' tends to ')
      .replace(/\\[a-zA-Z]+/g, ' ')
      .replace(/=/g, ' equals ')
      .replace(/\+/g, ' plus ')
      .replace(/(?<=[\w)])\s*-\s*(?=[\w(])/g, ' minus ')
      .replace(/[$*#`{}\\|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ---------- function plotter (```plot blocks) ---------- */
  const FN = 'sin|cos|tan|asin|acos|atan|sqrt|abs|ln|log|exp|floor|ceil';

  function compileExpr(src) {
    let e = String(src).trim().replace(/^(y|f\(x\))\s*=\s*/i, '').replace(/π/g, 'pi').replace(/\^/g, '**');
    const stripped = e.replace(new RegExp('(' + FN + '|pi|e|x)', 'g'), '');
    if (!e || /[^0-9+\-*/().,\s]/.test(stripped)) return null;
    e = e
      .replace(/\*\*\s*-\s*(\d+(?:\.\d+)?|x)/g, '**(-$1)')
      .replace(/(^|[(,+\-*/])\s*-\s*/g, '$1(-1)*')
      .replace(/(\d|\))\s*(?=x\b|\(|pi\b|(?:sin|cos|tan|asin|acos|atan|sqrt|abs|ln|log|exp)\b)/g, '$1*')
      .replace(/\bx\s*(?=\(|pi\b|(?:sin|cos|tan|asin|acos|atan|sqrt|abs|ln|log|exp)\b)/g, 'x*')
      .replace(/(?<![.\w])ln\s*\(/g, 'Math.log(')
      .replace(/(?<![.\w])log\s*\(/g, 'Math.log10(')
      .replace(/(?<![.\w])(sin|cos|tan|asin|acos|atan|sqrt|abs|exp|floor|ceil)\s*\(/g, 'Math.$1(')
      .replace(/(?<![.\w])pi(?![\w(])/g, 'Math.PI')
      .replace(/(?<![.\w])e(?![\w(])/g, 'Math.E');
    try {
      const f = new Function('x', '"use strict"; return (' + e + ');');
      f(1);
      return f;
    } catch (err) { return null; }
  }

  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
  }

  function plotSvg(spec) {
    const lines = String(spec).split('\n').map(l => l.trim()).filter(Boolean);
    let xmin = -10, xmax = 10, ymin = null, ymax = null;
    const exprs = [];
    for (const l of lines) {
      let m;
      if ((m = l.match(/^(?:range|x|xrange)\s*[:=]\s*(-?[\d.]+)\s*(?:,|to|\.\.)\s*(-?[\d.]+)/i))) { xmin = +m[1]; xmax = +m[2]; }
      else if ((m = l.match(/^(?:yrange|y\s*range)\s*[:=]\s*(-?[\d.]+)\s*(?:,|to|\.\.)\s*(-?[\d.]+)/i))) { ymin = +m[1]; ymax = +m[2]; }
      else { const f = compileExpr(l); if (f) exprs.push({ label: l, f }); }
    }
    if (!exprs.length || !(xmax > xmin)) return '<div class="plot-err">Could not draw this graph.</div>';
    const W = 480, H = 320, pad = 28, N = 500;
    const data = exprs.map(ex => {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const x = xmin + (xmax - xmin) * i / N;
        let y; try { y = ex.f(x); } catch (e) { y = NaN; }
        pts.push([x, typeof y === 'number' && isFinite(y) ? y : NaN]);
      }
      return pts;
    });
    if (ymin == null) {
      const ys = data.flat().map(p => p[1]).filter(v => !isNaN(v) && Math.abs(v) < 1e4).sort((a, b) => a - b);
      if (ys.length) {
        const lo = ys[Math.floor(ys.length * 0.02)], hi = ys[Math.ceil(ys.length * 0.98) - 1];
        const padY = (hi - lo || 2) * 0.12;
        ymin = lo - padY; ymax = hi + padY;
      } else { ymin = -5; ymax = 5; }
      if (ymax - ymin < 1e-6) { ymin -= 1; ymax += 1; }
    }
    const sx = x => pad + (x - xmin) / (xmax - xmin) * (W - 2 * pad);
    const sy = y => H - pad - (y - ymin) / (ymax - ymin) * (H - 2 * pad);
    let g = '';
    const xs = niceStep((xmax - xmin) / 8), ys2 = niceStep((ymax - ymin) / 6);
    for (let x = Math.ceil(xmin / xs) * xs; x <= xmax + 1e-9; x += xs) {
      g += `<line x1="${sx(x).toFixed(1)}" y1="${pad}" x2="${sx(x).toFixed(1)}" y2="${H - pad}" class="gl"/>`;
      g += `<text x="${sx(x).toFixed(1)}" y="${H - pad + 13}" text-anchor="middle" class="gt">${+x.toFixed(6)}</text>`;
    }
    for (let y = Math.ceil(ymin / ys2) * ys2; y <= ymax + 1e-9; y += ys2) {
      g += `<line x1="${pad}" y1="${sy(y).toFixed(1)}" x2="${W - pad}" y2="${sy(y).toFixed(1)}" class="gl"/>`;
      g += `<text x="${pad - 4}" y="${(sy(y) + 3).toFixed(1)}" text-anchor="end" class="gt">${+y.toFixed(6)}</text>`;
    }
    if (xmin <= 0 && xmax >= 0) g += `<line x1="${sx(0)}" y1="${pad}" x2="${sx(0)}" y2="${H - pad}" class="ax"/>`;
    if (ymin <= 0 && ymax >= 0) g += `<line x1="${pad}" y1="${sy(0)}" x2="${W - pad}" y2="${sy(0)}" class="ax"/>`;
    const colors = ['#4f46e5', '#e11d48', '#059669', '#d97706', '#0891b2'];
    let paths = '', legend = '';
    data.forEach((pts, k) => {
      let d = '', pen = false, prev = null;
      for (const [x, y] of pts) {
        const out = isNaN(y) || y < ymin - (ymax - ymin) * 2 || y > ymax + (ymax - ymin) * 2;
        const jump = prev !== null && Math.abs(y - prev) > (ymax - ymin) * 1.5;
        if (out || jump) { pen = false; prev = out ? null : y; if (out) continue; }
        d += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + sy(y).toFixed(1) + ' ';
        pen = true; prev = y;
      }
      paths += `<path d="${d}" fill="none" stroke="${colors[k % 5]}" stroke-width="2"/>`;
      legend += `<span><i style="background:${colors[k % 5]}"></i>${esc(exprs[k].label)}</span>`;
    });
    return `<figure class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="graph">${g}<clipPath id="c"><rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}"/></clipPath><g clip-path="url(#c)">${paths}</g></svg><figcaption>${legend}</figcaption></figure>`;
  }

  /* ---------- markdown + LaTeX renderer (HTML-escaped, safe) ---------- */
  function md(src, katex) {
    const store = [];
    const put = h => { store.push(h); return '\u0001' + (store.length - 1) + '\u0001'; };
    const math = (tex, disp) => {
      tex = tex.trim();
      if (katex) { try { return katex.renderToString(tex, { displayMode: disp, throwOnError: false }); } catch (e) { /* fall through */ } }
      return `<code class="tex">${esc(tex)}</code>`;
    };
    let t = String(src || '');
    t = t.replace(/```(\w*)[ \t]*\n?([\s\S]*?)```/g, (m, lang, code) => {
      if (lang === 'plot') return '\n' + put(plotSvg(code)) + '\n';
      return '\n' + put('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>') + '\n';
    });
    t = t.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?=\S)([^$\n]*?\S)\$(?!\d)/g, (m, a, b, c, d) => {
      const disp = a !== undefined || b !== undefined;
      return put(math(a ?? b ?? c ?? d, disp));
    });
    t = esc(t);
    const inline = s => s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
    const out = []; let list = null, para = [];
    const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join('<br>')) + '</p>'); para = []; } };
    const flushL = () => { if (list) { out.push('<' + list.t + '>' + list.items.map(i => '<li>' + inline(i) + '</li>').join('') + '</' + list.t + '>'); list = null; } };
    for (const raw of t.split('\n')) {
      const line = raw.replace(/\s+$/, ''); let m;
      if (!line.trim()) { flushP(); flushL(); continue; }
      if (/^\u0001\d+\u0001$/.test(line.trim())) { flushP(); flushL(); out.push(line.trim()); continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushP(); flushL(); const n = Math.min(m[1].length + 2, 5); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
      if ((m = line.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/))) {
        flushP(); const tt = /\d/.test(m[1]) ? 'ol' : 'ul';
        if (list && list.t !== tt) flushL();
        if (!list) list = { t: tt, items: [] };
        list.items.push(m[2]); continue;
      }
      if ((m = line.match(/^&gt;\s?(.*)$/))) { flushP(); flushL(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      if (list && /^\s+/.test(raw)) { list.items[list.items.length - 1] += '<br>' + line.trim(); continue; }
      flushL(); para.push(line);
    }
    flushP(); flushL();
    return out.join('').replace(/\u0001(\d+)\u0001/g, (m, i) => store[+i]);
  }

  const api = { esc, grade, parseJsonLoose, speakable, compileExpr, plotSvg, md };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Lib = api;
})(typeof window !== 'undefined' ? window : globalThis);

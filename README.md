# Mentora – AI study tracker + tutor

A free, installable web app (PWA) for students: log study time, track marks and tasks, and learn with an AI tutor that can see your progress.

No server, no build step, no database. Everything runs in the browser and saves to the device. The AI is Google Gemini (free tier).

## What's inside

| Area | What it does |
|---|---|
| Home | Today vs goal, streak, average mark, live exam countdown, 7-day bars, 12-week heatmap, per-subject progress vs target, **AI plan for today** |
| Tutor | Chat with **Hints** (Socratic) or **Worked** (full solution) mode, subject-aware. Attach **photos / PDFs** (camera too), paste images, **voice chat** (speak and it answers aloud), **LaTeX maths**, **auto-drawn graphs** (` ```plot ` blocks), checks handwritten working line by line. Tutor time can be logged into the study log |
| Study | Timer + manual log, notes |
| Marks | Results with A/B/C/S/F grades, progress chart with target lines, **AI analysis** of your results |
| Tasks | Priority, due date, subject, overdue flag |
| Quiz | AI-made multiple-choice quizzes by topic and difficulty, explanations, history, "weak topics" fed back to the tutor and planner, "Ask the tutor about this" on wrong answers |
| Settings | Name, level (A/L, O/L, IB...), exam date, daily goal, API key, model, voice language (English / Sinhala / Tamil), dark mode, backup export/import |

## Run it locally (30 seconds)

```bash
cd mentora
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening index.html by double-click also works, but install-as-app and offline mode need http/https.)

## Get the AI working

1. Go to https://aistudio.google.com/apikey and create a free key.
2. In Mentora → **Settings → AI tutor**, paste the key and press **Test key**.

The key stays in your browser and is sent only to Google. It is never included in exports.

If a model name stops working, type another one in the **Model** box (default `gemini-2.5-flash`).

## Put it online for free (pick one)

**Netlify Drop (easiest):** open https://app.netlify.com/drop and drag the whole `mentora` folder onto the page. You get an https link immediately.

**GitHub Pages:** create a repo, upload these files, then Settings → Pages → deploy from the `main` branch.

**Cloudflare Pages:** create a project → Direct Upload → upload the folder.

Then on a phone open the link in Chrome → menu → **Install app** / **Add to Home screen**.

## Before you share it with other students

Right now each student pastes **their own** free Gemini key, which is safe and costs you nothing. If you want students to use it without a key:

- Do **not** put your key in `app.js`; anyone could copy it from the browser.
- Add a tiny backend (for example a Cloudflare Worker) that holds your key, checks login, and enforces a per-student daily limit, then point `gem()` in `app.js` at it. Ask me and I'll build that.
- Data is currently per-device. Accounts and syncing across devices also need a backend (Supabase or Firebase are the usual free options).
- If students are under 18, add a short privacy notice saying what is stored and where.

## Notes and limits

- AI can make maths mistakes. The tutor shows its steps so students can verify, and is told to re-check calculations, but it is not perfect.
- Voice input needs Chrome or Edge (Safari support is limited). Sinhala and Tamil voice recognition depends on the device; reading aloud for those languages depends on installed voices.
- PDFs up to 15 MB can be attached; photos are shrunk automatically.
- Maths and graphs use KaTeX from a CDN; offline, formulas show as plain text until the CDN file has been cached once.
- After changing any file, bump `VERSION` in `sw.js` so installed copies update.

## Files

`index.html` · `styles.css` · `lib.js` (maths/markdown/graph helpers) · `app.js` (the app) · `sw.js` (offline) · `manifest.webmanifest` · `icon.svg`, `icon-192.png`, `icon-512.png`

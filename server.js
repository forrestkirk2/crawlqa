require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const { crawlSite } = require('./crawler');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AI Enhancement via Ollama ---
async function aiEnhance(findings) {
  try {
    // Detect available Ollama models
    const tagsRes = await axios.get('http://localhost:11434/api/tags', { timeout: 3000 });
    const models = tagsRes.data.models || [];
    if (models.length === 0) return null;

    // Pick best available model
    const preferred = ['llama3', 'llama3.2', 'gemma3', 'gemma2', 'qwen2.5', 'mistral', 'phi3', 'deepseek'];
    let model = models[0].name;
    for (const pref of preferred) {
      const found = models.find(m => m.name.startsWith(pref));
      if (found) { model = found.name; break; }
    }

    console.log(`Running AI analysis with model: ${model}`);

    // Warm up the model with a tiny prompt first to avoid cold-start timeout
    try {
      await axios.post('http://localhost:11434/api/generate', {
        model, prompt: 'hi', stream: false
      }, { timeout: 15000 });
    } catch {} // ignore warmup errors

    const allIssues = [
      ...findings.critical.map(t => `CRITICAL: ${t}`),
      ...findings.medium.map(t => `MEDIUM: ${t}`),
    ];

    // If no issues, return a simple positive summary
    if (allIssues.length === 0) {
      return {
        model,
        summary: `${findings.url} passed all checks with no critical or medium issues found. The site appears to be in excellent health — keep up the good work and consider running regular scans to catch any future regressions.`,
        fixes: {}
      };
    }

    const prompt = `You are a senior web developer and QA expert. Give practical, specific advice — name the exact HTML tag, attribute, tool, or setting needed. No vague answers.

Site scanned: ${findings.url}

Issues found:
${allIssues.join('\n')}

Provide:
1. A 2-3 sentence executive summary written for a non-technical business owner. Be direct about the impact.
2. For each issue, one highly specific HTML/code fix. Rules: only recommend changes to HTML, CSS, or server config. Never suggest third-party tools, plugins, or image editors. Always name the exact HTML tag and attribute needed. Example fixes: "Add <meta property='og:title' content='Your Title'> inside the <head> tag." or "Add alt='description of image' attribute directly to each <img> tag in the HTML."

Respond ONLY with this exact JSON, no other text:
{
  "summary": "...",
  "fixes": {
    "exact issue text here": "specific fix here",
    "exact issue text here": "specific fix here"
  }
}`;

    const res = await axios.post('http://localhost:11434/api/generate', {
      model,
      prompt,
      stream: false,
      format: 'json'
    }, { timeout: 90000 }); // extended timeout for slower machines

    const parsed = JSON.parse(res.data.response);

    // Normalize fixes — AI sometimes returns objects instead of strings
    const rawFixes = parsed.fixes || {};
    const fixes = {};
    for (const [key, val] of Object.entries(rawFixes)) {
      if (typeof val === 'string') {
        fixes[key] = val;
      } else if (typeof val === 'object' && val !== null) {
        // Extract most likely string field
        fixes[key] = val.fix || val.suggestion || val.text || val.description || JSON.stringify(val);
      }
    }

    console.log(`✅ AI analysis complete (${model})`);
    return { model, summary: parsed.summary || null, fixes };
  } catch (err) {
    console.log('⚠️  AI enhancement unavailable:', err.message);
    return null;
  }
}

// --- POST /scan ---
// Runs full scan, enhances with AI, returns complete results
app.post('/scan', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Please provide a URL to scan.' });

  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

  try {
    console.log(`Scanning: ${normalizedUrl}`);
    const findings = await crawlSite(normalizedUrl);

    // Return scan results immediately — AI loads separately
    res.json(findings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Scan failed: ' + err.message });
  }
});

// --- POST /ai-enhance ---
// Called separately after scan so it doesn't block the report
app.post('/ai-enhance', async (req, res) => {
  const { findings } = req.body;
  if (!findings) return res.status(400).json({ error: 'No findings provided.' });
  try {
    const ai = await aiEnhance(findings);
    res.json(ai || { unavailable: true });
  } catch (err) {
    res.json({ unavailable: true });
  }
});

// --- GET /download-pdf ---
// Generates and streams a PDF of the full report
app.get('/download-pdf', async (req, res) => {
  const data = req.query.data;
  if (!data) return res.status(400).json({ error: 'No report data provided.' });

  let findings;
  try {
    findings = JSON.parse(decodeURIComponent(data));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid report data.' });
  }

  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(generatePdfHtml(findings), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
    });
    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="crawlqa-report.pdf"');
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed.' });
  }
});

function calcGrade(findings) {
  let score = 100;
  score -= findings.critical.length * 15;
  score -= findings.medium.length * 7;
  score -= findings.low.length * 2;
  score = Math.max(0, score);
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 65) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

function generatePdfHtml(findings) {
  const renderItems = items => items.length === 0
    ? '<p style="color:#888;font-style:italic;margin:8px 0">None found</p>'
    : items.map(i => `<div style="padding:8px 0;border-bottom:1px solid #eee;color:#333;font-size:0.9rem">${i}</div>`).join('');

  const grade = calcGrade(findings);
  const gradeColors = { A: '#16a34a', B: '#22c55e', C: '#d97706', D: '#ea580c', F: '#dc2626' };
  const gradeColor = gradeColors[grade];

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1a1a1a; margin: 0; padding: 0; }
    .header { background: #15803d; color: white; padding: 24px 32px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; }
    .header-left h1 { margin: 0 0 4px; font-size: 1.6rem; }
    .header-left p { margin: 0; opacity: 0.85; font-size: 0.9rem; }
    .grade-box { background: rgba(255,255,255,0.15); border: 2px solid rgba(255,255,255,0.4); border-radius: 12px; width: 72px; height: 72px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .grade-label { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.85; margin-bottom: 2px; }
    .grade-letter { font-size: 2rem; font-weight: 800; line-height: 1; }
    .content { padding: 0 32px 32px; }
    .summary { display: flex; gap: 12px; margin-bottom: 28px; }
    .badge { padding: 12px 20px; border-radius: 8px; text-align: center; min-width: 80px; }
    .badge .num { font-size: 1.6rem; font-weight: 700; }
    .badge .lbl { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    .section { margin-bottom: 24px; }
    .section-title { font-weight: 700; font-size: 0.95rem; padding: 10px 0; border-bottom: 2px solid #f0f0f0; margin-bottom: 8px; }
    .critical { color: #dc2626; } .medium { color: #d97706; } .low { color: #2563eb; } .passed { color: #16a34a; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #eee; color: #9ca3af; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1>🕷️ CrawlQA Report</h1>
      <p>${findings.url} &nbsp;·&nbsp; ${new Date(findings.scannedAt).toLocaleString()}</p>
    </div>
    <div class="grade-box">
      <div class="grade-label">Grade</div>
      <div class="grade-letter">${grade}</div>
    </div>
  </div>
  <div class="content">
    <div class="summary">
      <div class="badge" style="background:#fee2e2"><div class="num critical">${findings.critical.length}</div><div class="lbl critical">Critical</div></div>
      <div class="badge" style="background:#fef3c7"><div class="num medium">${findings.medium.length}</div><div class="lbl medium">Medium</div></div>
      <div class="badge" style="background:#dbeafe"><div class="num low">${findings.low.length}</div><div class="lbl low">Low</div></div>
      <div class="badge" style="background:#dcfce7"><div class="num passed">${findings.passed.length}</div><div class="lbl passed">Passed</div></div>
    </div>
    <div class="section"><div class="section-title critical">🔴 Critical Issues (${findings.critical.length})</div>${renderItems(findings.critical)}</div>
    <div class="section"><div class="section-title medium">🟡 Medium Issues (${findings.medium.length})</div>${renderItems(findings.medium)}</div>
    <div class="section"><div class="section-title low">🔵 Low Priority (${findings.low.length})</div>${renderItems(findings.low)}</div>
    <div class="section"><div class="section-title passed">✅ Passed Checks (${findings.passed.length})</div>${renderItems(findings.passed)}</div>
    <div class="footer">Generated by CrawlQA · crawlqa.com</div>
  </div>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`\n✅ CrawlQA is running!`);
  console.log(`👉 Open your browser and go to: http://localhost:${PORT}\n`);
});

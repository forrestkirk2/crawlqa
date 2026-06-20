const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

async function crawlSite(url) {
  console.log(`\n🔍 CrawlQA starting scan on: ${url}\n`);

  const findings = {
    url,
    scannedAt: new Date().toISOString(),
    critical: [],
    medium: [],
    low: [],
    passed: []
  };

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Capture JS console errors
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    // ── Load page & measure response time ──────────────────────────────
    const startTime = Date.now();
    const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const loadTime = Date.now() - startTime;

    if (response.status() >= 400) {
      findings.critical.push(`Page returned HTTP ${response.status()} — site may be down or URL is wrong`);
    } else {
      findings.passed.push(`Page loaded successfully (HTTP ${response.status()})`);
    }

    // ── Performance: load time ─────────────────────────────────────────
    if (loadTime > 5000) {
      findings.critical.push(`Page load time is ${(loadTime/1000).toFixed(1)}s — very slow, will hurt SEO and user experience`);
    } else if (loadTime > 3000) {
      findings.medium.push(`Page load time is ${(loadTime/1000).toFixed(1)}s — consider optimizing for faster loads`);
    } else {
      findings.passed.push(`Page load time is ${(loadTime/1000).toFixed(1)}s — good`);
    }

    // ── Security: HTTPS ────────────────────────────────────────────────
    if (!url.startsWith('https://')) {
      findings.critical.push('Site is not using HTTPS — user data is not encrypted and browsers will show a "Not Secure" warning');
    } else {
      findings.passed.push('Site is using HTTPS — connection is secure');
    }

    // ── Security: response headers ─────────────────────────────────────
    const responseHeaders = response.headers();
    if (!responseHeaders['x-frame-options'] && !responseHeaders['content-security-policy']) {
      findings.medium.push('Missing X-Frame-Options header — site may be vulnerable to clickjacking attacks');
    } else {
      findings.passed.push('Clickjacking protection header present');
    }
    if (!responseHeaders['x-content-type-options']) {
      findings.low.push('Missing X-Content-Type-Options header — recommended security header');
    }

    // ── Grab HTML ──────────────────────────────────────────────────────
    const html = await page.content();
    const $ = cheerio.load(html);

    // ── Accessibility: HTML lang attribute ────────────────────────────
    const htmlLang = $('html').attr('lang');
    if (!htmlLang) {
      findings.medium.push('Missing lang attribute on <html> tag — screen readers need this to read content correctly');
    } else {
      findings.passed.push(`HTML language attribute set to "${htmlLang}"`);
    }

    // ── SEO: Page title ────────────────────────────────────────────────
    // Get title from the raw HTML of <title> to avoid SVG/icon text bleeding in
    const titleRaw = $('title').html() || '';
    const title = titleRaw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title) {
      findings.medium.push('Missing page title — bad for SEO and browser tabs');
    } else if (title.length > 60) {
      findings.low.push(`Page title is ${title.length} characters — recommended max is 60 for SEO`);
    } else {
      findings.passed.push(`Page title found: "${title}"`);
    }

    // ── SEO: Meta description ──────────────────────────────────────────
    const metaDesc = $('meta[name="description"]').attr('content');
    if (!metaDesc) {
      findings.medium.push('Missing meta description — hurts SEO and search result previews');
    } else if (metaDesc.length > 160) {
      findings.low.push(`Meta description is ${metaDesc.length} characters — recommended max is 160`);
    } else {
      findings.passed.push('Meta description found and within recommended length');
    }

    // ── SEO: Canonical tag ─────────────────────────────────────────────
    const canonical = $('link[rel="canonical"]').attr('href');
    if (!canonical) {
      findings.low.push('Missing canonical tag — search engines may index duplicate versions of this page');
    } else {
      findings.passed.push(`Canonical URL set: ${canonical}`);
    }

    // ── SEO: Open Graph / Social tags ─────────────────────────────────
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDesc = $('meta[property="og:description"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    if (!ogTitle || !ogDesc || !ogImage) {
      const missing = [!ogTitle && 'og:title', !ogDesc && 'og:description', !ogImage && 'og:image'].filter(Boolean).join(', ');
      findings.medium.push(`Missing Open Graph tags (${missing}) — links shared on Facebook, LinkedIn, Slack won't show a preview`);
    } else {
      findings.passed.push('Open Graph tags present — social sharing previews will display correctly');
    }

    // ── SEO: H1 tag ────────────────────────────────────────────────────
    const h1Count = $('h1').length;
    if (h1Count === 0) {
      findings.medium.push('No H1 heading found — every page should have one for SEO');
    } else if (h1Count > 1) {
      findings.low.push(`Multiple H1 tags found (${h1Count}) — pages should have only one`);
    } else {
      findings.passed.push('H1 heading found');
    }

    // ── SEO: Favicon ──────────────────────────────────────────────────
    const favicon = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').first().attr('href');
    if (!favicon) {
      findings.low.push('No favicon found — browser tabs and bookmarks will show a blank icon');
    } else {
      findings.passed.push('Favicon found');
    }

    // ── SEO: robots.txt ───────────────────────────────────────────────
    try {
      const robotsUrl = new URL('/robots.txt', url).href;
      const robotsRes = await axios.get(robotsUrl, { timeout: 5000, headers: REQUEST_HEADERS });
      if (robotsRes.status === 200) {
        findings.passed.push('robots.txt found');
      }
    } catch {
      findings.low.push('No robots.txt found — search engines have no crawl instructions for this site');
    }

    // ── SEO: sitemap.xml ──────────────────────────────────────────────
    try {
      const sitemapUrl = new URL('/sitemap.xml', url).href;
      const sitemapRes = await axios.get(sitemapUrl, { timeout: 5000, headers: REQUEST_HEADERS });
      if (sitemapRes.status === 200) {
        findings.passed.push('sitemap.xml found');
      }
    } catch {
      findings.low.push('No sitemap.xml found — search engines may miss pages on this site');
    }

    // ── Accessibility: images without alt text ─────────────────────────
    const images = $('img');
    let missingAlt = 0;
    const brokenImages = [];
    images.each((i, img) => {
      const alt = $(img).attr('alt');
      if (!alt || alt.trim() === '') missingAlt++;
    });
    if (missingAlt > 0) {
      findings.medium.push(`${missingAlt} image(s) missing alt text — accessibility and SEO issue`);
    } else if (images.length > 0) {
      findings.passed.push(`All ${images.length} images have alt text`);
    }

    // ── Accessibility: broken images ──────────────────────────────────
    const imgSrcs = [];
    images.each((i, img) => {
      const src = $(img).attr('src');
      if (src && !src.startsWith('data:')) {
        try { imgSrcs.push(new URL(src, url).href); } catch {}
      }
    });
    const uniqueImgSrcs = [...new Set(imgSrcs)].slice(0, 15);
    for (const src of uniqueImgSrcs) {
      try {
        const res = await axios.head(src, { timeout: 5000, headers: REQUEST_HEADERS });
        if (res.status >= 400) brokenImages.push(src);
      } catch {}
    }
    if (brokenImages.length > 0) {
      findings.critical.push(`${brokenImages.length} broken image(s) found — users will see missing image icons`);
    } else if (uniqueImgSrcs.length > 0) {
      findings.passed.push(`All ${uniqueImgSrcs.length} images load correctly`);
    }

    // ── Accessibility: form inputs without labels ──────────────────────
    const inputs = $('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
    let unlabeledInputs = 0;
    inputs.each((i, input) => {
      const id = $(input).attr('id');
      const ariaLabel = $(input).attr('aria-label');
      const ariaLabelledBy = $(input).attr('aria-labelledby');
      const hasLabel = id && $(`label[for="${id}"]`).length > 0;
      if (!hasLabel && !ariaLabel && !ariaLabelledBy) unlabeledInputs++;
    });
    if (unlabeledInputs > 0) {
      findings.medium.push(`${unlabeledInputs} form input(s) missing labels — screen readers can't identify these fields`);
    } else if (inputs.length > 0) {
      findings.passed.push(`All ${inputs.length} form inputs have labels`);
    }

    // ── Accessibility: links with no text ─────────────────────────────
    let emptyLinks = 0;
    $('a').each((i, el) => {
      const text = $(el).text().trim();
      const ariaLabel = $(el).attr('aria-label');
      const img = $(el).find('img[alt]').length;
      if (!text && !ariaLabel && !img) emptyLinks++;
    });
    if (emptyLinks > 0) {
      findings.medium.push(`${emptyLinks} link(s) have no text — screen readers can't describe these to users`);
    }

    // ── Technical: duplicate IDs ──────────────────────────────────────
    const idCounts = {};
    $('[id]').each((i, el) => {
      const id = $(el).attr('id');
      idCounts[id] = (idCounts[id] || 0) + 1;
    });
    const duplicateIds = Object.entries(idCounts).filter(([, count]) => count > 1).map(([id]) => id);
    if (duplicateIds.length > 0) {
      findings.medium.push(`${duplicateIds.length} duplicate ID(s) found — IDs must be unique per page (${duplicateIds.slice(0, 3).join(', ')}${duplicateIds.length > 3 ? '...' : ''})`);
    } else {
      findings.passed.push('No duplicate IDs found');
    }

    // ── Technical: JS console errors ──────────────────────────────────
    if (consoleErrors.length > 0) {
      const sample = consoleErrors.slice(0, 2).map(e => e.slice(0, 120)).join(' | ');
      findings.medium.push(`${consoleErrors.length} JavaScript console error(s) detected on page load: ${sample}`);
    } else {
      findings.passed.push('No JavaScript console errors detected');
    }

    // ── Broken links ──────────────────────────────────────────────────
    console.log('Checking links...');
    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
        try { links.push(new URL(href, url).href); } catch {}
      }
    });

    const uniqueLinks = [...new Set(links)].slice(0, 20);
    let brokenLinks = 0;

    // Check links in parallel batches of 5 for speed
    const checkLink = async (link) => {
      try {
        const res = await axios.head(link, { timeout: 8000, maxRedirects: 5, headers: REQUEST_HEADERS });
        if (res.status >= 400) { findings.critical.push(`Broken link (${res.status}): ${link}`); brokenLinks++; }
      } catch {
        try {
          const res = await axios.get(link, { timeout: 8000, maxRedirects: 5, headers: REQUEST_HEADERS });
          if (res.status >= 400) { findings.critical.push(`Broken link (${res.status}): ${link}`); brokenLinks++; }
        } catch (err2) {
          const status = err2.response?.status;
          if (status === 403 || status === 429 || status === 401) {
            findings.low.push(`Link protected/restricted (${status}): ${link}`);
          } else {
            findings.critical.push(`Broken link (unreachable): ${link}`);
            brokenLinks++;
          }
        }
      }
    };

    const batchSize = 5;
    for (let i = 0; i < uniqueLinks.length; i += batchSize) {
      const batch = uniqueLinks.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(checkLink));
    }

    if (brokenLinks === 0 && uniqueLinks.length > 0) {
      findings.passed.push(`All ${uniqueLinks.length} links checked — none broken`);
    }

    // ── Mobile viewport ────────────────────────────────────────────────
    const mobileViewport = $('meta[name="viewport"]').attr('content');
    if (!mobileViewport) {
      findings.critical.push('No viewport meta tag — site will not display correctly on mobile');
    } else {
      findings.passed.push('Viewport meta tag present — mobile rendering supported');
    }

  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('ERR_NAME_NOT_RESOLVED') || msg.includes('getaddrinfo')) {
      findings.critical.push(`Site not found — check the URL is correct and the site is live`);
    } else if (msg.includes('Timeout') || msg.includes('timeout')) {
      findings.critical.push(`Scan timed out — the site took too long to respond (over 30 seconds). It may be down or blocking scanners.`);
    } else if (msg.includes('ERR_CONNECTION_REFUSED')) {
      findings.critical.push(`Connection refused — the site actively rejected the connection. It may be down.`);
    } else if (msg.includes('403') || msg.includes('Forbidden')) {
      findings.critical.push(`Site blocked the scanner (403 Forbidden) — this site does not allow automated scanning.`);
    } else {
      findings.critical.push(`Could not load page — ${msg}`);
    }
  }

  await browser.close();
  return findings;
}

function printReport(findings) {
  console.log('\n========================================');
  console.log('           CRAWLQA REPORT');
  console.log('========================================');
  console.log(`URL: ${findings.url}`);
  console.log(`Scanned: ${new Date(findings.scannedAt).toLocaleString()}`);
  console.log('----------------------------------------');
  console.log(`\n🔴 CRITICAL (${findings.critical.length})`);
  findings.critical.length === 0 ? console.log('  None') : findings.critical.forEach(i => console.log(`  • ${i}`));
  console.log(`\n🟡 MEDIUM (${findings.medium.length})`);
  findings.medium.length === 0 ? console.log('  None') : findings.medium.forEach(i => console.log(`  • ${i}`));
  console.log(`\n🔵 LOW (${findings.low.length})`);
  findings.low.length === 0 ? console.log('  None') : findings.low.forEach(i => console.log(`  • ${i}`));
  console.log(`\n✅ PASSED (${findings.passed.length})`);
  findings.passed.forEach(i => console.log(`  • ${i}`));
  const total = findings.critical.length + findings.medium.length + findings.low.length;
  console.log(`\n----------------------------------------`);
  console.log(`Total issues found: ${total}`);
  console.log('========================================\n');
}

module.exports = { crawlSite, printReport };

if (require.main === module) {
  const url = process.argv[2];
  if (!url) { console.log('Usage: node crawler.js https://yourwebsite.com'); process.exit(1); }
  crawlSite(url).then(printReport).catch(console.error);
}

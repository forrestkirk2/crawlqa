# 🕷️ CrawlQA — Website Health Scanner

CrawlQA is a free, local website health scanner that checks your site for broken links, SEO issues, accessibility problems, security gaps, and more — all running privately on your own machine.

## Quick Start

```bash
node launch.js
```

Then open your browser to **http://localhost:3000**, paste any URL, and hit **Run Scan**.

## What It Checks

**Security**
- HTTPS encryption
- Clickjacking protection headers (X-Frame-Options)
- Content-type sniffing headers

**SEO**
- Page title (existence and length)
- Meta description (existence and length)
- H1 heading (missing or multiple)
- Open Graph / social sharing tags (og:title, og:description, og:image)
- Canonical URL tag
- Favicon
- robots.txt
- sitemap.xml

**Accessibility**
- Images missing alt text
- Form inputs without labels
- Links with no text
- HTML language attribute

**Performance**
- Page load time (flags slow pages)
- Broken images

**Technical**
- Broken links (checks up to 20, in parallel)
- Duplicate IDs
- JavaScript console errors
- Mobile viewport tag
- HTTP status code

## Output

Every scan produces:
- **A–F site grade** based on issues found
- Color-coded report: 🔴 Critical / 🟡 Medium / 🔵 Low / ✅ Passed
- **Downloadable PDF** report you can share with clients or developers

## Requirements

- [Node.js](https://nodejs.org/) v18 or higher
- [Ollama](https://ollama.com/) (optional, for `ollama launch crawlqa`)

## Install & Run

```bash
# Clone or download the project
git clone https://github.com/your-username/crawlqa
cd crawlqa

# Install dependencies
npm install
npx playwright install chromium

# Start CrawlQA
node launch.js
```

## Tips

- Works best on small-to-medium business websites
- Large sites with aggressive bot protection (e.g. enterprise CDNs) may block some checks
- Scan individual pages for the most accurate results — paste `/about`, `/contact`, etc. separately
- The "Scan another page" button appears after each scan for quick page-by-page testing

## Roadmap

- [ ] Multi-page crawl (set a depth and scan the whole site automatically)
- [ ] Scheduled scans with email alerts
- [ ] Hosted version at crawlqa.com with agency plans

## License

MIT — free to use, modify, and distribute.

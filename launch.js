#!/usr/bin/env node
// CrawlQA launcher — called by `ollama launch crawlqa`
const { execSync, spawn } = require('child_process');
const path = require('path');

const PORT = 3000;
const dir = __dirname;

console.log('\n🕷  CrawlQA — Website Health Scanner');
console.log('─────────────────────────────────────');

const fs = require('fs');

// Install dependencies if needed
if (!fs.existsSync(path.join(dir, 'node_modules'))) {
  console.log('📦 Installing dependencies...');
  execSync('npm install', { cwd: dir, stdio: 'inherit' });
  execSync('npx playwright install chromium', { cwd: dir, stdio: 'inherit' });
}

// Start the server
const server = spawn('node', ['server.js'], { cwd: dir, stdio: 'inherit' });

// Open browser after short delay
setTimeout(() => {
  const url = `http://localhost:${PORT}`;
  const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { execSync(`${open} ${url}`); } catch (e) {}
}, 1500);

process.on('SIGINT', () => { server.kill(); process.exit(); });
process.on('SIGTERM', () => { server.kill(); process.exit(); });

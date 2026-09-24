#!/usr/bin/env node
// Screenshot hd.html through the GPU headless Chrome on Unraid (real WebGL on the Arc B60).
//   node tools/shot-hd.mjs '<query>' out.png            e.g. 'ids=orion&poses=idle,left,slideL,hit,cheer&views=chase,front'
//   node tools/shot-hd.mjs 'perf=1&ids=orion,kingdad,mum,sootie' -      prints window.__perf, no image
// Needs playwright-core (tools/charfab/node_modules). The page is always closed in a finally.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(new URL('./charfab/package.json', import.meta.url))
const { chromium } = require('playwright-core')

const q = process.argv[2] || ''
const out = process.argv[3] || 'shots/hd.png'
const BASE = process.env.BASE || 'http://192.168.15.78:8960'
const browser = await chromium.connectOverCDP(process.env.CDP || 'http://192.168.15.100:9333')
const ctx = browser.contexts()[0] || await browser.newContext()
const page = await ctx.newPage()
const logs = []
try {
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  page.on('pageerror', e => logs.push('pageerror: ' + e.message.slice(0, 300)))
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 200)) })
  page.on('response', r => { if (r.status() >= 400) logs.push(`${r.status()} ${r.url()}`) })
  await page.setViewportSize({ width: Number(process.env.W || 1280), height: Number(process.env.H || 800) })
  await page.goto(`${BASE}/hd.html?${q}`, { waitUntil: 'load', timeout: 90000 })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 })
  // size the viewport to the canvas so the whole grid is captured
  const [w, h] = await page.evaluate(() => { const c = document.querySelector('canvas'); return [c.width, c.height] })
  await page.setViewportSize({ width: w, height: h })
  const res = await page.evaluate(() => ({ perf: window.__perf, errs: window.__errs, info: document.getElementById('info').textContent }))
  if (out !== '-') {
    fs.mkdirSync(out.replace(/\/[^/]*$/, '') || '.', { recursive: true })
    fs.writeFileSync(out, await page.screenshot())
    console.log('shot', out, `${w}x${h}`)
  }
  console.log(JSON.stringify({ ...res, logs: logs.slice(0, 15) }))
} finally {
  await page.close().catch(() => {})
  await browser.close().catch(() => {})
}

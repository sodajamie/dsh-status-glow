import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Package root: lib/index.js -> package root. Keeps the bundle relocatable
// when installed as a normal DSH npm plugin (node_modules or a local link).
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Debug dump: the browser half POSTs candidate/selection ground truth here.
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DEBUG_FILE = path.join(DSH_HOME, 'dsh-status-glow-debug.jsonl')

const name = 'dsh-status-glow'
const inject = ['webServer']

function apply(ctx) {
  const disposers = []

  // Browser half, read once at startup (same pattern as dsh-whale-widget's
  // WIDGET_JS: a static string served over same-origin HTTP).
  let script = ''
  try {
    script = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'status.js'), 'utf8')
  } catch (err) {
    script = ''
  }

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-status-glow/status.js',
    handler: (req, res) => {
      if (!script) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('dsh-status-glow: lib/status.js missing')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(script)
    },
  }))

  // Debug endpoint: browser half POSTs JSON candidate/selection snapshots,
  // appended line-by-line to ~/.dsh/dsh-status-glow-debug.jsonl. Used only to
  // verify targeting against the real DOM; harmless when unused.
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-status-glow/debug',
    handler: (req, res) => {
      let body = ''
      req.on('data', (d) => { body += d })
      req.on('end', () => {
        try {
          fs.appendFileSync(DEBUG_FILE, body + '\n')
          res.writeHead(204)
          res.end()
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('debug write failed')
        }
      })
      req.on('error', () => {
        res.writeHead(400)
        res.end()
      })
    },
  }))

  disposers.push(ctx.webServer.tapIndex((html) => {
    if (!script || html.indexOf('/dsh-status-glow/status.js') !== -1) return html
    const tag = '<script defer src="/dsh-status-glow/status.js"></script>'
    if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
    return html + tag
  }))

  ctx.effect(() => () => {
    for (const d of disposers) {
      try { d() } catch (err) {}
    }
  })
}

export { name, inject, apply }

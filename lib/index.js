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
// 配置持久化文件：localStorage 随 DSH 重启（随机端口）失效，宿主文件端口无关。
const SETTINGS_FILE = path.join(DSH_HOME, 'dsh-status-glow-config.json')

const name = 'dsh-status-glow'
const inject = ['webServer']

function apply(ctx) {
  const disposers = []

  // Browser halves, read once at startup (same pattern as dsh-whale-widget's
  // WIDGET_JS: static strings served over same-origin HTTP).
  // text-pools.js MUST be injected BEFORE status.js (tapIndex order below),
  // so window.__DSH_STATUS_GLOW_TEXT_POOLS__ is defined when status.js boots.
  let script = ''
  let poolsScript = ''
  try {
    script = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'status.js'), 'utf8')
  } catch (err) {
    script = ''
  }
  try {
    poolsScript = fs.readFileSync(path.join(PACKAGE_ROOT, 'lib', 'text-pools.js'), 'utf8')
  } catch (err) {
    poolsScript = ''
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

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-status-glow/text-pools.js',
    handler: (req, res) => {
      if (!poolsScript) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('dsh-status-glow: lib/text-pools.js missing')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(poolsScript)
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

  // Settings persistence: GET returns the stored config ({} when none);
  // POST saves the browser half's full getConfig() to a port-independent file,
  // so customizations survive DSH restarts (localStorage is origin-scoped and
  // resets when the app restarts on a new random port).
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-status-glow/settings',
    handler: (req, res) => {
      if (req.method === 'POST' || req.method === 'PUT') {
        let body = ''
        req.on('data', (d) => { body += d })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body)
            if (parsed && typeof parsed === 'object') {
              fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
              fs.writeFileSync(SETTINGS_FILE, JSON.stringify(parsed, null, 2))
              res.writeHead(204)
            } else {
              res.writeHead(400)
            }
            res.end()
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('settings write failed')
          }
        })
        req.on('error', () => { res.writeHead(400); res.end() })
        return
      }
      // GET
      try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(raw)
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end('{}')
      }
    },
  }))

  // Inject order matters: text-pools.js first, then status.js. Both are
  // inserted right before </body> in sequence, so they run in document order.
  disposers.push(ctx.webServer.tapIndex((html) => {
    if ((!script && !poolsScript) || html.indexOf('/dsh-status-glow/status.js') !== -1) return html
    let out = html
    if (poolsScript && out.indexOf('/dsh-status-glow/text-pools.js') === -1) {
      const poolsTag = '<script defer src="/dsh-status-glow/text-pools.js"></script>'
      out = out.indexOf('</body>') !== -1 ? out.replace('</body>', poolsTag + '</body>') : out + poolsTag
    }
    if (script && out.indexOf('/dsh-status-glow/status.js') === -1) {
      const tag = '<script defer src="/dsh-status-glow/status.js"></script>'
      out = out.indexOf('</body>') !== -1 ? out.replace('</body>', tag + '</body>') : out + tag
    }
    return out
  }))

  ctx.effect(() => () => {
    for (const d of disposers) {
      try { d() } catch (err) {}
    }
  })
}

export { name, inject, apply }

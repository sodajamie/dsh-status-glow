// dsh-status-glow browser half (v3 — configurable).
//
// 功能：
// - 精确定位 DSH Web GUI 的「最下方总状态」文本节点（思考/消息上下文强排除，
//   shadow DOM 递归遍历，MIN_SCORE 门槛防误替换对话文本），把原文替换为自定义文本。
// - 文字样式可配置：纯色 / 从左到右渐变（background-clip:text + 透明字色），
//   辉光 text-shadow 支持关闭 / 柔和白光 / 自定义多层，动画预留（内置流动渐变）。
// - 所有内联样式经 !important 强制，不被应用主题蓝色覆盖；unglow 对称清理。
//
// 配置入口（二选一或同时）：
//   1) 初始化参数：脚本加载前设置 window.__DSH_STATUS_GLOW_CONFIG__ = {...}
//   2) 运行时：window.__dshStatusGlow.configure({...})，或
//      window.postMessage({ __dshStatusGlow: 'config', config: {...} }, '*')
// 详见 README「自定义接口」。
//
// 纯核心（MATCH / 评分 / 配置归一化）导出给 node 单测（test/status.test.mjs）。
(function (global) {
  'use strict'

  // Matches "Deep diving", "Deep diving...", "deep dive…", "DeepDiving",
  // "DEEP DIVING ..." etc. — case/spacing/dots-agnostic.
  var MATCH = /deep\s*div/i

  // ── Targeting hints ────────────────────────────────────────────────────
  // Class/id tokens on the candidate's ancestor chain.
  // "总状态"容器加分；思考/消息上下文强排除（-8，任何候选低于 0 一律不选）。
  var STATUS_HINT = /status|state|footer|bottom|overall|global|总状态|agent|work|tool|progress/i
  var THINK_HINT = /think|reason|思考|message|assistant|answer|bubble|chat|msg|conversation|history/i

  var GLOW_CLASS = 'dsh-status-glow'
  var FLOW_ANIM = 'dshsg-flow 3s linear infinite'
  var SOFT_WHITE_SHADOW = '0 0 10px rgba(255,255,255,.4), 0 0 22px rgba(255,255,255,.22)'
  // 持久化键：configure() 写入、boot 读取（origin 作用域，随页面刷新保留）。
  var CONFIG_KEY = 'dsh-status-glow:config'

  // ── 可自定义样式配置（默认值即当前既有行为，向后兼容）──────────────────
  var DEFAULTS = {
    // 替换后的完整静态文本（含省略号）
    text: '正在深度烧烤...',
    // 从左到右渐变：合法 hex 颜色数组（≥2 色）。与 color 互斥，渐变优先。
    // 默认：色相等距 30° 的 12 色标 + 首尾同色闭环（hsl(h,100%,70%)）——
    // 每段只移动一个 RGB 通道、变化速率均匀，头尾无缝无停顿。
    gradientColors: ['#ff6b6b', '#ffb36b', '#ffff6b', '#b3ff6b', '#6bff6b', '#6bffb3',
      '#6bffff', '#6bb3ff', '#6b6bff', '#b36bff', '#ff6bff', '#ff6bb3', '#ff6b6b'],
    // 纯色（hex / rgb() / hsl() / 命名色）。仅当 gradientColors 无效或未传时生效。
    color: null,
    // 辉光：false='关闭' | 'soft-white'=柔和白光(默认) | 字符串原串 | 层数组
    textShadow: 'soft-white',
    // 动画：null=false=关闭 | 'flow'=内置流动渐变 | 任意 CSS animation 原串
    animation: null,
  }

  // ── 校验与归一化（纯函数，可单测）──────────────────────────────────────

  function isHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)
  }

  // 纯色校验（宽松）：hex / rgb() / rgba() / hsl() / hsla() / 命名色。
  function isCssColor(v) {
    if (typeof v !== 'string' || !v) return false
    return /^#([0-9a-fA-F]{3,8})$/.test(v) ||
           /^(rgb|rgba|hsl|hsla)\(/i.test(v) ||
           /^[a-zA-Z]+$/.test(v)
  }

  // textShadow 归一化：返回 false（关闭）或一个 text-shadow 字符串。
  //   数组元素可为字符串原串，或 {color, x, y, blur}（x/y/blur 默认 0/0/8px）。
  function normalizeTextShadow(input) {
    if (input === false || input === 'none' || input === '') return false
    if (input === undefined || input === 'soft-white') return SOFT_WHITE_SHADOW
    if (Array.isArray(input)) {
      var layers = []
      for (var i = 0; i < input.length; i++) {
        var layer = input[i]
        if (typeof layer === 'string' && layer.trim()) {
          layers.push(layer.trim())
        } else if (layer && typeof layer === 'object') {
          var color = isCssColor(layer.color) ? layer.color : '#ffffff'
          var x = typeof layer.x === 'number' && isFinite(layer.x) ? layer.x : 0
          var y = typeof layer.y === 'number' && isFinite(layer.y) ? layer.y : 0
          var blur = typeof layer.blur === 'number' && isFinite(layer.blur) && layer.blur >= 0 ? layer.blur : 8
          layers.push(x + 'px ' + y + 'px ' + blur + 'px ' + color)
        }
      }
      return layers.length ? layers.join(', ') : false
    }
    if (typeof input === 'string' && input.trim()) return input.trim()
    return SOFT_WHITE_SHADOW // 非法值 → 回退柔和白光
  }

  // animation 归一化：返回 null（关闭）/ 'flow'（内置）/ 原串。
  function normalizeAnimation(input) {
    if (input === false || input === null || input === undefined || input === '') return null
    if (input === 'flow') return 'flow'
    if (typeof input === 'string' && input.trim()) return input.trim()
    return null
  }

  // 归一化完整配置：填充默认值、校验、非法回退，并落实「渐变 > 纯色」互斥。
  function normalizeConfig(input) {
    var src = (input && typeof input === 'object') ? input : {}
    var cfg = {
      text: DEFAULTS.text,
      gradientColors: null,
      color: null,
      textShadow: SOFT_WHITE_SHADOW,
      animation: null,
    }

    if (typeof src.text === 'string' && src.text.length > 0) cfg.text = src.text

    if (Array.isArray(src.gradientColors)) {
      var gc = []
      for (var i = 0; i < src.gradientColors.length; i++) {
        if (isHexColor(src.gradientColors[i])) gc.push(src.gradientColors[i])
      }
      if (gc.length >= 2) cfg.gradientColors = gc
    }
    if (isCssColor(src.color)) cfg.color = src.color

    if (!cfg.gradientColors && !cfg.color) {
      cfg.gradientColors = DEFAULTS.gradientColors.slice() // 两者都缺 → 默认彩虹渐变
    } else if (cfg.gradientColors) {
      cfg.color = null // 渐变优先
    }

    cfg.textShadow = normalizeTextShadow(src.textShadow)
    cfg.animation = normalizeAnimation(src.animation)
    return cfg
  }

  // 由配置推出具体内联样式值（纯函数，可单测）。
  function resolveStyle(cfg) {
    var st = {
      gradient: null,       // background-image 值（渐变路径）
      color: null,          // 纯色值，或渐变路径下的 'transparent'
      shadow: null,         // text-shadow 值（null=关闭）
      animation: null,      // animation 值（null=关闭）
      backgroundSize: null, // flow 动画所需 background-size
    }
    if (cfg.gradientColors && cfg.gradientColors.length >= 2) {
      st.gradient = 'linear-gradient(90deg,' + cfg.gradientColors.join(',') + ')'
      st.color = 'transparent'
    } else {
      st.color = cfg.color || '#ffffff'
    }
    st.shadow = cfg.textShadow === false ? null : (cfg.textShadow || null)
    if (cfg.animation === 'flow') {
      st.animation = FLOW_ANIM
      st.backgroundSize = '200% auto'
    } else if (cfg.animation) {
      st.animation = cfg.animation
    }
    return st
  }

  // ── Pure core (unit-testable in node) ──────────────────────────────────

  // Minimum score for a candidate to be acceptable. Ground truth (debug log)
  // showed /deep\s*div/i can also match ordinary conversation text rendered
  // as markdown; such text scores 0 (mid-screen, no hints) and must never be
  // replaced. Only candidates with a status-like feature are allowed:
  //   +4 status/footer hint | +3 pinned to viewport bottom | +2 lower half
  // so MIN_SCORE = 3 admits "status hint" / "pinned bottom" but rejects
  // neutral text (0) and lower-half-only text (2).
  var MIN_SCORE = 3

  // c: { classes: lowercased ancestor class/id chain, rect: {top,bottom}, vh }
  function scoreCandidate(c) {
    var score = 0
    var info = String(c.classes || '')
    if (STATUS_HINT.test(info)) score += 4
    if (THINK_HINT.test(info)) score -= 8
    var vh = c.vh || 800
    var top = typeof c.rect.top === 'number' ? c.rect.top : -1
    var bottom = typeof c.rect.bottom === 'number' ? c.rect.bottom : -1
    if (bottom >= vh - 8) score += 3 // 吸附视口底部 = 最下方总状态
    else if (top > vh * 0.55) score += 2 // 屏幕下半区
    return score
  }

  // Pick the single best candidate; null when nothing is acceptable
  // (thinking/message context, ordinary text, mid-screen neutral text →
  // 不替换、不发光)。平局按 rect.top 更大（更靠下）者胜。
  function selectCandidate(list) {
    if (!list || !list.length) return null
    var best = null
    var bestScore = -Infinity
    for (var i = 0; i < list.length; i++) {
      var s = scoreCandidate(list[i])
      if (best === null || s > bestScore ||
          (s === bestScore && list[i].rect.top > best.rect.top)) {
        best = list[i]
        bestScore = s
      }
    }
    return bestScore < MIN_SCORE ? null : best
  }

  // ── DOM side (browser only) ────────────────────────────────────────────

  function classChain(el, depth) {
    var out = ''
    var cur = el
    for (var i = 0; i < depth && cur; i++) {
      if (cur.className) out += ' ' + String(cur.className)
      if (cur.id) out += ' #' + String(cur.id)
      cur = cur.parentElement
    }
    return out.toLowerCase()
  }

  function describeTextNode(node) {
    var el = node.parentElement
    var vh = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 800
    var rect = { top: -1, bottom: -1 }
    try {
      var r = el.getBoundingClientRect()
      rect = { top: r.top, bottom: r.bottom }
    } catch (e) {}
    return {
      node: node,
      el: el,
      classes: classChain(el, 8),
      rect: rect,
      vh: vh,
    }
  }

  // Walk text nodes of a root AND recurse into open shadow roots, so a
  // bottom status rendered inside a web component is still found.
  function collectCandidates(root) {
    var out = []
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    var n
    while ((n = walker.nextNode())) {
      if (MATCH.test(n.data)) out.push(describeTextNode(n))
    }
    var hosts = root.querySelectorAll ? root.querySelectorAll('*') : []
    for (var i = 0; i < hosts.length; i++) {
      var sr = hosts[i].shadowRoot
      if (sr) out = out.concat(collectCandidates(sr))
    }
    return out
  }

  function subtreeHasMatch(node) {
    if (node.nodeType === 3) return MATCH.test(node.data)
    if (node.nodeType !== 1) return false
    var w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    var n
    while ((n = w.nextNode())) if (MATCH.test(n.data)) return true
    return false
  }

  // ── Glow lifecycle ─────────────────────────────────────────────────────
  // 内联样式由 currentStyle（源自 currentCfg）驱动，全部带 !important：
  //   渐变路径：background-image + background-clip(text) + 透明字色（6 属性）
  //   纯色路径：color + -webkit-text-fill-color（不动 background，保原背景）
  //   辉光    ：text-shadow 多层合成（关闭则移除）
  //   动画    ：animation（+ flow 所需 background-size）
  // unglow 对称 removeProperty 清理全部属性。
  var currentCfg = normalizeConfig(null)
  var currentStyle = resolveStyle(currentCfg)
  var glowed = new Set()

  function glow(el) {
    if (!el) return
    el.classList.add(GLOW_CLASS)
    var s = el.style
    var st = currentStyle
    if (st.gradient) {
      s.setProperty('background-image', st.gradient, 'important')
      s.setProperty('-webkit-background-clip', 'text', 'important')
      s.setProperty('background-clip', 'text', 'important')
      s.setProperty('-webkit-text-fill-color', 'transparent', 'important')
      s.setProperty('color', 'transparent', 'important')
    } else {
      s.removeProperty('background-image')
      s.removeProperty('-webkit-background-clip')
      s.removeProperty('background-clip')
      s.setProperty('-webkit-text-fill-color', st.color, 'important')
      s.setProperty('color', st.color, 'important')
    }
    if (st.backgroundSize) s.setProperty('background-size', st.backgroundSize, 'important')
    else s.removeProperty('background-size')
    if (st.animation) s.setProperty('animation', st.animation, 'important')
    else s.removeProperty('animation')
    if (st.shadow) s.setProperty('text-shadow', st.shadow, 'important')
    else s.removeProperty('text-shadow')
    glowed.add(el)
  }

  function unglow(el) {
    el.classList.remove(GLOW_CLASS)
    var s = el.style
    s.removeProperty('background-image')
    s.removeProperty('-webkit-background-clip')
    s.removeProperty('background-clip')
    s.removeProperty('-webkit-text-fill-color')
    s.removeProperty('color')
    s.removeProperty('text-shadow')
    s.removeProperty('background-size')
    s.removeProperty('animation')
    glowed.delete(el)
  }

  // Remove glow from elements whose text no longer contains our replacement
  // (status finished / element detached) — no stale styling on other text.
  function sweepGlow() {
    glowed.forEach(function (el) {
      if (!el.isConnected) { unglow(el); return }
      var rec = origTexts.get(el)
      var applied = rec ? rec.applied : currentCfg.text
      if (String(el.textContent).indexOf(applied) === -1) unglow(el)
    })
  }

  // ── Targeting + application ────────────────────────────────────────────

  // 记录被替换元素的原文 / 文本节点 / 已应用文本，供切换目标时精确还原。
  var origTexts = new Map()

  function applyTo(cand) {
    var rec = origTexts.get(cand.el)
    if (!rec) {
      rec = { orig: cand.node.data, node: cand.node, applied: currentCfg.text }
      origTexts.set(cand.el, rec)
    } else {
      rec.node = cand.node
      rec.applied = currentCfg.text
      // 只有当节点数据不是我们的替换文本时才刷新原文（应用写回 "Deep diving"）
      if (cand.node.data !== currentCfg.text) rec.orig = cand.node.data
    }
    cand.node.data = currentCfg.text
    glow(cand.el)
  }

  // Restore the original text only if the element still shows our exact
  // replacement (never clobber app-written content).
  function restoreText(el) {
    var rec = origTexts.get(el)
    if (!rec) return
    origTexts.delete(el)
    try {
      if (rec.node && rec.node.nodeType === 3 && rec.node.data === rec.applied) {
        rec.node.data = rec.orig
      }
    } catch (e) {}
  }

  function retarget() {
    var cands = collectCandidates(document.body)
    var chosen = selectCandidate(cands)
    var target = chosen ? chosen.el : null
    glowed.forEach(function (el) {
      if (el !== target) {
        unglow(el)
        restoreText(el)
      }
    })
    if (chosen) applyTo(chosen)
    reportDebug(cands, chosen)
    return !!chosen
  }

  // ── 运行时配置接口 ─────────────────────────────────────────────────────
  // 持久化读写：配置随页面刷新保留（origin 作用域）。
  function readStoredConfig() {
    // 优先级：初始化参数 > localStorage 持久化配置
    try {
      if (global.window && global.window.__DSH_STATUS_GLOW_CONFIG__) {
        return global.window.__DSH_STATUS_GLOW_CONFIG__
      }
    } catch (e) {}
    try {
      var raw = global.localStorage && global.localStorage.getItem(CONFIG_KEY)
      if (raw) return JSON.parse(raw)
    } catch (e) {}
    return null
  }

  function persistConfig() {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(CONFIG_KEY, JSON.stringify(getConfig()))
      }
    } catch (e) {}
  }

  // configure(partial)：浅合并 + 归一化 + 校验回退，重算样式并把新样式/文本
  // 即时套用到当前已发光元素，并持久化。返回 { ok, config, style }。
  function configure(partial) {
    var merged = {
      text: currentCfg.text,
      gradientColors: currentCfg.gradientColors ? currentCfg.gradientColors.slice() : undefined,
      color: currentCfg.color,
      textShadow: currentCfg.textShadow,
      animation: currentCfg.animation,
    }
    if (partial && typeof partial === 'object') {
      if ('text' in partial) merged.text = partial.text
      if ('gradientColors' in partial) merged.gradientColors = partial.gradientColors
      if ('color' in partial) merged.color = partial.color
      if ('textShadow' in partial) merged.textShadow = partial.textShadow
      if ('animation' in partial) merged.animation = partial.animation
    }
    currentCfg = normalizeConfig(merged)
    currentStyle = resolveStyle(currentCfg)
    persistConfig()

    // 即时套用：更新已发光元素的文本（若仍显示旧替换文本）与样式。
    glowed.forEach(function (el) {
      if (!el.isConnected) return
      var rec = origTexts.get(el)
      if (rec && rec.node && rec.node.data === rec.applied) {
        rec.node.data = currentCfg.text
        rec.applied = currentCfg.text
      }
      glow(el)
    })

    return { ok: true, config: getConfig(), style: currentStyle }
  }

  function getConfig() {
    return {
      text: currentCfg.text,
      gradientColors: currentCfg.gradientColors ? currentCfg.gradientColors.slice() : null,
      color: currentCfg.color,
      textShadow: currentCfg.textShadow,
      animation: currentCfg.animation,
    }
  }

  // 纯解析接口（预览用）：把一段配置归一化并解析为内联样式值，
  // 不修改任何全局状态、不套用到真实状态元素 —— 设置页预览与真实效果
  // 共用同一套 resolveStyle 机制，保证所见即所得。
  function resolveStyles(config) {
    return resolveStyle(normalizeConfig(config))
  }

  // ── Debug reporter ─────────────────────────────────────────────────────
  // Reports the chosen target + its computed styles to the host route, which
  // appends one JSON line to ~/.dsh/dsh-status-glow-debug.jsonl. Used to
  // verify targeting and the applied text colour against the real DOM.
  var DEBUG_URL = '/dsh-status-glow/debug'

  // Throttle: report only when the CHOSEN ELEMENT changes identity, at most
  // once per 30s. The app rewrites the turn-status text every ~1s and the
  // plugin re-applies instantly, so chosen alternates null↔element every
  // cycle — reporting on that alternation spammed the debug file (10MB/18min).
  // A null result is no longer reported (targeting is verified); keep the
  // channel for element-identity changes and computed-style ground truth.
  var lastReportedEl = null
  var lastReportedTs = 0
  function reportDebug(cands, chosen) {
    var now = Date.now()
    if (!chosen) return
    if (chosen.el === lastReportedEl && now - lastReportedTs < 30000) return
    lastReportedEl = chosen.el
    lastReportedTs = now
    try {
      var cs = null
      try {
        var c = getComputedStyle(chosen.el)
        cs = { color: c.color, backgroundImage: c.backgroundImage, textShadow: c.textShadow }
      } catch (e) {}
      var payload = {
        ts: now,
        chosen: {
          text: chosen.node.data.slice(0, 60),
          classes: chosen.classes.slice(0, 300),
          rect: chosen.rect,
          computed: cs,
        },
      }
      fetch(DEBUG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(function () {})
    } catch (e) {}
  }

  // ── Styles + observer ──────────────────────────────────────────────────

  function injectCss() {
    if (document.getElementById('dsh-status-glow-css')) return
    var st = document.createElement('style')
    st.id = 'dsh-status-glow-css'
    var defStyle = resolveStyle(DEFAULTS)
    var cls = '.' + GLOW_CLASS + '{'
    if (defStyle.gradient) {
      cls += 'background-image:' + defStyle.gradient + ';'
        + '-webkit-background-clip:text;background-clip:text;'
        + '-webkit-text-fill-color:transparent;color:transparent;'
    } else {
      cls += 'color:' + defStyle.color + ';'
    }
    if (defStyle.shadow) cls += 'text-shadow:' + defStyle.shadow + ';'
    cls += '}'
    st.textContent = [
      // 内置流动渐变动画（animation:'flow' 时使用）
      '@keyframes dshsg-flow{0%{background-position:0% 50%}100%{background-position:200% 50%}}',
      // 静态类兜底（默认样式）；glow() 另有 inline !important 强制
      cls,
    ].join('')
    ;(document.head || document.documentElement).appendChild(st)
  }

  function handleMutations(mutations) {
    var need = false
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i]
      if (m.type === 'characterData') {
        if (m.target && MATCH.test(m.target.data)) need = true
      } else if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          if (subtreeHasMatch(m.addedNodes[j])) { need = true; break }
        }
      }
    }
    if (need) retarget()
    sweepGlow()
  }

  function onMessage(ev) {
    var data = ev && ev.data
    if (!data || typeof data !== 'object' || data.__dshStatusGlow !== 'config') return
    configure(data.config)
  }

  function boot() {
    injectCss()
    // 初始化配置：初始化参数（window.__DSH_STATUS_GLOW_CONFIG__）> localStorage 持久化 > 默认
    currentCfg = normalizeConfig(readStoredConfig())
    currentStyle = resolveStyle(currentCfg)
    retarget()
    new MutationObserver(handleMutations).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    if (global.window) {
      global.window.__dshStatusGlow = {
        version: '3.2.0',
        configure: configure,
        getConfig: getConfig,
        resolveStyles: resolveStyles,
      }
      global.window.addEventListener('message', onMessage)
    }
  }

  // ── Node testability + browser boot ────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MATCH: MATCH,
      STATUS_HINT: STATUS_HINT,
      THINK_HINT: THINK_HINT,
      MIN_SCORE: MIN_SCORE,
      GLOW_CLASS: GLOW_CLASS,
      DEFAULTS: DEFAULTS,
      scoreCandidate: scoreCandidate,
      selectCandidate: selectCandidate,
      isHexColor: isHexColor,
      isCssColor: isCssColor,
      normalizeTextShadow: normalizeTextShadow,
      normalizeAnimation: normalizeAnimation,
      normalizeConfig: normalizeConfig,
      resolveStyle: resolveStyle,
      resolveStyles: resolveStyles,
    }
    return
  }

  if (typeof global.document === 'undefined') return
  if (global.window && global.window.__dshStatusGlow) return
  if (global.window) global.window.__dshStatusGlow = true

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})(typeof window !== 'undefined' ? window : globalThis)

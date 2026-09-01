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
  // 持久化：localStorage 缓存（同 origin 刷新保留）+ 宿主文件（跨 DSH 重启，
  // 端口无关；localStorage 随随机端口重启而清空，宿主文件才是权威）。
  var CONFIG_KEY = 'dsh-status-glow:config'
  var SETTINGS_URL = '/dsh-status-glow/settings'
  var userConfigured = false // 用户在宿主配置就绪前改过配置 → 跳过宿主覆盖

  // ── 可自定义样式配置（默认值 = v0.2.0 整合发布的出厂配置）────────────────
  var DEFAULTS = {
    // 替换后的完整静态文本（含省略号）；usePools 关闭/未命中池时兜底
    text: '大肥鲸鱼正在深度烧烤...( ˊ꒳ˋ )ₚ✧',
    // 全局样式默认白字无辉光（特效由各状态池特效 poolEffects 接管）
    gradientColors: null,
    color: '#ffffff',
    textShadow: false,
    animation: null,
    // 随机文案池：默认开启（按状态从文案池抽取）
    usePools: true,
    // 随机是否允许相邻重复：默认关闭（洗牌无相邻重复）
    poolRepeat: false,
    // 各池自定义文案：{ [poolKey]: [{ text, weight }] }，附加到对应池末尾
    poolCustoms: {},
    // 各池整表覆盖：{ [poolKey]: [{ text, weight }] }，存在时完全替换该池文案（UI 增删改落盘于此）
    poolOverrides: {},
    // 各池特效：{ [poolKey]: 样式片段 }（gradientColors/color/textShadow/animation），
    // 开启 usePools 且命中该状态时，用池特效替代全局特效
    poolEffects: {
      thinking: {
        gradientColors: ['#ff6b6b', '#ffb36b', '#ffff6b', '#b3ff6b', '#6bff6b', '#6bffb3',
          '#6bffff', '#6bb3ff', '#6b6bff', '#b36bff', '#ff6bff', '#ff6bb3', '#ff6b6b'],
        animation: 'flow',
      },
      tool: {
        gradientColors: ['#fff3c4', '#ffd76a', '#ff9d2e'],
        textShadow: 'soft-white',
      },
      command: {
        color: '#ffffff',
        gradientColors: [],
        textShadow: [
          { color: '#4dc3ff', blur: 8 },
          { color: '#4dc3ff', blur: 18 },
          { color: '#b44dff', blur: 30 },
        ],
      },
      default: {
        color: '#ffffff',
        gradientColors: [],
        textShadow: false,
      },
    },
    // 自定义特效预设：[{ key, label, config }]，config 为样式片段（gradientColors/color/textShadow/animation）
    effects: [],
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
      textShadow: normalizeTextShadow(DEFAULTS.textShadow),
      animation: null,
      usePools: DEFAULTS.usePools,
    }

    if (typeof src.text === 'string' && src.text.length > 0) cfg.text = src.text
    if (src.usePools !== undefined) cfg.usePools = src.usePools === true
    cfg.poolRepeat = src.poolRepeat === undefined ? DEFAULTS.poolRepeat : src.poolRepeat === true

    if (Array.isArray(src.gradientColors)) {
      var gc = []
      for (var i = 0; i < src.gradientColors.length; i++) {
        if (isHexColor(src.gradientColors[i])) gc.push(src.gradientColors[i])
      }
      if (gc.length >= 2) cfg.gradientColors = gc
    }
    if (isCssColor(src.color)) cfg.color = src.color

    if (!cfg.gradientColors && !cfg.color) {
      // 两者都缺 → 回退出厂默认：渐变可用则渐变，否则默认纯色
      if (Array.isArray(DEFAULTS.gradientColors) && DEFAULTS.gradientColors.length >= 2) {
        cfg.gradientColors = DEFAULTS.gradientColors.slice()
      } else {
        cfg.color = DEFAULTS.color || '#ffffff'
      }
    } else if (cfg.gradientColors) {
      cfg.color = null // 渐变优先
    }

    cfg.textShadow = normalizeTextShadow(src.textShadow === undefined ? DEFAULTS.textShadow : src.textShadow)
    cfg.animation = normalizeAnimation(src.animation)
    cfg.poolCustoms = normalizePoolCustoms(src.poolCustoms)
    cfg.poolOverrides = normalizePoolCustoms(src.poolOverrides) // 与 poolCustoms 同构
    // 按池特效：逐池合并 —— 显式提供的池生效，未提供的池回退出厂默认特效
    // （这样「恢复默认」删除某池特效后回到 DEFAULTS 特效，而不是丢失特效）
    var srcPe = (src.poolEffects && typeof src.poolEffects === 'object' && !Array.isArray(src.poolEffects))
      ? src.poolEffects
      : {}
    var mergedPe = {}
    for (var peKey in DEFAULTS.poolEffects) {
      if (Object.prototype.hasOwnProperty.call(DEFAULTS.poolEffects, peKey)) {
        mergedPe[peKey] = Object.prototype.hasOwnProperty.call(srcPe, peKey) ? srcPe[peKey] : DEFAULTS.poolEffects[peKey]
      }
    }
    for (var peKey2 in srcPe) {
      if (Object.prototype.hasOwnProperty.call(srcPe, peKey2) && !Object.prototype.hasOwnProperty.call(mergedPe, peKey2)) {
        mergedPe[peKey2] = srcPe[peKey2]
      }
    }
    cfg.poolEffects = normalizePoolEffects(mergedPe)
    cfg.effects = normalizeEffects(src.effects)
    return cfg
  }

  // ── 自定义池内容 / 自定义特效（纯函数，可单测）──────────────────────────
  // 池自定义：{ [poolKey]: [{ text, weight }] }；非法项过滤，weight 默认 1。
  function normalizePoolCustoms(input) {
    var out = {}
    if (!input || typeof input !== 'object') return out
    for (var poolKey in input) {
      if (!Object.prototype.hasOwnProperty.call(input, poolKey)) continue
      var arr = input[poolKey]
      if (!Array.isArray(arr)) continue
      var entries = []
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i]
        if (e && typeof e.text === 'string' && e.text.length > 0) {
          entries.push({
            text: e.text,
            weight: typeof e.weight === 'number' && e.weight >= 1 ? Math.round(e.weight) : 1,
          })
        }
      }
      if (entries.length) out[poolKey] = entries
    }
    return out
  }

  // 特效预设：[{ key, label, config }]；key 唯一，config 为样式片段（原样保存，应用时再校验）。
  function normalizeEffects(input) {
    var out = []
    if (!Array.isArray(input)) return out
    var seen = {}
    for (var i = 0; i < input.length; i++) {
      var e = input[i]
      if (!e || typeof e !== 'object') continue
      var key = typeof e.key === 'string' && e.key ? e.key : ''
      if (!key || seen[key]) continue
      var label = typeof e.label === 'string' && e.label ? e.label : key
      var config = e.config && typeof e.config === 'object' ? e.config : {}
      seen[key] = true
      out.push({ key: key, label: label, config: config })
    }
    return out
  }

  // 把自定义池内容附加到 poolMap 对应池（无池则新建），返回同一 poolMap。
  function applyPoolCustoms(poolMap, customs) {
    if (!poolMap || !customs || typeof customs !== 'object') return poolMap
    for (var poolKey in customs) {
      if (!Object.prototype.hasOwnProperty.call(customs, poolKey)) continue
      var entries = customs[poolKey]
      if (!Array.isArray(entries) || !entries.length) continue
      var pool = poolMap['pool:' + poolKey]
      if (!pool) {
        pool = { type: poolKey, candidates: [] }
        poolMap['pool:' + poolKey] = pool
      }
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i]
        if (!e || typeof e.text !== 'string' || !e.text) continue
        pool.candidates.push({
          text: e.text,
          status: poolKey,
          weight: typeof e.weight === 'number' && e.weight >= 1 ? e.weight : 1,
          tags: ['custom'],
        })
      }
    }
    return poolMap
  }

  // 整表覆盖：存在覆盖的池，其 candidates 完全替换为覆盖列表（UI 增删改落盘于此）。
  function applyPoolOverrides(poolMap, overrides) {
    if (!poolMap || !overrides || typeof overrides !== 'object') return poolMap
    for (var poolKey in overrides) {
      if (!Object.prototype.hasOwnProperty.call(overrides, poolKey)) continue
      var entries = overrides[poolKey]
      if (!Array.isArray(entries) || !entries.length) continue
      var candidates = []
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i]
        if (!e || typeof e.text !== 'string' || !e.text) continue
        candidates.push({
          text: e.text,
          status: poolKey,
          weight: typeof e.weight === 'number' && e.weight >= 1 ? e.weight : 1,
          tags: ['custom'],
        })
      }
      if (candidates.length) poolMap['pool:' + poolKey] = { type: poolKey, candidates: candidates }
    }
    return poolMap
  }

  // 按池特效归一化：{ [poolKey]: 样式片段 }；非法值过滤（应用时再经 normalizeConfig 校验）。
  function normalizePoolEffects(input) {
    var out = {}
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out
    for (var poolKey in input) {
      if (!Object.prototype.hasOwnProperty.call(input, poolKey)) continue
      var cfg = input[poolKey]
      if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) out[poolKey] = cfg
    }
    return out
  }

  // 按状态解析特效样式：usePools 开启且该状态配置了池特效时返回对应 resolveStyle，
  // 否则返回 null（调用方回退全局 currentStyle）。纯函数，可单测。
  function resolveCandidateStyle(cfg, status) {
    if (cfg.usePools && cfg.poolEffects && cfg.poolEffects[status]) {
      return resolveStyle(normalizeConfig(cfg.poolEffects[status]))
    }
    return null
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

  // ── 随机文案池引擎（按状态分流，纯函数可单测）──────────────────────────
  // 文案池数据来自 lib/text-pools.js（window.__DSH_STATUS_GLOW_TEXT_POOLS__，
  // 宿主保证在 status.js 之前注入）。状态机与池解耦：
  //   registerStatusType(type, {detect, poolId}) —— 新状态只注册检测信号 + 池映射
  //   registerPool(pool)                            —— 新池只注册文案数据
  // 抽取机制：每池一个洗牌队列（Fisher-Yates + 权重 bag），弹出即消费；
  // 队列耗尽时按权重重建洗牌，若新队首 == 上一轮 lastDrawn 则与队尾交换，
  // 保证「同状态连续触发无相邻重复」。
  var POOL_MAP = {}   // poolId -> pool（{type, candidates}）
  var REGISTRY = []   // [{type, detect, poolId, regex?}]；regex 用于「最后出现位置」分类
  var queues = {}     // poolId -> 候选队列
  var lastDrawn = {}  // poolId -> 最近一次抽中的候选对象

  function registerPool(pool) {
    if (!pool || typeof pool !== 'object') return
    var type = typeof pool.type === 'string' ? pool.type : ''
    if (!type || !Array.isArray(pool.candidates) || pool.candidates.length === 0) return
    POOL_MAP['pool:' + type] = pool
  }

  function registerStatusType(type, opts) {
    if (typeof type !== 'string' || !type || !opts) return
    if (typeof opts.detect !== 'function' && !(opts.regex instanceof RegExp)) return
    REGISTRY.push({
      type: type,
      detect: opts.detect,
      poolId: opts.poolId || 'pool:' + type,
      regex: opts.regex instanceof RegExp ? opts.regex : null,
    })
  }

  function shuffleArr(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1))
      var t = arr[i]
      arr[i] = arr[j]
      arr[j] = t
    }
    return arr
  }

  // 按权重展开为 bag 并洗牌。allowRepeat=false 时丢弃相邻重复副本（保证
  // 队列内无相邻同文案）；true（默认）时保留，允许真随机出现连续重复。
  function weightedShuffle(candidates, allowRepeat) {
    var bag = []
    for (var i = 0; i < candidates.length; i++) {
      var n = Math.max(1, Math.round(candidates[i].weight || 1))
      for (var k = 0; k < n; k++) bag.push(candidates[i])
    }
    shuffleArr(bag)
    if (allowRepeat === false) {
      var out = []
      for (var m = 0; m < bag.length; m++) {
        if (out.length === 0 || out[out.length - 1] !== bag[m]) out.push(bag[m])
        // else：丢弃相邻重复副本（权重统计影响可忽略）
      }
      return out
    }
    return bag
  }

  function poolById(poolId) {
    return POOL_MAP[poolId] || POOL_MAP['pool:default'] || null
  }

  // 抽取一条文案；队列耗尽自动重建。返回候选对象（含 .text），池缺失返回 null。
  // allowRepeat 缺省时读取当前配置 poolRepeat（默认 true = 允许相邻重复）。
  function draw(poolId, allowRepeat) {
    var ar = allowRepeat !== undefined ? !!allowRepeat : currentCfg.poolRepeat !== false
    if (!queues[poolId] || queues[poolId].length === 0) {
      var pool = poolById(poolId)
      if (!pool) return null
      var q = weightedShuffle(pool.candidates, ar)
      if (!ar && q.length > 1 && q[0] === lastDrawn[poolId]) {
        var tmp = q[0]
        q[0] = q[q.length - 1]
        q[q.length - 1] = tmp // 不重复模式下跨轮不重复
      }
      queues[poolId] = q
    }
    var item = queues[poolId].shift()
    lastDrawn[poolId] = item
    return item
  }

  // 状态分类（纯函数，供单测）：
  // 优先「最后出现位置」——各状态关键词在上下文中最后一次出现的位置，取最靠后的
  // （最新内容 = 当前阶段；历史回合的「思考/Think」在文本更早处，不会抢先）。
  // 无 regex 的规则（自定义 detect 函数）退回按注册顺序检测。
  function classify(text) {
    var ctxText = String(text || '')
    var bestType = 'default'
    var bestPos = -1
    for (var i = 0; i < REGISTRY.length; i++) {
      var r = REGISTRY[i]
      if (!r.regex) continue
      try {
        // exec 循环需要全局正则（否则永远返回第一个匹配 → 死循环），克隆为 g
        var re = r.regex.global ? r.regex : new RegExp(r.regex.source, r.regex.flags.replace('g', '') + 'g')
        re.lastIndex = 0
        var m = null
        var lastPos = -1
        while ((m = re.exec(ctxText))) lastPos = m.index
        if (lastPos >= 0 && lastPos >= bestPos) {
          bestPos = lastPos
          bestType = r.type
        }
      } catch (e) {}
    }
    if (bestPos >= 0) return bestType
    for (var j = 0; j < REGISTRY.length; j++) {
      var r2 = REGISTRY[j]
      try {
        if (!r2.regex && r2.detect(ctxText)) return r2.type
      } catch (e) {}
    }
    return 'default'
  }

  // 浏览器侧：由候选元素生成邻近文本摘要，再分类。
  // 信号来源三路：①祖先链 + 兄弟元素；②「当前回合」文本（滚动容器最后几个子块
  // ——Think 标题/工具摘要/命令标识都在回合内容里，比 turnstatus 邻居可靠）。
  function nearbyText(cand, excludeText) {
    try {
      var el = cand && cand.el
      if (!el) return ''
      var out = ''
      // ① 祖先链 + 兄弟元素
      var cur = el.parentElement
      for (var i = 0; i < 6 && cur; i++) {
        if (cur.textContent) out += ' ' + String(cur.textContent).slice(0, 200)
        cur = cur.parentElement
      }
      if (el.parentElement) {
        var sibs = el.parentElement.children
        var max = Math.min(sibs.length, 6)
        for (var j = 0; j < max; j++) {
          if (sibs[j] !== el && sibs[j].textContent) out += ' ' + String(sibs[j].textContent).slice(0, 120)
        }
      }
      // ② 当前回合内容（滚动容器最后 3 个子块）
      out += ' ' + currentTurnText(el)
      // 剔除我们自己的替换文本，避免「正在思考…」这类文案反向污染状态判定
      if (excludeText) out = out.split(String(excludeText)).join('')
      return out
    } catch (e) { return '' }
  }

  // 爬到滚动容器（class 含 scroll/viewarea，如 md3f7g_scroll / wskvaw_scrollbody），
  // 取最后 N 个子块的文本作为「当前回合」上下文。
  function currentTurnText(el) {
    try {
      var cur = el
      var container = null
      for (var i = 0; i < 10 && cur; i++) {
        var cls = String(cur.className || '')
        if (/scroll|viewarea/i.test(cls) && cur.children && cur.children.length >= 1) {
          container = cur
          break
        }
        cur = cur.parentElement
      }
      if (!container) return ''
      var out = ''
      var kids = container.children
      var start = Math.max(0, kids.length - 3) // 当前回合 = 最后 3 个子块
      for (var k = start; k < kids.length; k++) {
        if (kids[k].textContent) out += ' ' + String(kids[k].textContent).slice(0, 400)
      }
      return out
    } catch (e) { return '' }
  }

  function detectStatus(cand, excludeText) {
    return classify(nearbyText(cand, excludeText))
  }

  // 从 text-pools.js 加载并注册默认池与默认检测规则（boot 时调用一次）。
  function loadPools() {
    try {
      var src = global.window && global.window.__DSH_STATUS_GLOW_TEXT_POOLS__
      if (!src || typeof src !== 'object') return
      for (var key in src) {
        if (Object.prototype.hasOwnProperty.call(src, key)) registerPool(src[key])
      }
    } catch (e) {}
    registerStatusType('thinking', {
      detect: function (t) { return /思考|think|推理|analyzing|reasoning/i.test(t) },
      regex: /思考|think|推理|analyzing|reasoning/i,
      poolId: 'pool:thinking',
    })
    registerStatusType('tool', {
      detect: function (t) { return /工具|tool|调用|executing|run (the )?tool|正在使用/i.test(t) },
      regex: /工具|tool|调用|executing|run (the )?tool|正在使用/i,
      poolId: 'pool:tool',
    })
    registerStatusType('command', {
      detect: function (t) { return /命令|command|shell|终端|terminal|执行|exec/i.test(t) },
      regex: /命令|command|shell|终端|terminal|执行|exec/i,
      poolId: 'pool:command',
    })
  }

  // 用内置池重建 POOL_MAP，并入自定义池内容与整表覆盖；重置抽取队列。
  // 在 boot（配置就绪后）与 configure()（每次变更后）调用，保证自定义内容即时生效。
  // 优先级：poolOverrides（整表）> 内置池 + poolCustoms（追加）。
  function rebuildPools() {
    var rebuilt = {}
    var src = global.window && global.window.__DSH_STATUS_GLOW_TEXT_POOLS__
    if (src && typeof src === 'object') {
      for (var key in src) {
        if (!Object.prototype.hasOwnProperty.call(src, key)) continue
        var pool = src[key]
        if (pool && typeof pool.type === 'string' && Array.isArray(pool.candidates)) {
          rebuilt['pool:' + pool.type] = pool
        }
      }
    }
    applyPoolCustoms(rebuilt, currentCfg.poolCustoms)
    applyPoolOverrides(rebuilt, currentCfg.poolOverrides)
    POOL_MAP = rebuilt
    queues = {}
    lastDrawn = {}
  }

  // 测试辅助：清空注册表与抽取队列。
  function resetPools() {
    POOL_MAP = {}
    REGISTRY = []
    queues = {}
    lastDrawn = {}
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

  // glow(el, styleOverride)：styleOverride 提供时（按池特效）用它替代全局 currentStyle。
  function glow(el, styleOverride) {
    if (!el) return
    el.classList.add(GLOW_CLASS)
    var s = el.style
    var st = styleOverride || currentStyle
    if (st.gradient) {
      s.setProperty('background-image', st.gradient, 'important')
      s.setProperty('-webkit-background-clip', 'text', 'important')
      s.setProperty('background-clip', 'text', 'important')
      s.setProperty('-webkit-text-fill-color', 'transparent', 'important')
      s.setProperty('color', 'transparent', 'important')
    } else {
      // 纯色路径：用 none 盖住应用自带的蓝色渐变背景，而不是 removeProperty（否则
      // 应用的 background-image 会露出来，表现为「特效消失、回到 dsh 原生蓝」）
      s.setProperty('background-image', 'none', 'important')
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

  // ── Targeting + application ────────────────────────────────────────────

  // 记录被替换元素的原文 / 文本节点 / 已应用文本，供切换目标时精确还原。
  var origTexts = new Map()

  // ── 文案变动状态机 ─────────────────────────────────────────────────────
  // 触发策略：
  //   - 同一状态下：每 5 秒定时器强制重抽一次（refreshStatus(force=true)）；
  //   - 状态交替（think→tool…）：应用更新文本时 detectStatus 变化 → 立即重抽；
  //   - 应用周期性把原文写回：仅盖回当前文案，不重新抽取（保持 5 秒节奏）。
  // 换文动画：老虎机式快速滚动（行业常见的 status ticker / slot-machine 效果），
  // 每 60–80ms 换一次随机池文案，滚动 5–7 步后落地。
  var currentStatus = null  // 当前已检测状态（null=尚未定位）
  var forcedStatus = null   // 状态强制预览（debugSetStatus 设置；非空时优先于自动检测）
  var hostStatus = null     // 宿主端权威状态（轮询 /dsh-status-glow/state，session/event 折叠而来）
  var rollTimer = null      // 滚动动画定时器（全局唯一，同一时刻只有一个状态元素）
  var rolling = new Set()   // 正在滚动动画的元素（抑制观察器/清理器干扰）

  // 生效状态：强制预览 > 宿主权威 > DOM 文本检测兜底。
  function effectiveStatus(cand, excludeText) {
    if (forcedStatus) return forcedStatus
    if (hostStatus) return hostStatus
    return detectStatus(cand, excludeText)
  }

  // 首次应用（新目标）：按当前状态做初始抽取。
  function applyFresh(rec, cand) {
    if (currentCfg.usePools) {
      currentStatus = effectiveStatus(cand, rec.orig)
      var item = draw('pool:' + currentStatus)
      rec.applied = (item && typeof item.text === 'string' && item.text) ? item.text : currentCfg.text
    } else {
      rec.applied = currentCfg.text
    }
    cand.node.data = rec.applied
    glow(cand.el, resolveCandidateStyle(currentCfg, currentStatus))
  }

  // 落地文案（滚动结束后调用；滚动中直接改 node.data，不经过这里）。
  function settle(rec, el, finalText) {
    rec.applied = finalText
    if (rec.node && rec.node.data !== finalText) rec.node.data = finalText
  }

  // 老虎机滚动动画：快速轮换池内文案后落到 finalText。
  function rollTo(rec, el, poolId, finalText, style) {
    if (rollTimer) { clearInterval(rollTimer); rollTimer = null }
    rolling.add(el)
    glow(el, style)
    var steps = 0
    var maxSteps = 5 + Math.floor(Math.random() * 3)      // 5–7 步
    var interval = 60 + Math.floor(Math.random() * 21)    // 60–80ms
    rollTimer = setInterval(function () {
      if (!el.isConnected || !origTexts.has(el)) {
        clearInterval(rollTimer); rollTimer = null
        rolling.delete(el)
        return
      }
      if (steps >= maxSteps) {
        clearInterval(rollTimer); rollTimer = null
        rolling.delete(el)
        settle(rec, el, finalText)
        return
      }
      steps++
      var item = draw(poolId)
      if (rec.node && item && typeof item.text === 'string') rec.node.data = item.text
    }, interval)
  }

  // 刷新当前状态文案：forceDraw=true（5 秒定时器 / 配置变更）或状态变化时重抽，
  // 否则仅把应用覆盖的原文盖回当前文案。forcedStatus 非空时优先（状态强制预览）。
  function refreshStatus(rec, el, forceDraw) {
    if (!currentCfg.usePools) {
      // 静态模式：盖回静态文本，不参与随机
      settle(rec, el, currentCfg.text)
      glow(el)
      return
    }
    var status = effectiveStatus({ el: el, node: rec.node }, rec.applied)
    var changed = status !== currentStatus
    currentStatus = status
    var poolId = 'pool:' + status
    var style = resolveCandidateStyle(currentCfg, status)
    if (forceDraw || changed) {
      var item = draw(poolId)
      var finalText = (item && typeof item.text === 'string' && item.text) ? item.text : currentCfg.text
      rollTo(rec, el, poolId, finalText, style) // 换文动画
    } else {
      settle(rec, el, rec.applied) // 同状态：盖回当前文案（应用刚覆盖过）
      glow(el, style)
    }
  }

  // 轮询宿主权威状态（/dsh-status-glow/state，session/event 折叠而来）。
  // 状态变化时立即刷新当前状态元素；轮询间隔 1s，事件级即时性由 5s 定时器外的
  // 「状态变化→立即重抽」保证（1s 内感知并切换）。
  function startStatusPoller() {
    setInterval(function () {
      try {
        fetch('/dsh-status-glow/state').then(function (r) { return r.json() }).then(function (data) {
          if (!data || typeof data.status !== 'string') return
          var changed = data.status !== hostStatus
          hostStatus = data.status
          if (changed && currentCfg.usePools && !forcedStatus) {
            var el = firstGlowed()
            if (el) {
              var rec = origTexts.get(el)
              if (rec) refreshStatus(rec, el, false)
            }
          }
        }).catch(function () {})
      } catch (e) {}
    }, 1000)
  }

  // 取当前活动（已发光且在文档中）的状态元素。
  function firstGlowed() {
    var el = null
    glowed.forEach(function (e) { if (e.isConnected && !el) el = e })
    return el
  }

  // 状态强制预览：debugSetStatus('tool') 立即用 tool 池文案 + tool 池特效刷新当前
  // 状态元素（供检查前端效果）；debugSetStatus('auto') 或 null 解除强制，恢复自动检测。
  function debugSetStatus(type) {
    if (!type || type === 'auto') {
      forcedStatus = null
      currentStatus = null
      var e0 = firstGlowed()
      if (e0) {
        var r0 = origTexts.get(e0)
        if (r0) refreshStatus(r0, e0, true)
      }
      return { ok: true, forced: false }
    }
    forcedStatus = type
    var el = firstGlowed()
    if (!el || !origTexts.has(el)) return { ok: false, reason: '无活动状态元素（等 agent 开始工作后再试）' }
    var rec = origTexts.get(el)
    var poolId = 'pool:' + type
    var item = draw(poolId)
    var finalText = (item && typeof item.text === 'string' && item.text) ? item.text : currentCfg.text
    rollTo(rec, el, poolId, finalText, resolveCandidateStyle(currentCfg, type))
    return { ok: true, forced: true, status: type, text: finalText }
  }

  function applyTo(cand) {
    var rec = origTexts.get(cand.el)
    if (!rec) {
      rec = { orig: cand.node.data, node: cand.node, applied: currentCfg.text }
      origTexts.set(cand.el, rec)
      applyFresh(rec, cand)
    } else {
      rec.node = cand.node
      // 应用写回原文时刷新 orig（仅当不是我们自己的文案）
      if (cand.node.data !== rec.applied) rec.orig = cand.node.data
      refreshStatus(rec, cand.el, false)
    }
  }

  // 5 秒定时器：同状态周期重抽。usePools 关闭或无活动元素时跳过。
  function startTicker() {
    setInterval(function () {
      if (!currentCfg.usePools) return
      var el = firstGlowed()
      if (!el) return
      var rec = origTexts.get(el)
      if (rec) refreshStatus(rec, el, true)
    }, 5000)
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
    // localStorage 缓存（同 origin 刷新保留）
    try {
      if (global.localStorage) {
        global.localStorage.setItem(CONFIG_KEY, JSON.stringify(getConfig()))
      }
    } catch (e) {}
    // 宿主文件持久化（跨 DSH 重启、端口无关）——权威存储
    try {
      fetch(SETTINGS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getConfig()),
      }).catch(function () {})
    } catch (e) {}
  }

  // boot 时从宿主文件异步拉取权威配置（比 localStorage 更持久）。
  // 若用户在拉取完成前已主动 configure，则跳过覆盖，避免吞掉用户操作。
  function hydrateFromHost() {
    try {
      fetch(SETTINGS_URL).then(function (r) { return r.json() }).then(function (data) {
        if (userConfigured || !data || typeof data !== 'object') return
        currentCfg = normalizeConfig(data)
        currentStyle = resolveStyle(currentCfg)
        rebuildPools()
        retarget()
      }).catch(function () {})
    } catch (e) {}
  }

  // configure(partial)：浅合并 + 归一化 + 校验回退，重算样式并把新样式/文本
  // 即时套用到当前已发光元素，并持久化。返回 { ok, config, style }。
  function configure(partial) {
    userConfigured = true // 用户侧配置优先于宿主拉取
    var merged = {
      text: currentCfg.text,
      gradientColors: currentCfg.gradientColors ? currentCfg.gradientColors.slice() : undefined,
      color: currentCfg.color,
      textShadow: currentCfg.textShadow,
      animation: currentCfg.animation,
      usePools: currentCfg.usePools,
      poolRepeat: currentCfg.poolRepeat,
      poolCustoms: currentCfg.poolCustoms,
      poolOverrides: currentCfg.poolOverrides,
      poolEffects: currentCfg.poolEffects,
      effects: currentCfg.effects,
    }
    if (partial && typeof partial === 'object') {
      if ('text' in partial) merged.text = partial.text
      if ('gradientColors' in partial) merged.gradientColors = partial.gradientColors
      if ('color' in partial) merged.color = partial.color
      if ('textShadow' in partial) merged.textShadow = partial.textShadow
      if ('animation' in partial) merged.animation = partial.animation
      if ('usePools' in partial) merged.usePools = partial.usePools
      if ('poolRepeat' in partial) merged.poolRepeat = partial.poolRepeat
      if ('poolCustoms' in partial) merged.poolCustoms = partial.poolCustoms
      if ('poolOverrides' in partial) merged.poolOverrides = partial.poolOverrides
      if ('poolEffects' in partial) merged.poolEffects = partial.poolEffects
      if ('effects' in partial) merged.effects = partial.effects
    }
    currentCfg = normalizeConfig(merged)
    currentStyle = resolveStyle(currentCfg)
    rebuildPools() // 自定义池内容并入 + 重置抽取队列
    persistConfig()

    // 即时套用：刷新已发光元素（配置变更 → 强制重抽 + 换文动画）。
    glowed.forEach(function (el) {
      if (!el.isConnected) return
      var rec = origTexts.get(el)
      if (rec && rec.node) refreshStatus(rec, el, true)
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
      usePools: currentCfg.usePools,
      poolRepeat: currentCfg.poolRepeat,
      poolCustoms: currentCfg.poolCustoms,
      poolOverrides: currentCfg.poolOverrides,
      poolEffects: currentCfg.poolEffects,
      effects: currentCfg.effects,
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
          // 实际生效状态（强制预览 > 宿主权威 > DOM 兜底）；host 字段标明信号来源
          status: effectiveStatus(chosen, origTexts.get(chosen.el) ? origTexts.get(chosen.el).applied : null),
          host: hostStatus,
          orig: origTexts.get(chosen.el) ? String(origTexts.get(chosen.el).orig).slice(0, 60) : null,
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
        if (m.target && MATCH.test(m.target.data)) {
          need = true // 应用写回 "Deep diving" → 重新定位并刷新状态
        } else if (currentCfg.usePools && m.target && !rolling.has(m.target.parentElement)) {
          // 应用写了非匹配的阶段文案（如 "调用工具…"）：若正是我们管理的总状态节点，
          // 直接刷新（状态变化→立即换文；同状态→盖回当前文案）。滚动期间跳过（防自激）。
          var el2 = m.target.parentElement
          var rec2 = el2 && origTexts.get(el2)
          if (rec2 && m.target === rec2.node && m.target.data !== rec2.applied) {
            refreshStatus(rec2, el2, false)
          }
        }
      } else if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          if (subtreeHasMatch(m.addedNodes[j])) { need = true; break }
        }
      }
    }
    if (need) retarget()
    sweepGlow()
  }

  // 清理辉光时跳过正在滚动动画的元素（其文本暂不等于 applied）。
  function sweepGlow() {
    glowed.forEach(function (el) {
      if (rolling.has(el)) return
      if (!el.isConnected) { unglow(el); return }
      var rec = origTexts.get(el)
      var applied = rec ? rec.applied : currentCfg.text
      if (String(el.textContent).indexOf(applied) === -1) unglow(el)
    })
  }

  function onMessage(ev) {
    var data = ev && ev.data
    if (!data || typeof data !== 'object' || data.__dshStatusGlow !== 'config') return
    configure(data.config)
  }

  function boot() {
    injectCss()
    // 文案池（text-pools.js 先于本脚本注入）必须在 retarget 前注册完成
    loadPools()
    // 初始化配置：初始化参数（window.__DSH_STATUS_GLOW_CONFIG__）> localStorage 持久化 > 默认
    currentCfg = normalizeConfig(readStoredConfig())
    currentStyle = resolveStyle(currentCfg)
    rebuildPools() // 自定义池内容并入（需在 retarget 之前）
    retarget()
    startTicker() // 同一状态下每 5 秒随机换文
    startStatusPoller() // 轮询宿主权威状态（session/event 折叠）
    hydrateFromHost() // 异步拉取宿主文件中的权威配置（跨重启持久化）
    new MutationObserver(handleMutations).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    if (global.window) {
      global.window.__dshStatusGlow = {
        version: '0.2.0',
        configure: configure,
        getConfig: getConfig,
        resolveStyles: resolveStyles,
        // 状态扩展入口：新状态只需注册检测信号 + 池映射，主逻辑零改动
        registerStatusType: registerStatusType,
        registerPool: registerPool,
        classify: classify,
        // 状态强制预览：debugSetStatus('tool') / debugSetStatus('auto') 解除
        debugSetStatus: debugSetStatus,
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
      // 随机文案池引擎（供单测）
      weightedShuffle: weightedShuffle,
      classify: classify,
      draw: draw,
      registerPool: registerPool,
      registerStatusType: registerStatusType,
      resetPools: resetPools,
      // 自定义池内容 / 自定义特效 / 按池特效
      normalizePoolCustoms: normalizePoolCustoms,
      normalizePoolEffects: normalizePoolEffects,
      normalizeEffects: normalizeEffects,
      applyPoolCustoms: applyPoolCustoms,
      applyPoolOverrides: applyPoolOverrides,
      resolveCandidateStyle: resolveCandidateStyle,
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

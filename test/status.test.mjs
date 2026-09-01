// dsh-status-glow targeting unit tests.
// Runs the pure core of lib/status.js (MATCH / scoreCandidate /
// selectCandidate) in node with simulated text nodes / ancestor chains.
// Run: node test/status.test.mjs   (from the package dir)

import fs from 'node:fs'
import assert from 'node:assert/strict'

const src = fs.readFileSync(new URL('../lib/status.js', import.meta.url), 'utf8')

// Load the classic-script IIFE in a sandbox where `module.exports` works,
// regardless of the package being "type": "module".
const moduleShim = { exports: {} }
new Function('module', 'exports', 'globalThis', src)(moduleShim, moduleShim.exports, globalThis)
const core = moduleShim.exports

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (err) {
    failed++
    console.log('  ✗ ' + name + '\n    ' + String(err && err.message || err))
  }
}

console.log('== 1. 文案匹配（大小写 / 空格 / 省略号） ==')
const matchCases = [
  ['Deep diving...', true],
  ['Deep diving', true],
  ['deep dive…', true],           // U+2026 省略号
  ['DeepDiving', true],
  ['DEEP DIVING ...', true],
  ['Deep   diving  ....', true],  // 多空格 + 多点
  ['正在深度烧烤...', false],      // 已替换文本不得再匹配（防死循环）
  ['Deep thinking', false],       // 思考文案不含 div，不命中
  ['Deep seek', false],
  ['hello world', false],
]
for (const [text, expect] of matchCases) {
  check(`MATCH(${JSON.stringify(text)}) === ${expect}`, () => {
    assert.equal(core.MATCH.test(text), expect)
  })
}

console.log('== 2. 评分：思考/消息上下文强排除 ==')
check('思考上下文候选分为负', () => {
  const s = core.scoreCandidate({ classes: 'message thinking', rect: { top: 200, bottom: 230 }, vh: 900 })
  assert.ok(s < 0, 'expected negative, got ' + s)
})
check('总状态(状态栏+吸附底部)高分', () => {
  const s = core.scoreCandidate({ classes: 'app status-bar agent', rect: { top: 870, bottom: 900 }, vh: 900 })
  assert.ok(s >= 7, 'expected >= 7 (hint 4 + pinned 3), got ' + s)
})
check('下半区加分、中屏无特征为 0', () => {
  assert.equal(core.scoreCandidate({ classes: '', rect: { top: 400, bottom: 430 }, vh: 900 }), 0)
  assert.equal(core.scoreCandidate({ classes: '', rect: { top: 600, bottom: 630 }, vh: 900 }), 2)
})

console.log('== 3. 选择：只选总状态，不碰思考旁文案/普通文本 ==')
check('MIN_SCORE 门槛 = 3', () => {
  assert.equal(core.MIN_SCORE, 3)
})
check('只有思考候选 → 不选择(null)，不替换', () => {
  const chosen = core.selectCandidate([
    { classes: 'message thinking', rect: { top: 200, bottom: 230 }, vh: 900 },
  ])
  assert.equal(chosen, null)
})
check('思考+底部总状态 → 选底部', () => {
  const chosen = core.selectCandidate([
    { classes: 'message thinking', rect: { top: 200, bottom: 230 }, vh: 900 },
    { classes: 'agent status-bar', rect: { top: 850, bottom: 890 }, vh: 900 },
  ])
  assert.ok(chosen, 'expected a candidate')
  assert.match(chosen.classes, /status-bar/)
})
check('思考候选即使带 status 提示仍被排除', () => {
  // 思考区元素恰好也带 status 类：THINK 惩罚(-8) > STATUS 加分(+4)
  const s = core.scoreCandidate({ classes: 'thinking status message', rect: { top: 200, bottom: 230 }, vh: 900 })
  assert.ok(s < 0, 'expected negative, got ' + s)
})
check('中屏无特征普通文本（对话内容，0分）→ 不选择', () => {
  // 真机证据：markdown 对话内容含 "deep dive…" 等字样，无状态特征、中屏 → 必须排除
  const chosen = core.selectCandidate([
    { classes: '_markdown_1r4m5_5 sxvs8a_body', rect: { top: 245, bottom: 267 }, vh: 900 },
  ])
  assert.equal(chosen, null)
})
check('仅下半区无特征文本（2分）→ 不选择', () => {
  const chosen = core.selectCandidate([
    { classes: '', rect: { top: 600, bottom: 630 }, vh: 900 },
  ])
  assert.equal(chosen, null)
})
check('仅吸附视口底部（3分）→ 选择', () => {
  const chosen = core.selectCandidate([
    { classes: '', rect: { top: 880, bottom: 900 }, vh: 900 },
  ])
  assert.ok(chosen, 'pinned-bottom candidate should qualify')
})
check('仅 status 提示中屏（4分）→ 选择', () => {
  const chosen = core.selectCandidate([
    { classes: 'md3f7g_turnstatus', rect: { top: 400, bottom: 430 }, vh: 900 },
  ])
  assert.ok(chosen, 'status-hint candidate should qualify')
})
check('平局（同为合格候选）→ 更靠下者胜', () => {
  const chosen = core.selectCandidate([
    { classes: 'status', rect: { top: 300, bottom: 330 }, vh: 900 },
    { classes: 'status', rect: { top: 700, bottom: 730 }, vh: 900 },
  ])
  assert.equal(chosen.rect.top, 700)
})
check('空列表 → null', () => {
  assert.equal(core.selectCandidate([]), null)
  assert.equal(core.selectCandidate(null), null)
})

console.log('== 4. 模拟文本节点流水线（各种写法 → 只替换底部总状态） ==')
function fakeDescribe(text, chain, top, bottom, vh) {
  return { node: { data: text }, el: {}, classes: chain.join(' ').toLowerCase(), rect: { top, bottom }, vh }
}
for (const [label, bottomText, bottomChain, bottomTop, bottomBottom] of [
  ['省略号 U+2026 写法', 'deep dive…', ['footer', 'overall-status'], 850, 890],
  ['全大写+空格+点', 'DEEP DIVING ...', ['agent-status', 'bottom-bar'], 860, 898],
  ['无空格连写', 'DeepDiving', ['status', 'global-bar'], 840, 880],
  ['标准写法', 'Deep diving...', ['app-status', 'footer'], 870, 900],
]) {
  check(`流水线：${label} → 选中底部、不选中思考`, () => {
    const thinking = fakeDescribe('Deep diving...', ['message', 'thinking'], 200, 230, 900)
    const bottom = fakeDescribe(bottomText, bottomChain, bottomTop, bottomBottom, 900)
    assert.equal(core.MATCH.test(bottom.node.data), true, '底部文案应命中 MATCH')
    const chosen = core.selectCandidate([thinking, bottom])
    assert.ok(chosen && chosen.node === bottom.node, '应选中底部总状态节点')
  })
}
check('流水线：对话普通文本(无特征中屏) + 底部总状态 → 只选底部', () => {
  const conv = fakeDescribe('Deep diving...', ['_markdown_1r4m5_5'], 245, 267, 900)
  const bottom = fakeDescribe('Deep diving...', ['md3f7g_turnstatus'], 591, 617, 900)
  const chosen = core.selectCandidate([conv, bottom])
  assert.ok(chosen && chosen.node === bottom.node, '应选中 turnstatus，而非对话文本')
})
check('流水线：只有对话普通文本 → 不选择(null)', () => {
  const conv = fakeDescribe('deep dive…', ['_markdown_1r4m5_5 sxvs8a_body'], 245, 267, 900)
  assert.equal(core.selectCandidate([conv]), null)
})
check('替换后文本不再命中（MutationObserver 不会自激/死循环）', () => {
  const replaced = core.DEFAULTS.text
  assert.equal(core.MATCH.test(replaced), false)
  // 连续调用 selectCandidate 两次结果一致（幂等，无副作用）
  const list = [
    { classes: 'message thinking', rect: { top: 200, bottom: 230 }, vh: 900 },
    { classes: 'agent status-bar', rect: { top: 850, bottom: 890 }, vh: 900 },
  ]
  const a = core.selectCandidate(list)
  const b = core.selectCandidate(list)
  assert.equal(a.node, b.node)
})

console.log('== 5. 自定义配置：默认值 / 校验 / 非法回退 ==')
check('默认配置 = 现有行为（平滑彩虹渐变 + 柔和白光 + 无动画）', () => {
  const cfg = core.normalizeConfig(null)
  assert.equal(cfg.text, '正在深度烧烤...')
  assert.ok(Array.isArray(cfg.gradientColors) && cfg.gradientColors.length >= 2)
  assert.equal(cfg.textShadow, '0 0 10px rgba(255,255,255,.4), 0 0 22px rgba(255,255,255,.22)')
  assert.equal(cfg.animation, null)
  const st = core.resolveStyle(cfg)
  assert.match(st.gradient, /^linear-gradient\(90deg,#ff6b6b/)
  assert.equal(st.color, 'transparent')
  assert.ok(st.shadow)
  assert.equal(st.animation, null)
  // 平滑度：色相等距 30° 的 12 色标 + 首尾同色闭环（无缝）
  const colors = cfg.gradientColors
  assert.equal(colors.length, 13, '12 色标 + 首尾闭环')
  assert.equal(colors[0].toLowerCase(), colors[colors.length - 1].toLowerCase(), '首尾同色无缝闭环')
})
check('text 覆盖 + 空串回退默认', () => {
  assert.equal(core.normalizeConfig({ text: '烧烤中...' }).text, '烧烤中...')
  assert.equal(core.normalizeConfig({ text: '' }).text, '正在深度烧烤...')
  assert.equal(core.normalizeConfig({ text: 123 }).text, '正在深度烧烤...')
})
check('渐变数组：合法 hex 过滤、<2 色回退默认', () => {
  const cfg = core.normalizeConfig({ gradientColors: ['#ff0000', '#0000ff', 'notacolor'] })
  assert.deepEqual(cfg.gradientColors, ['#ff0000', '#0000ff'])
  const bad = core.normalizeConfig({ gradientColors: ['#ff0000'] })
  assert.ok(Array.isArray(bad.gradientColors) && bad.gradientColors.length >= 2, '单色应回退默认渐变')
})
check('纯色路径：color 写入并忽略渐变', () => {
  const cfg = core.normalizeConfig({ color: '#ff0000' })
  assert.equal(cfg.gradientColors, null)
  assert.equal(cfg.color, '#ff0000')
  const st = core.resolveStyle(cfg)
  assert.equal(st.gradient, null)
  assert.equal(st.color, '#ff0000')
})
check('渐变优先于纯色；两者非法回退默认渐变', () => {
  const both = core.normalizeConfig({ gradientColors: ['#ff0000', '#0000ff'], color: '#00ff00' })
  assert.ok(both.gradientColors && both.color === null, '渐变应胜出')
  const neither = core.normalizeConfig({ gradientColors: 'xx', color: 123 })
  assert.ok(Array.isArray(neither.gradientColors), '应回退默认渐变')
})
check('textShadow：关闭 / 柔和白光 / 数组(字符串+对象) / 非法回退', () => {
  assert.equal(core.normalizeTextShadow(false), false)
  assert.equal(core.normalizeTextShadow('none'), false)
  assert.equal(core.normalizeTextShadow('soft-white'), core.normalizeTextShadow(undefined))
  const layers = core.normalizeTextShadow([
    '0 0 8px #ff0',
    { color: '#4fc3ff', blur: 12 },
  ])
  assert.equal(layers, '0 0 8px #ff0, 0px 0px 12px #4fc3ff')
  const cfg = core.normalizeConfig({ textShadow: false })
  assert.equal(cfg.textShadow, false)
  assert.equal(core.resolveStyle(cfg).shadow, null)
  assert.equal(core.normalizeTextShadow(42), '0 0 10px rgba(255,255,255,.4), 0 0 22px rgba(255,255,255,.22)')
})
check('动画：flow 内置 / 原串 / null / 非法回退关', () => {
  assert.equal(core.normalizeAnimation(null), null)
  assert.equal(core.normalizeAnimation('flow'), 'flow')
  assert.equal(core.normalizeAnimation('pulse 1s ease'), 'pulse 1s ease')
  assert.equal(core.normalizeAnimation(123), null)
  const flow = core.resolveStyle(core.normalizeConfig({ animation: 'flow' }))
  assert.equal(flow.animation, 'dshsg-flow 3s linear infinite')
  assert.equal(flow.backgroundSize, '200% auto')
  assert.equal(core.resolveStyle(core.normalizeConfig({})).animation, null)
})
check('isHexColor / isCssColor 校验', () => {
  assert.equal(core.isHexColor('#ff4d4d'), true)
  assert.equal(core.isHexColor('#FFF'), true)
  assert.equal(core.isHexColor('red'), false)
  assert.equal(core.isCssColor('red'), true)
  assert.equal(core.isCssColor('rgba(0,0,0,.5)'), true)
  assert.equal(core.isCssColor(123), false)
})
check('resolveStyles：纯解析预览接口（不修改全局状态）', () => {
  const g = core.resolveStyles({ gradientColors: ['#ff0000', '#0000ff'] })
  assert.equal(g.gradient, 'linear-gradient(90deg,#ff0000,#0000ff)')
  assert.equal(g.color, 'transparent')
  const s = core.resolveStyles({ color: '#00ff00', gradientColors: [] })
  assert.equal(s.gradient, null)
  assert.equal(s.color, '#00ff00')
  const off = core.resolveStyles({ textShadow: false })
  assert.equal(off.shadow, null)
  const flow = core.resolveStyles({ animation: 'flow' })
  assert.equal(flow.animation, 'dshsg-flow 3s linear infinite')
  assert.equal(flow.backgroundSize, '200% auto')
})

console.log('== 6. 随机文案池：结构 / 无重复 / 权重 / 分类 ==')

// 加载 lib/text-pools.js（module.exports 守卫，与 status.js 同款沙箱加载）
const poolsSrc = fs.readFileSync(new URL('../lib/text-pools.js', import.meta.url), 'utf8')
const poolsShim = { exports: {} }
new Function('module', 'exports', 'globalThis', poolsSrc)(poolsShim, poolsShim.exports, globalThis)
const POOLS = poolsShim.exports

check('池结构：thinking/tool/command/default 每池 ≥10 条且字段完整', () => {
  const types = ['thinking', 'tool', 'command', 'default']
  for (const t of types) {
    const pool = POOLS[t]
    assert.ok(pool, `缺池 ${t}`)
    assert.equal(pool.type, t)
    assert.ok(pool.candidates.length >= 10, `${t} 池不足 10 条（${pool.candidates.length}）`)
    for (const c of pool.candidates) {
      assert.equal(typeof c.text, 'string')
      assert.ok(c.text.length > 0)
      assert.equal(c.status, t, '候选 status 必须与池 type 一致')
      assert.ok(typeof c.weight !== 'number' || c.weight >= 1, 'weight 必须 ≥1')
      assert.ok(Array.isArray(c.tags), 'tags 必须为数组')
    }
  }
})

check('无相邻重复：同池连续 50 次抽取无连续相同文案（含跨轮）', () => {
  core.resetPools()
  core.registerPool(POOLS.thinking)
  let last = null
  for (let i = 0; i < 50; i++) {
    const item = core.draw('pool:thinking')
    assert.ok(item && item.text, 'draw 应返回候选')
    assert.notEqual(item.text, last, `第 ${i} 次与上次重复: ${item.text}`)
    last = item.text
  }
  core.resetPools()
})

check('权重占比：weight=2 文案出现频率 ≈ weight=1 的 2 倍（±35%）', () => {
  core.resetPools()
  const pool = {
    type: 'w',
    candidates: [
      { text: 'A', status: 'w', weight: 2 },
      ...Array.from({ length: 10 }, (_, i) => ({ text: 'B' + i, status: 'w', weight: 1 })),
    ],
  }
  core.registerPool(pool)
  let countA = 0
  const total = 300
  for (let i = 0; i < total; i++) {
    if (core.draw('pool:w').text === 'A') countA++
  }
  const pA = countA / total            // 理论 ≈ 2/12 ≈ 0.167
  const pB = (total - countA) / total  // 理论 ≈ 10/12
  const ratio = pA / (pB / 10)         // A 频率 : 单条 B 频率 ≈ 2
  assert.ok(ratio >= 1.3 && ratio <= 2.7, `ratio=${ratio.toFixed(2)} 偏离 2.0 过多`)
  core.resetPools()
})

check('classify：思考/工具/命令识别 + 未命中回退 default', () => {
  core.resetPools()
  core.registerStatusType('thinking', { detect: (t) => /思考|think|推理|analyzing/i.test(t) })
  core.registerStatusType('tool', { detect: (t) => /工具|tool|正在调用|executing/i.test(t) })
  core.registerStatusType('command', { detect: (t) => /命令|command|shell|终端|执行/i.test(t) })
  assert.equal(core.classify('思考中...'), 'thinking')
  assert.equal(core.classify('正在调用工具 foo'), 'tool')
  assert.equal(core.classify('执行命令 ls'), 'command')
  assert.equal(core.classify('随便什么文案'), 'default')
  core.resetPools()
})

check('draw 未知池返回 null；usePools 配置归一化默认 false', () => {
  core.resetPools()
  assert.equal(core.draw('pool:nope'), null)
  assert.equal(core.normalizeConfig(null).usePools, false)
  assert.equal(core.normalizeConfig({ usePools: true }).usePools, true)
  assert.equal(core.normalizeConfig({ usePools: 'yes' }).usePools, false)
  core.resetPools()
})

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exit(1)

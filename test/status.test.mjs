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
check('默认配置 = v0.2.0 出厂配置（白字 + 按池特效 + usePools 开）', () => {
  const cfg = core.normalizeConfig(null)
  assert.equal(cfg.text, '大肥鲸鱼正在深度烧烤...( ˊ꒳ˋ )ₚ✧')
  assert.equal(cfg.gradientColors, null)
  assert.equal(cfg.color, '#ffffff')
  assert.equal(cfg.textShadow, false)
  assert.equal(cfg.animation, null)
  assert.equal(cfg.usePools, true, 'usePools 默认开启（按状态抽取）')
  assert.equal(cfg.poolRepeat, false, 'poolRepeat 默认关闭（洗牌无相邻重复）')
  // 四池特效默认就绪
  assert.ok(cfg.poolEffects.thinking && cfg.poolEffects.thinking.animation === 'flow')
  assert.ok(Array.isArray(cfg.poolEffects.thinking.gradientColors) && cfg.poolEffects.thinking.gradientColors.length >= 2)
  assert.ok(cfg.poolEffects.tool && cfg.poolEffects.tool.textShadow === 'soft-white')
  assert.ok(cfg.poolEffects.command && Array.isArray(cfg.poolEffects.command.textShadow) && cfg.poolEffects.command.textShadow.length === 3)
  assert.ok(cfg.poolEffects.default && cfg.poolEffects.default.color === '#ffffff')
  const st = core.resolveStyle(cfg)
  assert.equal(st.gradient, null)
  assert.equal(st.color, '#ffffff')
  assert.equal(st.shadow, null)
  assert.equal(st.animation, null)
})
check('text 覆盖 + 空串回退默认', () => {
  assert.equal(core.normalizeConfig({ text: '烧烤中...' }).text, '烧烤中...')
  assert.equal(core.normalizeConfig({ text: '' }).text, '大肥鲸鱼正在深度烧烤...( ˊ꒳ˋ )ₚ✧')
  assert.equal(core.normalizeConfig({ text: 123 }).text, '大肥鲸鱼正在深度烧烤...( ˊ꒳ˋ )ₚ✧')
})
check('渐变数组：合法 hex 过滤、<2 色回退默认纯色', () => {
  const cfg = core.normalizeConfig({ gradientColors: ['#ff0000', '#0000ff', 'notacolor'] })
  assert.deepEqual(cfg.gradientColors, ['#ff0000', '#0000ff'])
  const bad = core.normalizeConfig({ gradientColors: ['#ff0000'] })
  assert.equal(bad.gradientColors, null, '单色应回退默认（白字）')
  assert.equal(bad.color, '#ffffff')
})
check('纯色路径：color 写入并忽略渐变', () => {
  const cfg = core.normalizeConfig({ color: '#ff0000' })
  assert.equal(cfg.gradientColors, null)
  assert.equal(cfg.color, '#ff0000')
  const st = core.resolveStyle(cfg)
  assert.equal(st.gradient, null)
  assert.equal(st.color, '#ff0000')
})
check('渐变优先于纯色；两者非法回退默认纯色', () => {
  const both = core.normalizeConfig({ gradientColors: ['#ff0000', '#0000ff'], color: '#00ff00' })
  assert.ok(both.gradientColors && both.color === null, '渐变应胜出')
  const neither = core.normalizeConfig({ gradientColors: 'xx', color: 123 })
  assert.equal(neither.gradientColors, null, '两者非法应回退默认（白字）')
  assert.equal(neither.color, '#ffffff')
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

check('无相邻重复（allowRepeat=false）：同池连续 50 次无连续相同文案（含跨轮）', () => {
  core.resetPools()
  core.registerPool(POOLS.thinking)
  let last = null
  for (let i = 0; i < 50; i++) {
    const item = core.draw('pool:thinking', false)
    assert.ok(item && item.text, 'draw 应返回候选')
    assert.notEqual(item.text, last, `第 ${i} 次与上次重复: ${item.text}`)
    last = item.text
  }
  core.resetPools()
})

check('允许重复（显式 allowRepeat=true）：可出现相邻重复', () => {
  // 用 2 项池保证相邻重复几乎必然出现（跨轮无队首交换），避免 12 项池的随机抖动
  core.resetPools()
  core.registerPool({ type: 'r', candidates: [{ text: 'X', status: 'r' }, { text: 'Y', status: 'r' }] })
  let last = null
  let repeats = 0
  for (let i = 0; i < 50; i++) {
    const item = core.draw('pool:r', true) // 显式允许重复
    if (item.text === last) repeats++
    last = item.text
  }
  assert.ok(repeats > 0, `2 项池 50 次应出现相邻重复（实际 0 次）`)
  assert.equal(core.normalizeConfig(null).poolRepeat, false, 'poolRepeat 默认 false（洗牌无相邻重复）')
  assert.equal(core.normalizeConfig({ poolRepeat: false }).poolRepeat, false)
  assert.equal(core.normalizeConfig({ poolRepeat: true }).poolRepeat, true)
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

check('classify（最后出现位置）：最新阶段优先，历史思考不抢先', () => {
  core.resetPools()
  core.registerStatusType('thinking', { regex: /思考|think/i })
  core.registerStatusType('tool', { regex: /工具|tool/i })
  core.registerStatusType('command', { regex: /命令|command/i })
  // 混合上下文：后出现的（最新）胜出
  assert.equal(core.classify('先思考，然后调用工具'), 'tool')
  assert.equal(core.classify('调用工具后继续思考'), 'thinking')
  assert.equal(core.classify('先思考再执行命令'), 'command')
  assert.equal(core.classify('思考中'), 'thinking')
  assert.equal(core.classify('历史回合都在思考，最近执行命令'), 'command')
  assert.equal(core.classify('完全没有关键词'), 'default')
  core.resetPools()
})

check('draw 未知池返回 null；usePools 配置归一化默认 true', () => {
  core.resetPools()
  assert.equal(core.draw('pool:nope'), null)
  assert.equal(core.normalizeConfig(null).usePools, true)
  assert.equal(core.normalizeConfig({ usePools: true }).usePools, true)
  assert.equal(core.normalizeConfig({ usePools: 'yes' }).usePools, false)
  assert.equal(core.normalizeConfig({ usePools: false }).usePools, false)
  core.resetPools()
})

check('normalizePoolCustoms：合法保留、非法过滤、weight 默认 1', () => {
  const out = core.normalizePoolCustoms({
    thinking: [
      { text: '自定义思考文案', weight: 3 },
      { text: '', weight: 5 },
      { text: 123 },
      { text: '默认权重' },
    ],
    tool: 'not-array',
    unknown: [{ text: '新池文案' }],
  })
  assert.equal(out.thinking.length, 2)
  assert.equal(out.thinking[0].weight, 3)
  assert.equal(out.thinking[1].weight, 1)
  assert.ok(!out.tool, '非数组应丢弃')
  assert.equal(out.unknown.length, 1, '未知池键保留（可映射未来注册池）')
  assert.deepEqual(core.normalizePoolCustoms(null), {})
})

check('normalizeEffects：合法保留、key 去重、非法过滤', () => {
  const out = core.normalizeEffects([
    { key: 'a', label: '特效A', config: { color: '#ff0000', gradientColors: [] } },
    { key: 'a', label: '重复key' },
    { key: 'b', label: '', config: { gradientColors: ['#00f', '#0ff'] } },
    { key: 'c' },
    'junk',
  ])
  assert.equal(out.length, 3)
  assert.equal(out[0].key, 'a')
  assert.equal(out[1].label, 'b', '空 label 回退为 key')
  assert.ok(out[1].config.gradientColors.length === 2)
  assert.deepEqual(core.normalizeEffects('x'), [])
})

check('applyPoolCustoms：新建池 + 并入已有池', () => {
  // 1) 不存在的池键会被新建（空池 + 自定义项）
  const pools = {}
  core.applyPoolCustoms(pools, {
    thinking: [{ text: '自定义思考', weight: 2 }],
    mypool: [{ text: '新池文案' }],
  })
  assert.equal(pools['pool:thinking'].candidates.length, 1)
  assert.equal(pools['pool:thinking'].candidates[0].text, '自定义思考')
  assert.equal(pools['pool:mypool'].candidates[0].text, '新池文案')
  assert.equal(pools['pool:mypool'].candidates[0].tags[0], 'custom')
  // 2) 并入已有池：候选数 +1，自定义项追加在末尾（用副本避免污染 POOLS）
  const m2 = { 'pool:tool': { type: 'tool', candidates: POOLS.tool.candidates.slice() } }
  core.applyPoolCustoms(m2, { tool: [{ text: '自定义工具', weight: 1 }] })
  assert.equal(m2['pool:tool'].candidates.length, POOLS.tool.candidates.length + 1)
  assert.equal(m2['pool:tool'].candidates[POOLS.tool.candidates.length].text, '自定义工具')
  // 3) 非法入参不抛错
  core.applyPoolCustoms(null, null)
  core.applyPoolCustoms({}, { thinking: 'not-array' })
})

check('applyPoolOverrides：整表覆盖（优先级高于追加）', () => {
  const pools = { 'pool:thinking': { type: 'thinking', candidates: POOLS.thinking.candidates.slice() } }
  core.applyPoolOverrides(pools, { thinking: [{ text: '只看这一条', weight: 1 }] })
  assert.equal(pools['pool:thinking'].candidates.length, 1)
  assert.equal(pools['pool:thinking'].candidates[0].text, '只看这一条')
  assert.equal(pools['pool:thinking'].candidates[0].tags[0], 'custom')
  // 空覆盖/非法不破坏原池
  const pools2 = { 'pool:tool': { type: 'tool', candidates: [1, 2] } }
  core.applyPoolOverrides(pools2, { tool: [] })
  assert.equal(pools2['pool:tool'].candidates.length, 2)
  core.applyPoolOverrides(null, null)
})

check('normalizePoolEffects：合法样式片段保留、非法过滤', () => {
  const out = core.normalizePoolEffects({
    thinking: { color: '#ff0000', gradientColors: [] },
    tool: { gradientColors: ['#00f', '#0ff'], textShadow: 'soft-white' },
    command: 'junk',
    default: null,
  })
  assert.ok(out.thinking && out.thinking.color === '#ff0000')
  assert.ok(out.tool && out.tool.gradientColors.length === 2)
  assert.ok(!out.command && !out.default)
  assert.deepEqual(core.normalizePoolEffects(null), {})
})

check('resolveCandidateStyle：usePools + 池特效 → 解析样式；缺省池回退默认', () => {
  const cfg = core.normalizeConfig({
    usePools: true,
    poolEffects: { thinking: { color: '#ff0000', gradientColors: [] } },
  })
  const st = core.resolveCandidateStyle(cfg, 'thinking')
  assert.ok(st && st.gradient === null && st.color === '#ff0000')
  // 未显式配置的池回退出厂默认特效（thinking 之外也有默认池特效）
  const toolSt = core.resolveCandidateStyle(cfg, 'tool')
  assert.ok(toolSt && toolSt.gradient, '未配置池特效的状态应回退 DEFAULTS 特效（tool 默认金黄渐变）')
  const off = core.normalizeConfig({ usePools: false, poolEffects: { thinking: { color: '#0f0' } } })
  assert.equal(core.resolveCandidateStyle(off, 'thinking'), null, 'usePools 关闭时不启用池特效')
})

console.log(`\n结果: ${passed} 通过, ${failed} 失败`)
if (failed > 0) process.exit(1)

# dsh-status-glow

把 DSH 界面里表示「正在工作」的**最下方总状态** **`Deep diving...`** 改为 **`正在深度烧烤...`**，文字样式可自定义：**纯色 / 从左到右渐变**（`background-clip:text`）、辉光可关/可多层合成、动画预留（内置流动渐变）。

> v2（精确命中）：v1 会替换页面里**所有**匹配的文本节点，导致命中「思考」旁的状态文案而不是最下方总状态。v2 改为**只选一个目标**（最下方总状态），思考/消息上下文一律排除。
> v3（可配置）：新增自定义样式接口，默认行为与 v2 完全一致（向后兼容）。
> v4（设置页快捷入口）：在 DSH 设置里新增「状态文字」分区——下拉栏选文字特效、输入栏填文本内容、点「应用」即时生效，无需重启。

## 工作原理

- **宿主端**（`lib/index.js`）：注册 `/dsh-status-glow/status.js` 与 `/dsh-status-glow/debug` 路由，并通过 `webServer.tapIndex` 往 Web GUI 首页注入 `<script defer src="/dsh-status-glow/status.js"></script>`（与 `dsh-whale-widget` 相同的注入方式）。
- **浏览器端**（`lib/status.js`）：
  1. 用 TreeWalker 扫描所有文本节点（含递归进入 open shadow root），收集匹配 `Deep diving`（大小写/空格/省略号不敏感）的候选；
  2. 对每个候选按**祖先 class/id 特征 + 屏幕位置**打分：
     - 祖先含 `status/state/footer/bottom/overall/global/总状态/agent/work/tool/progress` 等 → +4；
     - 祖先含 `think/reason/思考/message/assistant/bubble/chat/msg/conversation` 等 → 强排除（-8）；
     - 元素吸附视口底部（`rect.bottom ≥ vh-8`）→ +3，位于屏幕下半区 → +2；
     - **最低门槛 `MIN_SCORE = 3`**：只有带状态特征（`status` 类 / 吸附底部）的候选才允许替换；得分 0 的普通文本（如对话里恰好出现 "deep dive" 字样的 markdown 内容）或仅下半区无特征文本一律不选（真机调试数据证实的边界）；
     - 平局按更靠下者胜；
  3. 只对选中的那个节点执行文本替换并加 `.dsh-status-glow`（样式经 inline `!important` 强制，不被应用自身的蓝色样式覆盖）；切换目标时**自动还原上一目标原文**（仅在仍显示替换文本时），并清掉旧样式；
  4. `MutationObserver` 监听重渲染：应用把原文写回来时自动重新定位；替换后的文本不会再匹配（不会自激/死循环）；状态结束后（元素文本不再包含替换文本）自动移除样式。

### glow 内联属性与清理（对称）

| 路径 | 写入（均 `!important`） | unglow 清理 |
|---|---|---|
| 渐变 | `background-image`（渐变）、`-webkit-background-clip`/`background-clip`（`text`）、`-webkit-text-fill-color`/`color`（`transparent`） | 同名 `removeProperty` |
| 纯色 | `color` + `-webkit-text-fill-color`（纯色值；不碰 `background-*`，保留元素原背景） | 同名 `removeProperty` |
| 辉光 | `text-shadow`（多层合成；关闭则移除） | `removeProperty('text-shadow')` |
| 动画 | `animation`（+ `background-size` 仅 flow） | `removeProperty` |

## 自定义接口

配置入口二选一（可同时）：

```js
// 方式 1：初始化参数 —— 在脚本加载前设置
window.__DSH_STATUS_GLOW_CONFIG__ = { text: '...', gradientColors: [...], textShadow: [...] }

// 方式 2：运行时更新
window.__dshStatusGlow.configure({ textShadow: false })       // 函数调用
window.postMessage({ __dshStatusGlow: 'config', config: {...} }, '*')  // 消息通道
```

### 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `text` | string | `'正在深度烧烤...'` | 替换后的完整静态文本；空串/非字符串回退默认 |
| `gradientColors` | string[] | 平滑彩虹 13 色（12 色标 30° 等距 + 首尾同色闭环） | 从左到右渐变（合法 hex，≥2 色才生效，非法项被过滤）；与 `color` 互斥，**渐变优先**；等距色相保证头尾过渡均匀无停顿 |
| `color` | string | `null` | 纯色（hex / `rgb()` / `hsl()` / 命名色）；仅当无有效渐变时生效 |
| `textShadow` | `false` \| string \| array | `'soft-white'` | `false`/`'none'`/`''`=关闭；`'soft-white'`=柔和白光；字符串原串直接透传；数组=多层（元素可为原串或 `{color,x,y,blur}`，`x/y/blur` 默认 `0/0/8px`） |
| `animation` | `null` \| string | `null` | `null`/`false`=关闭；`'flow'`=内置流动渐变（`dshsg-flow`）；其他字符串作为 CSS `animation` 原串透传 |
| `usePools` | boolean | `false` | 随机文案池开关：`true` 时按状态（思考/工具/命令…）从 `lib/text-pools.js` 无重复抽取；`false` 使用静态 `text`（向后兼容） |

所有字段提供默认值、类型校验与非法回退（例如 `gradientColors:['#ff0000']` 只有 1 色 → 回退默认彩虹渐变；`textShadow:42` → 回退柔和白光）。`window.__dshStatusGlow.getConfig()` 可读取当前归一化后的配置。

### 调用示例

```js
// 1) 文本替换：只改文案，其余保持默认（彩虹渐变 + 柔和白光）
window.__dshStatusGlow.configure({ text: '正在深度烧烤...' })

// 2) 红蓝渐变：文字本体红→蓝渐变（覆盖默认彩虹渐变）
window.__dshStatusGlow.configure({ gradientColors: ['#ff4d4d', '#4dc3ff'] })

// 3) 霓虹辉光：纯色白字 + 青色霓虹辉光（多层合成，自定义颜色与半径）
window.__dshStatusGlow.configure({
  color: '#ffffff',
  gradientColors: [],               // 清空渐变，切到纯色路径
  textShadow: [
    { color: '#4dc3ff', blur: 8 },
    { color: '#4dc3ff', blur: 18 },
    { color: '#b44dff', blur: 30 },
  ],
})
```

## 设置页快捷入口（无需重启）

DSH 设置里新增「**状态文字**」分区（`lib/client.js` 通过 `ctx.slots.inject("settings.section")` 注册）：

- **预览条**：实时渲染「所选特效 + 当前输入文本」的最终效果（复用 `status.js` 的 `resolveStyles()` 纯解析，与真实状态共用同一套样式机制，所见即所得；含流动动画的预设会实时流动）；
- **文字特效**（下拉栏）：彩虹渐变·柔和白光（默认）/ 红蓝渐变 / 霓虹辉光 / 金色渐变 / 纯白·无辉光 / 流动渐变；
- **文本内容**（输入栏）：替换后的文案，回车或点「应用」生效；
- **应用**按钮：即时调用 `window.__dshStatusGlow.configure(...)`，**无需重启 DSH**，状态元素立即刷新样式与文本。

UI 选择与文本持久化到 `localStorage`（`dsh-status-glow:ui`），完整配置由 `status.js` 持久化到 `dsh-status-glow:config`——页面刷新后自动恢复（origin 作用域；DSH 重启换随机端口会回到默认，可再用设置页点一次应用，或经下方 `configure()` 程序化设置）。

## 随机文案池（按状态分流）

`configure({ usePools: true })` 或设置页勾选「随机文案」后，总状态文案按状态从 `lib/text-pools.js` 抽取：

- **状态分类**（`detectStatus`，启发式）：`thinking`（思考/Think/推理）、`tool`（工具/tool/正在调用）、`command`（命令/command/shell），未命中回退 `default` 池；
- **无重复抽取**：每池一个 Fisher-Yates 洗牌队列，同状态连续触发不出现相邻重复（含跨轮队首交换）；
- **权重**：`weight: 2` 的文案出现频率约为 `weight: 1` 的两倍（默认 1）；
- **扩展入口**（状态机与池解耦，新增状态零主逻辑改动）：

```js
// 新增池（≥10 条，text/status 必填，weight/tags 可选）
window.__dshStatusGlow.registerPool({
  type: 'error',
  candidates: [ { text: '出了点小差错，正在补救...', status: 'error', weight: 1, tags: [] }, /* … */ ],
})
// 新增状态：注册检测信号 + 池映射
window.__dshStatusGlow.registerStatusType('error', {
  detect: (ctxText) => /error|失败|异常/i.test(ctxText),
  poolId: 'pool:error',
})
```

池数据文件：`lib/text-pools.js`（`window.__DSH_STATUS_GLOW_TEXT_POOLS__`，宿主在 `status.js` 之前注入，保证就绪）。

## 调试（真机验证）

浏览器端在选中元素变化时（30s 内最多 1 条）把选中目标的文本/类名/坐标/**计算样式** POST 到 `/dsh-status-glow/debug`，宿主端逐行追加到 **`~/.dsh/dsh-status-glow-debug.jsonl`**。`computed.color` 可确认文字实际渲染色（渐变文字为 `rgba(0,0,0,0)` 透明字色 + `background-image` 渐变，纯色为对应色值）；若命中结果与预期不符，把该文件内容发来即可精确定位。

## 安装

**从 GitHub 安装（推荐）：**

```powershell
# 在 DSH profile 目录执行
cd $env:USERPROFILE\.dsh\profiles\desktop
dsh plugin --profile desktop add github:sodajamie/dsh-status-glow
# 或指定仓库 URL：dsh plugin --profile desktop add https://github.com/sodajamie/dsh-status-glow
```

**本地开发安装（link）：**

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
dsh plugin --profile desktop add link:C:\Users\Administrator\dsh-status-glow
```

或手动：把本目录加入 profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles`，并在 `node_modules` 中建立链接。

安装完成后**完全退出并重启 DSH Desktop**（不是最小化，是退出所有进程后重新启动）——宿主端只在启动时读取 `lib/status.js`。

## 验证

- 单元测试：`node test\status.test.mjs`（覆盖匹配/评分/选择/配置归一化与非法回退/随机文案池，44 项断言）。
- 真机：让任意 agent 开始工作 → **最下方总状态**应显示自定义文本与样式；「思考」旁的状态文案保持原样（不替换、不加样式）。
- 设置页：DSH 设置 → 「状态文字」→ 选特效 / 改文本 → 「应用」→ 总状态即时更新（无需重启）。
- DevTools（F12）：`window.__dshStatusGlow.getConfig()` 查看当前配置；`document.getElementById('dsh-status-glow-css')` 存在；总状态元素带 `dsh-status-glow` 类，思考旁元素没有该类。

## 卸载 / 回滚

1. 退出 DSH Desktop。
2. 编辑 `profiles\desktop\package.json`：从 `dependencies` 移除 `dsh-status-glow`，从 `dsh.profile.bundles` 移除 `dsh-status-glow`。
3. 删除 `profiles\desktop\node_modules\dsh-status-glow` 与 `profiles\desktop\dsh-status-glow` 目录。
4. 重启 DSH Desktop。

## 已知边界

- 若最下方总状态的文案**不是** `Deep diving` 系（例如显示为「Working...」「生成中…」），则匹配不到、不会替换——此时 `~/.dsh/dsh-status-glow-debug.jsonl` 会列出选中目标相关信息，把该文件发给维护者即可在 `MATCH` 里补上对应写法。
- 若应用把「...」单独渲染为相邻元素（而非同一文本节点），显示上可能出现重复省略号；届时把 `text` 配置里的 `'...'` 去掉即可。
- 本插件只做文本与样式注入，不修改 DSH 应用本体（`app.asar` 未改动），卸载即完全还原。

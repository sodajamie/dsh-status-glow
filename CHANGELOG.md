# Changelog

本项目的显著变更记录于此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-09-01

### 概述

整合发布版：汇集 0.1.0 之后所有迭代（此前内部 0.2.0~0.9.0 的更新统一整合为本版本）。
出厂默认配置 = 当前调校效果：全局白字无辉光，按状态池分配专属特效，随机文案池开箱即用。

### 新增

- **随机文案池按状态分流**：`usePools` 默认开启，按状态类型（思考 / 工具 / 命令 / 兜底）从对应池抽取
  - 无相邻重复抽取（默认）：每池 Fisher-Yates 洗牌队列 + 跨轮队首交换，同状态连续触发不重复
  - 权重支持：`weight: 2` 的文案出现频率约为 `weight: 1` 的两倍（默认 1）
  - 随机是否允许相邻重复可切换：`poolRepeat`（`false` = 洗牌无相邻重复，默认；`true` = 真随机）
- **文案变动时机**：同一状态下每 5 秒随机换文一次；状态交替（思考→工具→命令）时**立即**换文
- **换文动画**：老虎机式快速滚动（60–80ms/步、5–7 步后落地）
- **按池分配特效**：`poolEffects` 配置（`{ [poolKey]: 样式片段 }`），每个状态可指定专属特效
  - 出厂默认：思考 = 平滑彩虹渐变 + 流动动画；工具 = 金黄渐变 + 柔和白光；命令 = 白字 + 蓝紫多层辉光；兜底 = 白字无辉光
- **池整表编辑**：`poolOverrides` 配置（`{ [poolKey]: [{ text, weight }] }`）完全替换该池文案
  - 设置页每池卡片化：列表展示、行内编辑（文本/权重）、删除、添加、该池特效下拉与「恢复默认」
- **自定义文案池内容**：`poolCustoms` 配置（`{ [poolKey]: [{ text, weight }] }`）向任意池追加文案
- **自定义特效预设**：`effects` 配置（`[{ key, label, config }]`），出现在设置页「文字特效」下拉框
- **状态强制预览**：`window.__dshStatusGlow.debugSetStatus('tool'|'thinking'|'command'|'default'|'auto')`
  - 设置页「状态预览」区：思考 / 工具 / 命令 / 兜底 按钮 + 「自动」，逐状态检查前端效果
- **状态扩展接口**：`registerStatusType(type, {detect, poolId})` 与 `registerPool(pool)`，新增状态零改动
- **宿主文件持久化**：配置写入 `~/.dsh/dsh-status-glow-config.json`（端口无关，跨 DSH 重启不丢），
  localStorage 仅作缓存；设置页重开/重启后从持久化配置还原
- **平滑彩虹渐变**：色相等距 30° 的 12 色标 + 首尾同色闭环，头尾过渡均匀无停顿

### 变更（检测与渲染）

- **状态检测重构为宿主会话事件**（参照 whale-on-desk 的 session/event 方案）：
  - 宿主订阅 `ctx.on('session/event')` 折叠为小型状态机：
    `assistant/chunk`（非 text-delta）→ `thinking`；`tool/call` → `tool`（工具名匹配
    `bash|pwsh|powershell|shell|cmd|terminal|sh|zsh|fish|nu|ps1?` → `command`）；
    `tool/result` → 回到 `thinking`；`turn/end` → `default`
  - 新增 `/dsh-status-glow/state` 路由暴露 `{ status, tool, ts }`；浏览器每 1 秒轮询，
    状态变化立即重抽；优先级：**强制预览 > 宿主权威 > DOM 文本检测（兜底）**
  - 彻底摆脱 DOM 文本猜测（此前 turnstatus 上下文含全量会话文本导致总判 thinking）
- **精确命中最下方总状态**（v2）：祖先特征 + 屏幕位置评分 + 思考/消息上下文强排除 +
  shadow DOM 递归，思考旁文案不再被替换；检测上下文补充「当前回合」扫描（滚动容器最后 3 个子块）
- **分类按「最后出现位置」优先**：各状态关键词在上下文中最后一次出现的位置，最靠后者即当前阶段
  （历史回合的「思考/Think」不会抢先）；`registerStatusType` 支持 `regex` 字段参与位置分类
- **纯色特效不再露出应用原生蓝底**：纯色路径改为 `background-image: none !important` 盖住
- 所有内联样式经 `!important` 强制，不被应用主题颜色覆盖；unglow 对称清理
- 调试上报通道：`~/.dsh/dsh-status-glow-debug.jsonl`（30s 节流 + 计算样式 +
  实际生效状态 `status` 与信号来源 `host`），辅助真机验证

### 默认配置（出厂即当前调校效果）

- 全局：白字（`#ffffff`）、无辉光、无动画；静态兜底文本「大肥鲸鱼正在深度烧烤...( ˊ꒳ˋ )ₚ✧」
- `usePools: true`（按状态抽取）、`poolRepeat: false`（无相邻重复）
- 内置文案池：思考 14 条 / 工具 12 条 / 命令 10 条 / 兜底 11 条（含权重）
- 按池特效：思考 = 彩虹渐变 + 流动动画；工具 = 金黄渐变 + 柔和白光；
  命令 = 白字 + 蓝紫多层辉光；兜底 = 白字无辉光

## [0.1.0] - 2026-08-28

### 新增

- 初始版本：把「Deep diving...」替换为自定义文本，渐变彩虹文字 + 柔和白光辉光
- 设置页快捷入口：「状态文字」一级设置分区（特效下拉 + 文本输入 + 预览条 + 应用），即时生效无需重启
- 可配置样式接口：`window.__dshStatusGlow.configure()/getConfig()/resolveStyles()`，
  支持纯色 / 从左到右渐变 / 辉光（关闭、柔和白光、自定义多层）/ 动画（内置流动渐变）
- 宿主端 tapIndex 注入 + 状态替换渲染流程

> 注：0.1.0 为开发期版本，未单独打 tag；其功能随 0.2.0 一并发布。

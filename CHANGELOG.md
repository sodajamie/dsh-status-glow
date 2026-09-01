# Changelog

本项目的显著变更记录于此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-09-01

### 新增

- **随机文案池按状态分流**：`usePools` 配置开启后，总状态文案按状态类型从 `lib/text-pools.js` 抽取
  - 状态分类：`thinking`（思考/Think/推理）、`tool`（工具/tool/正在调用）、`command`（命令/command/shell），未命中回退 `default` 池
  - 无重复抽取：每池 Fisher-Yates 洗牌队列，同状态连续触发不出现相邻重复（含跨轮队首交换）
  - 权重支持：`weight: 2` 的文案出现频率约为 `weight: 1` 的两倍（默认 1）
- **状态扩展接口**：`registerStatusType(type, {detect, poolId})` 与 `registerPool(pool)`，新增状态只需注册检测信号与文案池，主逻辑零改动
- **设置页「随机文案」开关**：勾选即按状态分流抽取，即时生效无需重启
- 宿主端新增 `/dsh-status-glow/text-pools.js` 路由（在 `status.js` 之前注入，保证文案池就绪）

### 变更

- `configure()` 新增 `usePools` 字段（默认 `false`，向后兼容：关闭时维持静态文本行为）
- 单元测试扩展至 44 项（新增池结构 / 无相邻重复 / 权重占比 / 分类回退 / draw 边界）

## [0.2.0] - 2026-08-28

### 新增

- **设置页快捷入口**：「状态文字」一级设置分区（特效下拉 + 文本输入 + 预览条 + 应用），即时生效无需重启
- **可配置样式接口**：`window.__dshStatusGlow.configure()/getConfig()/resolveStyles()`，支持纯色 / 从左到右渐变 / 辉光（关闭、柔和白光、自定义多层）/ 动画（内置流动渐变），全部带默认值、类型校验与非法回退
- **初始化参数**：`window.__DSH_STATUS_GLOW_CONFIG__`；运行时消息通道 `postMessage({__dshStatusGlow:'config', config})`
- 配置持久化到 localStorage，页面刷新自动恢复

### 变更

- **精确命中**（v2）：只替换最下方总状态（祖先特征 + 屏幕位置评分 + 思考/消息上下文强排除 + shadow DOM 递归），思考旁文案不再被替换
- **平滑彩虹渐变**：色相等距 30° 的 12 色标 + 首尾同色闭环，头尾过渡均匀无停顿
- 调试上报通道（30s 节流 + 计算样式），辅助真机验证

## [0.1.0] - 2026-08-28

### 新增

- 初始版本：把「Deep diving...」替换为自定义文本，渐变彩虹文字 + 柔和白光辉光
- 宿主端 tapIndex 注入 + 状态替换渲染流程

> 注：0.1.0 为开发期版本，未单独打 tag；其功能在 0.2.0 首个提交中一并发布。

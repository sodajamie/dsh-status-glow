// dsh-status-glow text pools（随机文案池，按状态分流）。
//
// 经典脚本（无 import/export，与 lib/status.js 同款模式）：
// - 浏览器：宿主在 status.js 之前注入本文件，定义 window.__DSH_STATUS_GLOW_TEXT_POOLS__；
// - Node 单测：module.exports 直接导出 POOLS。
//
// 结构：{ [poolId]: { type, candidates: [{ text, status, weight, tags }] } }
// - text：展示文案（必填）
// - status：适用状态类型，与池 type 一致（必填，供筛选）
// - weight：抽取权重，默认 1（正整数，越大出现频率越高）
// - tags：筛选标签（可选，供后续过滤扩展）
(function (global) {
  'use strict'

  var POOLS = {
    thinking: {
      type: 'thinking',
      candidates: [
        { text: '正在深度烧烤...', status: 'thinking', weight: 2, tags: ['经典'] },
        { text: '正在和空气斗智斗勇...', status: 'thinking', weight: 1, tags: [] },
        { text: '大脑 CPU 已拉满...', status: 'thinking', weight: 1, tags: [] },
        { text: '正在思考人生的意义...', status: 'thinking', weight: 1, tags: [] },
        { text: '思路像头发一样多...', status: 'thinking', weight: 1, tags: [] },
        { text: '正在翻找记忆碎片...', status: 'thinking', weight: 1, tags: [] },
        { text: '正在用脑电波写字...', status: 'thinking', weight: 1, tags: [] },
        { text: '思考中，请勿投喂...', status: 'thinking', weight: 1, tags: [] },
        { text: '正在把问题揉成面团...', status: 'thinking', weight: 1, tags: [] },
        { text: '正在权衡利弊（选了全要）...', status: 'thinking', weight: 1, tags: ['梗'] },
        { text: '大鲸鱼正在深度烧烤...( ˊ꒳ˋ )ₚ✧', status: 'thinking', weight: 2, tags: ['自定义'] },
        { text: '俺寻思...', status: 'thinking', weight: 2, tags: ['自定义'] },
        { text: '正在偷吃token...', status: 'thinking', weight: 2, tags: ['自定义'] },
        { text: '用户目录里的dsh是什么？大烧货？', status: 'thinking', weight: 1, tags: ['自定义'] },
      ],
    },

    tool: {
      type: 'tool',
      candidates: [
        { text: '正在抄起键盘干活...', status: 'tool', weight: 1, tags: [] },
        { text: '正在调用工具...', status: 'tool', weight: 2, tags: ['经典'] },
        { text: '正在磨刀（打开工具箱）...', status: 'tool', weight: 1, tags: [] },
        { text: '工具已就位，开始操作...', status: 'tool', weight: 1, tags: [] },
        { text: '正在拧螺丝...', status: 'tool', weight: 1, tags: [] },
        { text: '正在翻工具箱找螺丝刀...', status: 'tool', weight: 1, tags: [] },
        { text: '执行器预热中...', status: 'tool', weight: 1, tags: [] },
        { text: '正在按按钮...', status: 'tool', weight: 1, tags: [] },
        { text: '自动化小工上线...', status: 'tool', weight: 1, tags: [] },
        { text: '正在读写文件...', status: 'tool', weight: 1, tags: [] },
        { text: '工具链已挂载...', status: 'tool', weight: 1, tags: [] },
        { text: '正在给工具擦灰...', status: 'tool', weight: 1, tags: ['梗'] },
      ],
    },

    command: {
      type: 'command',
      candidates: [
        { text: '正在执行命令...', status: 'command', weight: 2, tags: ['经典'] },
        { text: '终端模拟器启动...', status: 'command', weight: 1, tags: [] },
        { text: '正在敲击命令行...', status: 'command', weight: 1, tags: [] },
        { text: '命令已入队，执行中...', status: 'command', weight: 1, tags: [] },
        { text: '正在跑脚本...', status: 'command', weight: 1, tags: [] },
        { text: 'shell 里翻云覆雨...', status: 'command', weight: 1, tags: [] },
        { text: '正在等待命令回显...', status: 'command', weight: 1, tags: [] },
        { text: '正在批量操作...', status: 'command', weight: 1, tags: [] },
        { text: '命令行小霸王出击...', status: 'command', weight: 1, tags: ['梗'] },
        { text: '正在执行计划...', status: 'command', weight: 1, tags: [] },
      ],
    },

    default: {
      type: 'default',
      candidates: [
        { text: '正在深度烧烤...', status: 'default', weight: 2, tags: ['经典'] },
        { text: '正在忙碌...', status: 'default', weight: 1, tags: [] },
        { text: '摸鱼中，勿扰（假的）...', status: 'default', weight: 1, tags: ['梗'] },
        { text: '正在全力输出...', status: 'default', weight: 1, tags: [] },
        { text: '偷偷努力中...', status: 'default', weight: 1, tags: [] },
        { text: '正在加载进度条...', status: 'default', weight: 1, tags: [] },
        { text: '小齿轮转起来了...', status: 'default', weight: 1, tags: [] },
        { text: '正在处理中...', status: 'default', weight: 1, tags: [] },
        { text: '请稍候，正在燃烧 CPU...', status: 'default', weight: 1, tags: [] },
        { text: '忙得脚不沾地...', status: 'default', weight: 1, tags: [] },
        { text: '等我启动...', status: 'default', weight: 1, tags: ['自定义'] },
      ],
    },
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = POOLS
    return
  }
  if (global.window) global.window.__DSH_STATUS_GLOW_TEXT_POOLS__ = POOLS
})(typeof window !== 'undefined' ? window : globalThis)

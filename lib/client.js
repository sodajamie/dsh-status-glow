// dsh-status-glow client bundle (settings UI).
//
// 通过 DSH 客户端运行时（@deepseek-ai/dsh-client-runtime）加载，注册一个
// 一级设置分区「状态文字」：下拉栏选择文字特效（预设）、输入栏填写文本内容、
// 「应用」按钮即时套用 —— 直接调用 window.__dshStatusGlow.configure(...)，
// 无需重启 DSH。UI 选择状态持久化到 localStorage。
//
// 加载器约定（与 dsh-plugin-wallpaper-engine 相同）：
//   window.__ModuleLoader__.load({ id, factory }) —— factory(require) 返回
//   { apply, inject }；require("react") 由运行时提供，React hooks 可用。
window.__ModuleLoader__.load({
  id: "dsh-status-glow",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    // ── 特效预设 ──────────────────────────────────────────────────────────
    // 每个预设对应一段「已配置项」的片段（会与 text 合并后交给 configure()）。
    // 字段语义见 lib/status.js 的 DEFAULTS / normalizeConfig。
    // 平滑彩虹：色相等距 30°、首尾同色闭环（与 status.js 默认渐变一致）。
    const SMOOTH_RAINBOW = [
      "#ff6b6b", "#ffb36b", "#ffff6b", "#b3ff6b", "#6bff6b", "#6bffb3",
      "#6bffff", "#6bb3ff", "#6b6bff", "#b36bff", "#ff6bff", "#ff6bb3", "#ff6b6b",
    ];

    const PRESETS = [
      {
        key: "rainbow",
        label: "彩虹渐变 · 柔和白光",
        config: { gradientColors: SMOOTH_RAINBOW.slice(), textShadow: "soft-white" },
      },
      {
        key: "red-blue",
        label: "红蓝渐变",
        config: { gradientColors: ["#ff4d4d", "#4dc3ff"], textShadow: "soft-white" },
      },
      {
        key: "neon",
        label: "霓虹辉光",
        config: {
          color: "#ffffff",
          gradientColors: [],
          textShadow: [
            { color: "#4dc3ff", blur: 8 },
            { color: "#4dc3ff", blur: 18 },
            { color: "#b44dff", blur: 30 },
          ],
        },
      },
      {
        key: "gold",
        label: "金色渐变",
        config: { gradientColors: ["#fff3c4", "#ffd76a", "#ff9d2e"], textShadow: "soft-white" },
      },
      {
        key: "white",
        label: "纯白 · 无辉光",
        config: { color: "#ffffff", gradientColors: [], textShadow: false },
      },
      {
        key: "flow",
        label: "流动渐变",
        config: {
          gradientColors: SMOOTH_RAINBOW.slice(),
          animation: "flow",
        },
      },
    ];

    const UI_KEY = "dsh-status-glow:ui";
    const DEFAULT_TEXT = "正在深度烧烤...";

    function findPreset(key) {
      for (let i = 0; i < PRESETS.length; i++) {
        if (PRESETS[i].key === key) return PRESETS[i];
      }
      return PRESETS[0];
    }

    function readUI() {
      try {
        const raw = localStorage.getItem(UI_KEY);
        if (raw) {
          const ui = JSON.parse(raw);
          const preset = findPreset(ui.preset) ? ui.preset : PRESETS[0].key;
          const text = typeof ui.text === "string" && ui.text.length > 0 ? ui.text : DEFAULT_TEXT;
          return { preset, text };
        }
      } catch (e) {}
      return { preset: PRESETS[0].key, text: DEFAULT_TEXT };
    }

    function writeUI(preset, text) {
      try {
        localStorage.setItem(UI_KEY, JSON.stringify({ preset, text }));
      } catch (e) {}
    }

    // 即时套用：优先 configure()；脚本未就绪则写入初始化参数 + 消息通道兜底。
    function applyConfig(preset, text, usePools) {
      const presetDef = findPreset(preset);
      const cfg = Object.assign({}, presetDef.config, { text: text || DEFAULT_TEXT, usePools: !!usePools });
      let applied = false;
      try {
        if (window.__dshStatusGlow && typeof window.__dshStatusGlow.configure === "function") {
          window.__dshStatusGlow.configure(cfg);
          applied = true;
        }
      } catch (e) {}
      try { window.__DSH_STATUS_GLOW_CONFIG__ = cfg; } catch (e) {}
      try { window.postMessage({ __dshStatusGlow: "config", config: cfg }, "*"); } catch (e) {}
      return applied;
    }

    // 读取当前 usePools（来自 status.js 持久化配置）。
    function readUsePools() {
      try {
        if (window.__dshStatusGlow && typeof window.__dshStatusGlow.getConfig === "function") {
          return !!window.__dshStatusGlow.getConfig().usePools;
        }
      } catch (e) {}
      return false;
    }

    // ── 预览 ──────────────────────────────────────────────────────────────
    // 复用 status.js 的 resolveStyles()（纯解析、不套用到真实状态），把所选
    // 预设 + 输入文本解析为内联样式值，渲染到设置面板内的预览条上。
    function resolvePreviewStyle(preset, text) {
      const presetDef = findPreset(preset);
      const cfg = Object.assign({}, presetDef.config, { text: text || DEFAULT_TEXT });
      try {
        if (window.__dshStatusGlow && typeof window.__dshStatusGlow.resolveStyles === "function") {
          return window.__dshStatusGlow.resolveStyles(cfg);
        }
      } catch (e) {}
      return null;
    }

    function applyPreview(el, text, st) {
      if (!el) return;
      el.textContent = text || "预览文字";
      const s = el.style;
      s.cssText = ""; // 只清内联样式，.dsg-preview 类样式（深色底/圆角）保留
      if (!st) return;
      if (st.gradient) {
        s.backgroundImage = st.gradient;
        s.webkitBackgroundClip = "text";
        s.backgroundClip = "text";
        s.webkitTextFillColor = "transparent";
        s.color = "transparent";
      } else {
        s.color = st.color || "#ffffff";
        s.webkitTextFillColor = st.color || "#ffffff";
      }
      if (st.backgroundSize) s.backgroundSize = st.backgroundSize;
      if (st.animation) s.animation = st.animation; // flow 预览会实时流动
      if (st.shadow) s.textShadow = st.shadow;
    }

    function SettingsSection() {
      const ui = readUI();
      const [preset, setPreset] = React.useState(ui.preset);
      const [text, setText] = React.useState(ui.text);
      const [usePools, setUsePools] = React.useState(readUsePools());
      const [hint, setHint] = React.useState("");
      const previewRef = React.useRef(null);

      // 预设或文本变化时即时刷新预览条（所见即所得，无需点应用）。
      React.useEffect(() => {
        const st = resolvePreviewStyle(preset, text);
        applyPreview(previewRef.current, text, st);
      }, [preset, text]);

      const doApply = (p, t, u) => {
        const ok = applyConfig(p, t, u);
        writeUI(p, t);
        setHint(ok ? "已应用（即时生效，无需重启）" : "已保存，将在脚本就绪后生效");
      };

      return React.createElement(
        "div",
        { className: "dsg-settings" },
        React.createElement("div", { className: "dsg-preview", ref: previewRef }, "预览"),
        React.createElement(
          "div",
          { className: "dsg-field" },
          React.createElement("label", { className: "dsg-label" }, "文字特效"),
          React.createElement(
            "select",
            {
              className: "dsg-select",
              value: preset,
              onChange: (e) => {
                const p = e.target.value;
                setPreset(p);
                doApply(p, text, usePools);
              },
            },
            PRESETS.map((p) =>
              React.createElement("option", { key: p.key, value: p.key }, p.label),
            ),
          ),
        ),
        React.createElement(
          "div",
          { className: "dsg-field" },
          React.createElement("label", { className: "dsg-label" }, "文本内容"),
          React.createElement("input", {
            className: "dsg-input",
            type: "text",
            value: text,
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Enter") doApply(preset, text, usePools);
            },
          }),
        ),
        React.createElement(
          "div",
          { className: "dsg-field" },
          React.createElement(
            "label",
            { className: "dsg-label dsg-check-row" },
            React.createElement("input", {
              type: "checkbox",
              checked: usePools,
              onChange: (e) => {
                const v = e.target.checked;
                setUsePools(v);
                doApply(preset, text, v);
              },
            }),
            "随机文案（按状态分流抽取）",
          ),
          React.createElement("span", { className: "dsg-hint" },
            usePools ? "已开启：思考/工具/命令按状态从文案池无重复抽取" : "关闭：使用上方静态文本"),
        ),
        React.createElement(
          "div",
          { className: "dsg-actions" },
          React.createElement("button", { className: "dsg-btn", onClick: () => doApply(preset, text, usePools) }, "应用"),
          hint ? React.createElement("span", { className: "dsg-hint" }, hint) : null,
        ),
      );
    }

    const CSS = [
      ".dsg-settings{display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.5}",
      ".dsg-field{display:flex;flex-direction:column;gap:6px}",
      ".dsg-label{font-weight:600}",
      ".dsg-check-row{display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer}",
      ".dsg-select,.dsg-input{max-width:320px;padding:6px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:13px}",
      ".dsg-actions{display:flex;align-items:center;gap:10px}",
      ".dsg-btn{padding:6px 16px;border-radius:6px;border:1px solid transparent;background:#4f8cff;color:#fff;cursor:pointer;font-size:13px}",
      ".dsg-btn:hover{background:#3f7ae8}",
      ".dsg-hint{font-size:12px;color:rgba(128,128,128,.9)}",
      // 预览条：深色底让渐变/辉光/白字都清晰可见
      ".dsg-preview{margin:2px 0 4px;background:rgba(20,24,34,.92);border-radius:8px;padding:12px 16px;font-size:16px;font-weight:600;letter-spacing:.05em;line-height:1.4;color:#fff;min-height:24px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;box-shadow:0 2px 10px rgba(0,0,0,.25)}",
    ].join("");

    function injectCss() {
      if (document.getElementById("dsh-status-glow-settings-css")) return;
      const st = document.createElement("style");
      st.id = "dsh-status-glow-settings-css";
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }

    const inject = ["slots"];

    function apply(ctx) {
      injectCss();
      if (ctx.slots) {
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            { name: "settings.section", id: "dsh-status-glow", order: 490, label: "状态文字" },
            () => React.createElement(SettingsSection),
          ),
        );
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

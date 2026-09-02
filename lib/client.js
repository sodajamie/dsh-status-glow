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
    const DEFAULT_TEXT = "大肥鲸鱼正在深度烧烤...( ˊ꒳ˋ )ₚ✧";

    function findPreset(key) {
      for (let i = 0; i < PRESETS.length; i++) {
        if (PRESETS[i].key === key) return PRESETS[i];
      }
      return PRESETS[0];
    }

    // 读取 UI 初始状态：优先从已持久化配置（宿主文件 + localStorage，经 getConfig）
    // 推导文本与特效；本地显式选择（localStorage['dsh-status-glow:ui']）作为补充。
    function readUI() {
      const cfg = readConfig();
      let text = typeof cfg.text === "string" && cfg.text.length > 0 ? cfg.text : DEFAULT_TEXT;
      let preset = globalEffectKeyOf(cfg, PRESETS);
      try {
        const raw = localStorage.getItem(UI_KEY);
        if (raw) {
          const ui = JSON.parse(raw);
          if (findPreset(ui.preset, []).key === ui.preset) preset = ui.preset;
          if (typeof ui.text === "string" && ui.text.length > 0) text = ui.text;
        }
      } catch (e) {}
      return { preset, text };
    }

    // 用 resolveStyles 语义比对：从内置预设中找出与当前全局样式一致的 key。
    function globalEffectKeyOf(cfg, list) {
      try {
        if (window.__dshStatusGlow && typeof window.__dshStatusGlow.resolveStyles === "function") {
          const target = window.__dshStatusGlow.resolveStyles(cfg);
          for (let i = 0; i < list.length; i++) {
            const ps = window.__dshStatusGlow.resolveStyles(Object.assign({}, list[i].config, { text: cfg.text || DEFAULT_TEXT }));
            if (target.gradient === ps.gradient &&
                (target.color || null) === (ps.color || null) &&
                (target.shadow || null) === (ps.shadow || null) &&
                (target.animation || null) === (ps.animation || null) &&
                (target.backgroundSize || null) === (ps.backgroundSize || null)) {
              return list[i].key;
            }
          }
        }
      } catch (e) {}
      return PRESETS[0].key;
    }

    function writeUI(preset, text) {
      try {
        localStorage.setItem(UI_KEY, JSON.stringify({ preset, text }));
      } catch (e) {}
    }

    // 即时套用：优先 configure()；脚本未就绪则写入初始化参数 + 消息通道兜底。
    // opts：{ preset, text, usePools, poolRepeat, effects, poolCustoms, poolOverrides, poolEffects }
    function applyConfig(opts) {
      const presetDef = findPreset(opts.preset, opts.effects);
      const cfg = Object.assign({}, presetDef.config, {
        text: opts.text || DEFAULT_TEXT,
        usePools: !!opts.usePools,
        poolRepeat: opts.poolRepeat !== false,
      });
      for (const k of ["effects", "poolCustoms", "poolOverrides", "poolEffects"]) {
        if (opts[k] !== undefined) cfg[k] = opts[k];
      }
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

    // 读取 status.js 当前配置（getConfig）。
    function readConfig() {
      try {
        if (window.__dshStatusGlow && typeof window.__dshStatusGlow.getConfig === "function") {
          return window.__dshStatusGlow.getConfig();
        }
      } catch (e) {}
      return {};
    }
    function readUsePools() { return !!readConfig().usePools; }
    function readPoolRepeat() { return readConfig().poolRepeat !== false; }
    function readEffects() {
      const c = readConfig().effects;
      return Array.isArray(c) ? c : [];
    }
    function readPoolCustoms() {
      const c = readConfig().poolCustoms;
      return c && typeof c === "object" ? c : {};
    }
    function readPoolOverrides() {
      const c = readConfig().poolOverrides;
      return c && typeof c === "object" ? c : {};
    }
    function readPoolEffects() {
      const c = readConfig().poolEffects;
      return c && typeof c === "object" ? c : {};
    }

    // 内置文案池（lib/text-pools.js 注入的全局）。
    function readBuiltinPools() {
      try {
        const p = window.__DSH_STATUS_GLOW_TEXT_POOLS__;
        return p && typeof p === "object" ? p : {};
      } catch (e) {}
      return {};
    }

    // 池的有效文案列表：poolOverrides（整表）> 内置池 + poolCustoms（追加）。
    function effectiveEntries(poolKey, poolOverrides, poolCustoms, builtin) {
      if (poolOverrides && poolOverrides[poolKey]) return poolOverrides[poolKey];
      const builtinCands = (builtin && builtin[poolKey] && builtin[poolKey].candidates) || [];
      const customs = (poolCustoms && poolCustoms[poolKey]) || [];
      return builtinCands
        .map((c) => ({ text: c.text, weight: c.weight || 1 }))
        .concat(customs);
    }

    // 特效配置与预设的字段级比对（用于下拉框回显当前值）。
    function effectConfigEquals(a, b) {
      if (!a || !b) return false;
      const ga = a.gradientColors, gb = b.gradientColors;
      if (Array.isArray(ga) !== Array.isArray(gb)) return false;
      if (Array.isArray(ga)) {
        if (!Array.isArray(gb) || ga.length !== gb.length) return false;
        for (let i = 0; i < ga.length; i++) {
          if (String(ga[i]).toLowerCase() !== String(gb[i]).toLowerCase()) return false;
        }
      }
      const norm = (v) => (v === undefined ? null : v);
      return norm(a.color) === norm(b.color) &&
             norm(a.textShadow) === norm(b.textShadow) &&
             norm(a.animation) === norm(b.animation);
    }
    function effectKeyOf(config, effectList) {
      if (!config) return "global";
      for (let i = 0; i < effectList.length; i++) {
        if (effectConfigEquals(config, effectList[i].config)) return effectList[i].key;
      }
      return "global";
    }

    // 状态强制预览：调用 status.js 的 debugSetStatus（需 agent 正在工作）。
    function debugForceStatus(type) {
      try {
        if (window.__dshStatusGlow && typeof window.__dshStatusGlow.debugSetStatus === "function") {
          return window.__dshStatusGlow.debugSetStatus(type);
        }
      } catch (e) {}
      return { ok: false, reason: "脚本未就绪" };
    }

    // 在「内置预设 + 自定义特效」中按 key 查找；找不到回退第一个内置预设。
    function findPreset(key, customs) {
      const list = PRESETS.concat(customs || []);
      for (let i = 0; i < list.length; i++) {
        if (list[i].key === key) return list[i];
      }
      return PRESETS[0];
    }

    // ── 预览 ──────────────────────────────────────────────────────────────
    // 复用 status.js 的 resolveStyles()（纯解析、不套用到真实状态），把所选
    // 预设 + 输入文本解析为内联样式值，渲染到设置面板内的预览条上。
    function resolvePreviewStyle(preset, text, customs) {
      const presetDef = findPreset(preset, customs);
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

    // ── 文案池卡片：列表展示 + 增删改 + 按池特效 ──────────────────────────
    function PoolCard(props) {
      const { poolKey, label, entries, effectConfig, effectList, onChangeEntries, onChangeEffect, onReset, defaultOpen } = props;
      const [open, setOpen] = React.useState(!!defaultOpen);
      const [editIdx, setEditIdx] = React.useState(-1);
      const [editText, setEditText] = React.useState("");
      const [editWeight, setEditWeight] = React.useState("1");
      const [addText, setAddText] = React.useState("");
      const [addWeight, setAddWeight] = React.useState("1");

      const effectKey = effectKeyOf(effectConfig, effectList);

      const saveEdit = () => {
        if (editIdx < 0 || !editText.trim()) return;
        const next = entries.slice();
        next[editIdx] = { text: editText, weight: parseInt(editWeight, 10) || 1 };
        onChangeEntries(next);
        setEditIdx(-1);
      };
      const removeEntry = (i) => {
        const next = entries.slice();
        next.splice(i, 1);
        onChangeEntries(next);
      };
      const addEntry = () => {
        if (!addText.trim()) return;
        onChangeEntries(entries.concat([{ text: addText, weight: parseInt(addWeight, 10) || 1 }]));
        setAddText("");
      };

      return React.createElement(
        "div",
        { className: "dsg-pool" },
        React.createElement(
          "div",
          { className: "dsg-pool-head" },
          React.createElement("button", { className: "dsg-pool-toggle", onClick: () => setOpen(!open) }, open ? "▾" : "▸"),
          React.createElement("span", { className: "dsg-pool-title" },
            label,
            React.createElement("span", { className: "dsg-hint" }, "（" + entries.length + " 条）"),
          ),
          React.createElement("select", {
            className: "dsg-mini-input dsg-pool-effect",
            value: effectKey,
            onClick: (e) => e.stopPropagation(),
            onChange: (e) => {
              const v = e.target.value;
              const def = effectList.find((x) => x.key === v);
              onChangeEffect(def ? def.config : null);
            },
            title: "该状态专属特效（覆盖全局特效）",
          },
            React.createElement("option", { value: "global" }, "跟随全局"),
            effectList.map((x) => React.createElement("option", { key: x.key, value: x.key }, x.label)),
          ),
          React.createElement("button", { className: "dsg-btn dsg-btn-sm dsg-btn-ghost", onClick: () => onReset() }, "恢复默认"),
        ),
        open
          ? React.createElement(
              "div",
              { className: "dsg-pool-body" },
              entries.map((entry, i) =>
                React.createElement(
                  "div",
                  { className: "dsg-pool-row", key: i },
                  editIdx === i
                    ? React.createElement(React.Fragment, null,
                        React.createElement("input", {
                          className: "dsg-mini-input dsg-grow", type: "text", value: editText,
                          onChange: (e) => setEditText(e.target.value),
                          onKeyDown: (e) => { if (e.key === "Enter") saveEdit(); },
                        }),
                        React.createElement("input", {
                          className: "dsg-mini-input dsg-weight", type: "number", min: "1", value: editWeight,
                          onChange: (e) => setEditWeight(e.target.value),
                        }),
                        React.createElement("button", { className: "dsg-btn dsg-btn-sm", onClick: saveEdit }, "保存"),
                        React.createElement("button", { className: "dsg-btn dsg-btn-sm dsg-btn-ghost", onClick: () => setEditIdx(-1) }, "取消"),
                      )
                    : React.createElement(React.Fragment, null,
                        React.createElement("span", { className: "dsg-pool-text" }, entry.text),
                        React.createElement("span", { className: "dsg-hint" }, "×" + (entry.weight || 1)),
                        React.createElement("button", {
                          className: "dsg-del", title: "编辑",
                          onClick: () => { setEditIdx(i); setEditText(entry.text); setEditWeight(String(entry.weight || 1)); },
                        }, "✎"),
                        React.createElement("button", { className: "dsg-del", title: "删除", onClick: () => removeEntry(i) }, "×"),
                      ),
                ),
              ),
              React.createElement(
                "div",
                { className: "dsg-pool-row dsg-pool-add" },
                React.createElement("input", {
                  className: "dsg-mini-input dsg-grow", type: "text", placeholder: "新文案",
                  value: addText, onChange: (e) => setAddText(e.target.value),
                  onKeyDown: (e) => { if (e.key === "Enter") addEntry(); },
                }),
                React.createElement("input", {
                  className: "dsg-mini-input dsg-weight", type: "number", min: "1", placeholder: "权重",
                  value: addWeight, onChange: (e) => setAddWeight(e.target.value),
                }),
                React.createElement("button", { className: "dsg-btn dsg-btn-sm", onClick: addEntry }, "添加"),
              ),
            )
          : null,
      );
    }

    function SettingsSection() {
      const ui = readUI();
      const [preset, setPreset] = React.useState(ui.preset);
      const [text, setText] = React.useState(ui.text);
      const [usePools, setUsePools] = React.useState(readUsePools());
      const [poolRepeat, setPoolRepeat] = React.useState(readPoolRepeat());
      const [effects, setEffects] = React.useState(readEffects());
      const [poolCustoms, setPoolCustoms] = React.useState(readPoolCustoms());
      const [poolOverrides, setPoolOverrides] = React.useState(readPoolOverrides());
      const [poolEffects, setPoolEffects] = React.useState(readPoolEffects());
      const [hint, setHint] = React.useState("");
      const [statusPreview, setStatusPreview] = React.useState("");
      const previewRef = React.useRef(null);

      // 自定义特效表单
      const [effName, setEffName] = React.useState("");
      const [effType, setEffType] = React.useState("gradient");
      const [effColors, setEffColors] = React.useState("");
      const [effSolid, setEffSolid] = React.useState("#ffffff");
      const [effShadow, setEffShadow] = React.useState("soft-white");
      const [effAnim, setEffAnim] = React.useState("none");

      // 预设或文本变化时即时刷新预览条（所见即所得，无需点应用）。
      React.useEffect(() => {
        const st = resolvePreviewStyle(preset, text, effects);
        applyPreview(previewRef.current, text, st);
      }, [preset, text, effects]);

      // 统一提交：extra 覆盖当前各字段后交给 applyConfig（全部即时生效并持久化）。
      const doApply = (extra) => {
        const opts = Object.assign({ preset, text, usePools, poolRepeat, effects, poolCustoms, poolOverrides, poolEffects }, extra);
        const ok = applyConfig(opts);
        writeUI(preset, text);
        setHint(ok ? "已应用（即时生效，无需重启）" : "已保存，将在脚本就绪后生效");
      };

      const addCustomEffect = () => {
        const cfg = {};
        if (effType === "solid") {
          cfg.color = effSolid || "#ffffff";
          cfg.gradientColors = [];
        } else {
          cfg.gradientColors = effColors.split(",").map((s) => s.trim()).filter(Boolean);
        }
        cfg.textShadow = effShadow === "off" ? false : "soft-white";
        if (effAnim === "flow") cfg.animation = "flow";
        const next = effects.concat([{ key: "custom-" + Date.now(), label: effName || "自定义特效", config: cfg }]);
        setEffects(next);
        doApply({ effects: next });
        setEffName(""); setEffColors("");
      };

      const removeCustomEffect = (key) => {
        const next = effects.filter((e) => e.key !== key);
        setEffects(next);
        doApply({ effects: next });
      };

      // ── 各池卡片：整表增删改 + 按池特效 ──
      const builtin = readBuiltinPools();
      const POOL_META = [
        { key: "thinking", label: "思考" },
        { key: "tool", label: "工具调用" },
        { key: "command", label: "命令" },
        { key: "default", label: "兜底" },
      ];

      const saveEntries = (poolKey, entries) => {
        const next = Object.assign({}, poolOverrides);
        if (entries && entries.length) next[poolKey] = entries;
        else delete next[poolKey];
        setPoolOverrides(next);
        doApply({ poolOverrides: next });
      };
      const saveEffect = (poolKey, config) => {
        const next = Object.assign({}, poolEffects);
        if (config) next[poolKey] = config;
        else delete next[poolKey];
        setPoolEffects(next);
        doApply({ poolEffects: next });
      };
      const resetPool = (poolKey) => {
        const po = Object.assign({}, poolOverrides); delete po[poolKey];
        const pe = Object.assign({}, poolEffects); delete pe[poolKey];
        setPoolOverrides(po); setPoolEffects(pe);
        doApply({ poolOverrides: po, poolEffects: pe });
      };

      const effectList = PRESETS.concat(effects.map((e) => ({ key: e.key, label: e.label, config: e.config })));
      const allPoolKeys = POOL_META.map((m) => m.key).concat(
        Object.keys(poolOverrides).filter((k) => !POOL_META.some((m) => m.key === k)),
      );

      return React.createElement(
        "div",
        { className: "dsg-settings" },
        React.createElement("div", { className: "dsg-preview", ref: previewRef }, "预览"),

        // ── 文字特效（内置 + 自定义）──
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
                doApply({ preset: p });
              },
            },
            effectList.map((p) =>
              React.createElement("option", { key: p.key, value: p.key }, p.label),
            ),
          ),
        ),

        // ── 文本内容 ──
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
              if (e.key === "Enter") doApply({});
            },
          }),
        ),

        // ── 随机文案开关 + 允许重复 ──
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
                doApply({ usePools: v });
              },
            }),
            "随机文案（按状态分流抽取）",
          ),
          React.createElement(
            "label",
            { className: "dsg-label dsg-check-row" },
            React.createElement("input", {
              type: "checkbox",
              checked: poolRepeat,
              onChange: (e) => {
                const v = e.target.checked;
                setPoolRepeat(v);
                doApply({ poolRepeat: v });
              },
            }),
            "允许重复（关闭则相邻不重复）",
          ),
          React.createElement("span", { className: "dsg-hint" },
            usePools ? "已开启：按状态从文案池抽取" : "关闭：使用上方静态文本"),
        ),

        // ── 自定义特效 ──
        React.createElement(
          "div",
          { className: "dsg-field" },
          React.createElement("label", { className: "dsg-label" }, "自定义特效"),
          React.createElement("div", { className: "dsg-row" },
            React.createElement("input", {
              className: "dsg-mini-input", type: "text", placeholder: "名称",
              value: effName, onChange: (e) => setEffName(e.target.value),
            }),
            React.createElement("select", {
              className: "dsg-mini-input", value: effType,
              onChange: (e) => setEffType(e.target.value),
            },
              React.createElement("option", { value: "gradient" }, "渐变"),
              React.createElement("option", { value: "solid" }, "纯色"),
            ),
          ),
          React.createElement("div", { className: "dsg-row" },
            effType === "solid"
              ? React.createElement("input", {
                  className: "dsg-mini-input", type: "color", value: effSolid,
                  onChange: (e) => setEffSolid(e.target.value),
                })
              : React.createElement("input", {
                  className: "dsg-mini-input dsg-grow", type: "text",
                  placeholder: "渐变颜色，逗号分隔，如 #ff0000,#4dc3ff",
                  value: effColors, onChange: (e) => setEffColors(e.target.value),
                }),
            React.createElement("select", {
              className: "dsg-mini-input", value: effShadow,
              onChange: (e) => setEffShadow(e.target.value),
            },
              React.createElement("option", { value: "soft-white" }, "柔和白光"),
              React.createElement("option", { value: "off" }, "无辉光"),
            ),
            React.createElement("select", {
              className: "dsg-mini-input", value: effAnim,
              onChange: (e) => setEffAnim(e.target.value),
            },
              React.createElement("option", { value: "none" }, "无动画"),
              React.createElement("option", { value: "flow" }, "流动"),
            ),
            React.createElement("button", { className: "dsg-btn dsg-btn-sm", onClick: addCustomEffect }, "添加"),
          ),
          effects.length
            ? React.createElement(
                "div",
                { className: "dsg-chip-list" },
                effects.map((e) =>
                  React.createElement(
                    "span",
                    { key: e.key, className: "dsg-chip" },
                    e.label,
                    React.createElement("button", { className: "dsg-del", onClick: () => removeCustomEffect(e.key), title: "删除" }, "×"),
                  ),
                ),
              )
            : null,
        ),

        // ── 各池卡片：列表展示 + 增删改 + 按池特效 ──
        React.createElement(
          "div",
          { className: "dsg-field" },
          React.createElement("label", { className: "dsg-label" }, "文案池（按状态分流）"),
          React.createElement("span", { className: "dsg-hint" },
            "每个状态独立维护文案列表与特效；编辑后整表保存，无需点「应用」"),
          allPoolKeys.map((poolKey) => {
            const meta = POOL_META.find((m) => m.key === poolKey) || { key: poolKey, label: poolKey };
            return React.createElement(PoolCard, {
              key: poolKey,
              poolKey: poolKey,
              label: meta.label,
              entries: effectiveEntries(poolKey, poolOverrides, poolCustoms, builtin),
              effectConfig: poolEffects[poolKey] || null,
              effectList: effectList,
              onChangeEntries: (entries) => saveEntries(poolKey, entries),
              onChangeEffect: (config) => saveEffect(poolKey, config),
              onReset: () => resetPool(poolKey),
              defaultOpen: !!poolOverrides[poolKey] || !!poolEffects[poolKey],
            });
          }),
        ),

        // ── 状态遍历（检查前端效果）──
        React.createElement(
          "div",
          { className: "dsg-field" },
          React.createElement("label", { className: "dsg-label" }, "状态预览（检查前端效果）"),
          React.createElement(
            "div",
            { className: "dsg-row" },
            POOL_META.map((m) =>
              React.createElement("button", {
                key: m.key,
                className: "dsg-btn dsg-btn-sm" + (statusPreview === m.key ? " dsg-btn-active" : ""),
                onClick: () => {
                  const r = debugForceStatus(m.key);
                  setStatusPreview(r && r.ok ? m.key : "");
                  setHint(r && r.ok ? "已强制 " + m.label + "：检查状态栏效果后点「自动」恢复" : (r && r.reason) || "");
                },
              }, m.label),
            ),
            React.createElement("button", {
              className: "dsg-btn dsg-btn-sm dsg-btn-ghost",
              onClick: () => { debugForceStatus("auto"); setStatusPreview(""); setHint("已恢复自动检测"); },
            }, "自动"),
          ),
          React.createElement("span", { className: "dsg-hint" },
            "需 agent 正在工作时状态元素存在；点击后当前状态栏立即切换为该状态的文案与特效"),
        ),

        // ── 应用 ──
        React.createElement(
          "div",
          { className: "dsg-actions" },
          React.createElement("button", { className: "dsg-btn", onClick: () => doApply({}) }, "应用"),
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
      // 深色模式修复：select 的 color:inherit 在深色主题下解析为浅色文字，而 Chrome
      // 的 option 下拉弹层背景仍是浅色（页面未声明 color-scheme:dark 时），白字配白底
      // 导致选项不可见。显式固定 option 配色（只影响展开的下拉列表，不影响关闭态的主题继承）。
      ".dsg-select option,.dsg-mini-input option{color:#1a1a1a;background:#ffffff}",
      ".dsg-actions{display:flex;align-items:center;gap:10px}",
      ".dsg-btn{padding:6px 16px;border-radius:6px;border:1px solid transparent;background:#4f8cff;color:#fff;cursor:pointer;font-size:13px}",
      ".dsg-btn:hover{background:#3f7ae8}",
      ".dsg-hint{font-size:12px;color:rgba(128,128,128,.9)}",
      // 预览条：深色底让渐变/辉光/白字都清晰可见
      ".dsg-preview{margin:2px 0 4px;background:rgba(20,24,34,.92);border-radius:8px;padding:12px 16px;font-size:16px;font-weight:600;letter-spacing:.05em;line-height:1.4;color:#fff;min-height:24px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;box-shadow:0 2px 10px rgba(0,0,0,.25)}",
      // 自定义特效 / 自定义池
      ".dsg-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
      ".dsg-mini-input{padding:5px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:12px;max-width:150px}",
      ".dsg-mini-input.dsg-grow{flex:1;min-width:140px;max-width:none}",
      ".dsg-mini-input.dsg-weight{max-width:64px}",
      ".dsg-btn-sm{padding:5px 12px;font-size:12px}",
      ".dsg-chip-list{display:flex;flex-wrap:wrap;gap:6px}",
      ".dsg-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:999px;background:rgba(79,140,255,.15);border:1px solid rgba(79,140,255,.4);font-size:12px}",
      ".dsg-del{border:none;background:transparent;color:inherit;cursor:pointer;font-size:14px;line-height:1;opacity:.7;padding:0 2px}",
      ".dsg-del:hover{opacity:1;color:#ff5f5f}",
      // 文案池卡片
      ".dsg-pool{border:1px solid rgba(128,128,128,.35);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column;gap:8px}",
      ".dsg-pool-head{display:flex;align-items:center;gap:8px}",
      ".dsg-pool-toggle{border:none;background:transparent;color:inherit;cursor:pointer;font-size:12px;padding:2px 4px}",
      ".dsg-pool-title{font-weight:600;flex:1;min-width:80px}",
      ".dsg-pool-effect{max-width:180px}",
      ".dsg-btn-ghost{background:transparent;color:inherit;border:1px solid rgba(128,128,128,.4)}",
      ".dsg-btn-ghost:hover{background:rgba(128,128,128,.15)}",
      ".dsg-btn-active{outline:2px solid #4f8cff;outline-offset:1px}",
      ".dsg-pool-body{display:flex;flex-direction:column;gap:4px}",
      ".dsg-pool-row{display:flex;align-items:center;gap:6px}",
      ".dsg-pool-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dsg-pool-add{border-top:1px dashed rgba(128,128,128,.3);padding-top:6px;margin-top:2px}",
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

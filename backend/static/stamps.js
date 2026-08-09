/**
 * Document stamps for canvas + PDF export.
 * @typedef {Object} StampConfig
 * @property {string} [preset]
 * @property {string} text
 * @property {'rect'|'rounded'|'ellipse'|'double'|'cross'} shape
 * @property {string} fill - hex
 * @property {number} fillOpacity - 0..1
 * @property {string} stroke - hex
 * @property {string} textColor - hex
 * @property {number} strokeWidth
 * @property {boolean} dashed
 * @property {boolean} doubleBorder
 * @property {boolean} cross
 * @property {boolean} checkmark
 * @property {'none'|'check'|'x'|'star'|'exclamation'|'arrow'|'info'|'shield'|'minus'} [sign]
 * @property {boolean} strike
 * @property {number} fontSize
 * @property {string} fontFamily
 * @property {string} fontWeight
 * @property {number} charSpacing
 * @property {number} width
 * @property {number} height
 * @property {number} defaultRotation
 */

const STAMP_FONT_OPTIONS = [
    { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica / Arial' },
    { value: 'Times New Roman, Times, serif', label: 'Times New Roman' },
    { value: 'Courier New, Courier, monospace', label: 'Courier New' },
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: 'Verdana, sans-serif', label: 'Verdana' },
    { value: 'Trebuchet MS, sans-serif', label: 'Trebuchet MS' },
    { value: 'Palatino, Palatino Linotype, serif', label: 'Palatino' },
    { value: 'Garamond, serif', label: 'Garamond' },
    { value: 'Comic Sans MS, cursive', label: 'Comic Sans MS' },
];

const STAMP_SIGN_OPTIONS = [
    { id: 'none', label: 'None', preview: '—' },
    { id: 'check', label: 'Check', preview: '✓' },
    { id: 'x', label: 'Cross', preview: '✕' },
    { id: 'star', label: 'Star', preview: '★' },
    { id: 'exclamation', label: 'Alert', preview: '!' },
    { id: 'arrow', label: 'Arrow', preview: '→' },
    { id: 'info', label: 'Info', preview: 'i' },
    { id: 'shield', label: 'Shield', preview: '⛨' },
    { id: 'minus', label: 'Minus', preview: '−' },
];

const STAMP_PRESET_KEYS = [
    'approved', 'draft', 'confidential', 'void',
    'rejected', 'copy', 'received', 'sample',
];

const STAMP_PRESET_LIBRARY = {
    approved: {
        preset: 'approved',
        text: 'APPROVED',
        shape: 'rounded',
        fill: '#15803d',
        fillOpacity: 0.09,
        stroke: '#15803d',
        textColor: '#14532d',
        strokeWidth: 2.5,
        dashed: false,
        doubleBorder: false,
        cross: false,
        checkmark: true,
        strike: false,
        fontSize: 16,
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: 'bold',
        charSpacing: 70,
        width: 172,
        height: 54,
        defaultRotation: -8,
    },
    draft: {
        preset: 'draft',
        text: 'DRAFT',
        shape: 'rect',
        fill: '#2563eb',
        fillOpacity: 0.11,
        stroke: '#2563eb',
        textColor: '#1d4ed8',
        strokeWidth: 2,
        dashed: true,
        doubleBorder: false,
        cross: false,
        checkmark: false,
        strike: false,
        fontSize: 21,
        fontWeight: '600',
        charSpacing: 140,
        width: 148,
        height: 52,
        defaultRotation: 0,
    },
    confidential: {
        preset: 'confidential',
        text: 'CONFIDENTIAL',
        shape: 'double',
        fill: '#b91c1c',
        fillOpacity: 0.1,
        stroke: '#b91c1c',
        textColor: '#991b1b',
        strokeWidth: 2.5,
        dashed: false,
        doubleBorder: true,
        cross: false,
        checkmark: false,
        strike: false,
        fontSize: 13,
        fontWeight: 'bold',
        charSpacing: 90,
        width: 228,
        height: 50,
        defaultRotation: 0,
    },
    void: {
        preset: 'void',
        text: 'VOID',
        shape: 'cross',
        fill: '#374151',
        fillOpacity: 0.07,
        stroke: '#374151',
        textColor: '#1f2937',
        strokeWidth: 3.5,
        dashed: false,
        doubleBorder: false,
        cross: true,
        checkmark: false,
        strike: true,
        fontSize: 25,
        fontWeight: 'bold',
        charSpacing: 220,
        width: 108,
        height: 108,
        defaultRotation: -22,
    },
    rejected: {
        preset: 'rejected',
        text: 'REJECTED',
        shape: 'rounded',
        fill: '#dc2626',
        fillOpacity: 0.12,
        stroke: '#dc2626',
        textColor: '#b91c1c',
        strokeWidth: 3,
        dashed: false,
        doubleBorder: false,
        cross: true,
        checkmark: false,
        strike: false,
        fontSize: 16,
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: 'bold',
        charSpacing: 40,
        width: 168,
        height: 56,
        defaultRotation: -8,
    },
    copy: {
        preset: 'copy',
        text: 'COPY',
        shape: 'rect',
        fill: '#64748b',
        fillOpacity: 0.1,
        stroke: '#475569',
        textColor: '#334155',
        strokeWidth: 2,
        dashed: true,
        doubleBorder: false,
        cross: false,
        checkmark: false,
        strike: false,
        fontSize: 22,
        fontWeight: 'bold',
        charSpacing: 180,
        width: 120,
        height: 52,
        defaultRotation: 0,
    },
    received: {
        preset: 'received',
        text: 'RECEIVED',
        shape: 'rounded',
        fill: '#0284c7',
        fillOpacity: 0.12,
        stroke: '#0284c7',
        textColor: '#0369a1',
        strokeWidth: 2.5,
        dashed: false,
        doubleBorder: false,
        cross: false,
        checkmark: false,
        strike: false,
        fontSize: 15,
        fontWeight: 'bold',
        charSpacing: 40,
        width: 168,
        height: 52,
        defaultRotation: 0,
    },
    sample: {
        preset: 'sample',
        text: 'SAMPLE',
        shape: 'rect',
        fill: '#ea580c',
        fillOpacity: 0.12,
        stroke: '#ea580c',
        textColor: '#c2410c',
        strokeWidth: 2,
        dashed: true,
        doubleBorder: false,
        cross: false,
        checkmark: false,
        strike: false,
        fontSize: 20,
        fontWeight: '600',
        charSpacing: 120,
        width: 140,
        height: 52,
        defaultRotation: 0,
    },
};

function darkenHex(hex, amount = 0.15) {
    const h = (hex || '#000000').replace('#', '');
    if (h.length < 6) return hex || '#000000';
    const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
    const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
    const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const CUSTOM_STAMPS_STORAGE_KEY = 'pdfedit_custom_stamps';

const StampKit = {
    _customCache: null,

    listBuiltinPresets() {
        return STAMP_PRESET_KEYS.slice();
    },

    listPresets() {
        return this.listBuiltinPresets().concat(this.listCustomIds());
    },

    listCustomIds() {
        return this._loadCustom().map((item) => item.id);
    },

    isBuiltin(key) {
        return STAMP_PRESET_KEYS.includes(key);
    },

    isCustom(key) {
        return !this.isBuiltin(key) && this.getCustomRecord(key) != null;
    },

    _loadCustom() {
        if (this._customCache) return this._customCache;
        try {
            const raw = localStorage.getItem(CUSTOM_STAMPS_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            this._customCache = Array.isArray(parsed) ? parsed : [];
        } catch {
            this._customCache = [];
        }
        return this._customCache;
    },

    _persistCustom(list) {
        this._customCache = list;
        localStorage.setItem(CUSTOM_STAMPS_STORAGE_KEY, JSON.stringify(list));
    },

    getCustomRecord(id) {
        return this._loadCustom().find((item) => item.id === id) || null;
    },

    getPreset(key) {
        const custom = this.getCustomRecord(key);
        if (custom?.config) {
            return this.mergeConfig(custom.config, { preset: key });
        }
        const base = STAMP_PRESET_LIBRARY[key] || STAMP_PRESET_LIBRARY.approved;
        return this.cloneConfig(base);
    },

    createBlankCustom(name = 'NEW STAMP') {
        const base = this.cloneConfig(STAMP_PRESET_LIBRARY.approved);
        base.preset = '';
        base.text = String(name || 'NEW STAMP').toUpperCase().slice(0, 48);
        return base;
    },

    generateCustomId() {
        return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    },

    saveCustomStamp(config, id = null) {
        const nextConfig = this.mergeConfig(config);
        const stampId = id || this.generateCustomId();
        nextConfig.preset = stampId;

        const list = this._loadCustom().slice();
        const index = list.findIndex((item) => item.id === stampId);
        const record = {
            id: stampId,
            name: nextConfig.text || 'STAMP',
            config: nextConfig,
            updatedAt: Date.now(),
        };

        if (index >= 0) {
            list[index] = record;
        } else {
            list.push(record);
        }

        this._persistCustom(list);
        return stampId;
    },

    listCustomStamps() {
        return this._loadCustom().slice();
    },

    deleteCustomStamp(id) {
        if (!id || this.isBuiltin(id)) return false;
        const list = this._loadCustom().filter((item) => item.id !== id);
        if (list.length === this._loadCustom().length) return false;
        this._persistCustom(list);
        return true;
    },

    duplicatePreset(key) {
        const source = this.getPreset(key);
        const copy = this.cloneConfig(source);
        copy.preset = '';
        copy.text = source.text;
        return copy;
    },

    cloneConfig(config) {
        return JSON.parse(JSON.stringify(config || STAMP_PRESET_LIBRARY.approved));
    },

    listFontOptions() {
        return STAMP_FONT_OPTIONS.slice();
    },

    listSignOptions() {
        return STAMP_SIGN_OPTIONS.slice();
    },

    resolveSign(config) {
        const cfg = config || {};
        if (cfg.sign && STAMP_SIGN_OPTIONS.some((item) => item.id === cfg.sign)) {
            return cfg.sign;
        }
        if (cfg.checkmark) return 'check';
        return 'none';
    },

    hasSign(config) {
        return this.resolveSign(config) !== 'none';
    },

    resolveFontFamily(config) {
        return config?.fontFamily || 'Helvetica, Arial, sans-serif';
    },

    mergeConfig(base, patch) {
        const next = this.cloneConfig(base);
        if (!patch) return this.normalizeConfig(next);
        Object.assign(next, patch);
        if (patch.text != null) next.text = String(patch.text).toUpperCase().slice(0, 48) || 'STAMP';
        return this.normalizeConfig(next);
    },

    normalizeConfig(config) {
        const next = config || {};
        next.sign = this.resolveSign(next);
        next.checkmark = next.sign === 'check';
        if (!next.fontFamily) next.fontFamily = 'Helvetica, Arial, sans-serif';
        if (!next.signOffset && next.checkmarkOffset) {
            next.signOffset = { ...next.checkmarkOffset };
        }
        return next;
    },

    applyAccentColor(config, hex) {
        const next = this.cloneConfig(config);
        const stroke = hex || next.stroke || '#16a34a';
        next.fill = stroke;
        next.stroke = stroke;
        next.textColor = darkenHex(stroke, 0.12);
        return next;
    },

    fillRgba(config) {
        const hex = (config.fill || '#cc0000').replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16) || 0;
        const g = parseInt(hex.slice(2, 4), 16) || 0;
        const b = parseInt(hex.slice(4, 6), 16) || 0;
        const a = config.fillOpacity != null ? config.fillOpacity : 0.12;
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    },

    fillCss(config) {
        const hex = config.fill || '#16a34a';
        const a = config.fillOpacity != null ? config.fillOpacity : 0.12;
        return this.fillRgba({ fill: hex, fillOpacity: a });
    },

    measure(config, pdfScale = 2) {
        const s = pdfScale;
        return {
            width: (config.width || 160) * s,
            height: (config.height || 52) * s,
        };
    },

    /**
     * Left icon column used by stamp signs.
     */
    signColumn(w, h) {
        const colLeft = w * 0.07;
        const colRight = w * 0.36;
        const cx = (colLeft + colRight) / 2;
        const cy = h / 2;
        const span = Math.min(colRight - colLeft, h * 0.52);
        return { colLeft, colRight, cx, cy, span };
    },

    /**
     * Bold two-stroke approval check, centered in the left column of the stamp.
     */
    checkmarkGeometry(w, h) {
        const { cx, cy, span } = this.signColumn(w, h);
        const x0 = cx - span * 0.38;
        const y0 = cy + span * 0.12;
        const x1 = cx - span * 0.08;
        const y1 = cy + span * 0.38;
        const x2 = cx + span * 0.42;
        const y2 = cy - span * 0.38;
        const path = `M ${x0} ${y0} L ${x1} ${y1} L ${x2} ${y2}`;
        return {
            path,
            points: [[x0, y0], [x1, y1], [x2, y2]],
            strokeWidth: Math.max(2.5, h * 0.075),
        };
    },

    signGeometry(w, h, signType) {
        const sign = signType || 'none';
        const { cx, cy, span } = this.signColumn(w, h);
        const strokeWidth = Math.max(2.5, h * 0.075);
        const pad = span * 0.34;

        switch (sign) {
            case 'check':
                return { kind: 'path', ...this.checkmarkGeometry(w, h) };
            case 'x': {
                const path = `M ${cx - pad} ${cy - pad} L ${cx + pad} ${cy + pad} M ${cx + pad} ${cy - pad} L ${cx - pad} ${cy + pad}`;
                return { kind: 'path', path, strokeWidth };
            }
            case 'star': {
                const outer = pad * 1.05;
                const inner = outer * 0.42;
                const points = [];
                for (let i = 0; i < 10; i += 1) {
                    const angle = (-Math.PI / 2) + (i * Math.PI / 5);
                    const radius = i % 2 === 0 ? outer : inner;
                    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
                }
                const path = `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
                return { kind: 'path', path, strokeWidth: strokeWidth * 0.85, fill: true };
            }
            case 'exclamation':
                return {
                    kind: 'parts',
                    parts: [
                        { kind: 'line', x1: cx, y1: cy - pad * 0.95, x2: cx, y2: cy + pad * 0.15, strokeWidth },
                        { kind: 'circle', cx, cy: cy + pad * 0.72, r: Math.max(2, span * 0.08), fill: true },
                    ],
                };
            case 'arrow': {
                const path = `M ${cx - pad * 0.85} ${cy} L ${cx + pad * 0.45} ${cy} M ${cx + pad * 0.05} ${cy - pad * 0.55} L ${cx + pad * 0.75} ${cy} L ${cx + pad * 0.05} ${cy + pad * 0.55}`;
                return { kind: 'path', path, strokeWidth };
            }
            case 'info':
                return {
                    kind: 'parts',
                    parts: [
                        { kind: 'circle', cx, cy, r: pad * 0.95, strokeWidth: strokeWidth * 0.9 },
                        { kind: 'line', x1: cx, y1: cy - pad * 0.35, x2: cx, y2: cy + pad * 0.2, strokeWidth: strokeWidth * 0.85 },
                        { kind: 'circle', cx, cy: cy + pad * 0.58, r: Math.max(2, span * 0.07), fill: true },
                    ],
                };
            case 'shield': {
                const top = cy - pad * 0.95;
                const bottom = cy + pad * 0.95;
                const path = `M ${cx} ${top} L ${cx + pad * 0.95} ${top + pad * 0.45} L ${cx + pad * 0.75} ${bottom} L ${cx} ${bottom - pad * 0.15} L ${cx - pad * 0.75} ${bottom} L ${cx - pad * 0.95} ${top + pad * 0.45} Z`;
                return { kind: 'path', path, strokeWidth: strokeWidth * 0.85 };
            }
            case 'minus':
                return {
                    kind: 'line',
                    x1: cx - pad * 0.85,
                    y1: cy,
                    x2: cx + pad * 0.85,
                    y2: cy,
                    strokeWidth,
                };
            default:
                return null;
        }
    },

    buildSignParts(cfg, w, h, s, stroke, partOpts) {
        const sign = this.resolveSign(cfg);
        if (sign === 'none') return [];

        const geom = this.signGeometry(w, h, sign);
        if (!geom) return [];

        const offsetX = (cfg.signOffset?.x || cfg.checkmarkOffset?.x || 0) * s;
        const offsetY = (cfg.signOffset?.y || cfg.checkmarkOffset?.y || 0) * s;
        const parts = [];

        const addPath = (path, strokeWidth, fill = false) => {
            const signPath = new fabric.Path(path, {
                fill: fill ? stroke : 'transparent',
                stroke,
                strokeWidth: Math.max(2, strokeWidth),
                strokeLineCap: 'round',
                strokeLineJoin: 'round',
                strokeUniform: true,
                _partType: 'sign',
                ...partOpts,
            });
            signPath.set({
                left: signPath.left + offsetX,
                top: signPath.top + offsetY,
            });
            parts.push(signPath);
        };

        if (geom.kind === 'path') {
            addPath(geom.path, geom.strokeWidth, !!geom.fill);
        } else if (geom.kind === 'line') {
            parts.push(new fabric.Line([geom.x1 + offsetX, geom.y1 + offsetY, geom.x2 + offsetX, geom.y2 + offsetY], {
                stroke,
                strokeWidth: Math.max(2, geom.strokeWidth),
                strokeLineCap: 'round',
                strokeUniform: true,
                _partType: 'sign',
                ...partOpts,
            }));
        } else if (geom.kind === 'parts') {
            geom.parts.forEach((item) => {
                if (item.kind === 'line') {
                    parts.push(new fabric.Line(
                        [item.x1 + offsetX, item.y1 + offsetY, item.x2 + offsetX, item.y2 + offsetY],
                        {
                            stroke,
                            strokeWidth: Math.max(2, item.strokeWidth),
                            strokeLineCap: 'round',
                            strokeUniform: true,
                            _partType: 'sign',
                            ...partOpts,
                        },
                    ));
                } else if (item.kind === 'circle') {
                    parts.push(new fabric.Circle({
                        left: item.cx + offsetX,
                        top: item.cy + offsetY,
                        radius: item.r,
                        originX: 'center',
                        originY: 'center',
                        fill: item.fill ? stroke : 'transparent',
                        stroke: item.fill ? stroke : stroke,
                        strokeWidth: item.fill ? 0 : Math.max(1.5, item.strokeWidth || 2),
                        strokeUniform: true,
                        _partType: 'sign',
                        ...partOpts,
                    }));
                }
            });
        }

        return parts;
    },

    capCharSpacing(cfg, fontSize, w, s) {
        const raw = (cfg.charSpacing || 0) * s;
        const label = (cfg.text || 'STAMP').length || 1;
        const maxByWidth = Math.max(0, (w * 0.82) / label - fontSize * 0.4);
        return Math.min(raw, maxByWidth, Math.max(fontSize * 2.5, 0));
    },

    fitTextFontSize(text, maxWidth, maxHeight, baseSize, charSpacing = 0) {
        const label = text || 'STAMP';
        const spacingFactor = 1 + (charSpacing || 0) / 800;
        let size = baseSize;
        const minSize = Math.max(8, baseSize * 0.45);
        while (size > minSize) {
            const estWidth = label.length * size * 0.58 * spacingFactor;
            if (estWidth <= maxWidth && size <= maxHeight * 0.55) break;
            size -= 1;
        }
        return size;
    },

    computeTextLayout(cfg, w, h, s, shape) {
        const baseFontSize = (cfg.fontSize || 16) * s;
        const charSpacing = this.capCharSpacing(cfg, baseFontSize, w, s);

        if (this.hasSign(cfg)) {
            const textLeft = w * 0.42;
            const textWidth = w * 0.54;
            return {
                left: textLeft + textWidth / 2,
                top: h / 2,
                width: textWidth,
                fontSize: this.fitTextFontSize(cfg.text, textWidth, h * 0.62, baseFontSize, charSpacing),
                charSpacing,
            };
        }

        if (shape === 'ellipse') {
            const diameter = Math.min(w, h);
            const innerW = diameter * 0.72;
            return {
                left: w / 2,
                top: h / 2,
                width: innerW,
                fontSize: this.fitTextFontSize(cfg.text, innerW, diameter * 0.5, baseFontSize, charSpacing),
                charSpacing,
            };
        }

        const pad = shape === 'rounded' ? 10 * s : 8 * s;
        const innerW = Math.max(w - pad * 2, 24);
        return {
            left: w / 2,
            top: h / 2,
            width: innerW,
            fontSize: this.fitTextFontSize(cfg.text, innerW, h * 0.65, baseFontSize, charSpacing),
            charSpacing,
        };
    },

    buildParts(config, pdfScale = 2) {
        const cfg = this.mergeConfig(config);
        const s = pdfScale;
        const w = cfg.width * s;
        const h = cfg.height * s;
        const parts = [];
        const fill = this.fillRgba(cfg);
        const stroke = cfg.stroke || '#cc0000';
        const sw = (cfg.strokeWidth || 2) * s;
        const strokePad = sw / 2;
        const innerW = Math.max(w - sw, 1);
        const innerH = Math.max(h - sw, 1);
        const dash = cfg.dashed ? [10 * s, 5 * s] : null;
        const shape = cfg.shape || 'rounded';
        const partOpts = { evented: false, selectable: false };

        const addRect = (opts) => {
            parts.push(new fabric.Rect({
                left: strokePad,
                top: strokePad,
                width: innerW,
                height: innerH,
                fill,
                stroke,
                strokeWidth: sw,
                strokeDashArray: dash,
                strokeUniform: true,
                ...partOpts,
                ...opts,
            }));
        };

        if (shape === 'ellipse') {
            parts.push(new fabric.Ellipse({
                left: w / 2,
                top: h / 2,
                rx: innerW / 2,
                ry: innerH / 2,
                originX: 'center',
                originY: 'center',
                fill,
                stroke,
                strokeWidth: sw,
                strokeDashArray: dash,
                strokeUniform: true,
                ...partOpts,
            }));
        } else if (shape === 'rounded') {
            addRect({ rx: 6 * s, ry: 6 * s });
        } else if (shape !== 'cross') {
            addRect({});
        }

        if (cfg.doubleBorder || shape === 'double') {
            const inset = strokePad + 5 * s;
            parts.push(new fabric.Rect({
                left: inset,
                top: inset,
                width: w - inset * 2,
                height: h - inset * 2,
                fill: 'transparent',
                stroke,
                strokeWidth: Math.max(1, sw * 0.6),
                strokeDashArray: dash,
                strokeUniform: true,
                ...partOpts,
            }));
        }

        if (cfg.cross || shape === 'cross') {
            const pad = strokePad + 11 * s;
            const crossSw = sw * 0.9;
            parts.push(new fabric.Line([pad, pad, w - pad, h - pad], {
                stroke,
                strokeWidth: crossSw,
                strokeLineCap: 'round',
                strokeUniform: true,
                ...partOpts,
            }));
            parts.push(new fabric.Line([w - pad, pad, pad, h - pad], {
                stroke,
                strokeWidth: crossSw,
                strokeLineCap: 'round',
                strokeUniform: true,
                ...partOpts,
            }));
        }

        parts.push(...this.buildSignParts(cfg, w, h, s, stroke, partOpts));

        const textLayout = this.computeTextLayout(cfg, w, h, s, shape);
        const fontSize = Math.max(textLayout.fontSize, 8);
        const tx = (cfg.textOffset?.x || 0) * s;
        const ty = (cfg.textOffset?.y || 0) * s;
        parts.push(new fabric.Text(cfg.text || 'STAMP', {
            left: textLayout.left + tx,
            top: textLayout.top + ty,
            fontSize,
            fill: cfg.textColor || stroke,
            fontFamily: this.resolveFontFamily(cfg),
            fontWeight: cfg.fontWeight || 'bold',
            originX: 'center',
            originY: 'center',
            charSpacing: textLayout.charSpacing,
            _partType: 'text',
            ...partOpts,
        }));

        if (cfg.strike) {
            const strikeY = textLayout.top + fontSize * 0.35 + ty;
            parts.push(new fabric.Line([w * 0.12 + tx, strikeY, w * 0.88 + tx, strikeY], {
                stroke: cfg.textColor || stroke,
                strokeWidth: 2 * s,
                ...partOpts,
            }));
        }

        parts.unshift(new fabric.Rect({
            left: 0,
            top: 0,
            width: w,
            height: h,
            fill: 'transparent',
            strokeWidth: 0,
            evented: false,
            selectable: false,
            excludeFromExport: true,
        }));

        return { parts, width: w, height: h, config: cfg };
    },

    createPresetButton(key, cfg, options = {}) {
        const config = cfg || this.getPreset(key);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `stamp-preset-btn stamp-preset-${key}${options.active ? ' active' : ''}`;
        btn.dataset.stampType = key;
        btn.title = config.text;
        btn.style.color = config.textColor;
        btn.style.borderColor = config.stroke;
        btn.style.background = this.fillCss(config);
        if (config.dashed) btn.style.borderStyle = 'dashed';

        const sign = this.resolveSign(config);
        if (sign !== 'none') {
            const signEl = document.createElement('span');
            signEl.className = 'stamp-preset-btn-sign';
            signEl.textContent = STAMP_SIGN_OPTIONS.find((item) => item.id === sign)?.preview || '•';
            btn.appendChild(signEl);
        } else if (config.checkmark) {
            const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            check.setAttribute('class', 'stamp-preset-btn-checkmark');
            check.setAttribute('viewBox', '0 0 24 24');
            check.setAttribute('fill', 'none');
            check.setAttribute('stroke', 'currentColor');
            check.setAttribute('stroke-width', '3.5');
            check.setAttribute('stroke-linecap', 'round');
            check.setAttribute('stroke-linejoin', 'round');

            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            poly.setAttribute('d', 'M5.5 12.5 L9.5 16.5 L18 7');
            check.appendChild(poly);
            btn.appendChild(check);
        }

        const label = document.createElement('span');
        label.className = 'stamp-preset-label';
        const short = config.text.length > 16 ? `${config.text.slice(0, 14)}…` : config.text;
        label.textContent = short;
        btn.appendChild(label);
        return btn;
    },

    renderPreviewCanvas(canvasEl, config, options = {}) {
        if (!canvasEl || typeof fabric === 'undefined') return null;

        const maxW = options.maxWidth || 320;
        const maxH = options.maxHeight || 120;
        const pdfScale = 2;
        const { parts, width, height } = this.buildParts(config, pdfScale);

        const angle = config.defaultRotation || 0;
        const angleRad = Math.abs(angle * Math.PI / 180);
        const rotatedW = width * Math.cos(angleRad) + height * Math.sin(angleRad);
        const rotatedH = width * Math.sin(angleRad) + height * Math.cos(angleRad);

        const fit = Math.min(maxW / rotatedW, maxH / rotatedH, 1.5);
        const displayW = Math.round(rotatedW * fit);
        const displayH = Math.round(rotatedH * fit);

        canvasEl.width = displayW;
        canvasEl.height = displayH;
        canvasEl.style.width = `${displayW}px`;
        canvasEl.style.height = `${displayH}px`;

        let canvas = canvasEl.__stampPreview;
        const needsInteractive = !!options.interactive;
        
        if (!canvas) {
            const canvasClass = needsInteractive ? fabric.Canvas : fabric.StaticCanvas;
            canvas = new canvasClass(canvasEl, {
                selection: false,
                renderOnAddRemove: false,
            });
            canvasEl.__stampPreview = canvas;
        } else {
            const isInteractive = canvas instanceof fabric.Canvas;
            if (isInteractive !== needsInteractive) {
                canvas.dispose();
                const canvasClass = needsInteractive ? fabric.Canvas : fabric.StaticCanvas;
                canvas = new canvasClass(canvasEl, {
                    selection: false,
                    renderOnAddRemove: false,
                });
                canvasEl.__stampPreview = canvas;
            } else {
                canvas.clear();
            }
        }

        canvas.setWidth(displayW);
        canvas.setHeight(displayH);
        canvas.setZoom(fit);

        const stampCenter = new fabric.Point(width / 2, height / 2);
        const radians = fabric.util.degreesToRadians(angle);
        const dx = (rotatedW - width) / 2;
        const dy = (rotatedH - height) / 2;

        parts.forEach((part) => {
            if (part.excludeFromExport) {
                part.set({
                    left: width / 2 + dx,
                    top: height / 2 + dy,
                    originX: 'center',
                    originY: 'center',
                    selectable: false,
                    evented: false,
                });
                part.setCoords();
                canvas.add(part);
                return;
            }

            const origCenter = part.getCenterPoint();
            const rotCenter = fabric.util.rotatePoint(origCenter, stampCenter, radians);

            part.set({
                angle: (part.angle || 0) + angle,
            });
            part.setPositionByOrigin(new fabric.Point(rotCenter.x + dx, rotCenter.y + dy), 'center', 'center');

            const isInteractiveItem = needsInteractive &&
                (part._partType === 'text' || part._partType === 'sign' || part._partType === 'checkmark');

            if (isInteractiveItem) {
                part.set({
                    selectable: true,
                    evented: true,
                    hasControls: false,
                    hasBorders: true,
                    borderColor: '#01696f',
                    borderScaleFactor: 1.5,
                    hoverCursor: 'move',
                });
            } else {
                part.set({
                    selectable: false,
                    evented: false,
                });
            }

            part.setCoords();
            canvas.add(part);
        });

        if (needsInteractive) {
            canvas.off('object:moving');
            canvas.on('object:moving', (e) => {
                const obj = e.target;
                if (!obj) return;

                const draggedCenter = obj.getCenterPoint();
                const newRotCenter = new fabric.Point(draggedCenter.x - dx, draggedCenter.y - dy);
                const newOrigCenter = fabric.util.rotatePoint(newRotCenter, stampCenter, fabric.util.degreesToRadians(-angle));

                // Use clean config with no offsets to find the unshifted position
                const cleanConfig = { ...config, textOffset: null, signOffset: null, checkmarkOffset: null };

                if (obj._partType === 'text') {
                    const textLayout = this.computeTextLayout(cleanConfig, width, height, pdfScale, config.shape);
                    const defaultX = textLayout.left;
                    const defaultY = textLayout.top;
                    config.textOffset = {
                        x: (newOrigCenter.x - defaultX) / pdfScale,
                        y: (newOrigCenter.y - defaultY) / pdfScale,
                    };
                } else if (obj._partType === 'sign' || obj._partType === 'checkmark') {
                    const signType = this.resolveSign(cleanConfig);
                    const geom = this.signGeometry(width, height, signType);
                    let defaultX = width * 0.215;
                    let defaultY = height / 2;
                    if (geom?.kind === 'path') {
                        const tempPath = new fabric.Path(geom.path);
                        const tempCenter = tempPath.getCenterPoint();
                        defaultX = tempCenter.x;
                        defaultY = tempCenter.y;
                    }
                    config.signOffset = {
                        x: (newOrigCenter.x - defaultX) / pdfScale,
                        y: (newOrigCenter.y - defaultY) / pdfScale,
                    };
                    config.checkmarkOffset = { ...config.signOffset };
                }

                if (options.onOffsetChange) {
                    options.onOffsetChange(config);
                }
            });
        }

        canvas.renderAll();
        return canvas;
    },
};

window.StampKit = StampKit;

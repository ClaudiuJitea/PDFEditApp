class Toolbar {
    constructor() {
        this.activeTool = 'select';
        this.onToolChange = null;
        this.onPropertyChange = null;
        this.onFormValueChange = null;
        this.onFormFieldSelect = null;
        this.onFormCreate = null;
        this.onFormDelete = null;
        this.onFormDuplicate = null;
        this.onFormMatchSizes = null;
        this.onFormPropertiesChange = null;
        this.onTableAction = null;
        this._suppressFormPanelEvents = false;
        this._boundElements = false;
    }

    init() {
        this._bindToolButtons();
        this._bindColorValueFields();
        this._bindPropertyControls();
        this._bindFormControls();
        this._bindCompositeControls();
        this._boundElements = true;
    }

    _bindToolButtons() {
        document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.tool;
                this.setActiveTool(tool);
                if (this.onToolChange) this.onToolChange(tool);
            });
        });
    }

    _bindColorValueFields() {
        document.querySelectorAll('input.prop-color[type="color"]').forEach((colorInput) => {
            if (colorInput.dataset.hexBound === 'true') return;

            const hexInput = document.createElement('input');
            hexInput.type = 'text';
            hexInput.className = 'prop-color-hex';
            hexInput.maxLength = 7;
            hexInput.spellcheck = false;
            hexInput.value = (colorInput.value || '#000000').toUpperCase();
            hexInput.setAttribute('aria-label', `${colorInput.id || 'color'} hex value`);

            colorInput.insertAdjacentElement('afterend', hexInput);
            colorInput.dataset.hexBound = 'true';
            colorInput.title = 'Open color picker';
            colorInput.setAttribute('aria-label', `${colorInput.id || 'color'} color picker`);

            const syncHexFromColor = () => {
                hexInput.value = (colorInput.value || '#000000').toUpperCase();
            };

            const commitHexToColor = () => {
                const normalized = this._normalizeHexColor(hexInput.value);
                if (!normalized) {
                    syncHexFromColor();
                    return;
                }
                colorInput.value = normalized;
                hexInput.value = normalized.toUpperCase();
                colorInput.dispatchEvent(new Event('input', { bubbles: true }));
                colorInput.dispatchEvent(new Event('change', { bubbles: true }));
            };

            const openPicker = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._openAdaptiveColorPicker(colorInput, hexInput);
            };

            colorInput.addEventListener('mousedown', openPicker);
            colorInput.addEventListener('click', openPicker);
            colorInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    openPicker(e);
                }
            });
            colorInput.addEventListener('input', syncHexFromColor);
            colorInput.addEventListener('change', syncHexFromColor);
            hexInput.addEventListener('change', commitHexToColor);
            hexInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitHexToColor();
                    hexInput.blur();
                } else if (e.key === 'Escape') {
                    syncHexFromColor();
                    hexInput.blur();
                }
            });
            hexInput.addEventListener('blur', commitHexToColor);
        });
    }

    _ensureAdaptiveColorPicker() {
        if (this._adaptiveColorPicker) return this._adaptiveColorPicker;

        const popover = document.createElement('div');
        popover.className = 'adaptive-color-popover';
        popover.style.display = 'none';
        popover.innerHTML = `
            <div class="adaptive-color-header">
                <span>Color</span>
                <button type="button" class="adaptive-color-close" aria-label="Close color picker">×</button>
            </div>
            <div class="adaptive-color-main">
                <div class="adaptive-color-preview" aria-hidden="true"></div>
                <input type="text" class="adaptive-color-hex" maxlength="7" spellcheck="false" aria-label="Hex color">
            </div>
            <div class="adaptive-color-sliders">
                <label><span>R</span><input type="range" min="0" max="255" data-channel="r"><input type="number" min="0" max="255" data-channel-number="r"></label>
                <label><span>G</span><input type="range" min="0" max="255" data-channel="g"><input type="number" min="0" max="255" data-channel-number="g"></label>
                <label><span>B</span><input type="range" min="0" max="255" data-channel="b"><input type="number" min="0" max="255" data-channel-number="b"></label>
            </div>
            <div class="adaptive-color-presets" aria-label="Preset colors"></div>
        `;
        document.body.appendChild(popover);

        const presets = [
            '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
            '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
            '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
            '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#01696f', '#4f98a3',
        ];
        const presetWrap = popover.querySelector('.adaptive-color-presets');
        presets.forEach((hex) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'adaptive-color-preset';
            btn.style.setProperty('--preset-color', hex);
            btn.dataset.color = hex;
            btn.title = hex.toUpperCase();
            presetWrap.appendChild(btn);
        });

        const close = () => this._closeAdaptiveColorPicker();
        popover.querySelector('.adaptive-color-close').addEventListener('click', close);

        document.addEventListener('mousedown', (e) => {
            if (popover.style.display === 'none') return;
            const active = this._activeAdaptiveColorInput;
            if (popover.contains(e.target) || active === e.target) return;
            close();
        });
        window.addEventListener('resize', () => this._positionAdaptiveColorPicker());
        window.addEventListener('scroll', () => this._positionAdaptiveColorPicker(), true);

        const setFromHex = (hex, commit = true) => {
            const normalized = this._normalizeHexColor(hex);
            if (!normalized) return;
            this._setAdaptiveColor(normalized, commit);
        };

        popover.querySelector('.adaptive-color-hex').addEventListener('input', (e) => {
            const normalized = this._normalizeHexColor(e.target.value);
            if (normalized) this._setAdaptiveColor(normalized, true);
        });
        popover.querySelector('.adaptive-color-hex').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                setFromHex(e.target.value, true);
                this._closeAdaptiveColorPicker();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this._closeAdaptiveColorPicker();
            }
        });
        popover.querySelectorAll('[data-channel], [data-channel-number]').forEach((input) => {
            input.addEventListener('input', (e) => {
                const channel = e.target.dataset.channel || e.target.dataset.channelNumber;
                const value = Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0));
                popover.querySelector(`[data-channel="${channel}"]`).value = value;
                popover.querySelector(`[data-channel-number="${channel}"]`).value = value;
                const rgb = this._readAdaptiveRgb();
                this._setAdaptiveColor(this._rgbToHex(rgb.r, rgb.g, rgb.b), true);
            });
        });
        popover.querySelectorAll('.adaptive-color-preset').forEach((btn) => {
            btn.addEventListener('click', () => {
                this._setAdaptiveColor(btn.dataset.color, true);
            });
        });

        this._adaptiveColorPicker = popover;
        return popover;
    }

    _openAdaptiveColorPicker(colorInput, hexInput) {
        const popover = this._ensureAdaptiveColorPicker();
        this._activeAdaptiveColorInput = colorInput;
        this._activeAdaptiveHexInput = hexInput;
        this._setAdaptiveColor(colorInput.value || '#000000', false);
        popover.style.display = 'block';
        this._positionAdaptiveColorPicker();
        const hex = popover.querySelector('.adaptive-color-hex');
        if (hex) {
            hex.focus();
            hex.select();
        }
    }

    _closeAdaptiveColorPicker() {
        if (!this._adaptiveColorPicker) return;
        this._adaptiveColorPicker.style.display = 'none';
        this._activeAdaptiveColorInput = null;
        this._activeAdaptiveHexInput = null;
    }

    _positionAdaptiveColorPicker() {
        const popover = this._adaptiveColorPicker;
        const target = this._activeAdaptiveColorInput;
        if (!popover || !target || popover.style.display === 'none') return;

        const margin = 8;
        const rect = target.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const width = popoverRect.width || 260;
        const height = popoverRect.height || 320;
        let left = rect.left;
        let top = rect.bottom + 6;

        if (left + width > window.innerWidth - margin) {
            left = window.innerWidth - width - margin;
        }
        if (top + height > window.innerHeight - margin) {
            top = rect.top - height - 6;
        }
        left = Math.max(margin, left);
        top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    _hexToRgb(hex) {
        const normalized = this._normalizeHexColor(hex) || '#000000';
        return {
            r: parseInt(normalized.slice(1, 3), 16),
            g: parseInt(normalized.slice(3, 5), 16),
            b: parseInt(normalized.slice(5, 7), 16),
        };
    }

    _rgbToHex(r, g, b) {
        return '#' + [r, g, b]
            .map((n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0'))
            .join('');
    }

    _readAdaptiveRgb() {
        const popover = this._adaptiveColorPicker;
        return {
            r: parseInt(popover.querySelector('[data-channel="r"]').value, 10) || 0,
            g: parseInt(popover.querySelector('[data-channel="g"]').value, 10) || 0,
            b: parseInt(popover.querySelector('[data-channel="b"]').value, 10) || 0,
        };
    }

    _setAdaptiveColor(hex, commit = true) {
        const normalized = this._normalizeHexColor(hex);
        if (!normalized || !this._adaptiveColorPicker) return;
        const popover = this._adaptiveColorPicker;
        const rgb = this._hexToRgb(normalized);

        popover.querySelector('.adaptive-color-preview').style.background = normalized;
        popover.querySelector('.adaptive-color-hex').value = normalized.toUpperCase();
        ['r', 'g', 'b'].forEach((ch) => {
            popover.querySelector(`[data-channel="${ch}"]`).value = rgb[ch];
            popover.querySelector(`[data-channel-number="${ch}"]`).value = rgb[ch];
        });

        if (this._activeAdaptiveColorInput) {
            this._activeAdaptiveColorInput.value = normalized;
            if (this._activeAdaptiveHexInput) {
                this._activeAdaptiveHexInput.value = normalized.toUpperCase();
            }
            if (commit) {
                this._activeAdaptiveColorInput.dispatchEvent(new Event('input', { bubbles: true }));
                this._activeAdaptiveColorInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    _normalizeHexColor(value) {
        const raw = String(value || '').trim();
        const hex = raw.startsWith('#') ? raw.slice(1) : raw;
        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            return `#${hex.split('').map((ch) => ch + ch).join('')}`.toLowerCase();
        }
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            return `#${hex}`.toLowerCase();
        }
        return null;
    }

    _bindPropertyControls() {
        const textProps = [
            'prop-font-family', 'prop-font-size', 'prop-font-weight', 'prop-text-color', 'prop-text-bg',
            'prop-line-height', 'prop-char-spacing', 'prop-text-stroke-color', 'prop-text-stroke-width',
            'prop-text-opacity', 'prop-text-rotation',
        ];
        textProps.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, () => this._onTextPropChange(id));
        });

        document.getElementById('prop-bold').addEventListener('click', () => this._toggleStyle('bold'));
        document.getElementById('prop-italic').addEventListener('click', () => this._toggleStyle('italic'));
        document.getElementById('prop-underline').addEventListener('click', () => this._toggleStyle('underline'));
        document.getElementById('prop-strikethrough').addEventListener('click', () => this._toggleStyle('strikethrough'));

        document.querySelectorAll('.prop-text-align-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (this.onPropertyChange) {
                    this.onPropertyChange('text', 'textAlign', btn.dataset.textAlign);
                }
                const active = this.editor?.getActiveObject?.();
                if (active) this.syncTextAlignButtons(active);
            });
        });

        document.querySelectorAll('.prop-page-align-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.prop-page-align-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                if (this.onPropertyChange) {
                    this.onPropertyChange('text', 'pageAlign', btn.dataset.pageAlign);
                }
            });
        });

        document.querySelectorAll('.prop-case-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.prop-case-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                if (this.onPropertyChange) {
                    this.onPropertyChange('text', 'textCase', btn.dataset.case);
                }
            });
        });

        document.getElementById('prop-text-shadow').addEventListener('click', () => {
            const btn = document.getElementById('prop-text-shadow');
            btn.classList.toggle('active');
            if (this.onPropertyChange) {
                this.onPropertyChange('text', 'textShadow', btn.classList.contains('active'));
            }
        });

        document.getElementById('prop-clear-text-bg').addEventListener('click', () => {
            const input = document.getElementById('prop-text-bg');
            input.value = '#ffffff';
            if (this.onPropertyChange) this.onPropertyChange('text', 'backgroundColor', '');
        });

        document.getElementById('prop-clear-text-stroke').addEventListener('click', () => {
            document.getElementById('prop-text-stroke-width').value = '0';
            if (this.onPropertyChange) {
                this.onPropertyChange('text', 'textStrokeWidth', 0);
                this.onPropertyChange('text', 'textStrokeColor', 'transparent');
            }
        });

        const shapeProps = ['prop-fill', 'prop-stroke', 'prop-stroke-width', 'prop-shape-opacity', 'prop-shape-rotation', 'prop-corner-radius'];
        shapeProps.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, () => this._onShapePropChange(id));
        });

        document.getElementById('prop-clear-fill').addEventListener('click', () => {
            if (this.onPropertyChange) this.onPropertyChange('shape', 'fill', 'transparent');
        });
        document.getElementById('prop-clear-stroke').addEventListener('click', () => {
            if (this.onPropertyChange) this.onPropertyChange('shape', 'stroke', 'transparent');
        });

        const tableProps = ['prop-table-rows', 'prop-table-cols', 'prop-table-fill', 'prop-table-stroke', 'prop-table-stroke-width', 'prop-table-text-layer'];
        tableProps.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, () => this._onTablePropChange(id));
        });
        const clearTableFill = document.getElementById('prop-table-clear-fill');
        if (clearTableFill) {
            clearTableFill.addEventListener('click', () => {
                if (this.onPropertyChange) this.onPropertyChange('table', 'fill', 'transparent');
            });
        }
        const clearTableStroke = document.getElementById('prop-table-clear-stroke');
        if (clearTableStroke) {
            clearTableStroke.addEventListener('click', () => {
                if (this.onPropertyChange) this.onPropertyChange('table', 'stroke', 'transparent');
                this._syncTableLinesMode('transparent');
            });
        }

        this._bindTableActionButtons();

        const brushProps = ['prop-brush-color', 'prop-brush-width', 'prop-brush-opacity'];
        brushProps.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, () => this._onBrushPropChange(id));
        });

        const stickyProps = ['prop-sticky-opacity'];
        stickyProps.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, () => this._onStickyPropChange(id));
        });

        ['prop-stamp-text', 'prop-stamp-accent'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, () => this._onStampPropChange(id));
            if (el.type !== 'color') {
                el.addEventListener('input', () => this._onStampPropChange(id));
            }
        });

        document.querySelectorAll('.sticky-color-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.stickyColor;
                document.querySelectorAll('.sticky-color-btn').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                if (this.onPropertyChange) this.onPropertyChange('sticky', 'stickyColor', color);
            });
        });

        document.getElementById('prop-clear-brush-color').addEventListener('click', () => {
            if (this.onPropertyChange) this.onPropertyChange('brush', 'color', 'transparent');
        });

        document.querySelectorAll('.prop-chip-linestyle').forEach((btn) => {
            btn.addEventListener('click', () => {
                const value = btn.dataset.value;
                document.querySelectorAll('.prop-chip-linestyle').forEach((b) => b.classList.remove('active'));
                btn.classList.add('active');
                if (this.onPropertyChange) this.onPropertyChange('brush', 'lineStyle', value);
            });
        });

        document.querySelectorAll('[data-table-line-style]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const value = btn.dataset.tableLineStyle || 'solid';
                this._ensureTableStrokeVisible();
                this._syncTableLineStyle(value);
                if (this.onPropertyChange) this.onPropertyChange('table', 'lineStyle', value);
            });
        });
        const noTableLinesBtn = document.getElementById('btn-table-stroke-none');
        if (noTableLinesBtn) {
            noTableLinesBtn.addEventListener('click', () => {
                if (this.onPropertyChange) this.onPropertyChange('table', 'stroke', 'transparent');
                this._syncTableLinesMode('transparent');
            });
        }

        const imgProps = ['prop-img-width', 'prop-img-height', 'prop-img-opacity', 'prop-img-rotation'];
        imgProps.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, () => this._onImagePropChange(id));
        });

        document.getElementById('prop-lock-ratio').addEventListener('click', (e) => {
            document.getElementById('prop-lock-ratio').classList.add('active');
            document.getElementById('prop-unlock-ratio').classList.remove('active');
        });
        document.getElementById('prop-unlock-ratio').addEventListener('click', (e) => {
            document.getElementById('prop-unlock-ratio').classList.add('active');
            document.getElementById('prop-lock-ratio').classList.remove('active');
        });

        document.getElementById('prop-bring-front').addEventListener('click', () => {
            if (this.onPropertyChange) this.onPropertyChange('image', 'bringFront', true);
        });
        document.getElementById('prop-send-back').addEventListener('click', () => {
            if (this.onPropertyChange) this.onPropertyChange('image', 'sendBack', true);
        });

        // Prevent focus loss / blur on the active text box when clicking styling, case, or alignment buttons
        const preventBlurButtons = [
            'prop-bold', 'prop-italic', 'prop-underline', 'prop-strikethrough',
            'prop-text-shadow', 'prop-clear-text-bg', 'prop-clear-text-stroke'
        ];
        preventBlurButtons.forEach((id) => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            }
        });

        document.querySelectorAll('.prop-text-align-btn, .prop-page-align-btn, .prop-case-btn, .prop-chip, [data-step-target]').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
    }

    _bindCompositeControls() {
        document.querySelectorAll('[data-step-target]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const targetId = btn.dataset.stepTarget;
                const input = document.getElementById(targetId);
                if (!input) return;

                const currentValue = parseFloat(input.value || 0);
                const step = parseFloat(btn.dataset.step || 0);
                this._setControlValue(targetId, currentValue + step, true);
            });
        });

        document.querySelectorAll('[data-chip-target] .prop-chip').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tableStrokeMode === 'none') {
                    if (this.onPropertyChange) this.onPropertyChange('table', 'stroke', 'transparent');
                    this._syncTableLinesMode('transparent');
                    return;
                }
                const group = btn.closest('[data-chip-target]');
                if (!group) return;
                if (group.dataset.chipTarget === 'prop-table-stroke-width') {
                    this._ensureTableStrokeVisible();
                }
                this._setControlValue(group.dataset.chipTarget, btn.dataset.value, true);
            });
        });
    }

    _bindFormControls() {
        const textInput = document.getElementById('prop-form-text');
        const choiceInput = document.getElementById('prop-form-choice');
        const boolInput = document.getElementById('prop-form-bool');
        const fieldList = document.getElementById('prop-form-list');
        const createButtons = [
            ['btn-add-form-text', 'text'],
            ['btn-add-form-checkbox', 'checkbox'],
            ['btn-add-form-choice', 'choice'],
            ['btn-add-form-radio', 'radio'],
            ['btn-add-form-listbox', 'listbox'],
        ];

        if (textInput) {
            textInput.addEventListener('input', () => {
                if (this._suppressFormPanelEvents) return;
                if (this.onFormValueChange) this.onFormValueChange(textInput.value);
            });
        }

        if (choiceInput) {
            choiceInput.addEventListener('change', () => {
                if (this._suppressFormPanelEvents) return;
                if (!this.onFormValueChange) return;
                const value = choiceInput.multiple
                    ? Array.from(choiceInput.selectedOptions).map((option) => option.value)
                    : choiceInput.value;
                this.onFormValueChange(value);
            });
        }

        if (boolInput) {
            boolInput.addEventListener('change', () => {
                if (this._suppressFormPanelEvents) return;
                if (this.onFormValueChange) this.onFormValueChange(boolInput.checked);
            });
        }

        const nameInput = document.getElementById('prop-form-name');
        if (nameInput) {
            nameInput.addEventListener('input', () => {
                if (this._suppressFormPanelEvents) return;
                if (this.onFormPropertiesChange) {
                    this.onFormPropertiesChange({ field_name: nameInput.value });
                }
            });
        }

        const labelInput = document.getElementById('prop-form-label');
        if (labelInput) {
            labelInput.addEventListener('input', () => {
                if (this._suppressFormPanelEvents) return;
                if (this.onFormPropertiesChange) {
                    this.onFormPropertiesChange({ field_label: labelInput.value });
                }
            });
        }

        const choicesEditInput = document.getElementById('prop-form-choices-edit');
        if (choicesEditInput) {
            choicesEditInput.addEventListener('input', () => {
                if (this._suppressFormPanelEvents) return;
                if (this.onFormPropertiesChange) {
                    this.onFormPropertiesChange({
                        choice_values: this._parseChoiceEditorValue(choicesEditInput.value),
                    });
                }
            });
        }

        if (fieldList) {
            fieldList.addEventListener('click', (event) => {
                const button = event.target.closest('[data-form-xref]');
                if (!button || !this.onFormFieldSelect) return;
                this.onFormFieldSelect(Number.parseInt(button.dataset.formXref, 10), {
                    extend: event.ctrlKey || event.metaKey,
                    range: event.shiftKey,
                });
            });
        }

        createButtons.forEach(([id, kind]) => {
            const button = document.getElementById(id);
            if (!button) return;
            button.addEventListener('click', () => {
                if (this.onFormCreate) this.onFormCreate(kind);
            });
        });

        const deleteButton = document.getElementById('btn-delete-form');
        if (deleteButton) {
            deleteButton.addEventListener('click', () => {
                if (this.onFormDelete) this.onFormDelete();
            });
        }

        const duplicateButton = document.getElementById('btn-duplicate-form');
        if (duplicateButton) {
            duplicateButton.addEventListener('click', () => {
                if (this.onFormDuplicate) this.onFormDuplicate();
            });
        }

        [
            ['btn-form-match-width', 'width'],
            ['btn-form-match-height', 'height'],
            ['btn-form-match-both', 'both'],
        ].forEach(([id, dimension]) => {
            const button = document.getElementById(id);
            if (!button) return;
            button.addEventListener('click', () => {
                if (this.onFormMatchSizes) this.onFormMatchSizes(dimension);
            });
        });
    }

    _setControlValue(controlId, rawValue, emitChange = false) {
        const input = document.getElementById(controlId);
        if (!input) return;

        let value = Number.parseFloat(rawValue);
        if (Number.isNaN(value)) {
            value = Number.parseFloat(input.min || 0) || 0;
        }

        const min = input.min === '' ? -Infinity : Number.parseFloat(input.min);
        const max = input.max === '' ? Infinity : Number.parseFloat(input.max);
        const step = input.step === '' || input.step === 'any' ? null : Number.parseFloat(input.step);

        value = Math.min(Math.max(value, min), max);
        if (step && step >= 1) {
            value = Math.round(value);
        } else if (step) {
            const precision = (input.step.split('.')[1] || '').length;
            value = Number(value.toFixed(precision));
        }

        input.value = String(value);
        this._syncChipGroup(controlId, value);

        if (emitChange) {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            if (input.tagName === 'SELECT' || input.type === 'color') {
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    _parseChoiceEditorValue(rawValue) {
        return String(rawValue || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const idx = line.indexOf('|');
                if (idx === -1) {
                    return { value: line, label: line };
                }
                const value = line.substring(0, idx).trim();
                const label = line.substring(idx + 1).trim() || value;
                return { value, label };
            })
            .filter((option) => option.value !== '');
    }

    _formatChoiceEditorValue(choiceValues) {
        return (choiceValues || [])
            .map((option) => {
                const value = option?.value ?? '';
                const label = option?.label ?? value;
                return value === label ? String(label) : `${value}|${label}`;
            })
            .join('\n');
    }

    _setSelectValue(select, field) {
        if (!select || !field) return;
        const value = field.value;
        if (select.multiple) {
            const selectedValues = new Set(Array.isArray(value) ? value.map(String) : (value ? [String(value)] : []));
            Array.from(select.options).forEach((option) => {
                option.selected = selectedValues.has(option.value);
            });
            return;
        }
        select.value = value ?? '';
    }

    _getFormKind(field) {
        const kind = (field?.widget_kind || '').toLowerCase();
        if (['text', 'checkbox', 'radio', 'choice', 'listbox'].includes(kind)) return kind;
        const type = (field?.field_type_string || '').toLowerCase();
        if (type.includes('check')) return 'checkbox';
        if (type.includes('radio')) return 'radio';
        if (type.includes('combo') || type.includes('drop')) return 'choice';
        if (type.includes('list')) return 'listbox';
        return 'text';
    }

    _getFormKindBadge(kind) {
        const labels = {
            text: 'TXT',
            checkbox: 'CHK',
            radio: 'RAD',
            choice: 'SEL',
            listbox: 'LST',
        };
        return labels[kind] || 'FLD';
    }

    _getFormTypeLabel(field) {
        const kind = this._getFormKind(field);
        const labels = {
            text: 'Text',
            checkbox: 'Checkbox',
            radio: 'Radio',
            choice: 'Dropdown',
            listbox: 'List box',
        };
        return labels[kind] || field?.field_type_string || 'Field';
    }

    _getFormValuePreview(field) {
        const kind = this._getFormKind(field);
        const value = field?.value;
        if (kind === 'checkbox') return value ? 'Checked' : 'Unchecked';
        if (kind === 'radio') return value ? 'Selected' : 'Not selected';
        if (kind === 'listbox') {
            const values = Array.isArray(value) ? value : (value ? [value] : []);
            return values.length ? values.join(', ') : 'No options selected';
        }
        if (kind === 'choice') return value ? String(value) : 'No option selected';
        return value ? String(value) : 'Empty';
    }

    _getFormGeometryPreview(field) {
        const bbox = Array.isArray(field?.bbox) ? field.bbox : null;
        if (!bbox || bbox.length !== 4) return 'No position';
        const width = Math.max(0, Math.round(bbox[2] - bbox[0]));
        const height = Math.max(0, Math.round(bbox[3] - bbox[1]));
        return `${width} x ${height}`;
    }

    _syncChipGroup(controlId, rawValue) {
        const normalizedValue = String(Number.parseFloat(rawValue));
        const group = document.querySelector(`[data-chip-target="${controlId}"]`);
        if (!group) return;

        group.querySelectorAll('.prop-chip[data-value]').forEach((btn) => {
            const buttonValue = String(Number.parseFloat(btn.dataset.value));
            btn.classList.toggle('active', buttonValue === normalizedValue);
        });
    }

    _ensureTableStrokeVisible() {
        const active = this.editor?.getActiveObject?.();
        const cellTarget = this.editor?.getTableCellTargetFromSelection?.();
        const table = active?._elementType === 'table' ? active : cellTarget?.table;
        const cfg = table ? this.editor.getTableConfigFromGroup(table) : null;
        const defaults = this.editor?.tableDefaults;
        const currentStroke = cfg?.stroke ?? defaults?.stroke;
        if (currentStroke && currentStroke !== 'transparent') return;

        const restore = (defaults?.stroke && defaults.stroke !== 'transparent')
            ? defaults.stroke
            : '#333333';
        if (this.onPropertyChange) this.onPropertyChange('table', 'stroke', restore);
        this._syncTableLinesMode(restore);
    }

    _syncTableLinesMode(stroke) {
        const isNone = !stroke || stroke === 'transparent';
        const noneBtn = document.getElementById('btn-table-stroke-none');
        if (noneBtn) noneBtn.classList.toggle('active', isNone);

        const thicknessControls = document.getElementById('table-line-thickness-controls');
        if (thicknessControls) thicknessControls.classList.toggle('is-disabled', isNone);

        if (isNone) {
            document.querySelectorAll('[data-table-line-style]').forEach((btn) => {
                btn.classList.remove('active');
            });
        }
    }

    _syncTableLineStyle(lineStyle = 'solid') {
        document.querySelectorAll('[data-table-line-style]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tableLineStyle === lineStyle);
        });
    }

    _onTextPropChange(id) {
        if (!this.onPropertyChange) return;
        const el = document.getElementById(id);
        const val = el.value;

        switch (id) {
            case 'prop-font-family':
                this.onPropertyChange('text', 'fontFamily', val);
                break;
            case 'prop-font-size':
                this.onPropertyChange('text', 'fontSize', parseFloat(val));
                document.getElementById('prop-font-size').value = val;
                break;
            case 'prop-font-weight':
                this.onPropertyChange('text', 'fontWeight', parseInt(val, 10));
                document.getElementById('prop-bold').classList.toggle('active', parseInt(val, 10) >= 700);
                break;
            case 'prop-text-color':
                this.onPropertyChange('text', 'fill', val);
                break;
            case 'prop-text-bg':
                this.onPropertyChange('text', 'backgroundColor', val);
                break;
            case 'prop-line-height':
                this._syncChipGroup(id, val);
                this.onPropertyChange('text', 'lineHeight', parseFloat(val));
                break;
            case 'prop-char-spacing':
                this._syncChipGroup(id, val);
                this.onPropertyChange('text', 'charSpacing', parseFloat(val));
                break;
            case 'prop-text-stroke-color':
                this.onPropertyChange('text', 'textStrokeColor', val);
                break;
            case 'prop-text-stroke-width':
                this.onPropertyChange('text', 'textStrokeWidth', parseFloat(val));
                break;
            case 'prop-text-opacity':
                this._syncChipGroup(id, val);
                this.onPropertyChange('text', 'opacity', parseFloat(val) / 100);
                break;
            case 'prop-text-rotation':
                this._syncChipGroup(id, val);
                this.onPropertyChange('text', 'angle', parseFloat(val));
                break;
        }
    }

    _onShapePropChange(id) {
        if (!this.onPropertyChange) return;
        const el = document.getElementById(id);
        const val = el.value;

        switch (id) {
            case 'prop-fill':
                this.onPropertyChange('shape', 'fill', val);
                break;
            case 'prop-stroke':
                this.onPropertyChange('shape', 'stroke', val);
                break;
            case 'prop-stroke-width':
                this._syncChipGroup(id, val);
                this.onPropertyChange('shape', 'strokeWidth', parseFloat(val));
                break;
            case 'prop-shape-opacity':
                this._syncChipGroup(id, val);
                this.onPropertyChange('shape', 'opacity', parseFloat(val) / 100);
                break;
            case 'prop-shape-rotation':
                this._syncChipGroup(id, val);
                this.onPropertyChange('shape', 'angle', parseFloat(val));
                break;
            case 'prop-corner-radius':
                this._syncChipGroup(id, val);
                this.onPropertyChange('shape', 'rx', parseFloat(val));
                this.onPropertyChange('shape', 'ry', parseFloat(val));
                break;
        }
    }

    _onBrushPropChange(id) {
        if (!this.onPropertyChange) return;
        const el = document.getElementById(id);
        const val = el.value;

        switch (id) {
            case 'prop-brush-color':
                this.onPropertyChange('brush', 'color', val);
                break;
            case 'prop-brush-width':
                this._syncChipGroup(id, val);
                this.onPropertyChange('brush', 'width', parseFloat(val));
                break;
            case 'prop-brush-opacity':
                this._syncChipGroup(id, val);
                this.onPropertyChange('brush', 'opacity', parseFloat(val) / 100);
                break;
        }
    }

    _onStickyPropChange(id) {
        if (!this.onPropertyChange) return;
        const el = document.getElementById(id);
        const val = el.value;

        switch (id) {
            case 'prop-sticky-opacity':
                this._syncChipGroup(id, val);
                this.onPropertyChange('sticky', 'opacity', parseFloat(val) / 100);
                break;
        }
    }

    _bindTableActionButtons() {
        const actions = [
            ['btn-table-insert-row-above', 'insertRowAbove'],
            ['btn-table-insert-row-below', 'insertRowBelow'],
            ['btn-table-insert-col-left', 'insertColLeft'],
            ['btn-table-insert-col-right', 'insertColRight'],
            ['btn-table-delete-row', 'deleteRow'],
            ['btn-table-delete-col', 'deleteCol'],
            ['btn-table-distribute-evenly', 'distributeEvenly'],
            ['btn-table-export-csv', 'exportCsv'],
            ['btn-table-import-csv', 'importCsv'],
        ];
        actions.forEach(([id, action]) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                if (this.onTableAction) this.onTableAction(action);
            });
        });
    }

    _onTablePropChange(id) {
        if (!this.onPropertyChange || this._syncingTableProps) return;
        const el = document.getElementById(id);
        if (!el) return;

        switch (id) {
            case 'prop-table-rows':
                this.onPropertyChange('table', 'rows', parseInt(el.value, 10) || 3);
                break;
            case 'prop-table-cols':
                this.onPropertyChange('table', 'cols', parseInt(el.value, 10) || 3);
                break;
            case 'prop-table-fill':
                this.onPropertyChange('table', 'fill', el.value);
                break;
            case 'prop-table-stroke':
                if (el.value && el.value !== 'transparent') {
                    this._syncTableLinesMode(el.value);
                }
                this.onPropertyChange('table', 'stroke', el.value);
                break;
            case 'prop-table-stroke-width':
                this._ensureTableStrokeVisible();
                this.onPropertyChange('table', 'strokeWidth', parseFloat(el.value) || 0);
                break;
            case 'prop-table-text-layer':
                this.onPropertyChange('table', 'textLayer', el.value);
                break;
        }
    }

    _onStampPropChange(id) {
        if (!this.onPropertyChange || this._syncingStampProps) return;
        const el = document.getElementById(id);
        if (!el) return;

        switch (id) {
            case 'prop-stamp-text':
                this.onPropertyChange('stamp', 'text', el.value);
                break;
            case 'prop-stamp-accent':
                this.onPropertyChange('stamp', 'accentColor', el.value);
                break;
        }
    }

    _onImagePropChange(id) {
        if (!this.onPropertyChange) return;
        const el = document.getElementById(id);
        const val = el.value;

        switch (id) {
            case 'prop-img-width':
                this.onPropertyChange('image', 'width', parseFloat(val));
                break;
            case 'prop-img-height':
                this.onPropertyChange('image', 'height', parseFloat(val));
                break;
            case 'prop-img-opacity':
                this._syncChipGroup(id, val);
                this.onPropertyChange('image', 'opacity', parseFloat(val) / 100);
                break;
            case 'prop-img-rotation':
                this._syncChipGroup(id, val);
                this.onPropertyChange('image', 'angle', parseFloat(val));
                break;
        }
    }

    _toggleStyle(style) {
        const propMap = { strikethrough: 'linethrough' };
        const prop = propMap[style] || style;
        const btn = document.getElementById(`prop-${style}`);
        btn.classList.toggle('active');
        const isActive = btn.classList.contains('active');
        if (this.onPropertyChange) {
            this.onPropertyChange('text', prop, isActive);
            if (style === 'bold') {
                const weightEl = document.getElementById('prop-font-weight');
                if (weightEl) {
                    weightEl.value = isActive ? '700' : '400';
                }
            }
        }
    }

    _fontWeightValue(obj) {
        const w = obj.fontWeight;
        if (w === 900 || w === '900' || w === 'black') return 900;
        if (w === 'bold' || w === 700 || w === '700' || (typeof w === 'number' && w >= 700)) return 700;
        if (w === 600 || w === '600') return 600;
        if (w === 500 || w === '500') return 500;
        if (w === 300 || w === '300' || w === 'light') return 300;
        return 400;
    }

    setActiveTool(tool) {
        this.activeTool = tool;
        document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    syncTextSelectionProps(obj) {
        if (!obj || !this.editor) return;

        const styles = typeof this.editor.getTextSelectionStyles === 'function'
            ? this.editor.getTextSelectionStyles(obj)
            : {};

        if (styles.bold !== undefined) {
            document.getElementById('prop-bold').classList.toggle('active', styles.bold);
        }
        if (styles.italic !== undefined) {
            document.getElementById('prop-italic').classList.toggle('active', styles.italic);
        }
        if (styles.underline !== undefined) {
            document.getElementById('prop-underline').classList.toggle('active', styles.underline);
        }
        if (styles.linethrough !== undefined) {
            document.getElementById('prop-strikethrough').classList.toggle('active', styles.linethrough);
        }

        this.syncTextAlignButtons(obj);
    }

    syncTextAlignButtons(obj) {
        const align = obj?.textAlign || 'left';
        document.querySelectorAll('.prop-text-align-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.textAlign === align);
        });
    }

    showPropertiesForObjects(objects) {
        if (!objects || objects.length === 0) {
            this._hideAllProps();
            document.getElementById('props-empty').style.display = 'flex';
            return;
        }

        if (objects.length > 1) {
            const textObjects = objects.filter((o) => this.editor?.isTextObject(o));
            if (textObjects.length >= 2) {
                this._hideAllProps();
                const panel = document.getElementById('props-multi-text');
                const countEl = document.getElementById('props-multi-text-count');
                if (panel) panel.style.display = 'block';
                if (countEl) {
                    countEl.textContent = `${textObjects.length} text blocks selected`;
                }
                return;
            }
            this._hideAllProps();
            const empty = document.getElementById('props-empty');
            const msg = document.getElementById('props-empty-message');
            if (empty) empty.style.display = 'flex';
            if (msg) {
                msg.textContent = `${objects.length} objects selected`;
            }
            return;
        }

        const obj = objects[0];
        const elemType = obj._elementType || obj.type;

        this._hideAllProps();

        if (obj._isTableCellText) {
            const table = this.editor?._getTableFrame(obj._tableId);
            if (table) {
                this._showTableProps(table);
                this._showTextProps(obj);
                this.syncTableCellOps({ table, row: obj._cellRow, col: obj._cellCol });
                return;
            }
        }

        if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text') {
            this._showTextProps(obj);
        } else if (obj.type === 'image') {
            this._showImageProps(obj);
        } else if (obj._elementType === 'sticky') {
            this._showStickyProps(obj);
        } else if (obj._elementType === 'table') {
            this._showTableProps(obj);
            this.syncTableCellOps(obj._activeCell
                ? { table: obj, row: obj._activeCell.row, col: obj._activeCell.col }
                : null);
        } else if (obj.type === 'rect' || obj.type === 'ellipse' || obj.type === 'polygon' || obj._elementType === 'star') {
            this._showShapeProps(obj);
        } else if (obj.type === 'line') {
            this._showShapeProps(obj);
        } else if (obj.type === 'path') {
            this._showShapeProps(obj);
        } else if (obj._elementType === 'stamp' || (obj.type === 'group' && obj.stampType)) {
            this._showStampProps(obj);
        } else {
            document.getElementById('props-empty').style.display = 'flex';
        }
    }

    showPageProperties(pageWidth, pageHeight) {
        this._hideAllProps();
        const panel = document.getElementById('props-page');
        panel.style.display = 'block';
        document.getElementById('prop-page-width').value = Math.round(pageWidth);
        document.getElementById('prop-page-height').value = Math.round(pageHeight);
    }

    showFormProperties(forms, selectedFields = null) {
        this._hideAllProps();

        this._suppressFormPanelEvents = true;
        try {
            this._renderFormProperties(forms, selectedFields);
        } finally {
            this._suppressFormPanelEvents = false;
        }
    }

    _renderFormProperties(forms, selectedFields = null) {
        const panel = document.getElementById('props-form');
        const count = document.getElementById('prop-form-count');
        const selected = document.getElementById('prop-form-selected');
        const fieldList = document.getElementById('prop-form-list');
        const detail = document.getElementById('prop-form-detail');
        const matchGroup = document.getElementById('prop-form-match-group');
        const matchLabel = document.getElementById('prop-form-match-label');
        const textGroup = document.getElementById('prop-form-text-group');
        const choiceGroup = document.getElementById('prop-form-choice-group');
        const boolGroup = document.getElementById('prop-form-bool-group');
        const choiceInput = document.getElementById('prop-form-choice');
        const choiceLabel = choiceGroup?.querySelector('.prop-label');
        const boolLabel = document.getElementById('prop-form-bool-label');

        panel.style.display = 'block';

        const formList = Array.isArray(forms) ? forms : [];

        const selectedArray = Array.isArray(selectedFields)
            ? selectedFields
            : (selectedFields ? [selectedFields] : []);
        const primaryField = selectedArray[0] || null;
        const selectedXrefSet = new Set(selectedArray.map((field) => field.xref));

        const selectedCount = selectedArray.length;
        const selectedTypeKey = primaryField?.widget_kind || primaryField?.field_type_string || '';
        const sameTypeSelectedCount = selectedTypeKey
            ? selectedArray.filter((field) => (field.widget_kind || field.field_type_string) === selectedTypeKey).length
            : 0;

        count.textContent = `${formList.length} field${formList.length === 1 ? '' : 's'} on this page`;

        if (selectedCount > 1) {
            selected.textContent = `${selectedCount} fields selected (${selectedTypeKey || 'mixed'})`;
        } else if (primaryField) {
            selected.textContent = `${primaryField.field_label || primaryField.field_name}`;
        } else {
            selected.textContent = formList.length
                ? 'Select a field to inspect its value'
                : 'No interactive form fields on this page';
        }

        fieldList.innerHTML = '';
        formList.forEach((field) => {
            const kind = this._getFormKind(field);
            const typeLabel = this._getFormTypeLabel(field);
            const valuePreview = this._getFormValuePreview(field);
            const geometryPreview = this._getFormGeometryPreview(field);
            const title = `${field.field_label || field.field_name || 'Form field'} (${typeLabel})`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `form-field-item form-field-item-${kind}`;
            button.dataset.formXref = String(field.xref);
            button.title = title;
            button.classList.toggle('active', selectedXrefSet.has(field.xref));
            button.classList.toggle('primary', field.xref === primaryField?.xref);
            button.innerHTML = `
                <span class="form-field-item-main">
                    <span class="form-field-kind" aria-hidden="true">${this._escapeHtml(this._getFormKindBadge(kind))}</span>
                    <span class="form-field-item-body">
                        <span class="form-field-item-label">${this._escapeHtml(field.field_label || field.field_name || 'Unnamed field')}</span>
                        <span class="form-field-item-name">${this._escapeHtml(field.field_name || `xref ${field.xref}`)}</span>
                    </span>
                    <span class="form-field-item-type">${this._escapeHtml(typeLabel)}</span>
                </span>
                <span class="form-field-item-meta">
                    <span class="form-field-value">${this._escapeHtml(valuePreview)}</span>
                    <span class="form-field-geometry">${this._escapeHtml(geometryPreview)}</span>
                </span>
            `;
            fieldList.appendChild(button);
        });

        if (matchGroup) {
            const canMatch = sameTypeSelectedCount >= 2;
            matchGroup.style.display = canMatch ? 'block' : 'none';
            if (canMatch && matchLabel) {
                matchLabel.textContent = `${sameTypeSelectedCount} ${selectedTypeKey} field${sameTypeSelectedCount === 1 ? '' : 's'} selected. Matches the primary field size.`;
            }
        }

        if (!primaryField) {
            detail.style.display = 'none';
            return;
        }

        detail.style.display = 'block';
        
        const nameInput = document.getElementById('prop-form-name');
        if (nameInput && document.activeElement !== nameInput) {
            nameInput.value = primaryField.field_name || '';
        }
        const labelInput = document.getElementById('prop-form-label');
        if (labelInput && document.activeElement !== labelInput) {
            labelInput.value = primaryField.field_label || primaryField.field_name || '';
        }
        document.getElementById('prop-form-type').value = primaryField.field_type_string || primaryField.widget_kind || '';

        textGroup.style.display = 'none';
        choiceGroup.style.display = 'none';
        const choicesEditGroup = document.getElementById('prop-form-choices-edit-group');
        const choicesEditInput = document.getElementById('prop-form-choices-edit');
        if (choicesEditGroup) choicesEditGroup.style.display = 'none';
        boolGroup.style.display = 'none';

        if (primaryField.widget_kind === 'choice' || primaryField.widget_kind === 'listbox') {
            choiceGroup.style.display = 'block';
            if (choiceLabel) {
                choiceLabel.textContent = primaryField.widget_kind === 'listbox'
                    ? 'Selected Options'
                    : 'Selected Option';
            }
            choiceInput.innerHTML = '';
            choiceInput.multiple = primaryField.widget_kind === 'listbox';
            choiceInput.size = primaryField.widget_kind === 'listbox'
                ? Math.max(3, Math.min((primaryField.choice_values || []).length || 3, 8))
                : 1;
            (primaryField.choice_values || []).forEach((option) => {
                const el = document.createElement('option');
                el.value = option.value;
                el.textContent = option.label;
                choiceInput.appendChild(el);
            });
            this._setSelectValue(choiceInput, primaryField);

            if (choicesEditGroup && choicesEditInput) {
                choicesEditGroup.style.display = 'block';
                if (document.activeElement !== choicesEditInput) {
                    choicesEditInput.value = this._formatChoiceEditorValue(primaryField.choice_values || []);
                }
            }
        } else if (primaryField.widget_kind === 'checkbox' || primaryField.widget_kind === 'radio') {
            boolGroup.style.display = 'block';
            boolLabel.textContent = primaryField.widget_kind === 'radio' ? 'Selected' : 'Checked';
            document.getElementById('prop-form-bool').checked = Boolean(primaryField.value);
        } else {
            textGroup.style.display = 'block';
            document.getElementById('prop-form-text').value = primaryField.value ?? '';
        }
    }

    _hideAllProps() {
        document.getElementById('props-empty').style.display = 'none';
        document.getElementById('props-brush').style.display = 'none';
        document.getElementById('props-text').style.display = 'none';
        const multiText = document.getElementById('props-multi-text');
        if (multiText) multiText.style.display = 'none';
        document.getElementById('props-shape').style.display = 'none';
        const tableProps = document.getElementById('props-table');
        if (tableProps) tableProps.style.display = 'none';
        document.getElementById('props-image').style.display = 'none';
        document.getElementById('props-sticky').style.display = 'none';
        document.getElementById('props-page').style.display = 'none';
        document.getElementById('props-form').style.display = 'none';
        const extraPanels = ['props-stamp', 'props-link', 'props-document'];
        extraPanels.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const sigProps = document.getElementById('props-signature');
        if (sigProps) sigProps.style.display = 'none';
    }

    showStampProperties(mode = 'place') {
        this._hideAllProps();
        const panel = document.getElementById('props-stamp');
        if (!panel) return;
        panel.style.display = 'block';
        const placeHint = document.getElementById('stamp-place-hint');
        const editHint = document.getElementById('stamp-edit-hint');
        const saveBtn = document.getElementById('btn-save-stamp-to-library');
        if (placeHint) placeHint.style.display = mode === 'place' ? 'block' : 'none';
        if (editHint) editHint.style.display = mode === 'edit' ? 'block' : 'none';
        if (saveBtn) saveBtn.style.display = mode === 'edit' ? 'inline-flex' : 'none';
    }

    showTableProperties(mode = 'place') {
        this._hideAllProps();
        const panel = document.getElementById('props-table');
        if (!panel) return;
        panel.style.display = 'block';
        const placeHint = document.getElementById('table-place-hint');
        const editHint = document.getElementById('table-edit-hint');
        if (placeHint) placeHint.style.display = mode === 'place' ? 'block' : 'none';
        if (editHint) editHint.style.display = mode === 'edit' ? 'block' : 'none';
        if (mode === 'place') {
            this.syncTableDefaults(this.editor?.tableDefaults);
            this.syncTableCellOps(null);
        }
    }

    _showTableProps(obj) {
        this.showTableProperties('edit');
        this.syncTablePropsFromObject(obj);
    }

    syncTableCellOps(cellTarget) {
        const section = document.getElementById('table-cell-ops');
        const positionEl = document.getElementById('table-cell-position');
        if (!section) return;

        if (!cellTarget?.table || cellTarget.row == null || cellTarget.col == null) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        if (positionEl) {
            positionEl.textContent = `Row ${cellTarget.row + 1}, Col ${cellTarget.col + 1}`;
        }
    }

    syncTableDefaults(defaults) {
        if (!defaults) return;
        this._syncingTableProps = true;
        const rowsEl = document.getElementById('prop-table-rows');
        const colsEl = document.getElementById('prop-table-cols');
        const fillEl = document.getElementById('prop-table-fill');
        const strokeEl = document.getElementById('prop-table-stroke');
        const strokeWidthEl = document.getElementById('prop-table-stroke-width');
        const textLayerEl = document.getElementById('prop-table-text-layer');
        if (rowsEl) rowsEl.value = defaults.rows ?? 3;
        if (colsEl) colsEl.value = defaults.cols ?? 3;
        if (fillEl && defaults.fill && defaults.fill !== 'transparent') this._setColorInput('prop-table-fill', defaults.fill.slice(0, 7));
        if (strokeEl && defaults.stroke && defaults.stroke !== 'transparent') this._setColorInput('prop-table-stroke', defaults.stroke.slice(0, 7));
        if (strokeWidthEl) {
            strokeWidthEl.value = defaults.strokeWidth ?? 1;
        }
        if (textLayerEl) textLayerEl.value = defaults.textLayer || 'above';
        this._syncTableLineStyle(defaults.lineStyle || 'solid');
        this._syncTableLinesMode(defaults.stroke);
        this._syncingTableProps = false;
    }

    syncTablePropsFromObject(obj) {
        if (!obj || obj._elementType !== 'table') return;
        const cfg = this.editor?.getTableConfigFromGroup(obj);
        if (!cfg) return;
        this._syncingTableProps = true;
        const rowsEl = document.getElementById('prop-table-rows');
        const colsEl = document.getElementById('prop-table-cols');
        const fillEl = document.getElementById('prop-table-fill');
        const strokeEl = document.getElementById('prop-table-stroke');
        const strokeWidthEl = document.getElementById('prop-table-stroke-width');
        const textLayerEl = document.getElementById('prop-table-text-layer');
        if (rowsEl) rowsEl.value = cfg.rows ?? 3;
        if (colsEl) colsEl.value = cfg.cols ?? 3;
        if (fillEl && cfg.fill && cfg.fill !== 'transparent') this._setColorInput('prop-table-fill', cfg.fill.slice(0, 7));
        if (strokeEl && cfg.stroke && cfg.stroke !== 'transparent') this._setColorInput('prop-table-stroke', cfg.stroke.slice(0, 7));
        if (strokeWidthEl) {
            strokeWidthEl.value = cfg.strokeWidth ?? 1;
        }
        if (textLayerEl) textLayerEl.value = cfg.textLayer || 'above';
        this._syncTableLineStyle(cfg.lineStyle || 'solid');
        this._syncTableLinesMode(cfg.stroke);
        this._syncingTableProps = false;
    }

    _showStampProps(obj) {
        this.showStampProperties('edit');
        this.syncStampPropsFromObject(obj);
    }

    syncStampPropsFromObject(obj) {
        if (!obj || obj._elementType !== 'stamp') return;

        const cfg = obj.stampConfig || (window.StampKit ? StampKit.getPreset(obj.stampType || 'approved') : null);
        if (!cfg) return;

        this._syncingStampProps = true;

        const presetKey = cfg.preset && StampKit?.listPresets().includes(cfg.preset) ? cfg.preset : '';
        const hidden = document.getElementById('prop-stamp-type');
        if (hidden) hidden.value = presetKey || 'custom';
        this._syncStampPresetButtons(presetKey);

        const textEl = document.getElementById('prop-stamp-text');
        if (textEl) textEl.value = cfg.text || '';

        this._setColorInput('prop-stamp-accent', cfg.stroke || cfg.fill);

        this._syncingStampProps = false;
    }

    _setColorInput(id, hex) {
        const el = document.getElementById(id);
        if (!el || !hex) return;
        if (hex.startsWith('#') && hex.length >= 7) {
            el.value = hex.slice(0, 7);
            const hexInput = el.nextElementSibling;
            if (hexInput?.classList?.contains('prop-color-hex')) {
                hexInput.value = el.value.toUpperCase();
            }
        }
        if (id === 'prop-stamp-accent') {
            this._syncStampAccentHex(hex);
        }
    }

    _syncStampAccentHex(hex) {
        if (!hex) return;
        const normalized = (hex.startsWith('#') ? hex : `#${hex}`).slice(0, 7);
        const hexEl = document.getElementById('prop-stamp-accent-hex');
        const preview = document.getElementById('prop-stamp-accent-preview');
        if (hexEl) hexEl.textContent = normalized.toUpperCase();
        if (preview) {
            preview.style.setProperty('--stamp-accent-color', normalized);
            preview.style.background = normalized;
        }
    }

    _syncStampPresetButtons(stampType) {
        document.querySelectorAll('.stamp-preset-btn').forEach((btn) => {
            btn.classList.toggle('active', stampType && btn.dataset.stampType === stampType);
        });
    }

    syncStampConfigForPlacement(config) {
        if (!config) return;
        this._syncingStampProps = true;
        const presetKey = config.preset && StampKit?.listPresets().includes(config.preset)
            ? config.preset
            : '';
        const hidden = document.getElementById('prop-stamp-type');
        if (hidden) hidden.value = presetKey || 'approved';
        this._syncStampPresetButtons(presetKey || 'approved');
        const textEl = document.getElementById('prop-stamp-text');
        if (textEl) textEl.value = config.text || '';
        this._setColorInput('prop-stamp-accent', config.stroke || config.fill);
        this._syncingStampProps = false;
    }

    showLinkProperties() {
        this._hideAllProps();
        const panel = document.getElementById('props-link');
        if (panel) panel.style.display = 'block';
    }

    renderLinkList(links, options = {}) {
        const listEl = document.getElementById('link-list');
        const emptyEl = document.getElementById('link-list-empty');
        if (!listEl) return;

        const {
            selectedPage = null,
            selectedLinkIndex = null,
            scope = 'page',
            onSelect,
            onDelete,
            onJump,
        } = options;

        listEl.innerHTML = '';

        if (!links || links.length === 0) {
            if (emptyEl) {
                emptyEl.classList.remove('hidden');
                emptyEl.textContent = scope === 'document'
                    ? 'No hyperlinks in this document.'
                    : 'No links on this page. Select text and use “Link selected text”, or draw an area.';
            }
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        links.forEach((link, listIndex) => {
            const isGoto = link.link_type === 'goto' || (link.page != null && !link.uri);
            const title = isGoto
                ? `Page ${(link.page ?? 0) + 1}`
                : (link.uri || 'Link');
            const pageNum = link.page_num ?? selectedPage ?? 0;
            const meta = scope === 'document' ? `Page ${pageNum + 1}` : (isGoto ? 'Internal' : 'External');
            const isActive = selectedPage === pageNum && selectedLinkIndex === link.index;

            const li = document.createElement('li');
            li.className = `link-list-item${isActive ? ' active' : ''}`;
            li.dataset.page = String(pageNum);
            li.dataset.index = String(link.index);
            li.dataset.listIndex = String(listIndex);

            li.innerHTML = `
                <i data-lucide="${isGoto ? 'file-text' : 'external-link'}" class="link-list-icon"></i>
                <div class="link-list-body">
                    <div class="link-list-title" title="${this._escapeHtml(title)}">${this._escapeHtml(title)}</div>
                    <div class="link-list-meta">${this._escapeHtml(meta)}</div>
                </div>
                <div class="link-list-actions">
                    <button type="button" class="link-list-btn" data-action="jump" title="Go to link">↗</button>
                    <button type="button" class="link-list-btn" data-action="delete" title="Delete link">×</button>
                </div>
            `;

            li.addEventListener('click', (e) => {
                if (e.target.closest('[data-action]')) return;
                if (onSelect) onSelect(link, listIndex);
            });

            li.querySelector('[data-action="jump"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onJump) onJump(link);
            });

            li.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onDelete) onDelete(link);
            });

            listEl.appendChild(li);
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    showDocumentProperties(metadata = {}, bookmarks = []) {
        this._hideAllProps();
        const panel = document.getElementById('props-document');
        if (!panel) return;
        panel.style.display = 'block';
        document.getElementById('meta-title').value = metadata.title || '';
        document.getElementById('meta-author').value = metadata.author || '';
        document.getElementById('meta-subject').value = metadata.subject || '';
        document.getElementById('meta-keywords').value = metadata.keywords || '';
        const lines = (bookmarks || []).map((b) => `${b.level}|${b.title}|${b.page + 1}`);
        document.getElementById('meta-bookmarks').value = lines.join('\n');
    }

    showBrushProperties(settings) {
        this._hideAllProps();
        const panel = document.getElementById('props-brush');
        panel.style.display = 'block';

        const strokeHex = this._colorToHex(settings.color || '#01696f');
        if (settings.color && settings.color !== 'transparent') {
            this._setColorInput('prop-brush-color', strokeHex);
        }

        this._setControlValue('prop-brush-width', settings.width || 2);

        const opacity = Math.round((settings.opacity !== undefined ? settings.opacity : 1) * 100);
        this._setControlValue('prop-brush-opacity', opacity);

        const lineStyle = settings.lineStyle || 'solid';
        document.querySelectorAll('.prop-chip-linestyle').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.value === lineStyle);
        });
    }

    _showTextProps(obj) {
        const panel = document.getElementById('props-text');
        panel.style.display = 'block';

        document.getElementById('prop-font-family').value = obj.fontFamily || 'Helvetica';
        document.getElementById('prop-font-size').value = Math.round(obj.fontSize || 16);
        document.getElementById('prop-font-weight').value = String(this._fontWeightValue(obj));
        this._setColorInput('prop-text-color', this._colorToHex(obj.fill || '#000000'));

        const bgColor = obj.backgroundColor;
        if (bgColor && bgColor !== 'transparent') {
            this._setColorInput('prop-text-bg', this._colorToHex(bgColor));
        }

        const lineHeight = obj.lineHeight != null ? obj.lineHeight : 1.2;
        this._setControlValue('prop-line-height', lineHeight);

        const charSpacing = obj.charSpacing != null ? obj.charSpacing : 0;
        this._setControlValue('prop-char-spacing', charSpacing);

        const strokeW = obj.strokeWidth || 0;
        this._setControlValue('prop-text-stroke-width', strokeW);
        if (obj.stroke && obj.stroke !== 'transparent') {
            this._setColorInput('prop-text-stroke-color', this._colorToHex(obj.stroke));
        }

        const opacity = Math.round((obj.opacity || 1) * 100);
        this._setControlValue('prop-text-opacity', opacity);

        const angle = Math.round(obj.angle || 0);
        this._setControlValue('prop-text-rotation', angle);

        const weight = this._fontWeightValue(obj);
        document.getElementById('prop-bold').classList.toggle('active', weight >= 700);
        document.getElementById('prop-italic').classList.toggle('active', obj.fontStyle === 'italic');
        document.getElementById('prop-underline').classList.toggle('active', obj.underline === true);
        document.getElementById('prop-strikethrough').classList.toggle('active', obj.linethrough === true);

        const pageAlign = this.editor?.getObjectPageAlign
            ? this.editor.getObjectPageAlign(obj)
            : 'left';
        document.querySelectorAll('.prop-page-align-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.pageAlign === pageAlign);
        });

        this.syncTextAlignButtons(obj);

        const textCase = obj._textCase || 'none';
        document.querySelectorAll('.prop-case-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.case === textCase);
        });

        const hasShadow = !!(obj.shadow && (obj.shadow.color || obj.shadow.blur));
        document.getElementById('prop-text-shadow').classList.toggle('active', hasShadow);
    }

    _showShapeProps(obj) {
        const panel = document.getElementById('props-shape');
        panel.style.display = 'block';

        const fillHex = this._colorToHex(obj.fill || 'transparent');
        const strokeHex = this._colorToHex(obj.stroke || 'transparent');
        if (obj.fill && obj.fill !== 'transparent') {
            this._setColorInput('prop-fill', fillHex);
        }
        if (obj.stroke && obj.stroke !== 'transparent') {
            this._setColorInput('prop-stroke', strokeHex);
        }

        this._setControlValue('prop-stroke-width', obj.strokeWidth || 2);

        const isRect = obj.type === 'rect';
        document.getElementById('corner-radius-group').style.display = isRect ? 'block' : 'none';
        if (isRect) {
            const rx = Math.round(obj.rx || 0);
            this._setControlValue('prop-corner-radius', rx);
        }

        const opacity = Math.round((obj.opacity || 1) * 100);
        this._setControlValue('prop-shape-opacity', opacity);

        const angle = Math.round(obj.angle || 0);
        this._setControlValue('prop-shape-rotation', angle);
    }

    _showImageProps(obj) {
        const panel = document.getElementById('props-image');
        panel.style.display = 'block';

        const w = Math.round((obj.width || 100) * (obj.scaleX || 1));
        const h = Math.round((obj.height || 100) * (obj.scaleY || 1));
        document.getElementById('prop-img-width').value = w;
        document.getElementById('prop-img-height').value = h;

        const opacity = Math.round((obj.opacity || 1) * 100);
        this._setControlValue('prop-img-opacity', opacity);

        const angle = Math.round(obj.angle || 0);
        this._setControlValue('prop-img-rotation', angle);
    }

    _showStickyProps(obj) {
        const panel = document.getElementById('props-sticky');
        panel.style.display = 'block';

        const stickyColor = obj._stickyColor || '#fff9c4';
        document.querySelectorAll('.sticky-color-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.stickyColor === stickyColor);
        });

        const opacity = Math.round((obj.opacity || 1) * 100);
        this._setControlValue('prop-sticky-opacity', opacity);
    }

    _colorToHex(color) {
        if (!color || color === 'transparent') return '#ffffff';
        if (color.startsWith('#') && color.length === 7) return color;
        if (color.startsWith('#') && color.length === 4) {
            return '#' + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
        }
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            const r = parseInt(match[1]).toString(16).padStart(2, '0');
            const g = parseInt(match[2]).toString(16).padStart(2, '0');
            const b = parseInt(match[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        return '#ffffff';
    }

    showEmptyState(message = 'Select an element to edit its properties') {
        this._hideAllProps();
        document.getElementById('props-empty').style.display = 'flex';
        const msg = document.getElementById('props-empty-message');
        if (msg) msg.textContent = message;
    }

    reset() {
        this.setActiveTool('select');
        this.showEmptyState();
    }
}

window.Toolbar = Toolbar;

/**
 * Stamp library editor and manager (custom stamps persisted in localStorage).
 */
class StampManager {
    constructor() {
        this.mode = 'list';
        this.editingId = null;
        this.editingConfig = null;
        this.previewTimer = null;
    }

    init() {
        this._cacheElements();
        if (!this.els.modal) return;

        this._bindModalActions();
        this._bindEditorInputs();
        this._bindListActions();
    }

    _cacheElements() {
        this.els = {
            modal: document.getElementById('stamp-manager-modal'),
            listView: document.getElementById('stamp-manager-list-view'),
            editorView: document.getElementById('stamp-manager-editor-view'),
            modalTitle: document.getElementById('stamp-manager-title'),
            customList: document.getElementById('stamp-manager-custom-list'),
            builtinList: document.getElementById('stamp-manager-builtin-list'),
            previewCanvas: document.getElementById('stamp-editor-preview'),
            btnOpen: document.getElementById('btn-manage-stamps'),
            btnClose: document.getElementById('btn-stamp-manager-close'),
            btnCreate: document.getElementById('btn-stamp-manager-create'),
            btnEditorCancel: document.getElementById('btn-stamp-editor-cancel'),
            btnEditorSave: document.getElementById('btn-stamp-editor-save'),
            btnEditorDelete: document.getElementById('btn-stamp-editor-delete'),
            inputText: document.getElementById('stamp-editor-text'),
            inputShape: document.getElementById('stamp-editor-shape'),
            inputFontFamily: document.getElementById('stamp-editor-font-family'),
            inputFontWeight: document.getElementById('stamp-editor-font-weight'),
            signGrid: document.getElementById('stamp-editor-sign-grid'),
            inputAccent: document.getElementById('stamp-editor-accent'),
            inputTextColor: document.getElementById('stamp-editor-text-color'),
            inputFillOpacity: document.getElementById('stamp-editor-fill-opacity'),
            inputStrokeWidth: document.getElementById('stamp-editor-stroke-width'),
            inputFontSize: document.getElementById('stamp-editor-font-size'),
            inputCharSpacing: document.getElementById('stamp-editor-char-spacing'),
            inputRotation: document.getElementById('stamp-editor-rotation'),
            inputWidth: document.getElementById('stamp-editor-width'),
            inputHeight: document.getElementById('stamp-editor-height'),
            chkDashed: document.getElementById('stamp-editor-dashed'),
            chkDoubleBorder: document.getElementById('stamp-editor-double-border'),
            chkCross: document.getElementById('stamp-editor-cross'),
            chkStrike: document.getElementById('stamp-editor-strike'),
        };

        this._initFontOptions();
        this._initSignGrid();
    }

    _initFontOptions() {
        const select = this.els.inputFontFamily;
        if (!select || !window.StampKit) return;
        select.innerHTML = '';
        StampKit.listFontOptions().forEach((option) => {
            const el = document.createElement('option');
            el.value = option.value;
            el.textContent = option.label;
            select.appendChild(el);
        });
    }

    _initSignGrid() {
        const grid = this.els.signGrid;
        if (!grid || !window.StampKit) return;
        grid.innerHTML = '';
        StampKit.listSignOptions().forEach((option) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'stamp-sign-option';
            btn.dataset.sign = option.id;
            btn.title = option.label;
            btn.setAttribute('aria-label', option.label);
            btn.innerHTML = `<span class="stamp-sign-option-preview">${option.preview}</span><span class="stamp-sign-option-label">${option.label}</span>`;
            btn.addEventListener('click', () => {
                this._setSelectedSign(option.id);
                this._updatePreview();
            });
            grid.appendChild(btn);
        });
    }

    _setSelectedSign(signId) {
        if (!this.els.signGrid) return;
        this.els.signGrid.querySelectorAll('.stamp-sign-option').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.sign === signId);
        });
    }

    _bindModalActions() {
        this.els.btnOpen?.addEventListener('click', () => this.openManager());
        this.els.btnClose?.addEventListener('click', () => this.close());
        this.els.btnCreate?.addEventListener('click', () => this.openEditor(null));
        this.els.btnEditorCancel?.addEventListener('click', () => this.showList());
        this.els.btnEditorSave?.addEventListener('click', () => this.saveEditor());
        this.els.btnEditorDelete?.addEventListener('click', () => this.deleteEditing());

        this.els.modal.querySelector('.modal-backdrop')?.addEventListener('click', () => this.close());
    }

    _bindListActions() {
        /* delegated in renderList */
    }

    _bindEditorInputs() {
        const schedulePreview = () => {
            clearTimeout(this.previewTimer);
            this.previewTimer = setTimeout(() => this._updatePreview(), 80);
        };

        [
            this.els.inputText,
            this.els.inputShape,
            this.els.inputFontFamily,
            this.els.inputFontWeight,
            this.els.inputAccent,
            this.els.inputTextColor,
            this.els.inputFillOpacity,
            this.els.inputStrokeWidth,
            this.els.inputFontSize,
            this.els.inputCharSpacing,
            this.els.inputRotation,
            this.els.inputWidth,
            this.els.inputHeight,
        ].forEach((el) => {
            if (!el) return;
            el.addEventListener('input', schedulePreview);
            el.addEventListener('change', schedulePreview);
        });

        [
            this.els.chkDashed,
            this.els.chkDoubleBorder,
            this.els.chkCross,
            this.els.chkStrike,
        ].forEach((el) => {
            el?.addEventListener('change', schedulePreview);
        });
    }

    openManager() {
        this.showList();
        this.els.modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    close() {
        this.els.modal.style.display = 'none';
        this.mode = 'list';
        this.editingId = null;
    }

    showList() {
        this.mode = 'list';
        this.editingId = null;
        this.els.modalTitle.textContent = 'Manage stamps';
        this.els.listView.style.display = '';
        this.els.editorView.style.display = 'none';
        this.renderList();
    }

    openEditor(id, configOverride = null) {
        this.mode = 'edit';
        this.editingId = id;

        const cfg = configOverride
            ? StampKit.cloneConfig(configOverride)
            : (id ? StampKit.getPreset(id) : StampKit.createBlankCustom());

        this.editingConfig = cfg;
        this._populateEditor(cfg);
        this._updatePreview();

        const isNew = !id;
        const isCustom = id && StampKit.isCustom(id);
        this.els.modalTitle.textContent = isNew
            ? 'Create stamp'
            : (isCustom ? 'Edit stamp' : 'Duplicate stamp');
        this.els.btnEditorDelete.style.display = isCustom ? '' : 'none';
        this.els.btnEditorSave.textContent = isCustom ? 'Save changes' : 'Save to library';

        this.els.listView.style.display = 'none';
        this.els.editorView.style.display = '';
    }

    _populateEditor(cfg) {
        this.els.inputText.value = cfg.text || '';
        this.els.inputShape.value = cfg.shape || 'rounded';
        if (this.els.inputFontFamily) {
            this.els.inputFontFamily.value = StampKit.resolveFontFamily(cfg);
        }
        if (this.els.inputFontWeight) {
            this.els.inputFontWeight.value = String(cfg.fontWeight || '700');
        }
        this._setSelectedSign(StampKit.resolveSign(cfg));
        this.els.inputAccent.value = cfg.stroke || cfg.fill || '#15803d';
        this.els.inputTextColor.value = cfg.textColor || cfg.stroke || '#14532d';
        this.els.inputFillOpacity.value = cfg.fillOpacity != null ? cfg.fillOpacity : 0.12;
        this.els.inputStrokeWidth.value = cfg.strokeWidth != null ? cfg.strokeWidth : 2;
        this.els.inputFontSize.value = cfg.fontSize != null ? cfg.fontSize : 16;
        this.els.inputCharSpacing.value = cfg.charSpacing != null ? cfg.charSpacing : 70;
        this.els.inputRotation.value = cfg.defaultRotation != null ? cfg.defaultRotation : 0;
        this.els.inputWidth.value = cfg.width != null ? cfg.width : 168;
        this.els.inputHeight.value = cfg.height != null ? cfg.height : 52;
        this.els.chkDashed.checked = !!cfg.dashed;
        this.els.chkDoubleBorder.checked = !!(cfg.doubleBorder || cfg.shape === 'double');
        this.els.chkCross.checked = !!(cfg.cross || cfg.shape === 'cross');
        this.els.chkStrike.checked = !!cfg.strike;
    }

    _getSelectedSign() {
        const active = this.els.signGrid?.querySelector('.stamp-sign-option.active');
        return active?.dataset.sign || 'none';
    }

    _readEditorConfig() {
        const base = StampKit.cloneConfig(this.editingConfig || StampKit.createBlankCustom());
        const shape = this.els.inputShape.value || 'rounded';

        const patch = {
            text: this.els.inputText.value,
            shape,
            sign: this._getSelectedSign(),
            fontFamily: this.els.inputFontFamily?.value || 'Helvetica, Arial, sans-serif',
            fontWeight: this.els.inputFontWeight?.value || '700',
            strokeWidth: parseFloat(this.els.inputStrokeWidth.value) || 2,
            fillOpacity: parseFloat(this.els.inputFillOpacity.value) || 0.12,
            fontSize: parseFloat(this.els.inputFontSize.value) || 16,
            charSpacing: parseFloat(this.els.inputCharSpacing.value) || 0,
            defaultRotation: parseFloat(this.els.inputRotation.value) || 0,
            width: parseInt(this.els.inputWidth.value, 10) || 168,
            height: parseInt(this.els.inputHeight.value, 10) || 52,
            dashed: this.els.chkDashed.checked,
            doubleBorder: this.els.chkDoubleBorder.checked || shape === 'double',
            cross: this.els.chkCross.checked || shape === 'cross',
            strike: this.els.chkStrike.checked,
            textColor: this.els.inputTextColor.value,
        };

        let merged = StampKit.mergeConfig(base, patch);
        merged = StampKit.applyAccentColor(merged, this.els.inputAccent.value);
        merged.textColor = this.els.inputTextColor.value || merged.textColor;

        if (this.editingId && StampKit.isCustom(this.editingId)) {
            merged.preset = this.editingId;
        } else {
            merged.preset = '';
        }

        return merged;
    }

    _updatePreview() {
        if (!this.els.previewCanvas) return;
        const cfg = this._readEditorConfig();
        StampKit.renderPreviewCanvas(this.els.previewCanvas, cfg, {
            maxWidth: 200,
            maxHeight: 140,
            interactive: true,
            onOffsetChange: (updatedCfg) => {
                if (this.editingConfig) {
                    this.editingConfig.textOffset = updatedCfg.textOffset;
                    this.editingConfig.signOffset = updatedCfg.signOffset || updatedCfg.checkmarkOffset;
                    this.editingConfig.checkmarkOffset = updatedCfg.checkmarkOffset || updatedCfg.signOffset;
                }
            }
        });
    }

    saveEditor() {
        const cfg = this._readEditorConfig();
        if (!cfg.text || !cfg.text.trim()) {
            window.app?._showToast?.('Stamp label is required', 'error');
            return;
        }

        const saveId = (this.editingId && StampKit.isCustom(this.editingId)) ? this.editingId : null;
        const newId = StampKit.saveCustomStamp(cfg, saveId);

        window.app?.refreshStampPresetGrid?.(newId);
        window.app?._showToast?.('Stamp saved', 'success');
        this.showList();
    }

    deleteEditing() {
        if (!this.editingId || !StampKit.isCustom(this.editingId)) return;

        const name = StampKit.getPreset(this.editingId).text || 'this stamp';
        if (!window.confirm(`Delete "${name}" from your library?`)) return;

        StampKit.deleteCustomStamp(this.editingId);
        window.app?.refreshStampPresetGrid?.();
        window.app?._showToast?.('Stamp deleted', 'success');
        this.showList();
    }

    renderList() {
        this._renderCustomList();
        this._renderBuiltinList();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    _renderCustomList() {
        const container = this.els.customList;
        if (!container) return;
        container.innerHTML = '';

        const items = StampKit.listCustomStamps();
        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'stamp-manager-empty';
            empty.textContent = 'No custom stamps yet. Create one or duplicate a built-in preset.';
            container.appendChild(empty);
            return;
        }

        items.forEach((record) => {
            container.appendChild(this._createListRow(record.id, record.config, {
                editable: true,
                subtitle: 'Custom',
            }));
        });
    }

    _renderBuiltinList() {
        const container = this.els.builtinList;
        if (!container) return;
        container.innerHTML = '';

        StampKit.listBuiltinPresets().forEach((key) => {
            const cfg = StampKit.getPreset(key);
            container.appendChild(this._createListRow(key, cfg, {
                editable: false,
                subtitle: 'Built-in',
            }));
        });
    }

    _createListRow(id, config, options = {}) {
        const row = document.createElement('div');
        row.className = 'stamp-manager-row';

        const previewWrap = document.createElement('div');
        previewWrap.className = 'stamp-manager-row-preview';
        const miniCanvas = document.createElement('canvas');
        previewWrap.appendChild(miniCanvas);
        StampKit.renderPreviewCanvas(miniCanvas, config, { maxWidth: 120, maxHeight: 44 });

        const meta = document.createElement('div');
        meta.className = 'stamp-manager-row-meta';
        const title = document.createElement('div');
        title.className = 'stamp-manager-row-title';
        title.textContent = config.text || id;
        const sub = document.createElement('div');
        sub.className = 'stamp-manager-row-subtitle';
        sub.textContent = options.subtitle || '';
        meta.appendChild(title);
        meta.appendChild(sub);

        const actions = document.createElement('div');
        actions.className = 'stamp-manager-row-actions';

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'secondary-btn btn-sm';
        useBtn.textContent = 'Use';
        useBtn.title = 'Select this stamp for placement';
        useBtn.addEventListener('click', () => {
            window.app?.selectStampPreset?.(id);
            this.close();
        });

        actions.appendChild(useBtn);

        if (options.editable) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'secondary-btn btn-sm';
            editBtn.innerHTML = '<i data-lucide="pencil" class="btn-icon-sm"></i>';
            editBtn.title = 'Edit';
            editBtn.addEventListener('click', () => this.openEditor(id));
            actions.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'danger-btn btn-sm';
            delBtn.innerHTML = '<i data-lucide="trash-2" class="btn-icon-sm"></i>';
            delBtn.title = 'Delete';
            delBtn.addEventListener('click', () => {
                if (!window.confirm(`Delete "${config.text}"?`)) return;
                StampKit.deleteCustomStamp(id);
                window.app?.refreshStampPresetGrid?.();
                window.app?._showToast?.('Stamp deleted', 'success');
                this.renderList();
            });
            actions.appendChild(delBtn);
        } else {
            const dupBtn = document.createElement('button');
            dupBtn.type = 'button';
            dupBtn.className = 'secondary-btn btn-sm';
            dupBtn.textContent = 'Duplicate';
            dupBtn.title = 'Create an editable copy';
            dupBtn.addEventListener('click', () => {
                this.openEditor(null, StampKit.duplicatePreset(id));
            });
            actions.appendChild(dupBtn);
        }

        row.appendChild(previewWrap);
        row.appendChild(meta);
        row.appendChild(actions);
        return row;
    }
}

window.stampManager = new StampManager();
document.addEventListener('DOMContentLoaded', () => {
    window.stampManager.init();
});

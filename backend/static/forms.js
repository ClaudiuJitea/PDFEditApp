class PDFFormLayer {
    constructor() {
        this.container = null;
        this.layer = null;
        this.forms = [];
        this.selectedXref = null;
        this.selectedXrefs = [];
        this.zoom = 1;
        this.baseWidth = 0;
        this.baseHeight = 0;
        this.baseScale = 2;
        this.minFieldSize = 18;
        this.interactive = false;
        this.movable = false;
        this.onFieldSelected = null;
        this.onFieldChanged = null;
        this.onFieldsBatchChanged = null;
        this._onFieldDelete = null;
        this._onFieldDuplicate = null;
        this._isRendering = false;
        this._selectionAnchorXref = null;
        this.dragState = null;
        this._boundPointerMove = (event) => this._onPointerMove(event);
        this._boundPointerUp = (event) => this._onPointerUp(event);
    }

    init(container, layer) {
        this.container = container;
        this.layer = layer;
        this.layer.addEventListener('click', (event) => {
            if (event.target !== this.layer) return;
            if (!this.interactive && !this.movable) return;
            if (event.ctrlKey || event.metaKey || event.shiftKey) return;
            this.selectField(null);
        });
    }

    setForms(forms, width, height) {
        this.forms = Array.isArray(forms)
            ? forms.map((field) => ({
                ...field,
                bbox: Array.isArray(field.bbox) ? [...field.bbox] : [0, 0, this.minFieldSize, this.minFieldSize],
                pdf_bbox: Array.isArray(field.pdf_bbox) ? [...field.pdf_bbox] : null,
                choice_values: this._normalizeChoiceValues(field.choice_values),
                value: this._normalizeValueForField(field, field.value),
            }))
            : [];
        this.baseWidth = width || 0;
        this.baseHeight = height || 0;

        this.selectedXrefs = this.selectedXrefs.filter((xref) =>
            this.forms.some((field) => field.xref === xref)
        );
        this.selectedXref = this.selectedXrefs[0] ?? null;

        this.render();
    }

    setInteractive(interactive) {
        this.interactive = Boolean(interactive);
        if (this.layer) {
            this.layer.classList.toggle('interactive', this.interactive);
        }
    }

    setMovable(movable) {
        this.movable = Boolean(movable);
        if (this.layer) {
            this.layer.classList.toggle('movable', this.movable);
        }
    }

    _canManipulateSelection() {
        return this.interactive || this.movable;
    }

    setZoom(zoom) {
        this.zoom = zoom || 1;
        this.render();
    }

    syncPosition() {
        if (!this.container || !this.layer) return;

        const canvasContainer = this.container.querySelector('.canvas-container') || this.container.querySelector('#fabric-canvas');
        if (!canvasContainer) return;

        const wrapperRect = this.container.getBoundingClientRect();
        const canvasRect = canvasContainer.getBoundingClientRect();
        const left = canvasRect.left - wrapperRect.left + this.container.scrollLeft;
        const top = canvasRect.top - wrapperRect.top + this.container.scrollTop;

        this.layer.style.left = `${left}px`;
        this.layer.style.top = `${top}px`;
    }

    render() {
        if (!this.layer) return;

        this._isRendering = true;
        const activeElement = document.activeElement;
        let activeXref = null;
        let selectionStart = 0;
        let selectionEnd = 0;

        if (activeElement && activeElement.closest('.form-layer-field')) {
            activeXref = activeElement.closest('.form-layer-field').dataset.xref;
            if (activeElement.type === 'text') {
                try {
                    selectionStart = activeElement.selectionStart;
                    selectionEnd = activeElement.selectionEnd;
                } catch (e) {}
            }
        }

        this.layer.innerHTML = '';
        this.layer.style.width = `${this.baseWidth * this.zoom}px`;
        this.layer.style.height = `${this.baseHeight * this.zoom}px`;
        this.layer.style.display = this.forms.length ? 'block' : 'none';

        this.forms.forEach((field) => {
            const wrapper = document.createElement('div');
            wrapper.className = `form-layer-field form-layer-field-${field.widget_kind || 'text'}`;
            if (this.selectedXrefs.includes(field.xref)) {
                wrapper.classList.add('selected');
                if (field.xref === this.selectedXref) {
                    wrapper.classList.add('selected-primary');
                }
            }

            const bbox = field.bbox || [0, 0, 0, 0];
            const width = Math.max(this.minFieldSize, (bbox[2] - bbox[0]) * this.zoom);
            const height = Math.max(this.minFieldSize, (bbox[3] - bbox[1]) * this.zoom);

            wrapper.style.left = `${bbox[0] * this.zoom}px`;
            wrapper.style.top = `${bbox[1] * this.zoom}px`;
            wrapper.style.width = `${width}px`;
            wrapper.style.height = `${height}px`;
            wrapper.style.setProperty('--field-font-size', `${this._getFieldFontSize(field)}px`);
            wrapper.dataset.xref = String(field.xref);

            wrapper.addEventListener('pointerdown', (event) => {
                if (!this.interactive && !this.movable) return;
                event.stopPropagation();

                if (this.movable && !this.interactive) {
                    if (!this.selectedXrefs.includes(field.xref)) return;
                    if (this._handleModifierClick(field, event)) return;
                    this._startTransform('move', event);
                    return;
                }

                if (this._handleModifierClick(field, event)) return;
                const control = event.target.closest('.form-layer-control');
                if (control) {
                    this.selectField(field.xref, { focus: true, silent: false });
                    return;
                }
                this.selectField(field.xref, { focus: false, silent: false });
            });

            wrapper.appendChild(this._buildControl(field));

            this.layer.appendChild(wrapper);
        });

        this.syncPosition();
        if (this.layer) {
            this.layer.classList.toggle('interactive', this.interactive);
            this.layer.classList.toggle('movable', this.movable);
        }
        this._updateSelectionUI();

        if (activeXref) {
            const newActive = this.layer.querySelector(`[data-xref="${activeXref}"] .form-layer-control`);
            if (newActive) {
                newActive.focus();
                if (newActive.type === 'text' && typeof selectionStart === 'number') {
                    try {
                        newActive.setSelectionRange(selectionStart, selectionEnd);
                    } catch (e) {}
                }
            }
        }

        this._isRendering = false;
    }

    _shouldFocusSelectField(field) {
        if (this._isRendering || !field) return false;
        if (this.selectedXrefs.includes(field.xref)) return false;
        return this.selectedXref !== field.xref;
    }

    _updateSelectionUI() {
        if (!this.layer) return;

        this.layer.querySelectorAll('.form-layer-field').forEach((wrapper) => {
            const xref = Number.parseInt(wrapper.dataset.xref, 10);
            const isSelected = this.selectedXrefs.includes(xref);
            wrapper.classList.toggle('selected', isSelected);
            wrapper.classList.toggle('selected-primary', xref === this.selectedXref);
            wrapper.querySelectorAll('.form-layer-handle').forEach((handle) => handle.remove());
        });

        if (!this._canManipulateSelection() || this.selectedXref == null) return;

        const primaryWrapper = this.layer.querySelector(`[data-xref="${this.selectedXref}"]`);
        const field = this.getSelectedField();
        if (!primaryWrapper || !field) return;

        primaryWrapper.appendChild(this._buildHandle('move', 'Move field'));
        if (this.interactive) {
            primaryWrapper.appendChild(this._buildHandle('duplicate', 'Duplicate field'));
            primaryWrapper.appendChild(this._buildHandle('resize', 'Resize field'));
            primaryWrapper.appendChild(this._buildHandle('delete', 'Delete field'));
        }
    }

    _buildControl(field) {
        if (field.widget_kind === 'choice' || field.widget_kind === 'listbox') {
            const select = document.createElement('select');
            select.className = 'form-layer-control';

            if (this._isListbox(field)) {
                select.multiple = true;
                const visibleOptions = Math.max(2, Math.min((field.choice_values || []).length || 2, Math.floor(((field.bbox?.[3] || 0) - (field.bbox?.[1] || 0)) / 28)));
                select.size = visibleOptions;
            }

            (field.choice_values || []).forEach((option) => {
                const el = document.createElement('option');
                el.value = option.value;
                el.textContent = option.label;
                select.appendChild(el);
            });

            this._syncChoiceControlValue(select, field);
            select.addEventListener('focus', () => {
                if (this._shouldFocusSelectField(field)) {
                    this.selectField(field.xref, { focus: true });
                }
            });
            select.addEventListener('change', () => {
                if (this._isRendering) return;
                const value = select.multiple
                    ? Array.from(select.selectedOptions).map((option) => option.value)
                    : select.value;
                this.updateFieldValue(field.xref, value);
            });
            return select;
        }

        if (field.widget_kind === 'checkbox' || field.widget_kind === 'radio') {
            const toggle = document.createElement('div');
            toggle.className = 'form-layer-toggle';

            const input = document.createElement('input');
            input.type = field.widget_kind === 'radio' ? 'radio' : 'checkbox';
            input.className = 'form-layer-control';
            if (field.widget_kind === 'radio') {
                input.name = `pdf-form-radio-${field.field_name || field.xref}`;
            }
            input.checked = Boolean(field.value);
            input.addEventListener('focus', () => {
                if (this._shouldFocusSelectField(field)) {
                    this.selectField(field.xref, { focus: true });
                }
            });
            input.addEventListener('change', () => {
                if (this._isRendering) return;
                this.updateFieldValue(field.xref, input.checked);
            });
            input.addEventListener('pointerdown', (event) => {
                if (this._handleModifierClick(field, event)) return;
                event.stopPropagation();
            });

            toggle.appendChild(input);
            return toggle;
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-layer-control';
        input.value = field.value ?? '';
        input.placeholder = field.field_label || field.field_name || 'Text field';
        input.addEventListener('focus', () => {
            if (this._shouldFocusSelectField(field)) {
                this.selectField(field.xref, { focus: true });
            }
        });
        input.addEventListener('blur', () => {
            if (input.value === '') {
                input.value = field.value ?? '';
            }
        });
        input.addEventListener('input', () => {
            if (this._isRendering) return;
            this.updateFieldValue(field.xref, input.value);
        });
        input.addEventListener('pointerdown', (event) => {
            if (this._handleModifierClick(field, event)) return;
            event.stopPropagation();
        });
        return input;
    }

    _handleModifierClick(field, event) {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return false;
        event.preventDefault();
        this.selectField(field.xref, {
            extend: event.ctrlKey || event.metaKey,
            range: event.shiftKey,
            silent: false,
        });
        return true;
    }

    _buildHandle(kind, title) {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = `form-layer-handle form-layer-handle-${kind}`;
        handle.title = title;
        handle.setAttribute('aria-label', title);
        if (kind === 'delete') {
            handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
            handle.addEventListener('pointerdown', (event) => {
                if (!this.interactive) return;
                event.preventDefault();
                event.stopPropagation();
                const field = this.getSelectedField();
                if (field && this._onFieldDelete) {
                    this._onFieldDelete(field.xref);
                }
            });
            return handle;
        }
        if (kind === 'duplicate') {
            handle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            handle.addEventListener('pointerdown', (event) => {
                if (!this.interactive) return;
                event.preventDefault();
                event.stopPropagation();
                const field = this.getSelectedField();
                if (field && this._onFieldDuplicate) {
                    this._onFieldDuplicate(field.xref);
                }
            });
            return handle;
        }
        handle.textContent = kind === 'move' ? 'Move' : '';
        handle.addEventListener('pointerdown', (event) => {
            if (!this._canManipulateSelection()) return;
            if (kind === 'resize' && !this.interactive) return;
            event.preventDefault();
            event.stopPropagation();
            this._startTransform(kind, event);
        });
        return handle;
    }

    _startTransform(kind, event) {
        const primary = this.getSelectedField();
        if (!primary) return;

        const fields = (kind === 'move' && this.selectedXrefs.length > 1)
            ? this.getSelectedFields()
            : [primary];
        const startBBoxes = fields.map((field) => ({
            xref: field.xref,
            bbox: [...field.bbox],
        }));
        const groupBounds = this._getBounds(startBBoxes.map((item) => item.bbox));

        this.dragState = {
            kind,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startBBoxes,
            groupBounds,
            moved: false,
            xref: primary.xref,
        };

        document.addEventListener('pointermove', this._boundPointerMove);
        document.addEventListener('pointerup', this._boundPointerUp);
        document.addEventListener('pointercancel', this._boundPointerUp);
    }

    _onPointerMove(event) {
        if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;

        let dx = (event.clientX - this.dragState.startX) / this.zoom;
        let dy = (event.clientY - this.dragState.startY) / this.zoom;
        this.dragState.moved = this.dragState.moved || Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;

        if (this.dragState.kind === 'move') {
            const bounds = this.dragState.groupBounds;
            if (bounds) {
                dx = this._clamp(dx, -bounds.left, this.baseWidth - bounds.right);
                dy = this._clamp(dy, -bounds.top, this.baseHeight - bounds.bottom);
            }

            this.dragState.startBBoxes.forEach(({ xref, bbox }) => {
                const field = this.forms.find((item) => item.xref === xref);
                if (!field) return;

                const [startLeft, startTop, startRight, startBottom] = bbox;
                field.bbox = [startLeft + dx, startTop + dy, startRight + dx, startBottom + dy];
            });
        } else {
            const field = this.forms.find((item) => item.xref === this.dragState.xref);
            if (!field) return;

            const startBBox = this.dragState.startBBoxes[0]?.bbox;
            if (!startBBox) return;

            const [startLeft, startTop, startRight, startBottom] = startBBox;
            const nextRight = this._clamp(startRight + dx, startLeft + this.minFieldSize, this.baseWidth);
            const nextBottom = this._clamp(startBottom + dy, startTop + this.minFieldSize, this.baseHeight);
            field.bbox = [startLeft, startTop, nextRight, nextBottom];
        }

        this._syncFieldElementPositions();
    }

    _onPointerUp(event) {
        if (!this.dragState || event.pointerId !== this.dragState.pointerId) return;

        document.removeEventListener('pointermove', this._boundPointerMove);
        document.removeEventListener('pointerup', this._boundPointerUp);
        document.removeEventListener('pointercancel', this._boundPointerUp);

        const movedFields = this.dragState.startBBoxes
            .map(({ xref }) => this.forms.find((field) => field.xref === xref))
            .filter(Boolean);
        const didMove = this.dragState.moved;
        this.dragState = null;

        if (!movedFields.length || !didMove) {
            this._syncFieldElementPositions();
            return;
        }

        const payload = movedFields.map((field) => ({
            ...field,
            bbox: Array.isArray(field.bbox) ? [...field.bbox] : field.bbox,
        }));

        if (payload.length > 1 && this.onFieldsBatchChanged) {
            this.onFieldsBatchChanged(payload);
        } else if (this.onFieldChanged) {
            this.onFieldChanged(payload[0]);
        }
    }

    _getFieldFontSize(field) {
        const bbox = field.bbox || [0, 0, this.minFieldSize, this.minFieldSize];
        const height = Math.max(this.minFieldSize, bbox[3] - bbox[1]);
        return Math.max(11, Math.min(16, Math.round(height * 0.42)));
    }

    _getBounds(bboxes) {
        if (!bboxes.length) return null;
        return bboxes.reduce((bounds, bbox) => ({
            left: Math.min(bounds.left, bbox[0]),
            top: Math.min(bounds.top, bbox[1]),
            right: Math.max(bounds.right, bbox[2]),
            bottom: Math.max(bounds.bottom, bbox[3]),
        }), {
            left: bboxes[0][0],
            top: bboxes[0][1],
            right: bboxes[0][2],
            bottom: bboxes[0][3],
        });
    }

    _syncFieldElementPositions() {
        if (!this.layer) return;

        this.forms.forEach((field) => {
            const wrapper = this.layer.querySelector(`[data-xref="${field.xref}"]`);
            if (!wrapper) return;

            const bbox = field.bbox || [0, 0, 0, 0];
            const width = Math.max(this.minFieldSize, (bbox[2] - bbox[0]) * this.zoom);
            const height = Math.max(this.minFieldSize, (bbox[3] - bbox[1]) * this.zoom);
            wrapper.style.left = `${bbox[0] * this.zoom}px`;
            wrapper.style.top = `${bbox[1] * this.zoom}px`;
            wrapper.style.width = `${width}px`;
            wrapper.style.height = `${height}px`;
            wrapper.style.setProperty('--field-font-size', `${this._getFieldFontSize(field)}px`);
        });
    }

    _isListbox(field) {
        return field?.widget_kind === 'listbox' || (field?.field_type_string || '').toLowerCase().includes('list');
    }

    _normalizeChoiceValues(choiceValues) {
        if (!Array.isArray(choiceValues)) return [];
        return choiceValues
            .map((option) => {
                if (Array.isArray(option)) {
                    const value = option[0] ?? '';
                    return {
                        value: String(value),
                        label: String(option[1] ?? value),
                    };
                }
                if (option && typeof option === 'object') {
                    const value = option.value ?? option.label ?? '';
                    return {
                        value: String(value),
                        label: String(option.label ?? value),
                    };
                }
                return {
                    value: String(option ?? ''),
                    label: String(option ?? ''),
                };
            })
            .filter((option) => option.value !== '' || option.label !== '');
    }

    _normalizeValueForField(field, value) {
        const kind = field?.widget_kind || 'text';
        if (kind === 'checkbox' || kind === 'radio') {
            return Boolean(value);
        }
        if (this._isListbox(field)) {
            const values = Array.isArray(value) ? value : (value ? [value] : []);
            const allowed = new Set((field.choice_values || []).map((option) => String(option.value)));
            return values
                .map((item) => String(item))
                .filter((item) => !allowed.size || allowed.has(item));
        }
        if (kind === 'choice') {
            const valueText = value == null ? '' : String(value);
            const allowed = new Set((field.choice_values || []).map((option) => String(option.value)));
            return allowed.size && valueText && !allowed.has(valueText) ? '' : valueText;
        }
        return value == null ? '' : String(value);
    }

    _coerceChoiceValueAfterOptionsChange(field) {
        const options = field.choice_values || [];
        const allowed = new Set(options.map((option) => String(option.value)));
        if (this._isListbox(field)) {
            field.value = this._normalizeValueForField(field, field.value);
            return;
        }
        if (field.widget_kind === 'choice') {
            const current = field.value == null ? '' : String(field.value);
            field.value = !current || allowed.has(current) ? current : (options[0]?.value ?? '');
        }
    }

    _syncChoiceControlValue(select, field) {
        if (select.multiple) {
            const selectedValues = new Set(this._normalizeValueForField(field, field.value));
            Array.from(select.options).forEach((option) => {
                option.selected = selectedValues.has(option.value);
            });
            return;
        }
        select.value = this._normalizeValueForField(field, field.value);
    }

    _clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    getForms() {
        return this.forms.map((field) => ({
            ...field,
            bbox: Array.isArray(field.bbox) ? [...field.bbox] : field.bbox,
            pdf_bbox: Array.isArray(field.pdf_bbox) ? [...field.pdf_bbox] : field.pdf_bbox,
            choice_values: this._normalizeChoiceValues(field.choice_values),
            value: Array.isArray(field.value) ? [...field.value] : field.value,
        }));
    }

    getSelectedField() {
        return this.forms.find((field) => field.xref === this.selectedXref) || null;
    }

    getSelectedFields() {
        if (!this.selectedXrefs.length) return [];
        const set = new Set(this.selectedXrefs);
        return this.forms
            .filter((field) => set.has(field.xref))
            .sort((a, b) => this.selectedXrefs.indexOf(a.xref) - this.selectedXrefs.indexOf(b.xref));
    }

    clearSelection() {
        this.selectedXrefs = [];
        this.selectedXref = null;
        this._selectionAnchorXref = null;
        this._updateSelectionUI();
    }

    selectField(xref, options = {}) {
        const extend = Boolean(options.extend);
        const range = Boolean(options.range);
        const target = (xref === null || xref === undefined) ? null : this.forms.find((field) => field.xref === xref);

        if (target === null) {
            this.selectedXrefs = [];
            this._selectionAnchorXref = null;
        } else if (range) {
            const anchorXref = this._selectionAnchorXref ?? this.selectedXref ?? target.xref;
            const anchorIndex = this.forms.findIndex((field) => field.xref === anchorXref);
            const targetIndex = this.forms.findIndex((field) => field.xref === target.xref);
            if (anchorIndex >= 0 && targetIndex >= 0) {
                const start = Math.min(anchorIndex, targetIndex);
                const end = Math.max(anchorIndex, targetIndex);
                const anchorKind = this.forms[anchorIndex]?.widget_kind || 'text';
                this.selectedXrefs = this.forms
                    .slice(start, end + 1)
                    .filter((field) => (field.widget_kind || 'text') === anchorKind)
                    .map((field) => field.xref);
            } else {
                this.selectedXrefs = [target.xref];
            }
            this._selectionAnchorXref = anchorXref;
        } else if (extend) {
            const primary = this.getSelectedField();
            if (primary && primary.widget_kind !== target.widget_kind) {
                this.selectedXrefs = [target.xref];
            } else if (this.selectedXrefs.includes(target.xref)) {
                if (this.selectedXrefs.length === 1) {
                    this.selectedXrefs = [];
                } else {
                    this.selectedXrefs = this.selectedXrefs.filter((value) => value !== target.xref);
                }
            } else {
                this.selectedXrefs = [...this.selectedXrefs, target.xref];
            }
            this._selectionAnchorXref = this.selectedXrefs[0] ?? target.xref;
        } else {
            this.selectedXrefs = [target.xref];
            this._selectionAnchorXref = target.xref;
        }

        this.selectedXref = this.selectedXrefs[0] ?? null;

        this._updateSelectionUI();

        const selectedField = this.getSelectedField();
        if (options.focus && selectedField && !extend && !range) {
            const active = this.layer.querySelector(`[data-xref="${selectedField.xref}"] .form-layer-control`);
            active?.focus();
        }

        if (!options.silent && this.onFieldSelected) {
            this.onFieldSelected(selectedField, this.getSelectedFields());
        }

        return selectedField;
    }

    selectFields(xrefs, options = {}) {
        const wanted = new Set(Array.isArray(xrefs) ? xrefs : []);
        this.selectedXrefs = this.forms
            .filter((field) => wanted.has(field.xref))
            .map((field) => field.xref);
        this.selectedXref = this.selectedXrefs[0] ?? null;
        this._selectionAnchorXref = this.selectedXref;

        this._updateSelectionUI();

        const selectedField = this.getSelectedField();
        if (!options.silent && this.onFieldSelected) {
            this.onFieldSelected(selectedField, this.getSelectedFields());
        }

        return this.getSelectedFields();
    }

    updateFieldValue(xref, value, options = {}) {
        const target = this.forms.find((field) => field.xref === xref);
        if (!target) return;

        const normalizedValue = this._normalizeValueForField(target, value);
        if (target.widget_kind === 'radio' && normalizedValue) {
            this.forms.forEach((field) => {
                if (field.widget_kind === 'radio' && field.field_name === target.field_name) {
                    field.value = field.xref === xref;
                }
            });
        } else {
            target.value = normalizedValue;
        }

        this.render();

        if (!options.silent && this.onFieldChanged) {
            this.onFieldChanged(this.getSelectedField() || target);
        }
    }

    updateFieldProperties(xref, properties, options = {}) {
        const target = this.forms.find((field) => field.xref === xref);
        if (!target) return;

        const nextProperties = { ...properties };
        if (Object.prototype.hasOwnProperty.call(nextProperties, 'choice_values')) {
            nextProperties.choice_values = this._normalizeChoiceValues(nextProperties.choice_values);
        }

        Object.assign(target, nextProperties);
        if (Object.prototype.hasOwnProperty.call(nextProperties, 'choice_values')) {
            this._coerceChoiceValueAfterOptionsChange(target);
        }
        this.render();

        if (!options.silent && this.onFieldChanged) {
            this.onFieldChanged(this.getSelectedField() || target);
        }
    }

    nudgeSelectedFields(dx, dy) {
        const selected = this.getSelectedFields();
        if (!selected.length) return false;

        const bounds = this._getBounds(selected.map((field) => field.bbox));
        if (bounds) {
            dx = this._clamp(dx, -bounds.left, this.baseWidth - bounds.right);
            dy = this._clamp(dy, -bounds.top, this.baseHeight - bounds.bottom);
        }
        if (dx === 0 && dy === 0) return false;

        selected.forEach((field) => {
            field.bbox = [
                field.bbox[0] + dx,
                field.bbox[1] + dy,
                field.bbox[2] + dx,
                field.bbox[3] + dy,
            ];
        });

        this.render();

        const payload = selected.map((field) => ({
            ...field,
            bbox: [...field.bbox],
        }));

        if (payload.length > 1 && this.onFieldsBatchChanged) {
            this.onFieldsBatchChanged(payload);
        } else if (this.onFieldChanged) {
            this.onFieldChanged(payload[0]);
        }

        return true;
    }

    removeField(xref) {
        const index = this.forms.findIndex((field) => field.xref === xref);
        if (index === -1) return false;
        this.forms.splice(index, 1);
        if (this.selectedXrefs.includes(xref)) {
            this.selectedXrefs = this.selectedXrefs.filter((value) => value !== xref);
            this.selectedXref = this.selectedXrefs[0] ?? null;
        }
        this.render();
        return true;
    }

    /**
     * Resize all selected fields of the same type as the primary selection to
     * share an equal width and/or height. The primary field supplies the
     * reference dimensions; other selected fields keep their top-left corner.
     *
     * @param {'width'|'height'|'both'} dimension
     * @returns {Array} the fields that were modified
     */
    matchSelectedFieldSizes(dimension = 'both') {
        const selected = this.getSelectedFields();
        if (selected.length < 2) return [];

        const primary = selected[0];
        const primaryKind = primary.widget_kind || 'text';
        const primaryBbox = primary.bbox || [0, 0, 0, 0];
        const refWidth = Math.max(this.minFieldSize, primaryBbox[2] - primaryBbox[0]);
        const refHeight = Math.max(this.minFieldSize, primaryBbox[3] - primaryBbox[1]);

        const updated = [];
        selected.forEach((field) => {
            if (field === primary) return;
            if ((field.widget_kind || 'text') !== primaryKind) return;

            const bbox = Array.isArray(field.bbox) ? [...field.bbox] : [0, 0, this.minFieldSize, this.minFieldSize];
            const left = bbox[0];
            const top = bbox[1];
            const currentWidth = Math.max(this.minFieldSize, bbox[2] - bbox[0]);
            const currentHeight = Math.max(this.minFieldSize, bbox[3] - bbox[1]);
            const nextWidth = dimension === 'height' ? currentWidth : refWidth;
            const nextHeight = dimension === 'width' ? currentHeight : refHeight;

            const nextBbox = [left, top, left + nextWidth, top + nextHeight];
            const sizeChanged = nextBbox[2] !== bbox[2] || nextBbox[3] !== bbox[3];
            if (!sizeChanged) return;

            field.bbox = nextBbox;
            updated.push(field);
        });

        if (updated.length === 0) return [];

        this.render();

        if (this.onFieldsBatchChanged) {
            this.onFieldsBatchChanged(updated.map((field) => ({
                ...field,
                bbox: [...field.bbox],
            })));
        } else if (this.onFieldChanged) {
            updated.forEach((field) => {
                this.onFieldChanged({
                    ...field,
                    bbox: [...field.bbox],
                });
            });
        }

        return updated;
    }

    clear() {
        this.dragState = null;
        this.forms = [];
        this.selectedXref = null;
        this.selectedXrefs = [];
        this.baseWidth = 0;
        this.baseHeight = 0;
        this.render();
    }
}

window.PDFFormLayer = PDFFormLayer;
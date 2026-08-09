// Override fabric.Line._render to draw arrows when in arrowMode
if (typeof fabric !== 'undefined' && fabric.Line) {
    const originalLineRender = fabric.Line.prototype._render;
    fabric.Line.prototype._render = function(ctx) {
        originalLineRender.call(this, ctx);
        if (this._elementType === 'arrow') {
            ctx.save();
            const p = this.calcLinePoints();
            const dx = p.x2 - p.x1;
            const dy = p.y2 - p.y1;
            const length = Math.sqrt(dx * dx + dy * dy) || 0.001;
            
            // Normalize direction vector
            const ux = dx / length;
            const uy = dy / length;
            
            // Arrowhead size (proportional to strokeWidth)
            const arrowLength = Math.max(12, this.strokeWidth * 4);
            const arrowWidth = arrowLength * 0.5;
            
            // Calculate the two base vertices of the arrowhead triangle
            const ax = p.x2 - ux * arrowLength - uy * arrowWidth;
            const ay = p.y2 - uy * arrowLength + ux * arrowWidth;
            const bx = p.x2 - ux * arrowLength + uy * arrowWidth;
            const by = p.y2 - uy * arrowLength - ux * arrowWidth;
            
            ctx.beginPath();
            ctx.moveTo(p.x2, p.y2);
            ctx.lineTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.closePath();
            
            // Fill the arrowhead with stroke color
            ctx.fillStyle = this.stroke;
            ctx.fill();
            
            // Stroke the arrowhead to ensure clean edges
            ctx.strokeStyle = this.stroke;
            ctx.lineWidth = this.strokeWidth;
            ctx.stroke();
            
            ctx.restore();
        }
    };
}

class PDFEditor {
    constructor() {
        this.canvas = null;
        this.currentTool = 'select';
        this.drawingShape = null;
        this.isDrawing = false;
        this.startX = 0;
        this.startY = 0;
        this.freehandPoints = [];
        this.zoomLevel = 1;
        this.pdfScale = 2;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.onObjectSelected = null;
        this.onSelectionCleared = null;
        this.onSelectCanvasPointerDown = null;
        this.onSelectCanvasPointerUp = null;
        this.onCanvasModified = null;
        this.onDrawingComplete = null;
        this.onContextMenuRequested = null;
        this.onStickyDoubleClicked = null;
        this.onLinkAreaDrawn = null;
        this.arrowMode = false;
        this.deletedOriginals = [];
        this._deletedOcrMasks = [];
        this.stampType = 'approved';
        this.stampConfig = StampKit.getPreset('approved');
        this.brushSettings = {
            color: '#01696f',
            width: 2,
            opacity: 1,
            lineStyle: 'solid',
        };
        this._linkDrawMode = false;
        this._selectPointerStart = null;
        this._objectIdSeq = 0;
        this._tableIdSeq = 0;
        this.pendingOcrText = null;
        this.tableDefaults = {
            rows: 3,
            cols: 3,
            fill: '#ffffff',
            stroke: '#333333',
            strokeWidth: 1,
            lineStyle: 'solid',
            textLayer: 'above',
        };
        this._undoProps = [
            '_elementType', '_isRedaction', 'origin', 'originalPdfBbox', '_modified',
            '_stickyColor', '_stickyText', '_stickyPinned', '_textCase', '_pdfEditId',
            'stampType', 'stampText', 'stampConfig',
            '_tableRows', '_tableCols', '_tableFill', '_tableStroke', '_tableStrokeWidth', '_tableLineStyle',
            '_tableCells', '_tableWidth', '_tableHeight', '_tableId', '_tableTextLayer',
            '_tableRowHeights', '_tableColWidths',
            '_cellRow', '_cellCol', '_isTableCellText', '_isTableCellImage', '_isTableCellContent',
        ];
    }

    ensureObjectId(obj) {
        if (!obj) return null;
        const pdfBbox = obj.originalPdfBbox;
        if (pdfBbox && pdfBbox.length >= 4) {
            const key = pdfBbox.map((n) => Math.round(n * 10) / 10).join('_');
            obj._pdfEditId = `pdf-${key}`;
            return obj._pdfEditId;
        }
        if (!obj._pdfEditId) {
            this._objectIdSeq += 1;
            obj._pdfEditId = `pe-${this._objectIdSeq}`;
        }
        return obj._pdfEditId;
    }

    _objectOriginPoint(obj) {
        obj.setCoords();
        if (typeof obj.getPointByOrigin === 'function') {
            return obj.getPointByOrigin('left', 'top');
        }
        return { x: obj.left || 0, y: obj.top || 0 };
    }

    _setObjectOriginPoint(obj, left, top) {
        if (typeof obj.setPositionByOrigin === 'function' && typeof fabric !== 'undefined') {
            obj.setPositionByOrigin(new fabric.Point(left, top), 'left', 'top');
        } else {
            obj.set({ left, top });
        }
    }

    _registerCanvasObject(obj) {
        this.ensureObjectId(obj);
        this.applyTextboxWrapResize(obj);
        return obj;
    }

    assignIdsToAllObjects() {
        if (!this.canvas) return;
        this.canvas.getObjects().forEach((obj) => {
            this.ensureObjectId(obj);
            this.applyTextboxWrapResize(obj);
        });
    }

    _discardActiveSelection() {
        const active = this.canvas?.getActiveObject();
        if (active && active.type === 'activeSelection') {
            this.canvas.discardActiveObject();
        }
    }

    captureObjectPositions(objects) {
        const targets = objects && objects.length
            ? objects
            : this.canvas.getObjects().filter((obj) => (
                !obj._isLinkOverlay
                && !obj._isTableOverlay
                && !obj._isSearchHighlight
                && !obj._isTableResizeHandle
            ));
        return targets.map((obj) => {
            const point = this._objectOriginPoint(obj);
            const entry = {
                id: this.ensureObjectId(obj),
                left: point.x,
                top: point.y,
                angle: obj.angle || 0,
            };
            if (obj.width != null) {
                entry.width = obj.width;
            }
            if (obj.textAlign) {
                entry.textAlign = obj.textAlign;
            }
            return entry;
        });
    }

    captureObjectPositionsForUndo(objects) {
        this._discardActiveSelection();
        (objects || []).forEach((obj) => obj.setCoords());
        return this.captureObjectPositions(objects);
    }

    restoreObjectPositions(items) {
        if (!this.canvas || !items?.length) return;

        this._discardActiveSelection();

        const byId = new Map();
        this.canvas.getObjects().forEach((obj) => {
            byId.set(this.ensureObjectId(obj), obj);
        });

        items.forEach(({ id, left, top, angle, width, textAlign }) => {
            const obj = byId.get(id);
            if (!obj) return;
            this._setObjectOriginPoint(obj, left, top);
            const updates = {};
            if (angle != null) {
                updates.angle = angle;
            }
            if (width != null) {
                updates.width = width;
            }
            if (textAlign != null) {
                updates.textAlign = textAlign;
            }
            if (Object.keys(updates).length) {
                obj.set(updates);
            }
            if (width != null && typeof obj.initDimensions === 'function') {
                obj.initDimensions();
            }
            obj.setCoords();
            if (obj.origin === 'pdf') {
                obj._modified = true;
            }
        });

        this.canvas.requestRenderAll();
    }

    init(canvasEl, width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;

        this.canvas = new fabric.Canvas(canvasEl, {
            width: width,
            height: height,
            backgroundColor: null,
            selection: true,
            preserveObjectStacking: true,
            stopContextMenu: true,
            fireRightClick: true,
        });

        this.canvas.backgroundImage = null;

        this.canvas.on('selection:created', (e) => {
            this._syncAllTableResizeHandleVisibility();
            if (this.onObjectSelected) this.onObjectSelected(e.selected);
        });
        this.canvas.on('selection:updated', (e) => {
            this._syncAllTableResizeHandleVisibility();
            if (this.onObjectSelected) this.onObjectSelected(e.selected);
        });
        this.canvas.on('text:selection:changed', (e) => {
            if (this.onTextSelectionChanged && e.target) {
                this.onTextSelectionChanged(e.target);
            }
        });
        this.canvas.on('text:changed', (e) => {
            if (e.target?._isTableCellText) {
                this._enforceTableCellTextBounds(e.target);
            }
            if (this.onTextSelectionChanged && e.target) {
                this.onTextSelectionChanged(e.target);
            }
            if (e.target?._isTableCellText && this.onCanvasModified) {
                this.onCanvasModified();
            }
        });
        this.canvas.on('selection:cleared', () => {
            this._syncAllTableResizeHandleVisibility();
            if (this.onSelectionCleared) this.onSelectionCleared();
        });
        this.canvas.on('object:scaling', (e) => {
            if (e.target?._isTableCellText) {
                this._resizeTableCellFromTextObject(e.target);
                return;
            }
            this._onTextObjectTransform(e);
        });
        this.canvas.on('object:moving', (e) => {
            if (e.target?._isTableResizeHandle) {
                this._constrainTableResizeHandle(e.target);
            } else if (e.target?._elementType === 'table') {
                this._onTableFrameMoving(e);
            } else if (e.target?._tableId) {
                this._constrainObjectToTableCell(e.target);
            }
        });
        this.canvas.on('object:modified', (e) => {
            this._onTextObjectTransform(e);
            if (e.target?._isTableResizeHandle) {
                this._applyTableResizeHandle(e.target);
            } else if (e.target?._elementType === 'table') {
                delete e.target._moveLastLeft;
                delete e.target._moveLastTop;
                this._layoutTableCells(e.target);
            } else if (e.target && e.target._elementType !== 'table' && !e.target._isTableCellText) {
                this._tryAttachObjectToTableCell(e.target);
            }
            if (e.target && e.target.origin === 'pdf') {
                e.target._modified = true;
            }
            if (e.target?._elementType === 'stamp' && e.target.stampConfig) {
                const s = this.pdfScale || 1;
                const w = Math.round(((e.target.width || 0) * (e.target.scaleX || 1)) / s);
                const h = Math.round(((e.target.height || 0) * (e.target.scaleY || 1)) / s);
                e.target.stampConfig.width = w;
                e.target.stampConfig.height = h;
            }
            if (this.onCanvasModified) this.onCanvasModified();
        });
        this.canvas.on('object:changed', (e) => {
            if (e.target && e.target.origin === 'pdf') {
                e.target._modified = true;
            }
        });
        this.canvas.on('path:created', (e) => {
            const path = e.path;
            if (path) {
                path._elementType = 'path';
                const scale = this.pdfScale;
                const inkPoints = [];
                if (path.path) {
                    path.path.forEach((seg) => {
                        if (seg[0] === 'M' || seg[0] === 'L') {
                            inkPoints.push([
                                (path.left + seg[1]) / scale,
                                (path.top + seg[2]) / scale,
                            ]);
                        }
                    });
                }
                path._inkPoints = inkPoints;
                path.lineStyle = this.brushSettings.lineStyle;
            }
            if (this.onCanvasModified) this.onCanvasModified();
            if (this.currentTool === 'freehand' && this.onDrawingComplete) {
                this.onDrawingComplete(path);
            }
        });

        this.canvas.on('mouse:down', (opt) => this._onMouseDown(opt));
        this.canvas.on('mouse:move', (opt) => this._onMouseMove(opt));
        this.canvas.on('mouse:up', (opt) => this._onMouseUp(opt));
        this.canvas.on('mouse:dblclick', (opt) => this._onDoubleClick(opt));

        this._setupDrawingBrush();
        this._suppressNativeContextMenu(canvasEl);
    }

    _suppressNativeContextMenu(canvasEl) {
        const preventNativeMenu = (e) => {
            e.preventDefault();
        };
        const onCanvasContextMenu = (e) => {
            e.preventDefault();
            this._onRightClick({ e, button: 2, target: this.canvas.findTarget(e) });
        };

        canvasEl.addEventListener('contextmenu', onCanvasContextMenu);
        if (this.canvas?.upperCanvasEl) {
            this.canvas.upperCanvasEl.addEventListener('contextmenu', onCanvasContextMenu);
        }
        if (this.canvas?.lowerCanvasEl) {
            this.canvas.lowerCanvasEl.addEventListener('contextmenu', preventNativeMenu);
        }
        if (this.canvas?.wrapperEl) {
            this.canvas.wrapperEl.addEventListener('contextmenu', onCanvasContextMenu);
        }
    }

    _setupDrawingBrush() {
        this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
        this._applyBrushSettings();
        this.canvas.isDrawingMode = false;
    }

    _applyBrushSettings() {
        const brush = this.canvas.freeDrawingBrush;
        if (!brush) return;
        brush.width = this.brushSettings.width;
        brush.color = this.brushSettings.color;
        const dashArray = this._getBrushDashArray();
        brush.strokeDashArray = dashArray;
    }

    _getBrushDashArray() {
        return this.getDashArrayForStyle(this.brushSettings.lineStyle, this.brushSettings.width);
    }

    getDashArrayForStyle(style, width) {
        const w = Math.max(1, width);
        switch (style) {
            case 'dashed': return [w * 3, w * 2];
            case 'dotted': return [w * 0.8, w * 1.5];
            default: return null;
        }
    }

    setBackground(imageUrl) {
        return new Promise((resolve) => {
            fabric.Image.fromURL(imageUrl, (img) => {
                img.set({
                    scaleX: this.canvasWidth / img.width,
                    scaleY: this.canvasHeight / img.height,
                    selectable: false,
                    evented: false,
                    excludeFromExport: true,
                });
                this.canvas.setBackgroundImage(img, () => {
                    this.canvas.renderAll();
                    resolve();
                });
            });
        });
    }

    _applyCanvasCursor(tool) {
        if (!this.canvas) return;
        const cursor = this._getCursor(tool);
        this.canvas.defaultCursor = cursor;
        this.canvas.hoverCursor = cursor;
        this.canvas.moveCursor = cursor;
        [this.canvas.upperCanvasEl, this.canvas.lowerCanvasEl, this.canvas.wrapperEl].forEach((el) => {
            if (el) el.style.cursor = cursor;
        });
    }

    activateSelectTool() {
        if (!this.canvas) return;
        this.currentTool = 'select';
        this.canvas.isDrawingMode = false;
        this.canvas.selection = true;
        this._applyCanvasCursor('select');
        this.canvas.forEachObject((obj) => {
            if (!obj._isRedaction) {
                obj.selectable = true;
                obj.evented = true;
            }
        });
        this.canvas.requestRenderAll();
    }

    setTool(tool) {
        if (!this.canvas) {
            this.currentTool = tool;
            return;
        }

        if (tool === 'select') {
            this.activateSelectTool();
            return;
        }

        this.currentTool = tool;
        this.canvas.isDrawingMode = false;
        this.canvas.selection = false;
        this._applyCanvasCursor(tool);

        if (tool === 'forms') {
            this.canvas.selection = false;
            this.canvas.discardActiveObject();
            this.canvas.forEachObject((obj) => {
                obj.selectable = false;
                obj.evented = false;
            });
            this.canvas.renderAll();
        } else if (tool === 'freehand') {
            this.canvas.isDrawingMode = true;
            this._applyBrushSettings();
        } else if (tool === 'eraser') {
            this._deleteSelected();
            return;
        } else if (tool === 'link') {
            this._syncLinkToolInteractivity();
        } else {
            this.canvas.selection = false;
            this.canvas.discardActiveObject();
            this.canvas.forEachObject((obj) => {
                obj.selectable = false;
                obj.evented = false;
            });
            this.canvas.renderAll();
        }
    }

    _notifyDrawingComplete(createdObject) {
        if (this.onDrawingComplete) {
            this.onDrawingComplete(createdObject);
        }
        if (createdObject && this.canvas) {
            this.canvas.setActiveObject(createdObject);
            createdObject.setCoords();
            this.canvas.requestRenderAll();
            if (this.onObjectSelected) {
                this.onObjectSelected(this.canvas.getActiveObjects());
            }
        }
    }

    _hitTestStampAtPointer(e) {
        if (!this.canvas) return null;
        const pointer = this.canvas.getPointer(e);
        const objects = this.canvas.getObjects();
        for (let i = objects.length - 1; i >= 0; i--) {
            const obj = objects[i];
            if (obj._elementType !== 'stamp') continue;
            obj.setCoords();
            if (typeof obj.containsPoint === 'function' && obj.containsPoint(pointer)) {
                return obj;
            }
        }
        return null;
    }

    _activateSelectForStampInteraction(stamp) {
        if (!stamp) return;
        if (this.onDrawingComplete) {
            this.onDrawingComplete(stamp);
        }
        this.canvas.setActiveObject(stamp);
        stamp.setCoords();
        this.canvas.requestRenderAll();
        if (this.onObjectSelected) {
            this.onObjectSelected([stamp]);
        }
    }

    _isShapeTooSmall(shape, tool) {
        if (!shape) return true;
        if (tool === 'line') {
            const p = shape.calcLinePoints ? shape.calcLinePoints() : { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 };
            const len = Math.hypot((p.x2 || 0) - (p.x1 || 0), (p.y2 || 0) - (p.y1 || 0));
            return len < 5;
        }
        shape.setCoords();
        const bounds = shape.getBoundingRect(true, true);
        return bounds.width < 5 && bounds.height < 5;
    }

    _isTextLinkTarget(obj) {
        if (!obj || obj._isLinkOverlay) return false;
        const textTypes = ['text', 'i-text', 'textbox'];
        return textTypes.includes(obj._elementType) || textTypes.includes(obj.type);
    }

    isTextObject(obj) {
        return this._isTextLinkTarget(obj);
    }

    applyTextboxWrapResize(obj) {
        if (!obj || obj.type !== 'textbox') return obj;
        obj.set({
            lockScalingY: !obj._isTableCellText,
            lockScalingFlip: true,
            splitByGrapheme: !!obj._isTableCellText,
        });
        if (obj._isTableCellText && typeof obj.initDimensions === 'function') {
            obj.initDimensions();
        }
        if (typeof obj.setControlsVisibility === 'function') {
            obj.setControlsVisibility({
                mt: false,
                mb: false,
            });
        }
        if (Math.abs((obj.scaleX ?? 1) - 1) > 0.001 || Math.abs((obj.scaleY ?? 1) - 1) > 0.001) {
            this.normalizeTextObjectScale(obj);
        }
        return obj;
    }

    /**
     * Convert resize scale into width (Textbox) or font size (IText) so text wraps instead of stretching.
     */
    normalizeTextObjectScale(obj) {
        if (!obj || !this.isTextObject(obj)) return;

        const sx = obj.scaleX ?? 1;
        const sy = obj.scaleY ?? 1;
        if (Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;

        if (obj.type === 'textbox') {
            const minW = obj.minWidth ?? 40;
            const newWidth = Math.max(minW, (obj.width || 100) * Math.abs(sx));
            obj.set({
                width: newWidth,
                scaleX: 1,
                scaleY: 1,
            });
            if (typeof obj.initDimensions === 'function') {
                obj.initDimensions();
            }
        } else if (obj.type === 'i-text' || obj.type === 'text') {
            const scale = Math.max(Math.abs(sx), Math.abs(sy));
            const newSize = Math.max(6, (obj.fontSize || 16) * scale);
            obj.set({
                fontSize: newSize,
                scaleX: 1,
                scaleY: 1,
            });
        }
        obj.setCoords();
    }

    _onTextObjectTransform(e) {
        const target = e?.target;
        if (!target) return;
        if (target.type === 'activeSelection' && typeof target.getObjects === 'function') {
            target.getObjects().forEach((obj) => this.normalizeTextObjectScale(obj));
            return;
        }
        this.normalizeTextObjectScale(target);
    }

    getPageContentMargins() {
        const marginX = this.canvasWidth * 0.08;
        const marginY = this.canvasHeight * 0.06;
        return {
            left: marginX,
            right: this.canvasWidth - marginX,
            top: marginY,
            bottom: this.canvasHeight - marginY,
            centerX: this.canvasWidth / 2,
            centerY: this.canvasHeight / 2,
        };
    }

    _getObjectPageRect(obj) {
        obj.setCoords();
        const topLeft = obj.getPointByOrigin('left', 'top');
        const scaleX = obj.scaleX || 1;
        const scaleY = obj.scaleY || 1;
        const textWidth = typeof obj.calcTextWidth === 'function'
            ? obj.calcTextWidth() * scaleX
            : 0;
        const boxWidth = obj.width ? obj.width * scaleX : 0;
        const width = Math.max(textWidth, boxWidth);
        const height = (obj.height || obj.fontSize || 16) * scaleY;
        if (width > 0) {
            return {
                left: topLeft.x,
                top: topLeft.y,
                width,
                height,
            };
        }
        return obj.getBoundingRect(false, true);
    }

    _clampRectToMargins(rectLeft, rectTop, rectWidth, rectHeight, margins) {
        const maxLeft = Math.max(margins.left, margins.right - rectWidth);
        const maxTop = Math.max(margins.top, margins.bottom - rectHeight);
        return {
            left: Math.min(Math.max(rectLeft, margins.left), maxLeft),
            top: Math.min(Math.max(rectTop, margins.top), maxTop),
        };
    }

    getObjectPageAlign(obj) {
        if (!obj) return 'left';
        const margins = this.getPageContentMargins();
        const rect = this._getObjectPageRect(obj);
        const right = rect.left + rect.width;
        const contentWidth = margins.right - margins.left;
        const tolerance = Math.max(12, contentWidth * 0.02);

        if (obj.textAlign === 'justify' && Math.abs(rect.width - contentWidth) <= tolerance + 4) {
            return 'justify';
        }
        if (Math.abs(rect.left - margins.left) <= tolerance) return 'left';
        if (Math.abs(right - margins.right) <= tolerance) return 'right';
        if (Math.abs((rect.left + rect.width / 2) - margins.centerX) <= tolerance) return 'center';
        return obj.textAlign || 'left';
    }

    alignTextToPageMargin(obj, mode, options = {}) {
        if (!obj || !this.isTextObject(obj)) return false;

        if (mode === 'justify') {
            const margins = this.getPageContentMargins();
            const point = this._objectOriginPoint(obj);
            const contentWidth = margins.right - margins.left;
            this._setObjectOriginPoint(obj, margins.left, point.y);
            obj.set({ width: contentWidth, textAlign: 'justify' });
            if (typeof obj.initDimensions === 'function') {
                obj.initDimensions();
            }
            obj.setCoords();
            if (obj.origin === 'pdf') {
                obj._modified = true;
            }
            this.canvas.requestRenderAll();
            if (!options.skipModifiedCallback && this.onCanvasModified) {
                this.onCanvasModified();
            }
            return true;
        }

        return this.alignTextObjectsToPageMargins([obj], mode, options);
    }

    getTextSelectionStyles(obj) {
        if (!obj) return {};
        const styles = (typeof obj.getActiveStyle === 'function' && obj.isEditing)
            ? obj.getActiveStyle()
            : {};
        return {
            bold: (styles.fontWeight != null ? styles.fontWeight : obj.fontWeight) >= 700,
            italic: (styles.fontStyle != null ? styles.fontStyle : obj.fontStyle) === 'italic',
            underline: styles.underline != null ? styles.underline : obj.underline,
            linethrough: styles.linethrough != null ? styles.linethrough : obj.linethrough,
        };
    }

    alignSelectedLines(obj, textAlign) {
        if (!obj || !obj.isEditing) return false;

        const selStart = obj.selectionStart;
        const selEnd = obj.selectionEnd;
        if (selStart === selEnd) return false;

        const text = obj.text || '';
        if (!text.trim()) return false;

        let lineStart = text.lastIndexOf('\n', selStart - 1);
        lineStart = lineStart === -1 ? 0 : lineStart + 1;

        let lineEnd = text.indexOf('\n', selEnd);
        if (lineEnd === -1) {
            lineEnd = text.length;
        }

        if (lineStart === 0 && lineEnd === text.length) return false;

        const beforeText = text.slice(0, lineStart);
        const selectedText = text.slice(lineStart, lineEnd);
        const afterText = lineEnd < text.length ? text.slice(lineEnd) : '';

        const cleanBefore = beforeText.replace(/\n+$/, '');
        const cleanSelected = selectedText.replace(/^\n+/, '').replace(/\n+$/, '');
        const cleanAfter = afterText.replace(/^\n+/, '');

        if (!cleanSelected.trim()) return false;

        obj.exitEditing();

        const baseProps = {
            width: obj.width,
            fontSize: obj.fontSize,
            fontFamily: obj.fontFamily,
            fontWeight: obj.fontWeight,
            fontStyle: obj.fontStyle,
            fill: obj.fill,
            lineHeight: obj.lineHeight,
            charSpacing: obj.charSpacing,
            backgroundColor: obj.backgroundColor,
            underline: obj.underline,
            linethrough: obj.linethrough,
            opacity: obj.opacity,
            stroke: obj.stroke,
            strokeWidth: obj.strokeWidth,
            _elementType: obj._elementType,
            origin: obj.origin,
            _textCase: obj._textCase,
            splitByGrapheme: false,
        };
        const originalAlign = obj.textAlign || 'left';
        const originalLeft = obj.left;
        const originalTop = obj.top;

        this.canvas.remove(obj);

        const parts = [];
        if (cleanBefore) {
            parts.push({ text: cleanBefore, align: originalAlign });
        }
        parts.push({ text: cleanSelected, align: textAlign });
        if (cleanAfter) {
            parts.push({ text: cleanAfter, align: originalAlign });
        }

        let currentTop = originalTop;
        const gap = 4;
        let selBox = null;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const box = new fabric.Textbox(part.text, {
                ...baseProps,
                left: originalLeft,
                top: currentTop,
                textAlign: part.align,
                editable: true,
            });
            if (typeof box.initDimensions === 'function') {
                box.initDimensions();
            }
            box.setCoords();
            this.canvas.add(box);
            this._registerCanvasObject(box);
            currentTop = box.top + box.getScaledHeight() + gap;
            if (part.align === textAlign && part.text === cleanSelected) {
                selBox = box;
            }
            if (box.origin === 'pdf') {
                box._modified = true;
            }
        }

        if (selBox) {
            this.canvas.setActiveObject(selBox);
        }
        this.assignIdsToAllObjects();
        this.canvas.requestRenderAll();

        if (this.onObjectSelected && selBox) {
            this.onObjectSelected([selBox]);
        }

        return true;
    }

    alignTextObjectsToPageMargins(objects, mode, options = {}) {
        if (!objects || objects.length === 0) return false;

        const textObjects = objects.filter((o) => this.isTextObject(o));
        if (textObjects.length === 0) return false;

        const active = this.canvas.getActiveObject();
        if (active && active.type === 'activeSelection') {
            this.canvas.discardActiveObject();
        }

        const margins = this.getPageContentMargins();
        const rects = textObjects.map((obj) => ({ obj, rect: this._getObjectPageRect(obj) }));

        let minLeft = Infinity;
        let minTop = Infinity;
        let maxRight = -Infinity;
        let maxBottom = -Infinity;
        rects.forEach(({ rect }) => {
            minLeft = Math.min(minLeft, rect.left);
            minTop = Math.min(minTop, rect.top);
            maxRight = Math.max(maxRight, rect.left + rect.width);
            maxBottom = Math.max(maxBottom, rect.top + rect.height);
        });

        const groupWidth = maxRight - minLeft;
        const groupHeight = maxBottom - minTop;
        let dx = 0;
        let dy = 0;

        switch (mode) {
            case 'left':
                dx = margins.left - minLeft;
                break;
            case 'right':
                dx = margins.right - maxRight;
                break;
            case 'center':
                dx = margins.centerX - (minLeft + groupWidth / 2);
                break;
            case 'top':
                dy = margins.top - minTop;
                break;
            case 'middle':
                dy = margins.centerY - (minTop + groupHeight / 2);
                break;
            case 'bottom':
                dy = margins.bottom - maxBottom;
                break;
            default:
                return false;
        }

        const clampedDx = (() => {
            let shift = dx;
            if (minLeft + shift < margins.left) shift += margins.left - (minLeft + shift);
            if (maxRight + shift > margins.right) shift -= (maxRight + shift) - margins.right;
            return shift;
        })();
        const clampedDy = (() => {
            let shift = dy;
            if (minTop + shift < margins.top) shift += margins.top - (minTop + shift);
            if (maxBottom + shift > margins.bottom) shift -= (maxBottom + shift) - margins.bottom;
            return shift;
        })();

        textObjects.forEach((obj) => {
            const point = this._objectOriginPoint(obj);
            this._setObjectOriginPoint(obj, point.x + clampedDx, point.y + clampedDy);
            if (obj.origin === 'pdf') {
                obj._modified = true;
            }
            obj.setCoords();
        });

        if (textObjects.length > 1) {
            const selection = new fabric.ActiveSelection(textObjects, { canvas: this.canvas });
            this.canvas.setActiveObject(selection);
            selection.setCoords();
        } else if (textObjects.length === 1) {
            this.canvas.setActiveObject(textObjects[0]);
        }

        this.canvas.requestRenderAll();
        if (!options.skipModifiedCallback && this.onCanvasModified) {
            this.onCanvasModified();
        }
        if (this.onObjectSelected) this.onObjectSelected(textObjects);
        return true;
    }

    _syncLinkToolInteractivity() {
        if (!this.canvas || this.currentTool !== 'link') return;

        if (this._linkDrawMode) {
            this.canvas.selection = false;
            this.canvas.discardActiveObject();
            this.canvas.defaultCursor = this._getCursor('link');
            this.canvas.hoverCursor = this._getCursor('link');
            this.canvas.forEachObject((obj) => {
                if (obj._isLinkOverlay) return;
                obj.selectable = false;
                obj.evented = false;
            });
        } else {
            this.canvas.selection = true;
            this.canvas.defaultCursor = 'text';
            this.canvas.hoverCursor = 'text';
            this.canvas.forEachObject((obj) => {
                if (obj._isLinkOverlay) {
                    obj.selectable = false;
                    obj.evented = true;
                    return;
                }
                const isText = this._isTextLinkTarget(obj);
                obj.selectable = isText;
                obj.evented = isText;
            });
        }
        this.canvas.renderAll();
    }

    _getCursor(tool) {
        const cursors = {
            select: 'default',
            forms: 'default',
            text: 'text',
            image: 'crosshair',
            rect: 'crosshair',
            ellipse: 'crosshair',
            line: 'crosshair',
            star: 'crosshair',
            freehand: 'crosshair',
            highlight: 'crosshair',
            sticky: 'crosshair',
            table: 'crosshair',
            redaction: 'crosshair',
            stamp: 'crosshair',
            link: 'crosshair',
            eraser: 'pointer',
        };
        return cursors[tool] || 'default';
    }

    _onMouseDown(opt) {
        if (opt.button === 3 || opt.e?.button === 2) {
            // Selection prep only; menu opens on contextmenu to avoid browser menu conflict.
            const target = opt.target || this.canvas.findTarget(opt.e);
            if (!target || target.selectable === false) return;

            const activeObjects = this.canvas.getActiveObjects();
            const isAlreadySelected = activeObjects.includes(target) || this.canvas.getActiveObject() === target;
            if (!isAlreadySelected) {
                this.canvas.setActiveObject(target);
                this.canvas.requestRenderAll();
                if (this.onObjectSelected) this.onObjectSelected(this.canvas.getActiveObjects());
            }
            return;
        }

        if (this.canvas.isDrawingMode) return;
        if (this.currentTool === 'select') {
            const pointer = this.canvas.getPointer(opt.e);
            this._selectPointerStart = {
                x: pointer.x,
                y: pointer.y,
                target: opt.target || null,
            };

            if (opt.button !== 3 && opt.e?.button !== 2) {
                const hit = this._findTableCellAtPoint(pointer);
                if (hit) {
                    this._clearActiveTableCells(hit.table);
                    hit.table._activeCell = { row: hit.row, col: hit.col };
                } else if (opt.target?._isTableCellText || opt.target?._isTableCellImage) {
                    const table = this._getTableFrame(opt.target._tableId);
                    if (table) {
                        this._clearActiveTableCells(table);
                        table._activeCell = {
                            row: opt.target._cellRow,
                            col: opt.target._cellCol,
                        };
                    }
                } else {
                    this._clearActiveTableCells();
                }
            }
            if (this.onSelectCanvasPointerDown?.(opt)) {
                this._selectPointerStart = null;
                return;
            }
            return;
        }
        if (this.currentTool === 'forms' || this.currentTool === 'eraser') return;
        if (this.currentTool === 'link' && !this._linkDrawMode) return;

        const hitStamp = this._hitTestStampAtPointer(opt.e);
        if (hitStamp) {
            this.isDrawing = false;
            this._activateSelectForStampInteraction(hitStamp);
            return;
        }

        const pointer = this.canvas.getPointer(opt.e);
        this.startX = pointer.x;
        this.startY = pointer.y;
        this.isDrawing = true;

        switch (this.currentTool) {
            case 'text': {
                const pointer = this.canvas.getPointer(opt.e);
                const cellHit = this._findTableCellAtPoint(pointer);
                if (cellHit) {
                    this._focusTableCell(cellHit.table, cellHit.row, cellHit.col, true);
                    this.isDrawing = false;
                    break;
                }
                const textbox = this._createText(pointer.x, pointer.y);
                this._attachObjectToTableCellIfHit(textbox, pointer, { fit: true });
                this.isDrawing = false;
                break;
            }
            case 'sticky': {
                const sticky = this._createSticky(pointer.x, pointer.y);
                this.isDrawing = false;
                this._notifyDrawingComplete(sticky);
                break;
            }
            case 'image':
                this.isDrawing = false;
                break;
            case 'table':
                this.drawingShape = this._createTablePreview(pointer.x, pointer.y);
                break;
            case 'rect':
                this.drawingShape = this._createRect(pointer.x, pointer.y);
                break;
            case 'ellipse':
                this.drawingShape = this._createEllipse(pointer.x, pointer.y);
                break;
            case 'line':
                this.drawingShape = this._createLine(pointer.x, pointer.y);
                break;
            case 'star':
                this.drawingShape = this._createStar(pointer.x, pointer.y);
                break;
            case 'highlight':
                this.drawingShape = this._createHighlight(pointer.x, pointer.y);
                break;
            case 'redaction':
                this.drawingShape = this._createRedaction(pointer.x, pointer.y);
                break;
            case 'stamp': {
                const stamp = this._placeStamp(pointer.x, pointer.y);
                this.isDrawing = false;
                this._notifyDrawingComplete(stamp);
                break;
            }
            case 'link':
                if (this._linkDrawMode === false) {
                    this.isDrawing = false;
                    break;
                }
                this.drawingShape = this._createLinkArea(pointer.x, pointer.y);
                break;
        }
    }

    _onMouseMove(opt) {
        if (!this.isDrawing || !this.drawingShape) return;

        const pointer = this.canvas.getPointer(opt.e);
        const dx = pointer.x - this.startX;
        const dy = pointer.y - this.startY;

        if (['rect', 'table', 'highlight', 'redaction', 'link'].includes(this.currentTool)) {
            const left = Math.min(this.startX, pointer.x);
            const top = Math.min(this.startY, pointer.y);
            const width = Math.abs(dx);
            const height = Math.abs(dy);
            this.drawingShape.set({ left, top, width, height });
            this.canvas.renderAll();
        } else if (this.currentTool === 'ellipse') {
            const rx = Math.abs(dx) / 2;
            const ry = Math.abs(dy) / 2;
            const cx = this.startX + dx / 2;
            const cy = this.startY + dy / 2;
            this.drawingShape.set({ left: cx - rx, top: cy - ry, rx, ry });
            this.canvas.renderAll();
        } else if (this.currentTool === 'line') {
            this.drawingShape.set({ x2: pointer.x, y2: pointer.y });
            this.canvas.renderAll();
        } else if (this.currentTool === 'star') {
            const rx = Math.abs(dx);
            const ry = Math.abs(dy);
            const left = dx > 0 ? this.startX : this.startX + dx;
            const top = dy > 0 ? this.startY : this.startY + dy;
            
            this.drawingShape.set({
                left: left,
                top: top,
                scaleX: rx / 200,
                scaleY: ry / 200
            });
            this.drawingShape.setCoords();
            this.canvas.renderAll();
        }
    }

    _onMouseUp(opt) {
        if (this.currentTool === 'select') {
            const start = this._selectPointerStart;
            this._selectPointerStart = null;
            if (start && this.onSelectCanvasPointerUp) {
                const pointer = this.canvas.getPointer(opt.e);
                this.onSelectCanvasPointerUp({
                    start,
                    end: {
                        x: pointer.x,
                        y: pointer.y,
                        target: opt.target || null,
                    },
                    event: opt.e,
                });
            }
            return;
        }

        if (!this.isDrawing) return;
        this.isDrawing = false;

        if (this.drawingShape) {
            this.drawingShape.setCoords();

            if (this.currentTool === 'link' && this.onLinkAreaDrawn) {
                const bounds = this.drawingShape.getBoundingRect(true, true);
                const pdf_bbox = this.canvasBoundsToPdfBbox(bounds);
                const canvas_bbox = this.canvasBoundsToCanvasBbox(bounds);
                this.canvas.remove(this.drawingShape);
                this.onLinkAreaDrawn({ pdf_bbox, bbox: canvas_bbox });
            } else if (this.currentTool === 'table') {
                const bounds = this.drawingShape.getBoundingRect(true, true);
                this.canvas.remove(this.drawingShape);
                if (bounds.width >= 5 && bounds.height >= 5) {
                    const table = this.addTableToCanvas(bounds.left, bounds.top, bounds.width, bounds.height);
                    this._notifyDrawingComplete(table);
                }
            } else if (this._isShapeTooSmall(this.drawingShape, this.currentTool)) {
                this.canvas.remove(this.drawingShape);
            } else {
                const created = this.drawingShape;
                if (created._isRedaction) {
                    created.selectable = true;
                    created.evented = true;
                }
                this._attachObjectToTableCellIfHit(created, { x: this.startX, y: this.startY }, { fit: true });
                this._notifyDrawingComplete(created);
            }

            this.drawingShape = null;
            if (this.onCanvasModified) this.onCanvasModified();
        }
    }

    _onDoubleClick(opt) {
        const pointer = this.canvas.getPointer(opt.e);
        const cellHit = this._findTableCellAtPoint(pointer);
        if (cellHit) {
            this._focusTableCell(cellHit.table, cellHit.row, cellHit.col, true);
            return;
        }

        const target = opt.target;
        if (target && target._isTableCellText) {
            this.canvas.setActiveObject(target);
            target.enterEditing();
            target.selectAll();
            this.canvas.requestRenderAll();
            return;
        }

        if (target && target._elementType === 'sticky' && this.onStickyDoubleClicked) {
            this.onStickyDoubleClicked(target);
        }

        if (target && target._elementType === 'stamp') {
            const cfg = target.stampConfig || this.getStampConfigFromGroup(target);
            const newText = prompt("Edit Stamp Text:", cfg.text || "");
            if (newText !== null) {
                this.rebuildStamp(target, { text: newText });
                const textEl = document.getElementById('prop-stamp-text');
                if (textEl) {
                    textEl.value = newText;
                }
                if (this.onCanvasModified) this.onCanvasModified();
            }
        }
    }

    _onRightClick(opt) {
        const target = opt.target || this.canvas.findTarget(opt.e);

        if (opt.e) {
            opt.e.preventDefault();
        }

        if (!target || target.selectable === false) {
            this.canvas.discardActiveObject();
            this.canvas.requestRenderAll();
            if (this.onSelectionCleared) this.onSelectionCleared();
            if (this.onContextMenuRequested) this.onContextMenuRequested(null);
            return;
        }

        const activeObjects = this.canvas.getActiveObjects();
        const isAlreadySelected = activeObjects.includes(target) || this.canvas.getActiveObject() === target;

        if (!isAlreadySelected) {
            this.canvas.setActiveObject(target);
            this.canvas.requestRenderAll();
            if (this.onObjectSelected) this.onObjectSelected(this.canvas.getActiveObjects());
        }

        const selected = this.canvas.getActiveObjects();
        const textObjects = selected.filter((o) => this.isTextObject(o));
        const pointer = opt.e ? this.canvas.getPointer(opt.e) : null;
        const tableCellHit = pointer ? this._findTableCellAtPoint(pointer) : null;

        if (this.onContextMenuRequested && opt.e) {
            this.onContextMenuRequested({
                x: opt.e.clientX,
                y: opt.e.clientY,
                hasSelection: selected.length > 0,
                target: target,
                selectedObjects: selected,
                textObjectCount: textObjects.length,
                tableCellHit,
            });
        }
    }

    _createText(x, y) {
        const pending = this.consumePendingOcrText();
        const initialText = pending || 'Type here';
        const textbox = new fabric.Textbox(initialText, {
            left: x,
            top: y,
            width: pending ? Math.min(420, Math.max(200, this.canvasWidth * 0.45)) : 200,
            fontSize: 16 * this.pdfScale,
            fontFamily: 'Helvetica',
            fontWeight: 400,
            fill: '#000000',
            lineHeight: 1.2,
            charSpacing: 0,
            textAlign: 'left',
            editable: true,
            _elementType: 'text',
            _textCase: 'none',
        });
        this.canvas.add(textbox);
        this._registerCanvasObject(textbox);
        textbox.enterEditing();
        if (pending) {
            textbox.selectionStart = textbox.text.length;
            textbox.selectionEnd = textbox.text.length;
        } else {
            textbox.selectAll();
        }
        if (this.onCanvasModified) this.onCanvasModified();
        return textbox;
    }

    setPendingOcrText(text) {
        const trimmed = (text || '').trim();
        this.pendingOcrText = trimmed || null;
    }

    consumePendingOcrText() {
        const text = this.pendingOcrText;
        this.pendingOcrText = null;
        return text;
    }

    getSelectedImageObject() {
        const active = this.getActiveObjects();
        if (active.length !== 1) return null;
        const obj = active[0];
        if (obj._elementType === 'image' || obj.type === 'image') {
            return obj;
        }
        return null;
    }

    /**
     * Visual axis-aligned bounds of the replace source on the canvas.
     */
    _captureOcrReplaceBounds(obj) {
        if (obj) {
            obj.setCoords();
            const br = obj.getBoundingRect(true, true);
            return {
                left: br.left,
                top: br.top,
                width: Math.max(br.width, 1),
                height: Math.max(br.height, 1),
                angle: obj.angle || 0,
            };
        }
        return {
            left: 0,
            top: 0,
            width: Math.max(this.canvasWidth, 1),
            height: Math.max(this.canvasHeight, 1),
            angle: 0,
        };
    }


    _unionBboxFromElements(elements) {
        let minL = Infinity;
        let minT = Infinity;
        let maxR = -Infinity;
        let maxB = -Infinity;
        (elements || []).forEach((elem) => {
            const b = elem.bbox;
            if (!b || b.length < 4) return;
            minL = Math.min(minL, b[0]);
            minT = Math.min(minT, b[1]);
            maxR = Math.max(maxR, b[2]);
            maxB = Math.max(maxB, b[3]);
        });
        if (!Number.isFinite(minL)) {
            return null;
        }
        return {
            left: minL,
            top: minT,
            width: Math.max(maxR - minL, 1),
            height: Math.max(maxB - minT, 1),
            angle: 0,
        };
    }

    _estimatePageOcrBounds(content) {
        const pad = 32;
        const maxW = Math.max(this.canvasWidth - pad * 2, 200);
        const fontSize = Math.min(18, Math.max(11, 13 * (this.pdfScale || 2) * 0.45));
        const probe = new fabric.Textbox(content, {
            width: maxW,
            fontSize,
            lineHeight: 1.15,
        });
        if (typeof probe.initDimensions === 'function') {
            probe.initDimensions();
        }
        const textH = Math.max((probe.height || 80) * (probe.scaleY || 1), 40);
        return {
            left: pad,
            top: pad,
            width: maxW,
            height: Math.min(textH + pad, Math.max(this.canvasHeight - pad * 2, textH)),
            angle: 0,
        };
    }

    /**
     * Place mask + text at bounds without non-uniform scaling (avoids stretched glyphs).
     */
    _styledOcrElementsFromList(elements) {
        if (!elements?.length) return null;
        const textEls = elements.filter((e) => e?.type === 'text' && String(e.text || '').trim());
        if (!textEls.length || !textEls.some((e) => e.origin === 'ocr')) return null;
        const masks = elements.filter((e) => e?.type === 'rect');
        return { textEls, masks, loadOrder: [...masks, ...textEls] };
    }

    _createOcrReplaceAtBounds(content, box, options = {}) {
        const {
            skipMask = false,
            extraMaskElements = null,
            fontFamily = 'Helvetica',
            fill = '#111111',
            fontWeight = 'normal',
            fontStyle = 'normal',
            backgroundColor = '#ffffff',
        } = options;
        const lineHeight = 1.15;
        const fontSize = this._fitOcrFontSize(content, box.width, box.height, lineHeight);
        const pdfBbox = this.canvasBoundsToPdfBbox({
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
        });

        if (extraMaskElements?.length) {
            extraMaskElements
                .filter((e) => e.type === 'rect')
                .forEach((elem) => {
                    try {
                        this._loadSingleElement(elem);
                    } catch (e) {
                        console.warn('OCR mask load failed:', e);
                    }
                });
            this.canvas.getObjects()
                .filter((o) => o._elementType === 'ocr_mask')
                .forEach((m) => this.canvas.sendToBack(m));
        }

        if (!skipMask && !extraMaskElements?.length) {
            const mask = new fabric.Rect({
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                originX: 'left',
                originY: 'top',
                angle: box.angle || 0,
                fill: '#ffffff',
                stroke: 'transparent',
                strokeWidth: 0,
                opacity: 1,
                _elementType: 'ocr_mask',
                origin: 'ocr',
                originalPdfBbox: pdfBbox,
                selectable: false,
                evented: false,
            });
            this.canvas.add(mask);
            this.canvas.sendToBack(mask);
        }

        const textbox = new fabric.Textbox(content, {
            left: box.left,
            top: box.top,
            originX: 'left',
            originY: 'top',
            width: box.width,
            angle: box.angle || 0,
            fontSize,
            fontFamily: fontFamily || 'Helvetica',
            fill: fill || '#111111',
            fontWeight: fontWeight || 'normal',
            fontStyle: fontStyle || 'normal',
            backgroundColor: backgroundColor || '#ffffff',
            lineHeight,
            textAlign: 'left',
            scaleX: 1,
            scaleY: 1,
            editable: true,
            origin: 'ocr',
            originalPdfBbox: pdfBbox,
            _elementType: 'text',
            splitByGrapheme: false,
        });
        if (typeof textbox.initDimensions === 'function') {
            textbox.initDimensions();
        }
        this.canvas.add(textbox);
        this._registerCanvasObject(textbox);
        textbox.bringToFront();
        return textbox;
    }

    /**
     * Bounds for OCR replace: selected picture, or full page scan (canvas).
     */
    resolveOcrReplaceSource(imageObj = null) {
        const image = imageObj || this.getSelectedImageObject();
        if (image) {
            return {
                kind: 'image',
                target: image,
                bounds: this._captureOcrReplaceBounds(image),
            };
        }
        return {
            kind: 'page',
            target: null,
            bounds: this._captureOcrReplaceBounds(null),
        };
    }

    _collectOcrPunchRegions(extraRegions = []) {
        const pad = 6;
        const regions = [];
        const addRect = (left, top, width, height) => {
            if (!Number.isFinite(left) || width <= 0 || height <= 0) return;
            regions.push({
                left: Math.max(0, left - pad),
                top: Math.max(0, top - pad),
                width: width + pad * 2,
                height: height + pad * 2,
            });
        };

        (extraRegions || []).forEach((b) => {
            if (!b) return;
            addRect(b.left, b.top, b.width, b.height);
        });

        if (!this.canvas) return regions;

        this.canvas.getObjects().forEach((obj) => {
            if (!this._isOcrMaskObject(obj)) {
                return;
            }
            obj.setCoords();
            const br = obj.getBoundingRect(true, true);
            addRect(br.left, br.top, br.width, br.height);
        });

        return regions;
    }

    /**
     * Paint over scanned regions on the page background image so the source is removed visually.
     */
    async eraseScannedRegionsFromBackground(extraRegions = []) {
        if (!this.canvas?.backgroundImage) {
            return false;
        }

        const regions = this._collectOcrPunchRegions(extraRegions);
        if (!regions.length) {
            return false;
        }

        const w = this.canvasWidth;
        const h = this.canvasHeight;
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const ctx = off.getContext('2d');
        if (!ctx) {
            return false;
        }

        const bg = this.canvas.backgroundImage;
        const imgEl = bg._originalElement
            || (typeof bg.getElement === 'function' ? bg.getElement() : null);
        if (!imgEl) {
            return false;
        }

        try {
            ctx.drawImage(imgEl, 0, 0, w, h);
            ctx.fillStyle = '#ffffff';
            regions.forEach((r) => {
                ctx.fillRect(
                    Math.floor(r.left),
                    Math.floor(r.top),
                    Math.ceil(r.width),
                    Math.ceil(r.height)
                );
            });
            const dataUrl = off.toDataURL('image/png');
            await this.setBackground(dataUrl);
            this._ocrBackgroundPunched = true;
            this.canvas.requestRenderAll();
            return true;
        } catch (err) {
            console.warn('Failed to erase scan from background:', err);
            return false;
        }
    }

    _canvasRectFromPdfBbox(pdfBbox) {
        const scale = this.pdfScale || 2;
        return {
            left: pdfBbox[0] * scale,
            top: pdfBbox[1] * scale,
            width: (pdfBbox[2] - pdfBbox[0]) * scale,
            height: (pdfBbox[3] - pdfBbox[1]) * scale,
        };
    }

    /**
     * Remove embedded PDF images that are the OCR source (handwriting scans, etc.).
     */
    removePdfImagesInPdfBboxes(pdfBboxes, removeAllPdfImages = false) {
        if (!this.canvas) return [];
        const regions = (pdfBboxes || []).map((b) => this._canvasRectFromPdfBbox(b));
        const removedBboxes = [];

        this.canvas.getObjects().slice().forEach((obj) => {
            const isImage = obj.type === 'image' || obj._elementType === 'image';
            if (!isImage) return;

            let shouldRemove = false;
            if (removeAllPdfImages) {
                shouldRemove = true;
            } else if (regions.length) {
                obj.setCoords();
                const br = obj.getBoundingRect(true, true);
                shouldRemove = regions.some((r) => this._rectsOverlap(br, r, 8));
            }

            if (!shouldRemove) return;

            const scale = this.pdfScale || 2;
            let pdfBbox = obj.originalPdfBbox;
            if (!pdfBbox || pdfBbox.length !== 4) {
                obj.setCoords();
                const br = obj.getBoundingRect(true, true);
                pdfBbox = [
                    br.left / scale,
                    br.top / scale,
                    (br.left + br.width) / scale,
                    (br.top + br.height) / scale,
                ];
            }
            removedBboxes.push(pdfBbox);
            this.deletedOriginals.push({
                pdf_bbox: [...pdfBbox],
                type: 'image',
            });
            this.canvas.remove(obj);
        });
        return removedBboxes;
    }

    /** Remove every image layer on the canvas (the usual OCR source). */
    removeAllCanvasImagesForOcrReplace() {
        return this.removePdfImagesInPdfBboxes([], true);
    }

    _unionCanvasBboxFromPdfBboxes(pdfBboxes) {
        if (!pdfBboxes?.length) return null;
        const scale = this.pdfScale || 2;
        let minL = Infinity;
        let minT = Infinity;
        let maxR = -Infinity;
        let maxB = -Infinity;
        pdfBboxes.forEach((b) => {
            if (!b || b.length < 4) return;
            minL = Math.min(minL, b[0] * scale);
            minT = Math.min(minT, b[1] * scale);
            maxR = Math.max(maxR, b[2] * scale);
            maxB = Math.max(maxB, b[3] * scale);
        });
        if (!Number.isFinite(minL)) return null;
        return {
            left: minL,
            top: minT,
            width: Math.max(maxR - minL, 1),
            height: Math.max(maxB - minT, 1),
            angle: 0,
        };
    }

    _pdfBboxesFromElements(elements) {
        const out = [];
        (elements || []).forEach((elem) => {
            const b = elem.pdf_bbox;
            if (b && b.length === 4) {
                out.push([...b]);
            }
        });
        return out;
    }

    collectOcrMaskPdfBboxes() {
        const scale = this.pdfScale || 2;
        const bboxes = [];
        if (!this.canvas) return bboxes;

        this.canvas.getObjects().forEach((obj) => {
            if (!this._isOcrMaskObject(obj)) {
                return;
            }
            if (obj.originalPdfBbox && obj.originalPdfBbox.length === 4) {
                bboxes.push([...obj.originalPdfBbox]);
                return;
            }
            obj.setCoords();
            const br = obj.getBoundingRect(true, true);
            bboxes.push([
                br.left / scale,
                br.top / scale,
                (br.left + br.width) / scale,
                (br.top + br.height) / scale,
            ]);
        });
        return bboxes;
    }

    async refreshPageBackgroundWithMasks(sessionId, pageNum, pdfBboxes) {
        const unique = [];
        const seen = new Set();
        (pdfBboxes || []).forEach((bbox) => {
            if (!bbox || bbox.length !== 4) return;
            const key = bbox.map((n) => Math.round(n * 10) / 10).join(',');
            if (seen.has(key)) return;
            seen.add(key);
            unique.push(bbox);
        });
        if (!unique.length || !sessionId || pageNum == null) {
            return false;
        }
        try {
            const data = await API.getPageMaskedPreview(sessionId, pageNum, unique);
            if (data.image) {
                await this.setBackground(data.image);
                this._ocrBackgroundPunched = true;
                return true;
            }
        } catch (err) {
            console.warn('Server background mask failed:', err);
        }
        return false;
    }

    _isOcrMaskObject(obj) {
        return obj._elementType === 'ocr_mask' || (obj.origin === 'ocr' && obj.type === 'rect');
    }

    /** PDF regions to redact underlying scan when saving after OCR replace. */
    getOcrRedactAreas() {
        const scale = this.pdfScale || 2;
        const areas = [];
        if (!this.canvas) return areas;

        this.canvas.getObjects().forEach((obj) => {
            if (!this._isOcrMaskObject(obj)) {
                return;
            }
            let pdfBbox = obj.originalPdfBbox;
            if (!pdfBbox || pdfBbox.length !== 4) {
                obj.setCoords();
                const br = obj.getBoundingRect(true, true);
                pdfBbox = [
                    br.left / scale,
                    br.top / scale,
                    (br.left + br.width) / scale,
                    (br.top + br.height) / scale,
                ];
            }
            areas.push({ pdf_bbox: pdfBbox, type: 'ocr_mask', cover: true });
        });

        for (const mask of this._deletedOcrMasks) {
            areas.push({ pdf_bbox: mask.pdf_bbox, type: 'ocr_mask', cover: true });
        }
        this._deletedOcrMasks = [];

        return areas;
    }

    _fitOcrFontSize(text, boxWidth, boxHeight, lineHeight = 1.15) {
        const lines = String(text).split('\n');
        const lineCount = Math.max(1, lines.length);
        const widest = Math.max(...lines.map((l) => l.length), 1);
        let size = Math.floor((boxHeight / lineCount) / lineHeight * 0.9);
        const widthLimit = Math.floor(boxWidth / Math.max(widest * 0.52, 1));
        size = Math.min(size, widthLimit);
        return Math.min(28, Math.max(8, size));
    }

    /**
     * Replace page scan or image with masks + editable text (no scale stretching).
     */
    async applyOcrReplaceSource(source, text, options = {}) {
        const content = (text || '').trim();
        if (!source || !content) {
            return null;
        }

        const { elements = null, sourcePdfBboxes = [] } = options;
        const { target, kind } = source;
        const punchRegions = [];
        let allSourcePdfBboxes = [...sourcePdfBboxes];

        if (kind === 'page') {
            const removedBboxes = this.removeAllCanvasImagesForOcrReplace();
            allSourcePdfBboxes.push(...removedBboxes);
        } else {
            const removedBboxes = this.removePdfImagesInPdfBboxes(allSourcePdfBboxes, false);
            allSourcePdfBboxes.push(...removedBboxes);
        }

        allSourcePdfBboxes.push(...this._pdfBboxesFromElements(elements));

        if (target && this.canvas.getObjects().includes(target)) {
            source.bounds = this._captureOcrReplaceBounds(target);
            punchRegions.push(source.bounds);
            allSourcePdfBboxes.push(this.canvasBoundsToPdfBbox({
                left: source.bounds.left,
                top: source.bounds.top,
                width: source.bounds.width,
                height: source.bounds.height,
            }));
            this.canvas.remove(target);
        }

        let box = source.bounds;
        let textbox;

        const sourceUnion = this._unionCanvasBboxFromPdfBboxes(allSourcePdfBboxes);

        const maskPdfBboxes = [...allSourcePdfBboxes];
        let bgOk = false;
        if (options.sessionId != null && options.pageNum != null && maskPdfBboxes.length) {
            bgOk = await this.refreshPageBackgroundWithMasks(
                options.sessionId,
                options.pageNum,
                maskPdfBboxes
            );
        }

        const styledOcr = this._styledOcrElementsFromList(elements);
        const styleSample = styledOcr?.textEls?.[0] || elements?.find((e) => e?.type === 'text');
        const ocrTextStyle = styleSample ? {
            fontFamily: styleSample.fontFamily || 'Helvetica',
            fill: styleSample.fill || '#111111',
            fontWeight: styleSample.bold || styleSample.fontWeight === 'bold' ? 'bold' : 'normal',
            fontStyle: styleSample.italic ? 'italic' : 'normal',
            backgroundColor: styleSample.backgroundColor || '#ffffff',
        } : {};

        if (styledOcr) {
            if (kind === 'page') {
                const union = sourceUnion || this._unionBboxFromElements(styledOcr.loadOrder);
                if (union) punchRegions.push(union);
            } else if (box) {
                punchRegions.push(box);
            }
            this.loadElements(styledOcr.loadOrder);
            if (!bgOk) {
                await this.eraseScannedRegionsFromBackground(punchRegions);
            }
            this.canvas.renderAll();
            const placed = this.canvas.getObjects().filter(
                (o) => o._elementType === 'text' && o.origin === 'ocr'
            );
            textbox = placed[placed.length - 1] || null;
        } else if (kind === 'page' && elements?.length) {
            const union = sourceUnion || this._unionBboxFromElements(elements);
            if (union) {
                punchRegions.push(union);
            }
            box = union || this._estimatePageOcrBounds(content);
            textbox = this._createOcrReplaceAtBounds(content, box, {
                extraMaskElements: elements,
                ...ocrTextStyle,
            });
        } else if (kind === 'page') {
            box = sourceUnion || this._estimatePageOcrBounds(content);
            punchRegions.push(box);
            textbox = this._createOcrReplaceAtBounds(content, box, ocrTextStyle);
        } else if (box) {
            punchRegions.push(box);
            maskPdfBboxes.push(...this.collectOcrMaskPdfBboxes());
            textbox = this._createOcrReplaceAtBounds(content, box, ocrTextStyle);
        } else {
            return null;
        }

        if (!bgOk) {
            await this.eraseScannedRegionsFromBackground(punchRegions);
        }

        this.canvas.setActiveObject(textbox);
        this.canvas.requestRenderAll();
        this.assignIdsToAllObjects();

        if (this.onObjectSelected) {
            this.onObjectSelected([textbox]);
        }
        if (this.onCanvasModified) {
            this.onCanvasModified();
        }
        textbox._ocrReplaceKind = kind;
        return textbox;
    }


    _createSticky(x, y) {
        const color = '#fff9c4';
        const { body, fold, width, height } = this._buildStickyIcon(color);

        const group = new fabric.Group([body, fold], {
            left: x - width / 2,
            top: y - height / 2,
            _elementType: 'sticky',
            _stickyColor: color,
            _stickyText: '',
            _stickyPinned: false,
            shadow: new fabric.Shadow({
                color: 'rgba(0,0,0,0.2)',
                blur: 4,
                offsetX: 1,
                offsetY: 2,
            }),
            hasControls: false,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
        });

        this.canvas.add(group);
        if (this.onCanvasModified) this.onCanvasModified();
        return group;
    }

    _buildStickyIcon(color) {
        const darkColor = this._darkenStickyColor(color);
        const w = 30, h = 36, fold = 10;

        const bodyPath = [
            'M 2 0',
            `L ${w - fold} 0`,
            `L ${w - fold} ${fold}`,
            `L ${w} ${fold}`,
            `L ${w} ${h - 2}`,
            `Q ${w} ${h} ${w - 2} ${h}`,
            `L 2 ${h}`,
            `Q 0 ${h} 0 ${h - 2}`,
            'L 0 2',
            'Q 0 0 2 0',
            'Z',
        ].join(' ');

        const body = new fabric.Path(bodyPath, {
            fill: color,
            stroke: darkColor,
            strokeWidth: 1,
        });

        const foldPath = [
            `M ${w - fold} 0`,
            `L ${w} ${fold}`,
            `L ${w - fold} ${fold}`,
            'Z',
        ].join(' ');

        const foldShape = new fabric.Path(foldPath, {
            fill: darkColor,
            stroke: darkColor,
            strokeWidth: 0.5,
            opacity: 0.45,
        });

        return { body, fold: foldShape, width: w, height: h };
    }

    _darkenStickyColor(hex) {
        if (!hex || !hex.startsWith('#') || hex.length < 7) return '#999999';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const factor = 0.7;
        const dr = Math.round(r * factor);
        const dg = Math.round(g * factor);
        const db = Math.round(b * factor);
        return '#' + [dr, dg, db].map(c => c.toString(16).padStart(2, '0')).join('');
    }

    setTableDefault(prop, value) {
        if (!this.tableDefaults || !(prop in this.tableDefaults)) return;
        if (prop === 'rows' || prop === 'cols') {
            this.tableDefaults[prop] = Math.max(1, Math.min(20, parseInt(value, 10) || 1));
            return;
        }
        if (prop === 'strokeWidth') {
            this.tableDefaults[prop] = Math.max(0, parseFloat(value) || 0);
            return;
        }
        if (prop === 'stroke' && value !== 'transparent') {
            this.tableDefaults[prop] = value;
            return;
        }
        if (prop === 'stroke') {
            this.tableDefaults[prop] = 'transparent';
            return;
        }
        if (prop === 'textLayer') {
            this.tableDefaults[prop] = value === 'below' ? 'below' : 'above';
            return;
        }
        if (prop === 'lineStyle') {
            this.tableDefaults[prop] = ['dashed', 'dotted'].includes(value) ? value : 'solid';
            return;
        }
        this.tableDefaults[prop] = value;
    }

    _normalizeTableRenderStrokeWidth(strokeWidth) {
        const n = parseFloat(strokeWidth);
        if (!Number.isFinite(n) || n < 0) return 1;
        if (n === 0) return 0.5;
        return n;
    }

    _generateTableId() {
        this._tableIdSeq += 1;
        return `tbl-${this._tableIdSeq}`;
    }

    _normalizeTableCellData(cell) {
        if (cell == null) {
            return { text: '', image: null };
        }
        if (typeof cell === 'string') {
            return { text: cell, image: null };
        }
        return {
            text: cell.text || '',
            image: cell.image || null,
            fontSize: cell.fontSize,
            fontFamily: cell.fontFamily,
            fill: cell.fill,
            textAlign: cell.textAlign,
        };
    }

    _normalizeTableCells(rawCells, rows, cols) {
        return Array.from({ length: rows }, (_, rowIdx) => (
            Array.from({ length: cols }, (_, colIdx) => (
                this._normalizeTableCellData(rawCells?.[rowIdx]?.[colIdx])
            ))
        ));
    }

    getTableConfigFromGroup(group) {
        if (!group || group._elementType !== 'table') return null;
        return {
            rows: group._tableRows || 3,
            cols: group._tableCols || 3,
            fill: group._tableFill || '#ffffff',
            stroke: group._tableStroke || '#333333',
            strokeWidth: group._tableStrokeWidth ?? 1,
            lineStyle: group._tableLineStyle || 'solid',
            textLayer: group._tableTextLayer || 'above',
            rowHeights: group._tableRowHeights || null,
            colWidths: group._tableColWidths || null,
            cells: this._serializeTableCells(group),
        };
    }

    _normalizeTableSizes(rawSizes, count, total, minSize) {
        const source = Array.isArray(rawSizes) ? rawSizes : [];
        const sizes = Array.from({ length: count }, (_, idx) => {
            const n = parseFloat(source[idx]);
            return Number.isFinite(n) && n > 0 ? Math.max(minSize, n) : total / Math.max(count, 1);
        });
        return sizes;
    }

    _sumTableSizes(sizes) {
        return (sizes || []).reduce((sum, size) => sum + (parseFloat(size) || 0), 0);
    }

    _scaleTableSizesToTotal(sizes, targetTotal, minSize = 30) {
        const count = sizes?.length || 0;
        if (!count) return sizes || [];

        const total = Math.max(targetTotal, minSize * count);
        let scaled = sizes.map((size) => {
            const n = parseFloat(size);
            return Number.isFinite(n) && n > 0 ? n : total / count;
        });

        let sum = this._sumTableSizes(scaled);
        if (sum <= 0) {
            return Array.from({ length: count }, () => total / count);
        }

        scaled = scaled.map((size) => Math.max(minSize, size * total / sum));
        const drift = total - this._sumTableSizes(scaled);
        if (Math.abs(drift) > 0.01) {
            const adjustIdx = scaled.reduce((best, size, idx, arr) => (
                size > arr[best] ? idx : best
            ), 0);
            scaled[adjustIdx] = Math.max(minSize, scaled[adjustIdx] + drift);
        }
        return scaled;
    }

    _fitTableLayout(left, top, colWidths, rowHeights) {
        const margins = this.getPageContentMargins();
        const contentWidth = margins.right - margins.left;
        const contentHeight = margins.bottom - margins.top;
        const minCol = 30;
        const minRow = 20;

        let nextLeft = left;
        let nextTop = top;
        let nextColWidths = [...colWidths];
        let nextRowHeights = [...rowHeights];
        let tableWidth = this._sumTableSizes(nextColWidths);
        let tableHeight = this._sumTableSizes(nextRowHeights);

        if (tableWidth > contentWidth) {
            nextColWidths = this._scaleTableSizesToTotal(nextColWidths, contentWidth, minCol);
            tableWidth = contentWidth;
            nextLeft = margins.left;
        } else {
            const clamped = this._clampRectToMargins(nextLeft, nextTop, tableWidth, tableHeight, margins);
            nextLeft = clamped.left;
            nextTop = clamped.top;
        }

        if (tableHeight > contentHeight) {
            nextRowHeights = this._scaleTableSizesToTotal(nextRowHeights, contentHeight, minRow);
            tableHeight = contentHeight;
            nextTop = margins.top;
        } else {
            const clamped = this._clampRectToMargins(nextLeft, nextTop, tableWidth, tableHeight, margins);
            nextTop = clamped.top;
        }

        return {
            left: nextLeft,
            top: nextTop,
            colWidths: nextColWidths,
            rowHeights: nextRowHeights,
            width: tableWidth,
            height: tableHeight,
        };
    }

    _findTableSizeIndex(sizes, value) {
        let cursor = 0;
        for (let idx = 0; idx < sizes.length; idx += 1) {
            cursor += sizes[idx];
            if (value <= cursor) return idx;
        }
        return Math.max(0, sizes.length - 1);
    }

    _tableOffsetForIndex(sizes, index) {
        return sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
    }

    _getTableMembers(tableId) {
        if (!this.canvas || !tableId) return [];
        return this.canvas.getObjects().filter((obj) => obj._tableId === tableId);
    }

    _getTableFrame(tableId) {
        return this._getTableMembers(tableId).find((obj) => obj._elementType === 'table') || null;
    }

    _getTableCellTextbox(tableId, row, col) {
        return this._getTableMembers(tableId).find((obj) => (
            obj._isTableCellText && obj._cellRow === row && obj._cellCol === col
        )) || null;
    }

    _getTableCellImage(tableId, row, col) {
        return this._getTableMembers(tableId).find((obj) => (
            obj._isTableCellImage && obj._cellRow === row && obj._cellCol === col
        )) || null;
    }

    _getTableResizeHandles(tableId) {
        return this._getTableMembers(tableId).filter((obj) => obj._isTableResizeHandle);
    }

    _tableHasVisibleStroke(table) {
        const stroke = table?._tableStroke ?? this.tableDefaults?.stroke ?? '#333333';
        const strokeWidth = table?._tableStrokeWidth ?? this.tableDefaults?.strokeWidth ?? 1;
        const renderWidth = this._normalizeTableRenderStrokeWidth(strokeWidth);
        return Boolean(stroke && stroke !== 'transparent' && renderWidth > 0);
    }

    _isTableInteractionFocused(table) {
        if (!this.canvas || !table?._tableId) return false;
        const active = this.canvas.getActiveObject();
        if (!active) return false;
        if (active === table) return true;
        if (active._tableId === table._tableId && !active._isTableResizeHandle) return true;
        return false;
    }

    _syncTableResizeHandleVisibility(table) {
        if (!table?._tableId) return;
        const show = this._tableHasVisibleStroke(table) || this._isTableInteractionFocused(table);
        this._getTableResizeHandles(table._tableId).forEach((handle) => {
            handle.set({
                fill: show ? 'rgba(14, 116, 144, 0.08)' : 'transparent',
                opacity: show ? 1 : 0,
                evented: show && !handle._isTableBoundaryGuide,
            });
        });
    }

    _syncAllTableResizeHandleVisibility() {
        if (!this.canvas) return;
        this.canvas.getObjects()
            .filter((obj) => obj._elementType === 'table')
            .forEach((table) => this._syncTableResizeHandleVisibility(table));
    }

    _canvasPointToTableLocal(table, point) {
        const topLeft = typeof table.getPointByOrigin === 'function'
            ? table.getPointByOrigin('left', 'top')
            : { x: table.left || 0, y: table.top || 0 };
        const angle = -((table.angle || 0) * Math.PI / 180);
        const dx = point.x - topLeft.x;
        const dy = point.y - topLeft.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: (dx * cos - dy * sin) / (table.scaleX || 1),
            y: (dx * sin + dy * cos) / (table.scaleY || 1),
        };
    }

    _findTableCellAtPoint(point) {
        if (!this.canvas) return null;
        const tables = this.canvas.getObjects()
            .filter((obj) => obj._elementType === 'table')
            .reverse();
        for (const table of tables) {
            table.setCoords();
            const local = this._canvasPointToTableLocal(table, point);
            const colWidths = table._tableColWidths || this._normalizeTableSizes(null, table._tableCols || 1, table._tableWidth || table.width || 1, 40);
            const rowHeights = table._tableRowHeights || this._normalizeTableSizes(null, table._tableRows || 1, table._tableHeight || table.height || 1, 28);
            const width = this._sumTableSizes(colWidths);
            const height = this._sumTableSizes(rowHeights);
            if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) {
                continue;
            }
            const col = this._findTableSizeIndex(colWidths, local.x);
            const row = this._findTableSizeIndex(rowHeights, local.y);
            return { table, row, col };
        }
        return null;
    }

    _getTableCellRect(table, row, col) {
        const cols = table._tableCols || 1;
        const rows = table._tableRows || 1;
        const colWidths = table._tableColWidths || this._normalizeTableSizes(null, cols, table._tableWidth || table.width || 1, 40);
        const rowHeights = table._tableRowHeights || this._normalizeTableSizes(null, rows, table._tableHeight || table.height || 1, 28);
        const cellW = colWidths[col] || 40;
        const cellH = rowHeights[row] || 28;
        const topLeft = typeof table.getPointByOrigin === 'function'
            ? table.getPointByOrigin('left', 'top')
            : { x: table.left || 0, y: table.top || 0 };
        const scaleX = table.scaleX || 1;
        const scaleY = table.scaleY || 1;
        const left = topLeft.x + this._tableOffsetForIndex(colWidths, col) * scaleX;
        const top = topLeft.y + this._tableOffsetForIndex(rowHeights, row) * scaleY;
        return {
            left,
            top,
            width: cellW * scaleX,
            height: cellH * scaleY,
            angle: table.angle || 0,
        };
    }

    _makeTableCellClipPath(bounds) {
        return new fabric.Rect({
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            absolutePositioned: true,
        });
    }

    _getTableCellInnerBounds(table, row, col, pad = 4) {
        const bounds = this._getTableCellRect(table, row, col);
        return {
            left: bounds.left + pad,
            top: bounds.top + pad,
            width: Math.max(4, bounds.width - pad * 2),
            height: Math.max(4, bounds.height - pad * 2),
            angle: bounds.angle || 0,
        };
    }

    _createTableCellTextbox(table, row, col, cellData, bounds) {
        const pad = 4;
        const normalized = this._normalizeTableCellData(cellData);
        const fontSize = normalized.fontSize
            || Math.max(10, Math.min(16, bounds.height * 0.28));
        const inner = this._getTableCellInnerBounds(table, row, col, pad);
        const textbox = new fabric.Textbox(normalized.text || '', {
            left: inner.left,
            top: inner.top,
            width: Math.max(24, inner.width),
            height: inner.height,
            fontSize,
            fontFamily: normalized.fontFamily || 'Helvetica',
            fill: normalized.fill || '#000000',
            textAlign: normalized.textAlign || 'left',
            lineHeight: 1.15,
            editable: true,
            originX: 'left',
            originY: 'top',
            angle: bounds.angle || 0,
            _elementType: 'text',
            _isTableCellText: true,
            _tableId: table._tableId,
            _cellRow: row,
            _cellCol: col,
            hasControls: true,
            lockRotation: true,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: false,
            lockScalingY: false,
            lockScalingFlip: true,
            splitByGrapheme: true,
        });
        textbox._lastValidTableText = textbox.text || '';
        textbox.clipPath = this._makeTableCellClipPath(bounds);
        this.applyTextboxWrapResize(textbox);
        return textbox;
    }

    _createTableCellImageObject(table, row, col, dataUrl, bounds) {
        return new Promise((resolve) => {
            fabric.Image.fromURL(dataUrl, (img) => {
                const pad = 4;
                const maxW = Math.max(12, bounds.width - pad * 2);
                const maxH = Math.max(12, bounds.height - pad * 2);
                const scale = Math.min(maxW / img.width, maxH / img.height, 1);
                const drawW = img.width * scale;
                const drawH = img.height * scale;
                img.set({
                    left: bounds.left + pad + (maxW - drawW) / 2,
                    top: bounds.top + pad + (maxH - drawH) / 2,
                    scaleX: scale,
                    scaleY: scale,
                    angle: bounds.angle || 0,
                    originX: 'left',
                    originY: 'top',
                    _elementType: 'image',
                    _isTableCellImage: true,
                    _tableId: table._tableId,
                    _cellRow: row,
                    _cellCol: col,
                    lockRotation: true,
                    lockScalingX: true,
                    lockScalingY: true,
                    lockScalingFlip: true,
                });
                img.clipPath = this._makeTableCellClipPath(bounds);
                img.setCoords();
                resolve(img);
            });
        });
    }

    _layoutTableCellObject(table, obj) {
        const row = obj._cellRow;
        const col = obj._cellCol;
        if (row == null || col == null) return;
        const bounds = this._getTableCellRect(table, row, col);
        const pad = 4;

        if (obj._isTableCellText) {
            const inner = this._getTableCellInnerBounds(table, row, col, pad);
            obj.set({
                left: inner.left,
                top: inner.top,
                width: Math.max(24, inner.width),
                height: inner.height,
                angle: bounds.angle || 0,
                scaleX: 1,
                scaleY: 1,
            });
            this.applyTextboxWrapResize(obj);
            this._enforceTableCellTextBounds(obj, { allowRevert: false });
        } else if (obj._isTableCellImage) {
            const maxW = Math.max(12, bounds.width - pad * 2);
            const maxH = Math.max(12, bounds.height - pad * 2);
            const baseW = obj.width || 1;
            const baseH = obj.height || 1;
            const scale = Math.min(maxW / baseW, maxH / baseH, obj.scaleX || 1);
            const drawW = baseW * scale;
            const drawH = baseH * scale;
            obj.set({
                left: bounds.left + pad + (maxW - drawW) / 2,
                top: bounds.top + pad + (maxH - drawH) / 2,
                scaleX: scale,
                scaleY: scale,
                angle: bounds.angle || 0,
            });
        } else if (obj._isTableCellContent) {
            obj.set({ angle: (obj.angle || 0) });
        }

        if (obj.clipPath) {
            obj.clipPath.set({
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
            });
        }
        obj.setCoords();
    }

    _measureTableCellTextHeight(obj) {
        if (!obj) return 0;
        if (typeof obj.initDimensions === 'function') {
            obj.initDimensions();
        }
        if (typeof obj.calcTextHeight === 'function') {
            return obj.calcTextHeight();
        }
        return (obj.height || 0) * (obj.scaleY || 1);
    }

    _resizeTableRow(table, row, nextHeight) {
        if (!table || row == null) return;
        const active = this.getActiveObject();
        const shouldRefocus = active?._isTableCellText && active._tableId === table._tableId;
        const focusRow = active?._cellRow;
        const focusCol = active?._cellCol;
        const wasEditing = !!active?.isEditing;
        const cursor = active?.selectionStart ?? active?.text?.length ?? 0;
        const rows = table._tableRows || 1;
        const current = table._tableRowHeights || this._normalizeTableSizes(null, rows, table._tableHeight || table.height || 1, 28);
        const minHeight = 20;
        const rowHeights = [...current];
        rowHeights[row] = Math.max(minHeight, nextHeight);
        const frame = this.rebuildTable(table, { rowHeights });
        if (frame && shouldRefocus) {
            this._focusTableCell(frame, focusRow, focusCol, wasEditing);
            const focused = this.getActiveObject();
            if (focused?._isTableCellText) {
                const nextCursor = Math.min(cursor, focused.text?.length ?? 0);
                focused.selectionStart = nextCursor;
                focused.selectionEnd = nextCursor;
            }
        }
    }

    _resizeTableColumn(table, col, nextWidth) {
        if (!table || col == null) return;
        const active = this.getActiveObject();
        const shouldRefocus = active?._isTableCellText && active._tableId === table._tableId;
        const focusRow = active?._cellRow;
        const focusCol = active?._cellCol;
        const wasEditing = !!active?.isEditing;
        const cursor = active?.selectionStart ?? active?.text?.length ?? 0;
        const cols = table._tableCols || 1;
        const current = table._tableColWidths || this._normalizeTableSizes(null, cols, table._tableWidth || table.width || 1, 40);
        const minWidth = 30;
        const colWidths = [...current];
        colWidths[col] = Math.max(minWidth, nextWidth);
        const frame = this.rebuildTable(table, { colWidths });
        if (frame && shouldRefocus) {
            this._focusTableCell(frame, focusRow, focusCol, wasEditing);
            const focused = this.getActiveObject();
            if (focused?._isTableCellText) {
                const nextCursor = Math.min(cursor, focused.text?.length ?? 0);
                focused.selectionStart = nextCursor;
                focused.selectionEnd = nextCursor;
            }
        }
    }

    _resizeTableCellFromTextObject(obj) {
        if (!obj?._isTableCellText) return;
        const table = this._getTableFrame(obj._tableId);
        if (!table) return;
        const row = obj._cellRow;
        const col = obj._cellCol;
        if (row == null || col == null) return;

        const inner = this._getTableCellInnerBounds(table, row, col);
        const pad = 8;
        const nextWidth = Math.max(inner.width, (obj.width || inner.width) * Math.abs(obj.scaleX || 1)) + pad;
        const nextHeight = Math.max(inner.height, (obj.height || inner.height) * Math.abs(obj.scaleY || 1)) + pad;
        const rowHeights = [...(table._tableRowHeights || this._normalizeTableSizes(null, table._tableRows || 1, table._tableHeight || table.height || 1, 28))];
        const colWidths = [...(table._tableColWidths || this._normalizeTableSizes(null, table._tableCols || 1, table._tableWidth || table.width || 1, 40))];
        colWidths[col] = Math.max(30, nextWidth);
        rowHeights[row] = Math.max(20, nextHeight);
        const frame = this.rebuildTable(table, { rowHeights, colWidths });
        if (frame) {
            this._focusTableCell(frame, row, col, false);
        }
    }

    _enforceTableCellTextBounds(obj, options = {}) {
        if (!obj?._isTableCellText) return true;
        const table = this._getTableFrame(obj._tableId);
        if (!table) return true;

        const row = obj._cellRow;
        const col = obj._cellCol;
        if (row == null || col == null) return true;

        const inner = this._getTableCellInnerBounds(table, row, col);
        const maxWidth = Math.max(24, inner.width);
        const maxHeight = Math.max(4, inner.height);

        obj.set({
            left: inner.left,
            top: inner.top,
            width: maxWidth,
            scaleX: 1,
            scaleY: 1,
            splitByGrapheme: true,
        });

        const fits = () => this._measureTableCellTextHeight(obj) <= maxHeight + 0.5;

        if (!fits()) {
            const neededHeight = this._measureTableCellTextHeight(obj) + 8;
            this._resizeTableRow(table, row, neededHeight);
            return true;
        }

        obj.set({
            height: maxHeight,
            left: inner.left,
            top: inner.top,
            width: maxWidth,
            scaleX: 1,
            scaleY: 1,
        });
        obj._lastValidTableText = obj.text || '';
        obj.setCoords();
        this.canvas?.requestRenderAll();
        return true;
    }

    _fitObjectInsideTableCell(obj, table, row, col) {
        if (!obj || !table) return;
        const inner = this._getTableCellInnerBounds(table, row, col);
        obj.setCoords();
        const rect = obj.getBoundingRect(true, true);
        if (!rect.width || !rect.height) return;

        const scale = Math.min(
            inner.width / rect.width,
            inner.height / rect.height,
            1
        );
        if (scale < 1) {
            obj.set({
                scaleX: (obj.scaleX || 1) * scale,
                scaleY: (obj.scaleY || 1) * scale,
            });
            obj.setCoords();
        }

        const fitted = obj.getBoundingRect(true, true);
        obj.set({
            left: (obj.left || 0) + (inner.left + (inner.width - fitted.width) / 2 - fitted.left),
            top: (obj.top || 0) + (inner.top + (inner.height - fitted.height) / 2 - fitted.top),
        });
        obj.setCoords();
    }

    _constrainObjectToTableCell(obj) {
        if (!obj?._tableId || obj._elementType === 'table') return;
        const table = this._getTableFrame(obj._tableId);
        if (!table) return;
        const row = obj._cellRow;
        const col = obj._cellCol;
        if (row == null || col == null) return;

        if (obj._isTableCellText) {
            this._layoutTableCellObject(table, obj);
            return;
        }

        const inner = this._getTableCellInnerBounds(table, row, col);
        obj.setCoords();
        const rect = obj.getBoundingRect(true, true);
        let dx = 0;
        let dy = 0;

        if (rect.width <= inner.width) {
            if (rect.left < inner.left) dx = inner.left - rect.left;
            if (rect.left + rect.width > inner.left + inner.width) {
                dx = inner.left + inner.width - (rect.left + rect.width);
            }
        } else {
            dx = inner.left + (inner.width - rect.width) / 2 - rect.left;
        }

        if (rect.height <= inner.height) {
            if (rect.top < inner.top) dy = inner.top - rect.top;
            if (rect.top + rect.height > inner.top + inner.height) {
                dy = inner.top + inner.height - (rect.top + rect.height);
            }
        } else {
            dy = inner.top + (inner.height - rect.height) / 2 - rect.top;
        }

        if (dx || dy) {
            obj.set({
                left: (obj.left || 0) + dx,
                top: (obj.top || 0) + dy,
            });
        }
        if (obj.clipPath) {
            const bounds = this._getTableCellRect(table, row, col);
            obj.clipPath.set({
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
            });
        }
        obj.setCoords();
    }

    _layoutTableCells(table) {
        if (!table?._tableId) return;
        this._getTableMembers(table._tableId).forEach((obj) => {
            if (obj === table || obj._isTableResizeHandle) return;
            this._layoutTableCellObject(table, obj);
        });
        this._layoutTableResizeHandles(table);
        this._applyTableLayering(table);
        this.canvas?.requestRenderAll();
    }

    _applyTableLayering(table) {
        if (!table?._tableId || !this.canvas) return;
        const members = this._getTableMembers(table._tableId);
        const cellTexts = members.filter((obj) => obj._isTableCellText);
        const handles = members.filter((obj) => obj._isTableResizeHandle);
        const cellContent = members.filter((obj) => (
            obj !== table && !obj._isTableCellText && !obj._isTableResizeHandle
        ));

        this.canvas.sendToBack(table);
        if ((table._tableTextLayer || 'above') === 'below') {
            cellTexts.forEach((obj) => this.canvas.bringToFront(obj));
            cellContent.forEach((obj) => this.canvas.bringToFront(obj));
        } else {
            cellContent.forEach((obj) => this.canvas.bringToFront(obj));
            cellTexts.forEach((obj) => this.canvas.bringToFront(obj));
        }
        handles.forEach((obj) => this.canvas.bringToFront(obj));
    }

    _createTableResizeHandle(table, type, index) {
        const isCol = type === 'col';
        const isBoundaryGuide = index < 0;
        const handle = new fabric.Rect({
            left: table.left || 0,
            top: table.top || 0,
            width: isCol ? 8 : (table._tableWidth || table.width || 1),
            height: isCol ? (table._tableHeight || table.height || 1) : 8,
            fill: 'rgba(14, 116, 144, 0.08)',
            stroke: 'rgba(14, 116, 144, 0)',
            strokeWidth: 0,
            selectable: !isBoundaryGuide,
            evented: !isBoundaryGuide,
            hasControls: false,
            hasBorders: false,
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
            lockMovementX: isBoundaryGuide || !isCol,
            lockMovementY: isBoundaryGuide || isCol,
            hoverCursor: isCol ? 'col-resize' : 'row-resize',
            moveCursor: isCol ? 'col-resize' : 'row-resize',
            _tableId: table._tableId,
            _isTableResizeHandle: true,
            _isTableBoundaryGuide: isBoundaryGuide,
            _resizeHandleType: type,
            _resizeHandleIndex: index,
        });
        return handle;
    }

    _ensureTableResizeHandles(table) {
        if (!this.canvas || !table?._tableId) return;
        const existing = this._getTableResizeHandles(table._tableId);
        const expected = new Set();
        const needsBoundaryGuides = !this._tableHasVisibleStroke(table);

        if (needsBoundaryGuides) {
            expected.add('col:-1');
            expected.add('row:-1');
            if (!existing.some((obj) => obj._resizeHandleType === 'col' && obj._resizeHandleIndex === -1)) {
                this.canvas.add(this._createTableResizeHandle(table, 'col', -1));
            }
            if (!existing.some((obj) => obj._resizeHandleType === 'row' && obj._resizeHandleIndex === -1)) {
                this.canvas.add(this._createTableResizeHandle(table, 'row', -1));
            }
        }

        for (let col = 0; col < (table._tableCols || 1); col += 1) {
            expected.add(`col:${col}`);
            if (!existing.some((obj) => obj._resizeHandleType === 'col' && obj._resizeHandleIndex === col)) {
                this.canvas.add(this._createTableResizeHandle(table, 'col', col));
            }
        }
        for (let row = 0; row < (table._tableRows || 1); row += 1) {
            expected.add(`row:${row}`);
            if (!existing.some((obj) => obj._resizeHandleType === 'row' && obj._resizeHandleIndex === row)) {
                this.canvas.add(this._createTableResizeHandle(table, 'row', row));
            }
        }

        existing.forEach((obj) => {
            const key = `${obj._resizeHandleType}:${obj._resizeHandleIndex}`;
            if (!expected.has(key)) {
                this.canvas.remove(obj);
            }
        });
    }

    _layoutTableResizeHandles(table) {
        if (!this.canvas || !table?._tableId) return;
        this._ensureTableResizeHandles(table);
        const topLeft = typeof table.getPointByOrigin === 'function'
            ? table.getPointByOrigin('left', 'top')
            : { x: table.left || 0, y: table.top || 0 };
        const scaleX = table.scaleX || 1;
        const scaleY = table.scaleY || 1;
        const colWidths = table._tableColWidths || this._normalizeTableSizes(null, table._tableCols || 1, table._tableWidth || table.width || 1, 40);
        const rowHeights = table._tableRowHeights || this._normalizeTableSizes(null, table._tableRows || 1, table._tableHeight || table.height || 1, 28);
        const tableWidth = this._sumTableSizes(colWidths) * scaleX;
        const tableHeight = this._sumTableSizes(rowHeights) * scaleY;
        const handleSize = 8;

        this._getTableResizeHandles(table._tableId).forEach((handle) => {
            if (handle._resizeHandleType === 'col') {
                const x = topLeft.x + this._tableOffsetForIndex(colWidths, handle._resizeHandleIndex + 1) * scaleX;
                handle.set({
                    left: x - handleSize / 2,
                    top: topLeft.y,
                    width: handleSize,
                    height: tableHeight,
                    lockMovementY: true,
                    lockMovementX: false,
                });
            } else {
                const y = topLeft.y + this._tableOffsetForIndex(rowHeights, handle._resizeHandleIndex + 1) * scaleY;
                handle.set({
                    left: topLeft.x,
                    top: y - handleSize / 2,
                    width: tableWidth,
                    height: handleSize,
                    lockMovementX: true,
                    lockMovementY: false,
                });
            }
            handle.setCoords();
        });
        this._syncTableResizeHandleVisibility(table);
    }

    _constrainTableResizeHandle(handle) {
        if (!handle?._isTableResizeHandle) return;
        const table = this._getTableFrame(handle._tableId);
        if (!table) return;
        const topLeft = typeof table.getPointByOrigin === 'function'
            ? table.getPointByOrigin('left', 'top')
            : { x: table.left || 0, y: table.top || 0 };
        const colWidths = table._tableColWidths || this._normalizeTableSizes(null, table._tableCols || 1, table._tableWidth || table.width || 1, 40);
        const rowHeights = table._tableRowHeights || this._normalizeTableSizes(null, table._tableRows || 1, table._tableHeight || table.height || 1, 28);
        const minCol = 30 * (table.scaleX || 1);
        const minRow = 20 * (table.scaleY || 1);
        const handleSize = 8;

        if (handle._resizeHandleType === 'col') {
            const idx = handle._resizeHandleIndex;
            const minX = topLeft.x + this._tableOffsetForIndex(colWidths, idx) * (table.scaleX || 1) + minCol;
            const maxX = idx < colWidths.length - 1
                ? topLeft.x + this._tableOffsetForIndex(colWidths, idx + 2) * (table.scaleX || 1) - minCol
                : Infinity;
            const centerX = Math.max(minX, Math.min((handle.left || 0) + handleSize / 2, maxX));
            handle.set({
                left: centerX - handleSize / 2,
                top: topLeft.y,
            });
        } else {
            const idx = handle._resizeHandleIndex;
            const minY = topLeft.y + this._tableOffsetForIndex(rowHeights, idx) * (table.scaleY || 1) + minRow;
            const maxY = idx < rowHeights.length - 1
                ? topLeft.y + this._tableOffsetForIndex(rowHeights, idx + 2) * (table.scaleY || 1) - minRow
                : Infinity;
            const centerY = Math.max(minY, Math.min((handle.top || 0) + handleSize / 2, maxY));
            handle.set({
                left: topLeft.x,
                top: centerY - handleSize / 2,
            });
        }
        handle.setCoords();
    }

    _applyTableResizeHandle(handle) {
        if (!handle?._isTableResizeHandle) return;
        const table = this._getTableFrame(handle._tableId);
        if (!table) return;
        const topLeft = typeof table.getPointByOrigin === 'function'
            ? table.getPointByOrigin('left', 'top')
            : { x: table.left || 0, y: table.top || 0 };
        const minCol = 30;
        const minRow = 20;
        const colWidths = [...(table._tableColWidths || this._normalizeTableSizes(null, table._tableCols || 1, table._tableWidth || table.width || 1, 40))];
        const rowHeights = [...(table._tableRowHeights || this._normalizeTableSizes(null, table._tableRows || 1, table._tableHeight || table.height || 1, 28))];
        const idx = handle._resizeHandleIndex;

        if (handle._resizeHandleType === 'col') {
            const centerX = ((handle.left || 0) + (handle.width || 0) / 2 - topLeft.x) / (table.scaleX || 1);
            const start = this._tableOffsetForIndex(colWidths, idx);
            const oldEnd = this._tableOffsetForIndex(colWidths, idx + 1);
            const delta = centerX - oldEnd;
            if (idx < colWidths.length - 1) {
                const next = colWidths[idx + 1];
                const applied = Math.max(minCol - colWidths[idx], Math.min(delta, next - minCol));
                colWidths[idx] += applied;
                colWidths[idx + 1] -= applied;
            } else {
                colWidths[idx] = Math.max(minCol, centerX - start);
            }
            this.rebuildTable(table, { colWidths });
        } else {
            const centerY = ((handle.top || 0) + (handle.height || 0) / 2 - topLeft.y) / (table.scaleY || 1);
            const start = this._tableOffsetForIndex(rowHeights, idx);
            const oldEnd = this._tableOffsetForIndex(rowHeights, idx + 1);
            const delta = centerY - oldEnd;
            if (idx < rowHeights.length - 1) {
                const next = rowHeights[idx + 1];
                const applied = Math.max(minRow - rowHeights[idx], Math.min(delta, next - minRow));
                rowHeights[idx] += applied;
                rowHeights[idx + 1] -= applied;
            } else {
                rowHeights[idx] = Math.max(minRow, centerY - start);
            }
            this.rebuildTable(table, { rowHeights });
        }
    }

    setTableTextLayer(table, layer) {
        if (!table || table._elementType !== 'table') return null;
        table._tableTextLayer = layer === 'below' ? 'below' : 'above';
        this._applyTableLayering(table);
        this.canvas?.requestRenderAll();
        if (this.onCanvasModified) this.onCanvasModified();
        return table;
    }

    _onTableFrameMoving(e) {
        const table = e.target;
        if (!table || table._elementType !== 'table' || !table._tableId) return;
        const lastLeft = table._moveLastLeft ?? table.left;
        const lastTop = table._moveLastTop ?? table.top;
        const dx = table.left - lastLeft;
        const dy = table.top - lastTop;
        if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

        this._getTableMembers(table._tableId).forEach((obj) => {
            if (obj === table) return;
            obj.set({
                left: (obj.left || 0) + dx,
                top: (obj.top || 0) + dy,
            });
            if (obj.clipPath) {
                obj.clipPath.set({
                    left: (obj.clipPath.left || 0) + dx,
                    top: (obj.clipPath.top || 0) + dy,
                });
            }
            obj.setCoords();
        });
        table._moveLastLeft = table.left;
        table._moveLastTop = table.top;
        this.canvas.requestRenderAll();
    }

    _serializeTableCells(table) {
        const rows = table._tableRows || 3;
        const cols = table._tableCols || 3;
        const cells = Array.from({ length: rows }, () => (
            Array.from({ length: cols }, () => ({ text: '', image: null }))
        ));
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const textbox = this._getTableCellTextbox(table._tableId, row, col);
                const image = this._getTableCellImage(table._tableId, row, col);
                const cell = { text: textbox?.text || '', image: null };
                if (textbox) {
                    cell.fontSize = textbox.fontSize;
                    cell.fontFamily = textbox.fontFamily;
                    cell.fill = typeof textbox.fill === 'string' ? textbox.fill : '#000000';
                    cell.textAlign = textbox.textAlign || 'left';
                }
                if (image) {
                    try {
                        cell.image = image.toDataURL({ format: 'png' });
                    } catch (err) {
                        cell.image = null;
                    }
                }
                cells[row][col] = cell;
            }
        }
        return cells;
    }

    _removeTableMembers(tableId, removeFrame = true) {
        if (!this.canvas || !tableId) return;
        this.canvas.getObjects().slice().forEach((obj) => {
            if (obj._tableId !== tableId) return;
            if (!removeFrame && obj._elementType === 'table') return;
            this.canvas.remove(obj);
        });
        this.canvas.discardActiveObject();
        this.canvas.requestRenderAll();
    }

    _focusTableCell(table, row, col, enterEdit = false) {
        this._clearActiveTableCells(table);
        table._activeCell = { row, col };
        let textbox = this._getTableCellTextbox(table._tableId, row, col);
        if (!textbox) {
            const bounds = this._getTableCellRect(table, row, col);
            textbox = this._createTableCellTextbox(table, row, col, '', bounds);
            this.canvas.add(textbox);
            this._registerCanvasObject(textbox);
        }
        this.canvas.setActiveObject(textbox);
        if (enterEdit) {
            textbox.enterEditing();
            if (!textbox.text || textbox.text === 'Type here') {
                textbox.selectAll();
            } else {
                textbox.selectionStart = textbox.text.length;
                textbox.selectionEnd = textbox.text.length;
            }
        }
        this.canvas.requestRenderAll();
        if (this.onObjectSelected) this.onObjectSelected([textbox]);
    }

    _clearActiveTableCells(exceptTable = null) {
        if (!this.canvas) return;
        this.canvas.getObjects().forEach((obj) => {
            if (obj._elementType === 'table' && obj !== exceptTable) {
                obj._activeCell = null;
            }
        });
    }

    getTableCellTargetFromSelection() {
        const active = this.getActiveObject();
        if (!active) {
            const activeTable = this.canvas?.getObjects()
                .slice()
                .reverse()
                .find((obj) => obj._elementType === 'table' && obj._activeCell);
            if (activeTable) {
                return {
                    table: activeTable,
                    row: activeTable._activeCell.row,
                    col: activeTable._activeCell.col,
                };
            }
            return null;
        }
        if (active._isTableCellText || active._isTableCellImage) {
            const table = this._getTableFrame(active._tableId);
            if (table) {
                return { table, row: active._cellRow, col: active._cellCol };
            }
        }
        if (active._elementType === 'table' && active._activeCell) {
            return {
                table: active,
                row: active._activeCell.row,
                col: active._activeCell.col,
            };
        }
        const activeTable = this.canvas?.getObjects()
            .slice()
            .reverse()
            .find((obj) => obj._elementType === 'table' && obj._activeCell);
        if (activeTable) {
            return {
                table: activeTable,
                row: activeTable._activeCell.row,
                col: activeTable._activeCell.col,
            };
        }
        return null;
    }

    _tryAttachObjectToTableCell(obj) {
        if (!obj || obj._elementType === 'table' || obj._isTableCellText || obj._isTableCellImage) {
            return;
        }
        if (obj._tableId && obj._isTableCellContent) {
            return;
        }
        const center = obj.getCenterPoint();
        const hit = this._findTableCellAtPoint(center);
        if (!hit) return;

        this._attachObjectToTableCell(obj, hit, { fit: false });
    }

    _attachObjectToTableCellIfHit(obj, point = null, options = {}) {
        if (!obj || obj._elementType === 'table' || obj._isTableCellText || obj._isTableCellImage) {
            return null;
        }
        const hitPoint = point || obj.getCenterPoint();
        const hit = this._findTableCellAtPoint(hitPoint);
        if (!hit) return null;
        this._attachObjectToTableCell(obj, hit, options);
        return hit;
    }

    _attachObjectToTableCell(obj, hit, options = {}) {
        if (!obj || !hit?.table) return;
        obj.set({
            _tableId: hit.table._tableId,
            _cellRow: hit.row,
            _cellCol: hit.col,
            _isTableCellContent: true,
        });
        const bounds = this._getTableCellRect(hit.table, hit.row, hit.col);
        obj.clipPath = this._makeTableCellClipPath(bounds);
        if (options.fit) {
            this._fitObjectInsideTableCell(obj, hit.table, hit.row, hit.col);
        } else {
            this._constrainObjectToTableCell(obj);
        }
        obj.setCoords();
        this._applyTableLayering(hit.table);
        if (this.onCanvasModified) this.onCanvasModified();
    }

    _buildTableParts(width, height, rows, cols, options = {}) {
        const fill = options.fill ?? this.tableDefaults.fill ?? '#ffffff';
        const stroke = options.stroke ?? this.tableDefaults.stroke ?? '#333333';
        const storedStrokeWidth = options.strokeWidth ?? this.tableDefaults.strokeWidth ?? 1;
        const renderStrokeWidth = this._normalizeTableRenderStrokeWidth(storedStrokeWidth);
        const hasStroke = stroke !== 'transparent' && renderStrokeWidth > 0;
        const lineStyle = ['dashed', 'dotted'].includes(options.lineStyle)
            ? options.lineStyle
            : (this.tableDefaults.lineStyle || 'solid');
        const strokeDashArray = hasStroke ? this.getDashArrayForStyle(lineStyle, renderStrokeWidth) : null;
        const inset = hasStroke ? renderStrokeWidth / 2 : 0;
        const colWidths = this._scaleTableSizesToTotal(
            this._normalizeTableSizes(options.colWidths, cols, width, 30),
            width,
            30
        );
        const rowHeights = this._scaleTableSizesToTotal(
            this._normalizeTableSizes(options.rowHeights, rows, height, 20),
            height,
            20
        );
        const tableWidth = this._sumTableSizes(colWidths);
        const tableHeight = this._sumTableSizes(rowHeights);
        const objects = [];

        objects.push(new fabric.Rect({
            left: inset,
            top: inset,
            width: Math.max(1, tableWidth - inset * 2),
            height: Math.max(1, tableHeight - inset * 2),
            fill: fill === 'transparent' ? 'transparent' : fill,
            stroke: hasStroke ? stroke : 'transparent',
            strokeWidth: hasStroke ? renderStrokeWidth : 0,
            strokeDashArray,
            strokeUniform: true,
            selectable: false,
            evented: false,
        }));

        if (hasStroke) {
            const lineOpts = {
                stroke,
                strokeWidth: renderStrokeWidth,
                strokeDashArray,
                strokeUniform: true,
                selectable: false,
                evented: false,
            };
            let y = 0;
            for (let r = 1; r < rows; r += 1) {
                y += rowHeights[r - 1];
                objects.push(new fabric.Line(
                    [inset, y, tableWidth - inset, y],
                    lineOpts
                ));
            }

            let x = 0;
            for (let c = 1; c < cols; c += 1) {
                x += colWidths[c - 1];
                objects.push(new fabric.Line(
                    [x, inset, x, tableHeight - inset],
                    lineOpts
                ));
            }
        }

        return {
            objects,
            fill,
            stroke,
            strokeWidth: storedStrokeWidth,
            lineStyle,
            rowHeights,
            colWidths,
            tableWidth,
            tableHeight,
        };
    }

    _createTablePreview(x, y) {
        const stroke = this.tableDefaults.stroke || '#333333';
        const rect = new fabric.Rect({
            left: x,
            top: y,
            width: 0,
            height: 0,
            fill: 'rgba(79, 152, 163, 0.2)',
            stroke,
            strokeWidth: this.tableDefaults.strokeWidth ?? 1,
            strokeUniform: true,
            strokeDashArray: [4, 4],
            selectable: false,
            evented: false,
        });
        this.canvas.add(rect);
        return rect;
    }

    _createTable(left, top, width, height, options = {}) {
        const rows = Math.max(1, Math.min(20, parseInt(options.rows ?? this.tableDefaults.rows ?? 3, 10) || 3));
        const cols = Math.max(1, Math.min(20, parseInt(options.cols ?? this.tableDefaults.cols ?? 3, 10) || 3));
        const margins = this.getPageContentMargins();
        const maxW = margins.right - margins.left;
        const maxH = margins.bottom - margins.top;
        const minW = Math.min(Math.max(width, cols * 30), maxW);
        const minH = Math.min(Math.max(height, rows * 20), maxH);
        const fitted = this._fitTableLayout(left, top,
            this._scaleTableSizesToTotal(
                this._normalizeTableSizes(options.colWidths, cols, minW, 30),
                minW,
                30
            ),
            this._scaleTableSizesToTotal(
                this._normalizeTableSizes(options.rowHeights, rows, minH, 20),
                minH,
                20
            )
        );
        const cells = this._normalizeTableCells(options.cells, rows, cols);
        const tableId = options.tableId || this._generateTableId();
        const { objects, fill, stroke, strokeWidth, lineStyle, rowHeights, colWidths, tableWidth, tableHeight } = this._buildTableParts(
            fitted.width,
            fitted.height,
            rows,
            cols,
            {
                ...options,
                colWidths: fitted.colWidths,
                rowHeights: fitted.rowHeights,
            }
        );

        const frame = new fabric.Group(objects, {
            left: fitted.left,
            top: fitted.top,
            originX: 'left',
            originY: 'top',
            _elementType: 'table',
            _tableId: tableId,
            _tableRows: rows,
            _tableCols: cols,
            _tableFill: fill,
            _tableStroke: stroke,
            _tableStrokeWidth: strokeWidth,
            _tableLineStyle: lineStyle,
            _tableCells: cells,
            _tableWidth: tableWidth,
            _tableHeight: tableHeight,
            _tableRowHeights: rowHeights,
            _tableColWidths: colWidths,
            _tableTextLayer: options.textLayer === 'below' ? 'below' : 'above',
            subTargetCheck: false,
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
            lockUniScaling: true,
            hasControls: true,
            hasBorders: true,
        });
        frame.setCoords();

        const cellObjects = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const bounds = this._getTableCellRect(frame, row, col);
                cellObjects.push(this._createTableCellTextbox(frame, row, col, cells[row][col], bounds));
            }
        }

        return { frame, cellObjects, tableId, pendingImages: cells };
    }

    async _populateTableCellImages(frame, cells) {
        const rows = frame._tableRows || 3;
        const cols = frame._tableCols || 3;
        const imageLoads = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const imageSrc = cells?.[row]?.[col]?.image;
                if (!imageSrc) continue;
                const bounds = this._getTableCellRect(frame, row, col);
                imageLoads.push(
                    this._createTableCellImageObject(frame, row, col, imageSrc, bounds)
                        .then((img) => {
                            if (img) this.canvas.add(img);
                            return img;
                        })
                );
            }
        }
        if (imageLoads.length) {
            await Promise.all(imageLoads);
            this._applyTableLayering(frame);
            this.canvas.requestRenderAll();
        }
    }

    addTableToCanvas(left, top, width, height, options = {}) {
        const { frame, cellObjects } = this._createTable(left, top, width, height, options);
        this.canvas.add(frame);
        cellObjects.forEach((obj) => this.canvas.add(obj));
        this._populateTableCellImages(frame, options.cells || this._normalizeTableCells(null, frame._tableRows, frame._tableCols));
        this._registerCanvasObject(frame);
        cellObjects.forEach((obj) => this._registerCanvasObject(obj));
        this._layoutTableResizeHandles(frame);
        this._applyTableLayering(frame);
        frame.setCoords();
        this.canvas.requestRenderAll();
        if (this.onCanvasModified) this.onCanvasModified();
        return frame;
    }

    rebuildTable(group, configPatch = {}, options = {}) {
        if (!group || group._elementType !== 'table' || !this.canvas) {
            return null;
        }

        const left = group.left || 0;
        const top = group.top || 0;
        const angle = options.angle != null ? options.angle : (group.angle || 0);
        const opacity = options.opacity != null ? options.opacity : (group.opacity ?? 1);
        const width = group._tableWidth || group.width || 100;
        const height = group._tableHeight || group.height || 80;
        const current = this.getTableConfigFromGroup(group) || {};
        const cfg = {
            ...current,
            ...configPatch,
            cells: configPatch.cells || current.cells,
            tableId: group._tableId,
        };

        const nextRows = cfg.rows || group._tableRows || 3;
        const nextCols = cfg.cols || group._tableCols || 3;
        const fitted = this._fitTableLayout(
            left,
            top,
            this._scaleTableSizesToTotal(
                this._normalizeTableSizes(cfg.colWidths, nextCols, width, 30),
                width,
                30
            ),
            this._scaleTableSizesToTotal(
                this._normalizeTableSizes(cfg.rowHeights, nextRows, height, 20),
                height,
                20
            )
        );
        cfg.colWidths = fitted.colWidths;
        cfg.rowHeights = fitted.rowHeights;

        const wasActive = this.canvas.getActiveObject() === group;
        const index = this.canvas.getObjects().indexOf(group);

        this._removeTableMembers(group._tableId, true);
        const frame = this.addTableToCanvas(fitted.left, fitted.top, fitted.width, fitted.height, cfg);
        frame.set({ angle, opacity });
        frame.setCoords();
        this._layoutTableCells(frame);

        if (index >= 0) {
            this.canvas.moveTo(frame, index);
        }

        if (wasActive) {
            this.canvas.setActiveObject(frame);
        }
        this.canvas.requestRenderAll();
        if (this.onCanvasModified) this.onCanvasModified();
        return frame;
    }

    _rebuildTableStructural(table, configPatch, activeRow, activeCol, enterEdit = false) {
        const frame = this.rebuildTable(table, configPatch);
        if (frame && activeRow != null && activeCol != null) {
            this._focusTableCell(frame, activeRow, activeCol, enterEdit);
        }
        return frame;
    }

    _getTableSizeArrays(table, cfg) {
        const rows = cfg.rows || table._tableRows || 1;
        const cols = cfg.cols || table._tableCols || 1;
        const height = table._tableHeight || table.height || 80;
        const width = table._tableWidth || table.width || 100;
        return {
            rowHeights: [...(cfg.rowHeights || this._normalizeTableSizes(null, rows, height, 28))],
            colWidths: [...(cfg.colWidths || this._normalizeTableSizes(null, cols, width, 40))],
        };
    }

    insertTableRow(table, rowIndex, position = 'below') {
        if (!table || table._elementType !== 'table') return null;
        const cfg = this.getTableConfigFromGroup(table);
        if (!cfg || cfg.rows >= 20) return null;

        const rows = cfg.rows;
        const cols = cfg.cols;
        const insertAt = position === 'below' ? rowIndex + 1 : rowIndex;
        const { rowHeights } = this._getTableSizeArrays(table, cfg);
        const totalHeight = this._sumTableSizes(rowHeights);
        rowHeights.splice(insertAt, 0, totalHeight / (rows + 1));
        const nextRowHeights = this._scaleTableSizesToTotal(rowHeights, totalHeight, 20);

        const cells = cfg.cells.map((row) => row.map((cell) => ({ ...this._normalizeTableCellData(cell) })));
        cells.splice(insertAt, 0, Array.from({ length: cols }, () => ({ text: '', image: null })));

        const activeCol = table._activeCell?.col ?? 0;
        return this._rebuildTableStructural(table, {
            rows: rows + 1,
            cols,
            rowHeights: nextRowHeights,
            colWidths: cfg.colWidths,
            cells,
        }, insertAt, activeCol, true);
    }

    insertTableColumn(table, colIndex, position = 'right') {
        if (!table || table._elementType !== 'table') return null;
        const cfg = this.getTableConfigFromGroup(table);
        if (!cfg || cfg.cols >= 20) return null;

        const rows = cfg.rows;
        const cols = cfg.cols;
        const insertAt = position === 'right' ? colIndex + 1 : colIndex;
        const { colWidths } = this._getTableSizeArrays(table, cfg);
        const totalWidth = this._sumTableSizes(colWidths);
        colWidths.splice(insertAt, 0, totalWidth / (cols + 1));
        const nextColWidths = this._scaleTableSizesToTotal(colWidths, totalWidth, 30);

        const cells = cfg.cells.map((row) => {
            const next = row.map((cell) => ({ ...this._normalizeTableCellData(cell) }));
            next.splice(insertAt, 0, { text: '', image: null });
            return next;
        });

        const activeRow = table._activeCell?.row ?? 0;
        return this._rebuildTableStructural(table, {
            rows,
            cols: cols + 1,
            rowHeights: cfg.rowHeights,
            colWidths: nextColWidths,
            cells,
        }, activeRow, insertAt, true);
    }

    deleteTableRow(table, rowIndex) {
        if (!table || table._elementType !== 'table') return null;
        const cfg = this.getTableConfigFromGroup(table);
        if (!cfg || cfg.rows <= 1) return null;

        const { rowHeights } = this._getTableSizeArrays(table, cfg);
        const deletedHeight = rowHeights[rowIndex] || 28;
        rowHeights.splice(rowIndex, 1);
        if (rowIndex > 0) {
            rowHeights[rowIndex - 1] += deletedHeight;
        } else if (rowHeights.length) {
            rowHeights[0] += deletedHeight;
        }

        const cells = cfg.cells.map((row) => row.map((cell) => ({ ...this._normalizeTableCellData(cell) })));
        cells.splice(rowIndex, 1);

        let activeRow = table._activeCell?.row ?? rowIndex;
        let activeCol = table._activeCell?.col ?? 0;
        if (activeRow >= cells.length) activeRow = cells.length - 1;
        if (activeRow === rowIndex && activeRow > 0) activeRow -= 1;

        return this._rebuildTableStructural(table, {
            rows: cfg.rows - 1,
            cols: cfg.cols,
            rowHeights,
            colWidths: cfg.colWidths,
            cells,
        }, activeRow, activeCol, false);
    }

    deleteTableColumn(table, colIndex) {
        if (!table || table._elementType !== 'table') return null;
        const cfg = this.getTableConfigFromGroup(table);
        if (!cfg || cfg.cols <= 1) return null;

        const { colWidths } = this._getTableSizeArrays(table, cfg);
        const deletedWidth = colWidths[colIndex] || 40;
        colWidths.splice(colIndex, 1);
        if (colIndex > 0) {
            colWidths[colIndex - 1] += deletedWidth;
        } else if (colWidths.length) {
            colWidths[0] += deletedWidth;
        }

        const cells = cfg.cells.map((row) => {
            const next = row.map((cell) => ({ ...this._normalizeTableCellData(cell) }));
            next.splice(colIndex, 1);
            return next;
        });

        let activeRow = table._activeCell?.row ?? 0;
        let activeCol = table._activeCell?.col ?? colIndex;
        if (activeCol >= (cells[0]?.length || 1)) activeCol = (cells[0]?.length || 1) - 1;
        if (activeCol === colIndex && activeCol > 0) activeCol -= 1;

        return this._rebuildTableStructural(table, {
            rows: cfg.rows,
            cols: cfg.cols - 1,
            rowHeights: cfg.rowHeights,
            colWidths,
            cells,
        }, activeRow, activeCol, false);
    }

    distributeTableSizesEvenly(table) {
        if (!table || table._elementType !== 'table') return null;
        const cfg = this.getTableConfigFromGroup(table);
        if (!cfg) return null;

        const rows = cfg.rows;
        const cols = cfg.cols;
        const height = table._tableHeight || table.height || 80;
        const width = table._tableWidth || table.width || 100;
        const rowHeights = Array.from({ length: rows }, () => height / rows);
        const colWidths = Array.from({ length: cols }, () => width / cols);

        const activeRow = table._activeCell?.row ?? 0;
        const activeCol = table._activeCell?.col ?? 0;
        return this._rebuildTableStructural(table, { rowHeights, colWidths }, activeRow, activeCol, false);
    }

    addTableFromDetection(bbox, rowsData, options = {}) {
        if (!bbox || bbox.length < 4 || !this.canvas) return null;

        const left = bbox[0];
        const top = bbox[1];
        const width = Math.max(bbox[2] - bbox[0], 40);
        const height = Math.max(bbox[3] - bbox[1], 28);
        const sourceRows = Array.isArray(rowsData) ? rowsData : [];
        const rows = Math.max(1, Math.min(20, sourceRows.length || 1));
        const cols = Math.max(1, Math.min(20, sourceRows.reduce((max, row) => (
            Math.max(max, Array.isArray(row) ? row.length : 0)
        ), 1)));

        const rawCells = Array.from({ length: rows }, (_, rowIdx) => (
            Array.from({ length: cols }, (_, colIdx) => ({
                text: String(sourceRows[rowIdx]?.[colIdx] ?? ''),
                image: null,
            }))
        ));

        const table = this.addTableToCanvas(left, top, width, height, {
            rows,
            cols,
            cells: rawCells,
            fill: options.fill ?? this.tableDefaults.fill,
            stroke: options.stroke ?? this.tableDefaults.stroke,
            strokeWidth: options.strokeWidth ?? this.tableDefaults.strokeWidth,
            textLayer: options.textLayer ?? this.tableDefaults.textLayer,
        });
        this.canvas.setActiveObject(table);
        this.canvas.requestRenderAll();
        if (this.onObjectSelected) this.onObjectSelected([table]);
        return table;
    }

    _escapeCsvField(value) {
        const text = String(value ?? '');
        if (/[",\n\r]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    }

    exportTableCsv(table) {
        if (!table || table._elementType !== 'table') return '';
        const cells = this._serializeTableCells(table);
        return cells.map((row) => (
            row.map((cell) => this._escapeCsvField(cell.text || '')).join(',')
        )).join('\n');
    }

    _parseCsvRows(csvText) {
        const rows = [];
        let row = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < csvText.length; i += 1) {
            const ch = csvText[i];
            const next = csvText[i + 1];

            if (inQuotes) {
                if (ch === '"' && next === '"') {
                    field += '"';
                    i += 1;
                } else if (ch === '"') {
                    inQuotes = false;
                } else {
                    field += ch;
                }
                continue;
            }

            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                row.push(field);
                field = '';
            } else if (ch === '\n' || ch === '\r') {
                if (ch === '\r' && next === '\n') i += 1;
                row.push(field);
                if (row.some((cell) => cell.length > 0)) rows.push(row);
                row = [];
                field = '';
            } else {
                field += ch;
            }
        }

        row.push(field);
        if (row.some((cell) => cell.length > 0)) rows.push(row);
        return rows;
    }

    importTableFromCsv(csvText, left, top, options = {}) {
        if (!csvText || !this.canvas) return null;
        const parsed = this._parseCsvRows(csvText);
        if (!parsed.length) return null;

        const rows = Math.min(20, parsed.length);
        const cols = Math.min(20, parsed.reduce((max, row) => Math.max(max, row.length), 1));
        const cells = Array.from({ length: rows }, (_, rowIdx) => (
            Array.from({ length: cols }, (_, colIdx) => ({
                text: String(parsed[rowIdx]?.[colIdx] ?? ''),
                image: null,
            }))
        ));

        const placeLeft = Number.isFinite(left) ? left : (this.canvasWidth - cols * 80) / 2;
        const placeTop = Number.isFinite(top) ? top : (this.canvasHeight - rows * 28) / 2;
        const table = this.addTableToCanvas(
            placeLeft,
            placeTop,
            cols * 80,
            rows * 28,
            {
                rows,
                cols,
                cells,
                fill: options.fill ?? this.tableDefaults.fill,
                stroke: options.stroke ?? this.tableDefaults.stroke,
                strokeWidth: options.strokeWidth ?? this.tableDefaults.strokeWidth,
                textLayer: options.textLayer ?? this.tableDefaults.textLayer,
            }
        );
        this.canvas.setActiveObject(table);
        this.canvas.requestRenderAll();
        if (this.onObjectSelected) this.onObjectSelected([table]);
        return table;
    }

    _getTableCellNavigationTarget(table, row, col, key, shiftKey) {
        const rows = table._tableRows || 1;
        const cols = table._tableCols || 1;
        let nextRow = row;
        let nextCol = col;

        switch (key) {
            case 'Tab':
                if (shiftKey) {
                    nextCol -= 1;
                    if (nextCol < 0) {
                        nextCol = cols - 1;
                        nextRow -= 1;
                    }
                } else {
                    nextCol += 1;
                    if (nextCol >= cols) {
                        nextCol = 0;
                        nextRow += 1;
                    }
                }
                break;
            case 'Enter':
                nextRow += 1;
                break;
            case 'ArrowLeft':
                nextCol -= 1;
                break;
            case 'ArrowRight':
                nextCol += 1;
                break;
            case 'ArrowUp':
                nextRow -= 1;
                break;
            case 'ArrowDown':
                nextRow += 1;
                break;
            default:
                return null;
        }

        if (nextRow < 0 || nextRow >= rows || nextCol < 0 || nextCol >= cols) {
            return null;
        }
        return { row: nextRow, col: nextCol };
    }

    handleTableCellKeyboard(e) {
        if (!this.canvas || !e) return false;

        const active = this.getActiveObject();
        let table = null;
        let row = null;
        let col = null;

        if (active?._isTableCellText) {
            table = this._getTableFrame(active._tableId);
            row = active._cellRow;
            col = active._cellCol;
        } else if (active?._elementType === 'table' && active._activeCell) {
            table = active;
            row = active._activeCell.row;
            col = active._activeCell.col;
        } else {
            const cellTarget = this.getTableCellTargetFromSelection();
            if (!cellTarget) return false;
            table = cellTarget.table;
            row = cellTarget.row;
            col = cellTarget.col;
        }

        if (!table || row == null || col == null) return false;

        if (e.key === 'Escape' && active?._isTableCellText && active.isEditing) {
            active.exitEditing();
            this.canvas.requestRenderAll();
            return true;
        }

        const navKeys = ['Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
        if (!navKeys.includes(e.key)) return false;

        if (active?._isTableCellText && active.isEditing && e.key.startsWith('Arrow')) {
            return false;
        }

        if (!active?._isTableCellText && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight'
            && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
            return false;
        }

        const target = this._getTableCellNavigationTarget(table, row, col, e.key, e.shiftKey);
        if (!target) return false;

        if (active?._isTableCellText && active.isEditing) {
            active.exitEditing();
        }

        this._focusTableCell(table, target.row, target.col, true);
        return true;
    }

    getTableContextFromTarget(target) {
        if (!target) return null;
        if (target._elementType === 'table') {
            const row = target._activeCell?.row ?? 0;
            const col = target._activeCell?.col ?? 0;
            return { table: target, row, col };
        }
        if (target._isTableCellText || target._isTableCellImage) {
            const table = this._getTableFrame(target._tableId);
            if (!table) return null;
            return { table, row: target._cellRow, col: target._cellCol };
        }
        return null;
    }

    addTableCellImage(table, row, col, dataUrl) {
        if (!table || !dataUrl) return Promise.resolve(null);
        const existing = this._getTableCellImage(table._tableId, row, col);
        if (existing) {
            this.canvas.remove(existing);
        }
        const bounds = this._getTableCellRect(table, row, col);
        return this._createTableCellImageObject(table, row, col, dataUrl, bounds).then((img) => {
            if (!img) return null;
            this.canvas.add(img);
            this._applyTableLayering(table);
            this.canvas.requestRenderAll();
            if (this.onCanvasModified) this.onCanvasModified();
            return img;
        });
    }

    _createRect(x, y) {
        const rect = new fabric.Rect({
            left: x,
            top: y,
            width: 0,
            height: 0,
            fill: 'transparent',
            stroke: '#01696f',
            strokeWidth: 2,
            strokeUniform: true,
            _elementType: 'rect',
        });
        this.canvas.add(rect);
        return rect;
    }

    _createEllipse(x, y) {
        const ellipse = new fabric.Ellipse({
            left: x,
            top: y,
            rx: 0,
            ry: 0,
            fill: 'transparent',
            stroke: '#01696f',
            strokeWidth: 2,
            strokeUniform: true,
            _elementType: 'ellipse',
        });
        this.canvas.add(ellipse);
        return ellipse;
    }

    _createLine(x, y) {
        const line = new fabric.Line([x, y, x, y], {
            stroke: '#01696f',
            strokeWidth: 2,
            strokeUniform: true,
            _elementType: this.arrowMode ? 'arrow' : 'line',
            selectable: true,
        });
        this.canvas.add(line);
        return line;
    }

    _getStarPoints(cx, cy, rx, ry, spikes = 5, rotation = 0) {
        const points = [];
        let rot = (Math.PI / 2) * 3 + rotation;
        const step = Math.PI / spikes;

        for (let i = 0; i < spikes; i++) {
            let x = cx + Math.cos(rot) * rx;
            let y = cy + Math.sin(rot) * ry;
            points.push({ x: x, y: y });
            rot += step;

            x = cx + Math.cos(rot) * (rx * 0.4);
            y = cy + Math.sin(rot) * (ry * 0.4);
            points.push({ x: x, y: y });
            rot += step;
        }
        return points;
    }

    _createStar(x, y) {
        const points = this._getStarPoints(100, 100, 100, 100);
        const star = new fabric.Polygon(points, {
            left: x,
            top: y,
            width: 200,
            height: 200,
            scaleX: 0,
            scaleY: 0,
            fill: 'transparent',
            stroke: '#01696f',
            strokeWidth: 2,
            strokeUniform: true,
            _elementType: 'star',
        });
        this.canvas.add(star);
        return star;
    }

    _createHighlight(x, y) {
        const rect = new fabric.Rect({
            left: x,
            top: y,
            width: 0,
            height: 0,
            fill: 'rgba(255, 255, 0, 0.3)',
            stroke: 'transparent',
            strokeWidth: 0,
            _elementType: 'highlight',
        });
        this.canvas.add(rect);
        return rect;
    }

    getStampConfigFromGroup(group) {
        if (group?.stampConfig) {
            return StampKit.cloneConfig(group.stampConfig);
        }
        if (group?.stampType && StampKit.listPresets().includes(group.stampType)) {
            return StampKit.mergeConfig(StampKit.getPreset(group.stampType), {
                text: group.stampText,
            });
        }
        return StampKit.cloneConfig(this.stampConfig);
    }

    _createStampGroup(config, left, top, options = {}) {
        const cfg = StampKit.mergeConfig(config);
        const { parts, width, height } = StampKit.buildParts(cfg, this.pdfScale);
        const {
            angle = cfg.defaultRotation || 0,
            scaleX = 1,
            scaleY = 1,
            opacity = 1,
        } = options;

        const group = new fabric.Group(parts, {
            left,
            top,
            _elementType: 'stamp',
            stampType: cfg.preset || 'custom',
            stampText: cfg.text,
            stampConfig: cfg,
            angle,
            scaleX,
            scaleY,
            opacity,
            hasControls: true,
            hasBorders: true,
            lockRotation: false,
            lockScalingX: false,
            lockScalingY: false,
            lockUniScaling: false,
            subTargetCheck: false,
        });
        group.setCoords();
        return group;
    }

    rebuildStamp(group, configPatch, options = {}) {
        if (!group || group._elementType !== 'stamp' || !this.canvas) {
            return null;
        }

        const center = group.getCenterPoint();
        const angle = options.angle != null ? options.angle : (group.angle || 0);
        const opacity = options.opacity != null ? options.opacity : (group.opacity ?? 1);
        const wasActive = this.canvas.getActiveObject() === group;

        const targetW = (group.width || 1) * (group.scaleX || 1);
        const targetH = (group.height || 1) * (group.scaleY || 1);

        const s = this.pdfScale || 1;
        if (group.stampConfig) {
            group.stampConfig.width = Math.round(targetW / s);
            group.stampConfig.height = Math.round(targetH / s);
        }

        const cfg = StampKit.mergeConfig(this.getStampConfigFromGroup(group), configPatch);

        // Create the new group initially at 0, 0
        const newGroup = this._createStampGroup(cfg, 0, 0, { angle, opacity });

        const baseW = newGroup.width || (cfg.width || 168) * s;
        const baseH = newGroup.height || (cfg.height || 52) * s;
        newGroup.set({
            scaleX: targetW / baseW,
            scaleY: targetH / baseH,
        });
        newGroup.setCoords();

        // Position it exactly around the original center point
        newGroup.setPositionByOrigin(center, 'center', 'center');
        newGroup.setCoords();

        const index = this.canvas.getObjects().indexOf(group);
        this.canvas.remove(group);
        if (index >= 0) {
            this.canvas.insertAt(newGroup, index, false);
        } else {
            this.canvas.add(newGroup);
        }

        if (wasActive) {
            this.canvas.setActiveObject(newGroup);
        }
        this.canvas.requestRenderAll();
        if (this.onCanvasModified) this.onCanvasModified();
        return newGroup;
    }

    setStampConfig(config) {
        this.stampConfig = StampKit.mergeConfig(config);
        if (this.stampConfig.preset) {
            this.stampType = this.stampConfig.preset;
        }
    }

    _placeStamp(x, y) {
        const cfg = StampKit.cloneConfig(this.stampConfig);
        const { width, height } = StampKit.measure(cfg, this.pdfScale);
        const group = this._createStampGroup(cfg, x - width / 2, y - height / 2, {
            angle: cfg.defaultRotation || 0,
        });
        this.canvas.add(group);
        if (this.onCanvasModified) this.onCanvasModified();
        return group;
    }

    _createLinkArea(x, y) {
        const rect = new fabric.Rect({
            left: x,
            top: y,
            width: 0,
            height: 0,
            fill: 'rgba(0, 100, 255, 0.15)',
            stroke: '#0066cc',
            strokeWidth: 1,
            strokeDashArray: [4, 4],
            _elementType: 'link-area',
            selectable: false,
            evented: false,
        });
        this.canvas.add(rect);
        return rect;
    }

    setStampType(type) {
        const key = type || 'approved';
        this.stampType = StampKit.listPresets().includes(key) ? key : 'approved';
        this.stampConfig = StampKit.getPreset(this.stampType);
    }

    showSearchHighlights(matches, activeIndex = 0) {
        this.clearSearchHighlights();
        this._searchHighlights = [];
        matches.forEach((match, index) => {
            const bbox = match.bbox;
            if (!bbox || bbox.length < 4) return;
            const rect = new fabric.Rect({
                left: bbox[0],
                top: bbox[1],
                width: bbox[2] - bbox[0],
                height: bbox[3] - bbox[1],
                fill: index === activeIndex ? 'rgba(255, 200, 0, 0.45)' : 'rgba(255, 255, 0, 0.25)',
                stroke: index === activeIndex ? '#ff9800' : '#ffeb3b',
                strokeWidth: 1,
                selectable: false,
                evented: false,
                excludeFromExport: true,
                _isSearchHighlight: true,
            });
            this._searchHighlights.push(rect);
            this.canvas.add(rect);
        });
        this.canvas.renderAll();
    }

    clearSearchHighlights() {
        if (!this._searchHighlights) return;
        this._searchHighlights.forEach((obj) => this.canvas.remove(obj));
        this._searchHighlights = [];
        this.canvas.renderAll();
    }

    showTableOverlays(tables) {
        this.clearTableOverlays();
        this._tableOverlays = [];
        (tables || []).forEach((table, index) => {
            const bbox = table.bbox;
            if (!bbox || bbox.length < 4) return;
            const rect = new fabric.Rect({
                left: bbox[0],
                top: bbox[1],
                width: bbox[2] - bbox[0],
                height: bbox[3] - bbox[1],
                fill: 'rgba(0, 150, 136, 0.12)',
                stroke: '#009688',
                strokeWidth: 2,
                selectable: false,
                evented: false,
                excludeFromExport: true,
                _isTableOverlay: true,
                _detectedTableIndex: index,
            });
            this._tableOverlays.push(rect);
            this.canvas.add(rect);
        });
        this.canvas.renderAll();
    }

    clearTableOverlays() {
        if (!this._tableOverlays) return;
        this._tableOverlays.forEach((obj) => this.canvas.remove(obj));
        this._tableOverlays = [];
        this.canvas.renderAll();
    }

    _createRedaction(x, y) {
        const rect = new fabric.Rect({
            left: x,
            top: y,
            width: 0,
            height: 0,
            fill: '#000000',
            stroke: '#000000',
            strokeWidth: 1,
            _elementType: 'redaction',
            _isRedaction: true,
        });
        this.canvas.add(rect);
        return rect;
    }

    addImage(dataUrl, cellTarget = null) {
        if (cellTarget?.table) {
            return this.addTableCellImage(
                cellTarget.table,
                cellTarget.row,
                cellTarget.col,
                dataUrl
            );
        }
        return new Promise((resolve) => {
            fabric.Image.fromURL(dataUrl, (img) => {
                const maxW = this.canvasWidth * 0.5;
                const maxH = this.canvasHeight * 0.5;
                const scale = Math.min(maxW / img.width, maxH / img.height, 1);
                img.set({
                    left: (this.canvasWidth - img.width * scale) / 2,
                    top: (this.canvasHeight - img.height * scale) / 2,
                    scaleX: scale,
                    scaleY: scale,
                    _elementType: 'image',
                });
                this.canvas.add(img);
                this.canvas.setActiveObject(img);
                this.canvas.renderAll();
                if (this.onCanvasModified) this.onCanvasModified();
                resolve(img);
            });
        });
    }

    _deleteSelected() {
        const active = this.canvas.getActiveObjects();
        if (active.length === 0) return;

        const tableIdsToRemove = new Set();
        active.forEach((obj) => {
            if (obj._elementType === 'table' && obj._tableId) {
                tableIdsToRemove.add(obj._tableId);
            }
        });

        if (tableIdsToRemove.size > 0) {
            tableIdsToRemove.forEach((tableId) => this._removeTableMembers(tableId, true));
            if (this.onCanvasModified) this.onCanvasModified();
            return;
        }

        active.forEach((obj) => {
            if (obj.origin === 'pdf' && obj.originalPdfBbox) {
                this.deletedOriginals.push({
                    pdf_bbox: obj.originalPdfBbox,
                    type: obj._elementType || obj.type,
                });
            }
            if (obj._elementType === 'ocr_mask' && obj.originalPdfBbox) {
                this._deletedOcrMasks.push({
                    pdf_bbox: obj.originalPdfBbox,
                    type: 'ocr_mask',
                });
            }
            this.canvas.remove(obj);
        });
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
        if (this.onCanvasModified) this.onCanvasModified();
    }

    deleteSelected() {
        this._deleteSelected();
    }

    _isNudgeableObject(obj) {
        return !!obj && obj.selectable !== false;
    }

    nudgeSelectedObjects(deltaX, deltaY) {
        const activeObjects = this.canvas.getActiveObjects().filter((obj) => this._isNudgeableObject(obj));
        if (activeObjects.length === 0) {
            return false;
        }

        activeObjects.forEach((obj) => {
            obj.set({
                left: (obj.left || 0) + deltaX,
                top: (obj.top || 0) + deltaY,
            });
            if (obj.origin === 'pdf') {
                obj._modified = true;
            }
            obj.setCoords();
        });

        const activeSelection = this.canvas.getActiveObject();
        if (activeSelection) {
            activeSelection.setCoords();
        }

        this.canvas.requestRenderAll();
        if (this.onObjectSelected) this.onObjectSelected(activeObjects);
        if (this.onCanvasModified) this.onCanvasModified();
        return true;
    }

    getDeletedOriginals() {
        return this.deletedOriginals;
    }

    clearDeletedOriginals() {
        this.deletedOriginals = [];
    }

    loadElements(elements) {
        const orderPriority = {
            rect: 0, ellipse: 0, path: 0, highlight: 0, redaction: 0, sticky: 0, stamp: 0, table: 0, image: 1, text: 2, ocr_mask: 0,
        };
        const sorted = [...elements].sort((a, b) => {
            const pa = orderPriority[a.type] ?? 1;
            const pb = orderPriority[b.type] ?? 1;
            return pa - pb;
        });
        sorted.forEach((elem) => {
            try {
                this._loadSingleElement(elem);
            } catch (e) {
                console.warn('Failed to load element:', elem, e);
            }
        });
        this.assignIdsToAllObjects();
        this.canvas.renderAll();
    }

    _loadSingleElement(elem) {
        const bbox = elem.bbox || [];
        if (!bbox || bbox.length < 4) return;

        const originPdfBbox = elem.pdf_bbox || null;

        switch (elem.type) {
            case 'text': {
                const isPdf = elem.origin === 'pdf';
                const isOcr = elem.origin === 'ocr';
                const fontWeight = elem.fontWeight != null
                    ? elem.fontWeight
                    : (elem.bold ? 'bold' : 'normal');
                const textOpts = {
                    left: bbox[0],
                    top: bbox[1],
                    fontSize: elem.fontSize || 16,
                    fontFamily: elem.fontFamily || 'Helvetica',
                    fill: elem.fill || '#000000',
                    fontWeight,
                    fontStyle: elem.italic ? 'italic' : 'normal',
                    underline: !!elem.underline,
                    linethrough: !!(elem.linethrough || elem.strikeout),
                    lineHeight: elem.lineHeight != null ? elem.lineHeight : 1.2,
                    charSpacing: elem.charSpacing != null ? elem.charSpacing : 0,
                    textAlign: elem.textAlign || 'left',
                    editable: true,
                    _elementType: 'text',
                    _textCase: elem.textCase || 'none',
                };
                if (elem.opacity != null) textOpts.opacity = elem.opacity;
                if (elem.backgroundColor) textOpts.backgroundColor = elem.backgroundColor;
                if (elem.angle != null) textOpts.angle = elem.angle;
                if (elem.stroke && elem.stroke !== 'transparent') {
                    textOpts.stroke = elem.stroke;
                    textOpts.strokeWidth = elem.strokeWidth || 1;
                }
                if (elem.textShadow) {
                    textOpts.shadow = new fabric.Shadow({
                        color: 'rgba(0,0,0,0.35)',
                        blur: 5,
                        offsetX: 2,
                        offsetY: 2,
                    });
                }
                if (isPdf) {
                    textOpts.origin = 'pdf';
                    textOpts.originalPdfBbox = originPdfBbox;
                }
                const boxWidth = Math.max(bbox[2] - bbox[0], 80);
                const text = isPdf
                    ? new fabric.IText(elem.text || '', textOpts)
                    : new fabric.Textbox(elem.text || '', {
                        ...textOpts,
                        width: boxWidth,
                        minWidth: 40,
                    });
                if (isOcr) {
                    text.set({
                        origin: 'ocr',
                        _elementType: 'text',
                        splitByGrapheme: false,
                    });
                }
                this.canvas.add(text);
                if (isOcr) text.bringToFront();
                if (text.type === 'textbox') {
                    this.applyTextboxWrapResize(text);
                }
                this._registerCanvasObject(text);
                break;
            }
            case 'image': {
                if (elem.src) {
                    fabric.Image.fromURL(elem.src, (img) => {
                        const bw = bbox[2] - bbox[0];
                        const bh = bbox[3] - bbox[1];
                        img.set({
                            left: bbox[0],
                            top: bbox[1],
                            scaleX: bw / img.width,
                            scaleY: bh / img.height,
                            _elementType: 'image',
                            origin: 'pdf',
                            originalPdfBbox: originPdfBbox,
                        });
                        this.canvas.add(img);
                        this.canvas.renderAll();
                    });
                }
                break;
            }
            case 'rect': {
                const isOcrMask = elem.origin === 'ocr';
                const rect = new fabric.Rect({
                    left: bbox[0],
                    top: bbox[1],
                    width: bbox[2] - bbox[0],
                    height: bbox[3] - bbox[1],
                    fill: elem.fill || 'transparent',
                    stroke: elem.stroke || 'transparent',
                    strokeWidth: elem.strokeWidth || 0,
                    strokeUniform: true,
                    _elementType: isOcrMask ? 'ocr_mask' : 'rect',
                    origin: isOcrMask ? 'ocr' : 'pdf',
                    originalPdfBbox: originPdfBbox,
                    selectable: !isOcrMask,
                    evented: !isOcrMask,
                });
                if (elem.opacity !== undefined && elem.opacity < 1) {
                    rect.set('opacity', elem.opacity);
                }
                this.canvas.add(rect);
                break;
            }
            case 'ellipse': {
                const rx = (bbox[2] - bbox[0]) / 2;
                const ry = (bbox[3] - bbox[1]) / 2;
                const ellipse = new fabric.Ellipse({
                    left: bbox[0],
                    top: bbox[1],
                    rx: Math.abs(rx),
                    ry: Math.abs(ry),
                    fill: elem.fill || 'transparent',
                    stroke: elem.stroke || 'transparent',
                    strokeWidth: elem.strokeWidth || 0,
                    strokeUniform: true,
                    _elementType: 'ellipse',
                    origin: 'pdf',
                    originalPdfBbox: originPdfBbox,
                });
                if (elem.opacity !== undefined && elem.opacity < 1) {
                    ellipse.set('opacity', elem.opacity);
                }
                this.canvas.add(ellipse);
                break;
            }
            case 'star': {
                const points = this._getStarPoints(100, 100, 100, 100);
                const star = new fabric.Polygon(points, {
                    left: bbox[0],
                    top: bbox[1],
                    width: bbox[2] - bbox[0],
                    height: bbox[3] - bbox[1],
                    scaleX: (bbox[2] - bbox[0]) / 200,
                    scaleY: (bbox[3] - bbox[1]) / 200,
                    fill: elem.fill || 'transparent',
                    stroke: elem.stroke || 'transparent',
                    strokeWidth: elem.strokeWidth || 0,
                    strokeUniform: true,
                    _elementType: 'star',
                    origin: 'pdf',
                    originalPdfBbox: originPdfBbox,
                });
                if (elem.opacity !== undefined && elem.opacity < 1) {
                    star.set('opacity', elem.opacity);
                }
                this.canvas.add(star);
                break;
            }
            case 'highlight': {
                const hl = new fabric.Rect({
                    left: bbox[0],
                    top: bbox[1],
                    width: bbox[2] - bbox[0],
                    height: bbox[3] - bbox[1],
                    fill: elem.fill || 'rgba(255, 255, 0, 0.3)',
                    stroke: 'transparent',
                    strokeWidth: 0,
                    _elementType: 'highlight',
                    origin: 'pdf',
                    originalPdfBbox: originPdfBbox,
                });
                if (elem.opacity !== undefined) {
                    hl.set('opacity', elem.opacity);
                }
                this.canvas.add(hl);
                break;
            }
            case 'stamp': {
                let cfg = elem.stampConfig
                    ? StampKit.cloneConfig(elem.stampConfig)
                    : StampKit.getPreset(elem.stampType || 'approved');
                if (elem.text && !elem.stampConfig) {
                    cfg.text = elem.text;
                }
                const group = this._createStampGroup(cfg, bbox[0], bbox[1]);
                const targetW = bbox[2] - bbox[0];
                const targetH = bbox[3] - bbox[1];
                const gw = group.width || 1;
                const gh = group.height || 1;
                if (targetW > 0 && targetH > 0) {
                    group.set({
                        scaleX: targetW / gw,
                        scaleY: targetH / gh,
                    });
                }
                if (elem.angle != null) {
                    group.set('angle', elem.angle);
                }
                if (elem.opacity !== undefined && elem.opacity < 1) {
                    group.set('opacity', elem.opacity);
                }
                group.setCoords();
                this.canvas.add(group);
                this._registerCanvasObject(group);
                break;
            }
            case 'sticky': {
                const stickyColor = elem.stickyColor || '#fff9c4';
                const { body, fold, width, height } = this._buildStickyIcon(stickyColor);
                const isPinned = !!elem.stickyPinned;
                const sticky = new fabric.Group([body, fold], {
                    left: bbox[0],
                    top: bbox[1],
                    _elementType: 'sticky',
                    _stickyColor: stickyColor,
                    _stickyText: elem.text || '',
                    _stickyPinned: isPinned,
                    origin: elem.origin || undefined,
                    originalPdfBbox: originPdfBbox,
                    shadow: new fabric.Shadow({
                        color: 'rgba(0,0,0,0.2)',
                        blur: 4,
                        offsetX: 1,
                        offsetY: 2,
                    }),
                    selectable: true,
                    evented: true,
                    lockMovementX: isPinned,
                    lockMovementY: isPinned,
                    hasControls: false,
                    lockScalingX: true,
                    lockScalingY: true,
                    lockRotation: true,
                });
                if (elem.opacity !== undefined && elem.opacity < 1) {
                    sticky.set('opacity', elem.opacity);
                }
                this.canvas.add(sticky);
                break;
            }
            case 'table': {
                const width = bbox[2] - bbox[0];
                const height = bbox[3] - bbox[1];
                const table = this.addTableToCanvas(bbox[0], bbox[1], width, height, {
                    rows: elem.rows || 3,
                    cols: elem.cols || 3,
                    fill: elem.fill,
                    stroke: elem.stroke,
                    strokeWidth: elem.strokeWidth,
                    lineStyle: elem.lineStyle,
                    textLayer: elem.textLayer,
                    rowHeights: elem.rowHeights,
                    colWidths: elem.colWidths,
                    cells: elem.cells,
                    tableId: elem.tableId,
                });
                if (elem.angle != null) table.set('angle', elem.angle);
                if (elem.opacity != null) table.set('opacity', elem.opacity);
                this._layoutTableCells(table);
                break;
            }
            case 'path': {
                if (elem.items && elem.items.length > 0) {
                    const commands = [];
                    let firstPoint = true;
                    elem.items.forEach((item) => {
                        const type = item.type || 'L';
                        if (type === 'L' || type === 'l') {
                            const x1 = item.x1 ?? item.x ?? 0;
                            const y1 = item.y1 ?? item.y ?? 0;
                            const x2 = item.x2 ?? item.x ?? 0;
                            const y2 = item.y2 ?? item.y ?? 0;
                            if (firstPoint) {
                                commands.push(`M ${x1} ${y1}`);
                                firstPoint = false;
                            }
                            commands.push(`L ${x2} ${y2}`);
                        } else if (type === 'C' || type === 'c') {
                            const x1 = item.x1 ?? 0;
                            const y1 = item.y1 ?? 0;
                            const x2 = item.x2 ?? 0;
                            const y2 = item.y2 ?? 0;
                            const x3 = item.x3 ?? 0;
                            const y3 = item.y3 ?? 0;
                            const x4 = item.x4 ?? 0;
                            const y4 = item.y4 ?? 0;
                            if (firstPoint) {
                                commands.push(`M ${x1} ${y1}`);
                                firstPoint = false;
                            }
                            commands.push(`C ${x2} ${y2} ${x3} ${y3} ${x4} ${y4}`);
                        } else if (type === 'Q' || type === 'q') {
                            const x1 = item.x1 ?? 0;
                            const y1 = item.y1 ?? 0;
                            const x2 = item.x2 ?? 0;
                            const y2 = item.y2 ?? 0;
                            const x3 = item.x3 ?? 0;
                            const y3 = item.y3 ?? 0;
                            if (firstPoint) {
                                commands.push(`M ${x1} ${y1}`);
                                firstPoint = false;
                            }
                            commands.push(`Q ${x2} ${y2} ${x3} ${y3}`);
                        }
                    });
                    if (commands.length >= 2 || (commands.length === 1 && commands[0].startsWith('M'))) {
                        const pathStr = commands.join(' ');
                        const path = new fabric.Path(pathStr, {
                            stroke: elem.stroke || 'transparent',
                            strokeWidth: elem.strokeWidth || 2,
                            fill: 'transparent',
                            strokeUniform: true,
                            _elementType: 'path',
                            origin: 'pdf',
                            originalPdfBbox: originPdfBbox,
                            selectable: true,
                        });
                        if (elem.strokeDashArray) {
                            path.set('strokeDashArray', elem.strokeDashArray);
                        }
                        this.canvas.add(path);
                    }
                }
                break;
            }
        }
    }

    setBrushSetting(prop, value) {
        this.brushSettings[prop] = value;
        if (prop === 'width' || prop === 'lineStyle') {
            const dashArray = this._getBrushDashArray();
            if (this.canvas.freeDrawingBrush) {
                this.canvas.freeDrawingBrush.strokeDashArray = dashArray;
            }
        }
        if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush) {
            if (prop === 'width') {
                this.canvas.freeDrawingBrush.width = value;
            } else if (prop === 'color') {
                this.canvas.freeDrawingBrush.color = value;
            } else if (prop === 'opacity') {
                this.canvas.freeDrawingBrush.opacity = value;
            }
        }
    }

    getBrushSettings() {
        return { ...this.brushSettings };
    }

    canvasBoundsToPdfBbox(bounds) {
        const zoom = this.zoomLevel || 1;
        const scale = this.pdfScale * zoom;
        let x0 = bounds.left / scale;
        let y0 = bounds.top / scale;
        let x1 = (bounds.left + bounds.width) / scale;
        let y1 = (bounds.top + bounds.height) / scale;

        const minW = 24;
        const minH = 14;
        if (Math.abs(x1 - x0) < minW) {
            const cx = (x0 + x1) / 2;
            x0 = cx - minW / 2;
            x1 = cx + minW / 2;
        }
        if (Math.abs(y1 - y0) < minH) {
            const cy = (y0 + y1) / 2;
            y0 = cy - minH / 2;
            y1 = cy + minH / 2;
        }

        return [x0, y0, x1, y1];
    }

    canvasBoundsToCanvasBbox(bounds) {
        const zoom = this.zoomLevel || 1;
        const scale = this.pdfScale * zoom;
        let x0 = bounds.left;
        let y0 = bounds.top;
        let x1 = bounds.left + bounds.width;
        let y1 = bounds.top + bounds.height;

        const minW = 48 * zoom;
        const minH = 28 * zoom;
        if (Math.abs(x1 - x0) < minW) {
            const cx = (x0 + x1) / 2;
            x0 = cx - minW / 2;
            x1 = cx + minW / 2;
        }
        if (Math.abs(y1 - y0) < minH) {
            const cy = (y0 + y1) / 2;
            y0 = cy - minH / 2;
            y1 = cy + minH / 2;
        }

        return [x0, y0, x1, y1];
    }

    setLinkDrawMode(enabled) {
        this._linkDrawMode = enabled !== false;
        this._syncLinkToolInteractivity();
    }

    getSelectedTextLinkArea() {
        const active = this.getActiveObjects();
        if (!active || active.length !== 1) return null;
        const obj = active[0];
        const textTypes = ['text', 'i-text', 'textbox'];
        if (!textTypes.includes(obj._elementType) && !textTypes.includes(obj.type)) {
            return null;
        }
        const bounds = obj.getBoundingRect(true, true);
        return {
            pdf_bbox: this.canvasBoundsToPdfBbox(bounds),
            bbox: this.canvasBoundsToCanvasBbox(bounds),
        };
    }

    _truncateLinkLabel(text, maxLen = 28) {
        const s = String(text || 'Link');
        return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
    }

    _buildLinkOverlayGroup(link, listIndex) {
        const bbox = link.bbox;
        if (!bbox || bbox.length < 4) return null;

        const left = bbox[0];
        const top = bbox[1];
        const right = bbox[2];
        const bottom = bbox[3];
        const width = Math.max(right - left, 8);
        const height = Math.max(bottom - top, 8);

        const isGoto = link.link_type === 'goto' || link.kind === 1 || (link.page != null && !link.uri);
        const fullLabel = isGoto
            ? `Page ${(link.page ?? 0) + 1}`
            : (link.uri || 'Link');
        const label = this._truncateLinkLabel(fullLabel);

        const underlineY = bottom - 1;
        const underline = new fabric.Line([left, underlineY, right, underlineY], {
            stroke: '#2563eb',
            strokeWidth: 2,
            selectable: false,
            evented: false,
        });

        const tint = new fabric.Rect({
            left,
            top,
            width,
            height,
            fill: 'rgba(37, 99, 235, 0.06)',
            stroke: 'transparent',
            selectable: false,
            evented: false,
        });

        const chipPadX = 6;
        const chipH = 16;
        const chipW = Math.min(Math.max(label.length * 6.5 + chipPadX * 2, 36), 120);
        const chipLeft = Math.min(right + 4, left + Math.max(width - chipW, 0));
        const chipTop = Math.max(top - chipH - 2, top);

        const chipBg = new fabric.Rect({
            left: chipLeft,
            top: chipTop,
            width: chipW,
            height: chipH,
            fill: '#2563eb',
            rx: 4,
            ry: 4,
            selectable: false,
            evented: false,
        });

        const chipText = new fabric.Text(label, {
            left: chipLeft + chipPadX,
            top: chipTop + 3,
            fontSize: 10,
            fontFamily: 'Inter, Helvetica, Arial, sans-serif',
            fill: '#ffffff',
            textBaseline: 'alphabetic',
            selectable: false,
            evented: false,
        });

        const group = new fabric.Group([tint, underline, chipBg, chipText], {
            left: 0,
            top: 0,
            selectable: false,
            evented: true,
            hoverCursor: 'pointer',
            excludeFromExport: true,
            _isLinkOverlay: true,
            _linkIndex: link.index ?? listIndex,
            _linkListIndex: listIndex,
            _linkData: link,
            _linkLabel: fullLabel,
        });

        group.on('mousedown', (opt) => {
            if (this.onLinkOverlayClicked) {
                this.onLinkOverlayClicked(link, listIndex, opt);
            }
        });

        group.on('mousedblclick', (opt) => {
            if (this.onLinkOverlayDoubleClicked) {
                this.onLinkOverlayDoubleClicked(link, listIndex, opt);
            }
        });

        return group;
    }

    showLinkOverlays(links, options = {}) {
        this._lastLinkOverlayList = links || [];
        this._linkOverlayOptions = { visible: true, selectedListIndex: null, selectedLinkIndex: null, ...options };
        if (this._linkOverlayOptions.visible === false) {
            this.clearLinkOverlays();
            return;
        }

        this.clearLinkOverlays();
        this._linkOverlays = [];

        (links || []).forEach((link, listIndex) => {
            const group = this._buildLinkOverlayGroup(link, listIndex);
            if (!group) return;

            if (this._linkOverlayOptions.selectedListIndex === listIndex ||
                (link.index != null && this._linkOverlayOptions.selectedLinkIndex === link.index)) {
                group.set({ opacity: 1 });
                const objs = group._objects || [];
                objs.forEach((o) => {
                    if (o.type === 'line') o.set({ stroke: '#1d4ed8', strokeWidth: 3 });
                });
            }

            this._linkOverlays.push(group);
            this.canvas.add(group);
        });

        this._linkOverlays.forEach((obj) => {
            this.canvas.sendToBack(obj);
        });
        this.canvas.renderAll();
    }

    clearLinkOverlays() {
        if (!this._linkOverlays) return;
        this._linkOverlays.forEach((obj) => this.canvas.remove(obj));
        this._linkOverlays = [];
        this.canvas.renderAll();
    }

    refreshLinkOverlaySelection(listIndex, linkIndex) {
        this.showLinkOverlays(this._lastLinkOverlayList || [], {
            ...this._linkOverlayOptions,
            visible: this._linkOverlayOptions?.visible !== false,
            selectedListIndex: listIndex,
            selectedLinkIndex: linkIndex,
        });
    }

    getObjects() {
        return this.canvas.getObjects().filter((obj) => {
            if (obj.origin === 'pdf' && !obj._modified) {
                return false;
            }
            if (this._isOcrMaskObject(obj)) {
                return false;
            }
            if (obj._tableId && obj._elementType !== 'table' && !obj._isTableCellContent) {
                return false;
            }
            return true;
        }).map((obj) => {
            const base = {
                type: obj._elementType || obj.type,
            };

            if (obj.origin === 'pdf') {
                base.origin = 'pdf';
                base.originalPdfBbox = obj.originalPdfBbox || null;
            }

            const scale = this.pdfScale;

            if (obj.type === 'textbox' || obj.type === 'i-text' || obj.type === 'text') {
                base.type = 'text';
                base.text = obj.text || '';
                obj.setCoords();
                const br = obj.getBoundingRect(true, true);
                const left = br.left;
                const top = br.top;
                const w = Math.max(br.width, 1);
                const h = Math.max(br.height, 1);
                base.bbox = [left, top, left + w, top + h];
                base.pdf_bbox = [left / scale, top / scale, (left + w) / scale, (top + h) / scale];
                base.fontFamily = obj.fontFamily || 'Helvetica';
                base.fontSize = obj.fontSize || 16;
                base.fill = typeof obj.fill === 'string' ? obj.fill : '#000000';
                const fw = obj.fontWeight;
                base.fontWeight = fw === 'bold' || (typeof fw === 'number' && fw >= 700) ? 700 : (typeof fw === 'number' ? fw : 400);
                base.bold = base.fontWeight >= 700;
                base.italic = obj.fontStyle === 'italic';
                base.underline = !!obj.underline;
                base.linethrough = !!obj.linethrough;
                base.strikeout = !!obj.linethrough;
                base.textAlign = obj.textAlign || 'left';
                base.lineHeight = obj.lineHeight != null ? obj.lineHeight : 1.2;
                base.charSpacing = obj.charSpacing != null ? obj.charSpacing : 0;
                if (obj._textCase) base.textCase = obj._textCase;
                if (obj.angle) base.angle = obj.angle;
                base.opacity = obj.opacity;
                if (obj.backgroundColor) {
                    base.backgroundColor = obj.backgroundColor;
                }
                if (obj.stroke && obj.stroke !== 'transparent' && (obj.strokeWidth || 0) > 0) {
                    base.stroke = obj.stroke;
                    base.strokeWidth = obj.strokeWidth;
                }
                if (obj.shadow) base.textShadow = true;
            } else if (obj.type === 'group' && obj._elementType === 'stamp') {
                base.type = 'stamp';
                const center = obj.getCenterPoint();
                const w = (obj.width || 1) * (obj.scaleX || 1);
                const h = (obj.height || 1) * (obj.scaleY || 1);
                const left = center.x - w / 2;
                const top = center.y - h / 2;
                base.bbox = [left, top, left + w, top + h];
                base.pdf_bbox = [left / scale, top / scale, (left + w) / scale, (top + h) / scale];
                base.stampType = obj.stampType || obj.stampConfig?.preset || 'custom';
                base.stampConfig = StampKit.cloneConfig(obj.stampConfig || this.getStampConfigFromGroup(obj));
                base.text = base.stampConfig.text || obj.stampText || 'STAMP';
                if (obj.angle) base.angle = obj.angle;
                if (obj.opacity != null && obj.opacity < 1) base.opacity = obj.opacity;
            } else if (obj.type === 'image') {
                base.type = 'image';
                const left = obj.left || 0;
                const top = obj.top || 0;
                const w = (obj.width || 100) * (obj.scaleX || 1);
                const h = (obj.height || 100) * (obj.scaleY || 1);
                base.bbox = [left, top, left + w, top + h];
                base.pdf_bbox = [left / scale, top / scale, (left + w) / scale, (top + h) / scale];
                base.src = obj.toDataURL({ format: 'png' });
                base.opacity = obj.opacity;
            } else if (obj.type === 'rect') {
                const left = obj.left || 0;
                const top = obj.top || 0;
                const w = (obj.width || 50) * (obj.scaleX || 1);
                const h = (obj.height || 50) * (obj.scaleY || 1);
                base.bbox = [left, top, left + w, top + h];
                base.pdf_bbox = [left / scale, top / scale, (left + w) / scale, (top + h) / scale];
                base.fill = typeof obj.fill === 'string' ? obj.fill : 'transparent';
                base.stroke = typeof obj.stroke === 'string' ? obj.stroke : 'transparent';
                base.strokeWidth = obj.strokeWidth || 0;
                base.opacity = obj.opacity;
                if (obj._elementType === 'highlight') base.type = 'highlight';
                if (obj._elementType === 'redaction') base.type = 'redaction';
                if (obj.rx) {
                    base.cornerRadius = obj.rx * (obj.scaleX || 1);
                }
                if (obj.lineStyle) base.lineStyle = obj.lineStyle;
                if (obj.strokeDashArray) base.strokeDashArray = obj.strokeDashArray;
            } else if (obj.type === 'ellipse') {
                base.type = 'ellipse';
                const left = obj.left || 0;
                const top = obj.top || 0;
                const w = (obj.rx || 25) * 2 * (obj.scaleX || 1);
                const h = (obj.ry || 25) * 2 * (obj.scaleY || 1);
                base.bbox = [left, top, left + w, top + h];
                base.pdf_bbox = [left / scale, top / scale, (left + w) / scale, (top + h) / scale];
                base.fill = typeof obj.fill === 'string' ? obj.fill : 'transparent';
                base.stroke = typeof obj.stroke === 'string' ? obj.stroke : 'transparent';
                base.strokeWidth = obj.strokeWidth || 0;
                base.opacity = obj.opacity;
                if (obj.lineStyle) base.lineStyle = obj.lineStyle;
                if (obj.strokeDashArray) base.strokeDashArray = obj.strokeDashArray;
            } else if (obj.type === 'polygon' || obj._elementType === 'star') {
                base.type = 'star';
                const left = obj.left || 0;
                const top = obj.top || 0;
                const w = (obj.width || 200) * (obj.scaleX || 1);
                const h = (obj.height || 200) * (obj.scaleY || 1);
                base.bbox = [left, top, left + w, top + h];
                base.pdf_bbox = [left / scale, top / scale, (left + w) / scale, (top + h) / scale];
                base.fill = typeof obj.fill === 'string' ? obj.fill : 'transparent';
                base.stroke = typeof obj.stroke === 'string' ? obj.stroke : 'transparent';
                base.strokeWidth = obj.strokeWidth || 0;
                base.opacity = obj.opacity;
            } else if (obj.type === 'line') {
                base.type = obj._elementType === 'arrow' ? 'arrow' : 'line';
                const x1 = obj.x1 || 0;
                const y1 = obj.y1 || 0;
                const x2 = obj.x2 || 0;
                const y2 = obj.y2 || 0;
                const minX = Math.min(x1, x2);
                const minY = Math.min(y1, y2);
                const maxX = Math.max(x1, x2);
                const maxY = Math.max(y1, y2);
                base.bbox = [minX, minY, maxX, maxY];
                base.pdf_bbox = [minX / scale, minY / scale, maxX / scale, maxY / scale];
                base.stroke = typeof obj.stroke === 'string' ? obj.stroke : 'transparent';
                base.strokeWidth = obj.strokeWidth || 2;
                base.opacity = obj.opacity;
                base.arrow = obj._elementType === 'arrow';
                if (obj.lineStyle) base.lineStyle = obj.lineStyle;
                if (obj.strokeDashArray) base.strokeDashArray = obj.strokeDashArray;
            } else if (obj.type === 'path') {
                base.type = 'path';
                const bounds = obj.getBoundingRect();
                base.bbox = [bounds.left, bounds.top, bounds.left + bounds.width, bounds.top + bounds.height];
                base.pdf_bbox = [bounds.left / scale, bounds.top / scale, (bounds.left + bounds.width) / scale, (bounds.top + bounds.height) / scale];
                base.stroke = typeof obj.stroke === 'string' ? obj.stroke : 'transparent';
                base.strokeWidth = obj.strokeWidth || 2;
                base.opacity = obj.opacity;
                if (obj.strokeDashArray) {
                    base.strokeDashArray = obj.strokeDashArray;
                }
                if (obj.lineStyle) base.lineStyle = obj.lineStyle;
                if (obj._inkPoints) base.inkPoints = obj._inkPoints;
                base.path = obj.path
                    ? obj.path.map((seg) => seg.join(' ')).join(' ')
                    : '';
            } else if (obj.type === 'group') {
                if (obj._elementType === 'sticky') {
                    base.type = 'sticky';
                    const bounds = obj.getBoundingRect();
                    base.bbox = [bounds.left, bounds.top, bounds.left + bounds.width, bounds.top + bounds.height];
                    base.pdf_bbox = [bounds.left / scale, bounds.top / scale, (bounds.left + bounds.width) / scale, (bounds.top + bounds.height) / scale];
                    base.text = obj._stickyText || '';
                    base.stickyColor = obj._stickyColor || '#fff9c4';
                    base.stickyPinned = !!obj._stickyPinned;
                    base.opacity = obj.opacity;
                    if (obj.origin === 'pdf') {
                        base.origin = 'pdf';
                        base.originalPdfBbox = obj.originalPdfBbox || null;
                    }
                } else if (obj._elementType === 'table') {
                    base.type = 'table';
                    const bounds = obj.getBoundingRect(true, true);
                    base.bbox = [bounds.left, bounds.top, bounds.left + bounds.width, bounds.top + bounds.height];
                    base.pdf_bbox = [
                        bounds.left / scale,
                        bounds.top / scale,
                        (bounds.left + bounds.width) / scale,
                        (bounds.top + bounds.height) / scale,
                    ];
                    base.rows = obj._tableRows || 3;
                    base.cols = obj._tableCols || 3;
                    base.fill = obj._tableFill || '#ffffff';
                    base.stroke = obj._tableStroke || '#333333';
                    base.strokeWidth = obj._tableStrokeWidth ?? 1;
                    base.lineStyle = obj._tableLineStyle || 'solid';
                    base.textLayer = obj._tableTextLayer || 'above';
                    base.rowHeights = obj._tableRowHeights || [];
                    base.colWidths = obj._tableColWidths || [];
                    base.cells = this._serializeTableCells(obj);
                    base.opacity = obj.opacity;
                    if (obj.angle) base.angle = obj.angle;
                } else {
                    return null;
                }
            }

            return base;
        }).filter(Boolean);
    }

    clear() {
        this.canvas.clear();
        this.canvas.backgroundColor = null;
    }

    setZoom(zoom) {
        this.zoomLevel = Math.max(0.25, Math.min(3, zoom));
        this.canvas.setZoom(this.zoomLevel);
        this.canvas.setWidth(this.canvasWidth * this.zoomLevel);
        this.canvas.setHeight(this.canvasHeight * this.zoomLevel);
        this.canvas.renderAll();
    }

    resizeCanvas(width, height) {
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.canvas.setWidth(width * this.zoomLevel);
        this.canvas.setHeight(height * this.zoomLevel);
        this.canvas.calcOffset();
        this.canvas.renderAll();
    }

    rotatePageObjects(degrees, oldWidth, oldHeight, newWidth, newHeight) {
        const radians = degrees * Math.PI / 180;
        const oldCenterX = oldWidth / 2;
        const oldCenterY = oldHeight / 2;
        const newCenterX = newWidth / 2;
        const newCenterY = newHeight / 2;

        this.canvas.discardActiveObject();
        this.canvas.getObjects().forEach((obj) => {
            const center = obj.getCenterPoint();
            const dx = center.x - oldCenterX;
            const dy = center.y - oldCenterY;
            const nextCenterX = dx * Math.cos(radians) - dy * Math.sin(radians) + newCenterX;
            const nextCenterY = dx * Math.sin(radians) + dy * Math.cos(radians) + newCenterY;

            obj.rotate((obj.angle || 0) + degrees);
            obj.setPositionByOrigin(new fabric.Point(nextCenterX, nextCenterY), 'center', 'center');
            obj.setCoords();
        });

        this.canvas.renderAll();
    }

    fitToView(containerWidth, containerHeight) {
        if (!this.canvas || !this.canvasWidth || !this.canvasHeight) return this.zoomLevel;
        const scaleX = containerWidth / this.canvasWidth;
        const scaleY = containerHeight / this.canvasHeight;
        const zoom = Math.min(scaleX, scaleY, 2);
        this.setZoom(zoom);
        return this.zoomLevel;
    }

    toJSON() {
        return this.captureUndoSnapshot();
    }

    captureUndoSnapshot() {
        if (!this.canvas) return null;
        return {
            kind: 'snapshot',
            objects: this.canvas.getObjects()
                .filter((obj) => (
                    !obj._isLinkOverlay
                    && !obj._isTableOverlay
                    && !obj._isSearchHighlight
                    && !obj._isTableResizeHandle
                ))
                .map((obj) => ({
                    id: this.ensureObjectId(obj),
                    json: obj.toObject(this._undoProps),
                })),
        };
    }

    _applySnapshotToObject(obj, json) {
        if (!obj || !json) return;
        const isText = json.type === 'i-text' || json.type === 'textbox' || json.type === 'text';
        if (isText) {
            obj.set({
                left: json.left,
                top: json.top,
                angle: json.angle || 0,
                scaleX: json.scaleX ?? 1,
                scaleY: json.scaleY ?? 1,
                width: json.width,
                height: json.height,
                text: json.text,
                fill: json.fill,
                fontSize: json.fontSize,
                fontFamily: json.fontFamily,
                fontWeight: json.fontWeight,
                fontStyle: json.fontStyle,
                textAlign: json.textAlign,
                charSpacing: json.charSpacing,
                lineHeight: json.lineHeight,
                opacity: json.opacity,
                underline: json.underline,
                linethrough: json.linethrough,
                backgroundColor: json.backgroundColor,
                stroke: json.stroke,
                strokeWidth: json.strokeWidth,
            });
            if (json._elementType) obj._elementType = json._elementType;
            if (json.origin) obj.origin = json.origin;
            if (json.originalPdfBbox) obj.originalPdfBbox = json.originalPdfBbox;
            if (json._modified) obj._modified = json._modified;
            if (json._textCase) obj._textCase = json._textCase;
            return;
        }
        obj.set(json);
    }

    restoreUndoSnapshot(snapshot) {
        if (!this.canvas || !snapshot?.objects) {
            return Promise.resolve();
        }

        const existingById = new Map();
        this.canvas.getObjects().forEach((obj) => {
            const id = obj._pdfEditId || this.ensureObjectId(obj);
            existingById.set(id, obj);
        });

        const toCreate = [];

        snapshot.objects.forEach(({ id, json }) => {
            const existing = existingById.get(id);
            if (existing) {
                this._applySnapshotToObject(existing, json);
                existing._pdfEditId = id;
                existing.setCoords();
                return;
            }
            toCreate.push({ ...json, _pdfEditId: id });
        });

        const snapshotIds = new Set(snapshot.objects.map((s) => s.id));
        this.canvas.getObjects().forEach((obj) => {
            const id = obj._pdfEditId || this.ensureObjectId(obj);
            if (!snapshotIds.has(id)
                && !obj._isLinkOverlay
                && !obj._isTableOverlay
                && !obj._isSearchHighlight
                && !obj._isTableResizeHandle) {
                this.canvas.remove(obj);
            }
        });

        if (toCreate.length === 0) {
            this.canvas.renderAll();
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            fabric.util.enlivenObjects(toCreate, (objects) => {
                objects.forEach((obj, index) => {
                    obj._pdfEditId = toCreate[index]._pdfEditId;
                    this.canvas.add(obj);
                });
                this.canvas.renderAll();
                resolve();
            });
        });
    }

    loadFromJSON(json) {
        if (json?.kind === 'snapshot') {
            return this.restoreUndoSnapshot(json);
        }
        return new Promise((resolve) => {
            this.canvas.loadFromJSON(json, () => {
                this.canvas.getObjects().forEach((obj) => {
                    this.ensureObjectId(obj);
                    if ((obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text') && !obj._elementType) {
                        obj._elementType = 'text';
                    }
                    this.applyTextboxWrapResize(obj);
                    this.normalizeTextObjectScale(obj);
                });
                this.canvas.renderAll();
                resolve();
            });
        });
    }

    getActiveObject() {
        return this.canvas.getActiveObject();
    }

    getActiveObjects() {
        return this.canvas.getActiveObjects();
    }

    getSelectedTextObjects() {
        const active = this.canvas.getActiveObject();
        if (active && active.type === 'activeSelection') {
            return active.getObjects().filter((o) => this.isTextObject(o));
        }
        return this.getActiveObjects().filter((o) => this.isTextObject(o));
    }

    _rectsOverlap(a, b, padding = 2) {
        return !(
            a.left + a.width + padding < b.left
            || b.left + b.width + padding < a.left
            || a.top + a.height + padding < b.top
            || b.top + b.height + padding < a.top
        );
    }

    /**
     * Merge 2+ text objects into one Textbox (e.g. after AI OCR line blocks).
     * Removes associated OCR white-mask rects in the same region.
     */
    mergeSelectedTextBlocks(objects) {
        const texts = (objects || this.getSelectedTextObjects()).filter((o) => this.isTextObject(o));
        if (texts.length < 2) {
            return null;
        }

        const active = this.canvas.getActiveObject();
        if (active && active.type === 'activeSelection') {
            this.canvas.discardActiveObject();
        }
        texts.forEach((obj) => obj.setCoords());

        const sorted = [...texts].sort((a, b) => {
            const ra = this._getObjectPageRect(a);
            const rb = this._getObjectPageRect(b);
            if (Math.abs(ra.top - rb.top) > 6) {
                return ra.top - rb.top;
            }
            return ra.left - rb.left;
        });

        const mergedText = sorted
            .map((obj) => (obj.text || '').replace(/\s+$/, ''))
            .filter(Boolean)
            .join('\n');

        if (!mergedText) {
            return null;
        }

        let minL = Infinity;
        let minT = Infinity;
        let maxR = -Infinity;
        let maxB = -Infinity;
        sorted.forEach((obj) => {
            const r = this._getObjectPageRect(obj);
            minL = Math.min(minL, r.left);
            minT = Math.min(minT, r.top);
            maxR = Math.max(maxR, r.left + r.width);
            maxB = Math.max(maxB, r.top + r.height);
        });

        const selectionBounds = { left: minL, top: minT, width: maxR - minL, height: maxB - minT };
        const toRemove = [...sorted];
        this.canvas.getObjects().slice().forEach((obj) => {
            if (toRemove.includes(obj)) {
                return;
            }
            if (obj._elementType === 'ocr_mask' || (obj.origin === 'ocr' && obj.type === 'rect')) {
                const r = obj.getBoundingRect(true, true);
                if (this._rectsOverlap(r, selectionBounds, 8)) {
                    toRemove.push(obj);
                }
            }
        });

        toRemove.forEach((obj) => {
            if (this.canvas.getObjects().includes(obj)) {
                this.canvas.remove(obj);
            }
        });

        const pad = 6;
        const fontSize = Math.round(
            sorted.reduce((sum, obj) => sum + (obj.fontSize || 16), 0) / sorted.length
        );
        const sample = sorted[0];
        const bgSource = sorted.find((o) => o.backgroundColor && o.backgroundColor !== 'transparent');
        const boxWidth = Math.max(maxR - minL, 200);
        const lineCount = mergedText.split('\n').length;
        const boxHeight = Math.max(maxB - minT, lineCount * fontSize * 1.25);

        const mask = new fabric.Rect({
            left: minL - pad,
            top: minT - pad,
            width: boxWidth + pad * 2,
            height: boxHeight + pad * 2,
            originX: 'left',
            originY: 'top',
            fill: '#ffffff',
            stroke: 'transparent',
            strokeWidth: 0,
            _elementType: 'ocr_mask',
            origin: 'ocr',
            selectable: false,
            evented: false,
        });
        this.canvas.add(mask);

        const textbox = new fabric.Textbox(mergedText, {
            left: minL,
            top: minT,
            originX: 'left',
            originY: 'top',
            width: boxWidth,
            fontSize,
            fontFamily: sample.fontFamily || 'Helvetica',
            fill: sample.fill || '#111111',
            backgroundColor: bgSource?.backgroundColor || '#ffffff',
            lineHeight: sample.lineHeight != null ? sample.lineHeight : 1.25,
            textAlign: 'left',
            scaleX: 1,
            scaleY: 1,
            editable: true,
            origin: 'ocr',
            _elementType: 'text',
            splitByGrapheme: false,
        });
        if (typeof textbox.initDimensions === 'function') {
            textbox.initDimensions();
        }
        this._setObjectOriginPoint(textbox, minL, minT);
        textbox.setCoords();
        this.canvas.add(textbox);
        this._registerCanvasObject(textbox);
        textbox.bringToFront();
        this.canvas.setActiveObject(textbox);
        this.canvas.requestRenderAll();
        this.assignIdsToAllObjects();

        if (this.onObjectSelected) {
            this.onObjectSelected([textbox]);
        }

        return textbox;
    }

    renderAll() {
        this.canvas.renderAll();
    }

    /**
     * Rasterize the current canvas (background + objects) for sidebar thumbnails.
     * @param {number} maxHeight - target output height in pixels (use 2×+ display size for sharp thumbs)
     */
    capturePreviewDataUrl(maxHeight) {
        if (!this.canvas || !this.canvasHeight) {
            return null;
        }
        this.canvas.renderAll();
        const targetHeight = Math.min(
            this.canvasHeight,
            Math.max(1, maxHeight || this.canvasHeight)
        );
        const multiplier = targetHeight / this.canvasHeight;
        try {
            return this.canvas.toDataURL({
                format: 'png',
                quality: 1,
                multiplier,
            });
        } catch (err) {
            console.warn('Preview capture failed:', err);
            return null;
        }
    }

    bringToFront(obj) {
        this.canvas.bringToFront(obj);
        this.canvas.renderAll();
    }

    sendToBack(obj) {
        this.canvas.sendToBack(obj);
        this.canvas.renderAll();
    }

    dispose() {
        if (this.canvas) {
            const wrapper = this.canvas.wrapperEl;
            const origCanvas = this.canvas.lowerCanvasEl;
            this.canvas.dispose();
            if (wrapper && wrapper.parentNode) {
                if (origCanvas && origCanvas.parentNode === wrapper) {
                    wrapper.parentNode.appendChild(origCanvas);
                }
                wrapper.remove();
            }
            this.canvas = null;
        }
    }
}

window.PDFEditor = PDFEditor;

const AI_TRANSLATE_LANGUAGES = [
    { value: 'English', flag: '🇬🇧' },
    { value: 'Spanish', flag: '🇪🇸' },
    { value: 'French', flag: '🇫🇷' },
    { value: 'German', flag: '🇩🇪' },
    { value: 'Italian', flag: '🇮🇹' },
    { value: 'Portuguese', flag: '🇵🇹' },
    { value: 'Dutch', flag: '🇳🇱' },
    { value: 'Polish', flag: '🇵🇱' },
    { value: 'Romanian', flag: '🇷🇴' },
    { value: 'Russian', flag: '🇷🇺' },
    { value: 'Chinese (Simplified)', flag: '🇨🇳' },
    { value: 'Chinese (Traditional)', flag: '🇹🇼' },
    { value: 'Japanese', flag: '🇯🇵' },
    { value: 'Korean', flag: '🇰🇷' },
    { value: 'Arabic', flag: '🇸🇦' },
    { value: 'Hindi', flag: '🇮🇳' },
    { value: 'Turkish', flag: '🇹🇷' },
    { value: 'Ukrainian', flag: '🇺🇦' },
    { value: 'Czech', flag: '🇨🇿' },
    { value: 'Swedish', flag: '🇸🇪' },
    { value: 'Danish', flag: '🇩🇰' },
    { value: 'Norwegian', flag: '🇳🇴' },
    { value: 'Finnish', flag: '🇫🇮' },
    { value: 'Greek', flag: '🇬🇷' },
    { value: 'Hebrew', flag: '🇮🇱' },
    { value: 'Vietnamese', flag: '🇻🇳' },
    { value: 'Thai', flag: '🇹🇭' },
    { value: 'Indonesian', flag: '🇮🇩' },
];

class App {
    constructor() {
        this.sessionId = null;
        this.pageCount = 0;
        this.currentPage = 0;
        this.pageSizes = [];
        this.editor = new PDFEditor();
        this.formLayer = new PDFFormLayer();
        this.toolbar = new Toolbar();
        this.undoStack = [];
        this.undoIndex = -1;
        this._suppressUndoRecording = false;
        this.maxHistory = 50;
        this.pageStates = {};
        this.pageFormStates = {};
        this.thumbnails = {};
        this._thumbnailRefreshTimer = null;
        /** Base thumbnail raster height before DPR scaling (sidebar ~144px wide). */
        this._thumbnailCaptureBaseHeight = 320;
        this.isSaving = false;
        this.isLoading = false;
        this.thumbnailsVisible = true;
        this.selectedFormXref = null;
        this.pendingPageLoad = null;
        this._aiOcrInFlight = false;
        this._AI_OCR_FONT_KEY = 'pdfedit-ai-ocr-font';
        this._currentStickyObj = null;
        this.searchResults = [];
        this.searchIndex = 0;
        this.documentMode = false;
        this._pendingUploadFile = null;
        this._detectedTables = [];
        this.pageLinks = [];
        this.documentLinks = [];
        this.selectedLink = null;
        this.linkShowHighlights = true;
        this.linkScope = 'page';
        this.linkPreset = 'web';
        this._linkDrawAreaMode = false;
        this._certSignPlacementMode = false;
        this._certSignPending = null;
        this.isDirty = false;
        this.dirtyPages = new Set();
        this._draftPersistTimer = null;
        this._SESSION_STORAGE_KEY = 'pdfedit-session';
    }

    _draftStorageKey(sessionId) {
        return `pdfedit-draft-${sessionId}`;
    }

    async init() {
        this.toolbar.init();
        this.toolbar.editor = this.editor;
        this._bindElements();
        this.formLayer.init(this.els.canvasWrapper, this.els.formLayer);
        this._bindEvents();
        this._bindKeyboard();
        this._initTheme();
        this._initDesktopControls();
        this._initDragDrop();
        this._checkMobile();
        this.toolbar.onToolChange = (tool) => this._onToolChange(tool);
        this.toolbar.onPropertyChange = (type, prop, value) => this._onPropertyChange(type, prop, value);
        this.toolbar.onFormValueChange = (value) => this._onFormValueChange(value);
        this.toolbar.onFormFieldSelect = (xref, options = {}) => this._selectFormField(xref, {
            focus: this.toolbar.activeTool === 'forms',
            extend: options.extend,
            range: options.range,
        });
        this.toolbar.onFormCreate = (kind) => this._createFormField(kind);
        this.toolbar.onFormDelete = () => this._deleteFormField(this.selectedFormXref);
        this.toolbar.onFormDuplicate = () => this._duplicateFormField(this.selectedFormXref);
        this.toolbar.onFormMatchSizes = (dimension) => this._matchFormFieldSizes(dimension);
        this.toolbar.onFormPropertiesChange = (properties) => this._onFormPropertiesChange(properties);
        this.toolbar.onTableAction = (action) => this._onTableAction(action);
        this.formLayer.onFieldSelected = (field, selectedFields) => this._onFormFieldSelected(field, selectedFields);
        this.formLayer.onFieldChanged = (field) => this._onFormFieldChanged(field);
        this.formLayer.onFieldsBatchChanged = (fields) => this._onFormFieldsBatchChanged(fields);
        this.formLayer._onFieldDelete = (xref) => this._deleteFormField(xref);
        this.formLayer._onFieldDuplicate = (xref) => this._duplicateFormField(xref);
        this._attachEditorCallbacks();
        AISettings.bind();
        AIAssistant.init();
        await AISettings.refresh();
        this.onAiConfiguredChanged(AISettings.configured);
        lucide.createIcons();
        await this._restoreSessionOnInit();
    }

    onAiConfiguredChanged(configured) {
        const hasDoc = !!this.sessionId;
        const enabled = configured && hasDoc;
        AIAssistant.setEnabled(enabled);
        const aiOcr = document.getElementById('btn-ai-ocr-page');
        const metaBtn = document.getElementById('btn-ai-suggest-metadata');
        const formsBtn = document.getElementById('btn-ai-fill-forms');
        if (aiOcr) {
            aiOcr.disabled = !enabled;
            aiOcr.title = configured
                ? 'AI OCR: replace page scan with text, or copy text into your own text box'
                : 'Configure AI Settings first';
        }
        if (metaBtn) metaBtn.disabled = !enabled;
        if (formsBtn) formsBtn.disabled = !enabled;
        document.querySelectorAll('.ai-text-action-btn').forEach((btn) => {
            btn.disabled = !enabled;
        });
        const translateLang = document.getElementById('ai-translate-lang');
        const translateLangCustom = document.getElementById('ai-translate-lang-custom');
        const translateSearch = document.getElementById('ai-translate-search');
        const translateTrigger = document.getElementById('ai-translate-trigger');
        const translateGroup = document.getElementById('ai-translate-group');
        if (translateLang) translateLang.disabled = !enabled;
        if (translateLangCustom) translateLangCustom.disabled = !enabled;
        if (translateSearch) translateSearch.disabled = !enabled;
        if (translateTrigger) translateTrigger.disabled = !enabled;
        if (translateGroup) translateGroup.classList.toggle('disabled', !enabled);
    }

    _attachEditorCallbacks() {
        this.editor.onObjectSelected = (objects) => {
            this._clearFormSelection(false);
            if (
                objects?.length === 1
                && objects[0]._elementType === 'stamp'
                && this.toolbar.activeTool === 'stamp'
            ) {
                this._onToolChange('select');
                this.editor.canvas.setActiveObject(objects[0]);
            }
            if (this.toolbar.activeTool === 'link') {
                this.toolbar.showLinkProperties();
                this._updateLinkSelectedTextButton();
            } else {
                this.toolbar.showPropertiesForObjects(objects);
            }
            if (objects && objects.length === 1 && objects[0]._elementType === 'sticky') {
                this._showStickyPopup(objects[0]);
            } else {
                this._hideStickyPopup();
            }
        };
        this.editor.onStickyDoubleClicked = (obj) => {
            this._showStickyPopup(obj);
        };
        this.editor.onContextMenuRequested = (context) => this._handleCanvasContextMenu(context);
        this.editor.onSelectionCleared = () => {
            this._hideCanvasContextMenu();
            this._hideStickyPopup();
            if (this.toolbar.activeTool === 'link') {
                this._updateLinkSelectedTextButton();
            }
            if (!this.isLoading) {
                this._showContextProperties();
            }
        };
        this.editor.onSelectCanvasPointerDown = (opt) => this._onSelectCanvasPointerDown(opt);
        this.editor.onSelectCanvasPointerUp = (selection) => this._onSelectCanvasPointerUp(selection);
        this.editor.onCanvasModified = () => {
            this._recordUndoState();
            this._markDirty();
            const active = this.editor.getActiveObject();
            if (active?._elementType === 'stamp') {
                this.toolbar.syncStampPropsFromObject(active);
            }
        };
        this.editor.onDrawingComplete = (createdObject) => {
            if (createdObject?._elementType === 'table') {
                this._showToast('Double-click a cell to type, or use Text/Image tools inside a cell', 'info');
            }
            this._selectToolAfterDraw(createdObject);
        };
        this.editor.onLinkAreaDrawn = (area) => this._onLinkAreaDrawn(area);
        this.editor.onLinkOverlayClicked = (link) => this._selectLinkEntry(link);
        this.editor.onLinkOverlayDoubleClicked = (link) => this._testLinkEntry(link);
        this.editor.onTextSelectionChanged = (obj) => {
            this.toolbar.syncTextSelectionProps(obj);
        };
    }

    _bindElements() {
        this.els = {
            uploadZone: document.getElementById('upload-zone'),
            editorContainer: document.getElementById('editor-container'),
            fabricCanvas: document.getElementById('fabric-canvas'),
            canvasWrapper: document.getElementById('canvas-wrapper'),
            formLayer: document.getElementById('form-layer'),
            canvasLoading: document.getElementById('canvas-loading'),
            canvasError: document.getElementById('canvas-error'),
            aiOcrBusy: document.getElementById('ai-ocr-busy'),
            aiOcrBusyStatus: document.getElementById('ai-ocr-busy-status'),
            dropOverlay: document.getElementById('drop-overlay'),
            fileInput: document.getElementById('file-input'),
            imageInput: document.getElementById('image-input'),
            pageInput: document.getElementById('page-input'),
            totalPages: document.getElementById('total-pages'),
            zoomLevel: document.getElementById('zoom-level'),
            prevPage: document.getElementById('btn-prev-page'),
            nextPage: document.getElementById('btn-next-page'),
            zoomIn: document.getElementById('btn-zoom-in'),
            zoomOut: document.getElementById('btn-zoom-out'),
            zoomFit: document.getElementById('btn-zoom-fit'),
            zoom100: document.getElementById('btn-zoom-100'),
            btnSave: document.getElementById('btn-save'),
            btnDownload: document.getElementById('btn-download'),
            btnUpload: document.getElementById('btn-upload'),
            btnNew: document.getElementById('btn-new'),
            btnUndo: document.getElementById('btn-undo'),
            btnRedo: document.getElementById('btn-redo'),
            btnTheme: document.getElementById('btn-theme'),
            btnUploadZone: document.getElementById('btn-upload-zone'),
            btnNewZone: document.getElementById('btn-new-zone'),
            btnRetry: document.getElementById('btn-retry'),
            btnToggleThumbs: document.getElementById('btn-toggle-thumbs'),
            btnCloseThumbs: document.getElementById('btn-close-thumbs'),
            btnAddPageHeader: document.getElementById('btn-add-page-header'),
            btnAddPage: document.getElementById('btn-add-page'),
            thumbnailsPanel: document.getElementById('thumbnails-panel'),
            thumbnailsList: document.getElementById('thumbnails-list'),
            pageCountBadge: document.getElementById('page-count-badge'),
            pageCountText: document.getElementById('page-count-text'),
            newPdfModal: document.getElementById('new-pdf-modal'),
            newPageSize: document.getElementById('new-page-size'),
            customSizeFields: document.getElementById('custom-size-fields'),
            newCustomWidth: document.getElementById('new-custom-width'),
            newCustomHeight: document.getElementById('new-custom-height'),
            btnCancelNew: document.getElementById('btn-cancel-new'),
            btnCreateNew: document.getElementById('btn-create-new'),
            btnRotate90: document.getElementById('btn-rotate-90'),
            btnRotate180: document.getElementById('btn-rotate-180'),
            btnRotate270: document.getElementById('btn-rotate-270'),
            btnDeletePage: document.getElementById('btn-delete-page'),
            btnDuplicatePage: document.getElementById('btn-duplicate-page'),
            btnExportPage: document.getElementById('btn-export-page'),
            btnExtractText: document.getElementById('btn-extract-text'),
            editorContextMenu: document.getElementById('editor-context-menu'),
            contextAlignSection: document.getElementById('context-align-section'),
            contextMenuDivider: document.getElementById('context-menu-divider'),
            btnContextDelete: document.getElementById('btn-context-delete'),
            btnContextPin: document.getElementById('btn-context-pin'),
            btnContextUnpin: document.getElementById('btn-context-unpin'),
            toastContainer: document.getElementById('toast-container'),
            stickyPopup: document.getElementById('sticky-note-popup'),
            stickyPopupClose: document.getElementById('sticky-popup-close'),
            stickyPopupTextarea: document.getElementById('sticky-popup-textarea'),
            btnMerge: document.getElementById('btn-merge'),
            btnDocument: document.getElementById('btn-document'),
            btnClose: document.getElementById('btn-close'),
            mergeFileInput: document.getElementById('merge-file-input'),
            findInput: document.getElementById('find-input'),
            btnFindPrev: document.getElementById('btn-find-prev'),
            btnFindNext: document.getElementById('btn-find-next'),
            findStatus: document.getElementById('find-status'),
            exportModal: document.getElementById('export-modal'),
            btnCancelExport: document.getElementById('btn-cancel-export'),
            btnConfirmExport: document.getElementById('btn-confirm-export'),
            exportFlatten: document.getElementById('export-flatten'),
            exportSplitPages: document.getElementById('export-split-pages'),
            exportFromPage: document.getElementById('export-from-page'),
            exportToPage: document.getElementById('export-to-page'),
            exportUserPassword: document.getElementById('export-user-password'),
            exportOwnerPassword: document.getElementById('export-owner-password'),
            unsavedModal: document.getElementById('unsaved-modal'),
            unsavedModalTitle: document.getElementById('unsaved-modal-title'),
            unsavedModalMessage: document.getElementById('unsaved-modal-message'),
            btnUnsavedCancel: document.getElementById('btn-unsaved-cancel'),
            btnUnsavedDiscard: document.getElementById('btn-unsaved-discard'),
            btnUnsavedSave: document.getElementById('btn-unsaved-save'),
            passwordModal: document.getElementById('password-modal'),
            pdfPasswordInput: document.getElementById('pdf-password-input'),
            btnCancelPassword: document.getElementById('btn-cancel-password'),
            btnConfirmPassword: document.getElementById('btn-confirm-password'),
            btnExportPng: document.getElementById('btn-export-png'),
            btnOcrPage: document.getElementById('btn-ocr-page'),
            btnDetectTables: document.getElementById('btn-detect-tables'),
            btnExportTables: document.getElementById('btn-export-tables'),
            tablesOverlayInfo: document.getElementById('tables-overlay-info'),
            tablesCountText: document.getElementById('tables-count-text'),
            propStampType: document.getElementById('prop-stamp-type'),
            propLinkKind: document.getElementById('prop-link-kind'),
            propLinkUri: document.getElementById('prop-link-uri'),
            propLinkUriLabel: document.getElementById('prop-link-uri-label'),
            propLinkPage: document.getElementById('prop-link-page'),
            propLinkUriGroup: document.getElementById('prop-link-uri-group'),
            propLinkPageGroup: document.getElementById('prop-link-page-group'),
            propLinkScope: document.getElementById('prop-link-scope'),
            propLinkShowHighlights: document.getElementById('prop-link-show-highlights'),
            btnLinkSelectedText: document.getElementById('btn-link-selected-text'),
            btnLinkDrawArea: document.getElementById('btn-link-draw-area'),
            btnLinkTest: document.getElementById('btn-link-test'),
            linkPresetChips: document.getElementById('link-preset-chips'),
            linkList: document.getElementById('link-list'),
            linkListEmpty: document.getElementById('link-list-empty'),
            btnSaveMetadata: document.getElementById('btn-save-metadata'),
            btnSaveBookmarks: document.getElementById('btn-save-bookmarks'),
            aiOcrFontFamily: document.getElementById('ai-ocr-font-family'),
            btnAiOcrPage: document.getElementById('btn-ai-ocr-page'),
            aiOcrModal: document.getElementById('ai-ocr-modal'),
            aiOcrText: document.getElementById('ai-ocr-text'),
            aiOcrModalHint: document.getElementById('ai-ocr-modal-hint'),
            btnAiOcrCancel: document.getElementById('btn-ai-ocr-cancel'),
            btnAiOcrCopy: document.getElementById('btn-ai-ocr-copy'),
            btnAiOcrReplace: document.getElementById('btn-ai-ocr-replace'),
            btnAbout: document.getElementById('btn-about'),
            btnQuit: document.getElementById('btn-quit'),
            aboutModal: document.getElementById('about-modal'),
            aboutVersion: document.getElementById('about-version'),
            aboutDataDir: document.getElementById('about-data-dir'),
            btnAboutClose: document.getElementById('btn-about-close'),
            quitModal: document.getElementById('quit-modal'),
            quitModalMessage: document.getElementById('quit-modal-message'),
            btnQuitCancel: document.getElementById('btn-quit-cancel'),
            btnQuitConfirm: document.getElementById('btn-quit-confirm'),
            editorContextAiSection: document.getElementById('context-ai-section'),
            contextMenuDividerAi: document.getElementById('context-menu-divider-ai'),
            btnMergeTextBlocks: document.getElementById('btn-merge-text-blocks'),
            btnContextMergeText: document.getElementById('btn-context-merge-text'),
            contextTableSection: document.getElementById('context-table-section'),
            contextTableDivider: document.getElementById('context-table-divider'),
            btnMakeTableEditable: document.getElementById('btn-make-table-editable'),
            detectedTableSelect: document.getElementById('detected-table-select'),
            detectedTableActions: document.getElementById('detected-table-actions'),
            tableCsvInput: document.getElementById('table-csv-input'),
        };

        try {
            if (localStorage.getItem(this._SESSION_STORAGE_KEY)) {
                this.els.uploadZone.style.display = 'none';
                this.els.editorContainer.style.display = 'flex';
                this.els.canvasLoading.style.display = 'flex';
            }
        } catch (_) {
            // ignore storage access errors during startup
        }

        this._initAiOcrFontSelect();
    }

    _initAiOcrFontSelect() {
        const select = this.els.aiOcrFontFamily;
        if (!select) return;
        try {
            const saved = localStorage.getItem(this._AI_OCR_FONT_KEY);
            if (saved && [...select.options].some((o) => o.value === saved)) {
                select.value = saved;
            }
        } catch (_) {
            // ignore storage access errors
        }
        select.addEventListener('change', () => {
            try {
                localStorage.setItem(this._AI_OCR_FONT_KEY, select.value);
            } catch (_) {
                // ignore storage access errors
            }
        });
    }

    _getAiOcrFontFamily() {
        return this.els.aiOcrFontFamily?.value || 'Helvetica';
    }

    _bindEvents() {
        this.els.btnUpload.addEventListener('click', () => this._openFilePicker());
        this.els.btnUploadZone.addEventListener('click', () => this._openFilePicker());
        this.els.fileInput.addEventListener('change', (e) => this._onFileSelected(e));
        this.els.btnNew.addEventListener('click', () => this._showNewPdfModal());
        this.els.btnNewZone.addEventListener('click', () => this._showNewPdfModal());
        this.els.btnSave.addEventListener('click', () => this._saveCurrentPage());
        this.els.btnDownload.addEventListener('click', () => this._showExportModal());
        if (this.els.btnMerge) {
            this.els.btnMerge.addEventListener('click', () => this.els.mergeFileInput.click());
            this.els.mergeFileInput.addEventListener('change', (e) => this._onMergeFileSelected(e));
        }
        if (this.els.btnDocument) {
            this.els.btnDocument.addEventListener('click', () => this._toggleDocumentPanel());
        }
        if (this.els.btnClose) {
            this.els.btnClose.addEventListener('click', () => this._closeDocument());
        }
        if (this.els.btnCancelExport) {
            this.els.btnCancelExport.addEventListener('click', () => this._hideExportModal());
            this.els.exportModal.querySelector('.modal-backdrop')?.addEventListener('click', () => this._hideExportModal());
            this.els.btnConfirmExport.addEventListener('click', () => this._confirmExport());
        }
        if (this.els.unsavedModal) {
            this.els.btnUnsavedCancel.addEventListener('click', () => this._resolveUnsavedModal('cancel'));
            this.els.btnUnsavedDiscard.addEventListener('click', () => this._resolveUnsavedModal('discard'));
            this.els.btnUnsavedSave.addEventListener('click', () => this._resolveUnsavedModal('save'));
            this.els.unsavedModal.querySelector('.modal-backdrop')?.addEventListener('click', () => this._resolveUnsavedModal('cancel'));
        }
        if (this.els.btnCancelPassword) {
            this.els.btnCancelPassword.addEventListener('click', () => this._hidePasswordModal());
            this.els.passwordModal.querySelector('.modal-backdrop')?.addEventListener('click', () => this._hidePasswordModal());
            this.els.btnConfirmPassword.addEventListener('click', () => this._confirmPasswordUpload());
        }
        if (this.els.findInput) {
            this.els.findInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this._runSearch(e.shiftKey);
            });
            this.els.btnFindNext?.addEventListener('click', () => this._runSearch(false));
            this.els.btnFindPrev?.addEventListener('click', () => this._runSearch(true));
        }
        this._initStampPresetGrid();
        this._bindStampPresetButtons();
        this._bindStampDesignControls();
        document.getElementById('btn-save-stamp-to-library')?.addEventListener('click', () => {
            this._saveActiveStampToLibrary();
        });
        if (this.els.propLinkKind) {
            this.els.propLinkKind.addEventListener('change', () => {
                this._updateLinkPropVisibility();
                if (this.els.propLinkKind.value === 'goto') {
                    this._applyLinkPreset('page');
                } else if (this.linkPreset === 'page') {
                    this._applyLinkPreset('web');
                }
                if (this.selectedLink) this._updateSelectedLink();
            });
        }
        if (this.els.propLinkUri) {
            this.els.propLinkUri.addEventListener('change', () => {
                if (this.selectedLink) this._updateSelectedLink();
            });
        }
        if (this.els.propLinkPage) {
            this.els.propLinkPage.addEventListener('change', () => {
                if (this.selectedLink) this._updateSelectedLink();
            });
        }
        this.els.btnLinkSelectedText?.addEventListener('click', () => this._linkSelectedText());
        this.els.btnLinkDrawArea?.addEventListener('click', () => this._enableLinkDrawMode());
        this.els.btnLinkTest?.addEventListener('click', () => this._testCurrentLinkTarget());
        this.els.propLinkShowHighlights?.addEventListener('change', () => {
            this.linkShowHighlights = this.els.propLinkShowHighlights.checked;
            this._renderLinkHighlights();
        });
        this.els.propLinkScope?.addEventListener('change', () => {
            this.linkScope = this.els.propLinkScope.value;
            this._refreshLinkList();
        });
        this.els.linkPresetChips?.querySelectorAll('.prop-chip').forEach((chip) => {
            chip.addEventListener('click', () => this._applyLinkPreset(chip.dataset.preset));
        });
        if (this.els.btnSaveMetadata) {
            this.els.btnSaveMetadata.addEventListener('click', () => this._saveMetadata());
        }
        if (this.els.btnSaveBookmarks) {
            this.els.btnSaveBookmarks.addEventListener('click', () => this._saveBookmarks());
        }
        if (this.els.btnExportPng) {
            this.els.btnExportPng.addEventListener('click', () => this._exportCurrentPagePng());
        }
        if (this.els.btnOcrPage) {
            this.els.btnOcrPage.addEventListener('click', () => this._ocrCurrentPage());
        }
        if (this.els.btnAiOcrPage) {
            this.els.btnAiOcrPage.addEventListener('click', () => this._aiOcrCurrentPage());
        }
        if (this.els.aiOcrModal) {
            this.els.btnAiOcrCancel?.addEventListener('click', () => this._hideAiOcrModal());
            this.els.aiOcrModal.querySelector('.modal-backdrop')?.addEventListener('click', () => this._hideAiOcrModal());
            this.els.btnAiOcrCopy?.addEventListener('click', () => this._applyAiOcrKeepImage());
            this.els.btnAiOcrReplace?.addEventListener('click', () => this._applyAiOcrReplaceImage());
        }
        document.getElementById('btn-ai-suggest-metadata')?.addEventListener('click', () => this._aiSuggestMetadata());
        document.getElementById('btn-ai-fill-forms')?.addEventListener('click', () => this._aiFillForms());
        document.querySelectorAll('.ai-text-action-btn').forEach((btn) => {
            btn.addEventListener('click', () => this._aiTextAction(btn.dataset.aiAction));
        });
        this._bindAiTranslateLanguage();
        document.querySelectorAll('.ai-context-action').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._aiTextAction(btn.dataset.aiAction, this._contextMenuTextObjects);
                this._hideCanvasContextMenu();
            });
        });
        this.els.btnMergeTextBlocks?.addEventListener('click', () => this._mergeSelectedTextBlocks());

        const runContextMerge = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const targets = [
                ...(this._contextMenuTextObjects || []),
                ...(this.editor?.getSelectedTextObjects() || []),
            ];
            const unique = [...new Set(targets)];
            this._hideCanvasContextMenu();
            this._mergeSelectedTextBlocks(unique);
        };

        if (this.els.btnContextMergeText) {
            this.els.btnContextMergeText.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            this.els.btnContextMergeText.addEventListener('click', runContextMerge);
        }

        this.els.editorContextMenu?.addEventListener('click', (e) => {
            if (e.target.closest('#btn-context-merge-text')) {
                runContextMerge(e);
                return;
            }
            const tableBtn = e.target.closest('[data-table-action]');
            if (tableBtn) {
                e.preventDefault();
                e.stopPropagation();
                this._onTableAction(tableBtn.dataset.tableAction, this._contextMenuTableTarget);
                this._hideCanvasContextMenu();
            }
        });
        if (this.els.btnDetectTables) {
            this.els.btnDetectTables.addEventListener('click', () => this._detectTablesOnPage());
        }
        if (this.els.btnExportTables) {
            this.els.btnExportTables.addEventListener('click', () => this._exportTablesCsv());
        }
        if (this.els.btnMakeTableEditable) {
            this.els.btnMakeTableEditable.addEventListener('click', () => this._makeDetectedTableEditable());
        }
        if (this.els.tableCsvInput) {
            this.els.tableCsvInput.addEventListener('change', (e) => this._onTableCsvFileSelected(e));
        }
        this.els.btnUndo.addEventListener('click', () => this._undo());
        this.els.btnRedo.addEventListener('click', () => this._redo());
        this.els.btnTheme.addEventListener('click', () => this._toggleTheme());
        this.els.prevPage.addEventListener('click', () => this._goToPage(this.currentPage - 1));
        this.els.nextPage.addEventListener('click', () => this._goToPage(this.currentPage + 1));
        this.els.pageInput.addEventListener('change', () => {
            const page = parseInt(this.els.pageInput.value) - 1;
            if (page >= 0 && page < this.pageCount) this._goToPage(page);
        });
        this.els.zoomIn.addEventListener('click', () => this._setZoom(this.editor.zoomLevel + 0.1));
        this.els.zoomOut.addEventListener('click', () => this._setZoom(this.editor.zoomLevel - 0.1));
        this.els.zoomFit.addEventListener('click', () => this._fitToView());
        this.els.zoom100.addEventListener('click', () => this._setZoom(1));
        this.els.btnToggleThumbs.addEventListener('click', () => this._toggleThumbnails());
        this.els.btnCloseThumbs.addEventListener('click', () => this._toggleThumbnails(false));
        this.els.btnAddPageHeader.addEventListener('click', () => this._insertPageAt(this.currentPage + 1));
        this.els.btnAddPage.addEventListener('click', () => this._addNewPage());
        this.els.btnRetry.addEventListener('click', () => this._loadPage(this.currentPage));
        this.els.btnCancelNew.addEventListener('click', () => this._hideNewPdfModal());
        this.els.btnCreateNew.addEventListener('click', () => this._createNewPdf());
        this.els.newPageSize.addEventListener('change', (e) => {
            this.els.customSizeFields.style.display = e.target.value === 'custom' ? 'flex' : 'none';
        });
        this.els.btnRotate90.addEventListener('click', () => this._rotateCurrentPage(90));
        this.els.btnRotate180.addEventListener('click', () => this._rotateCurrentPage(180));
        this.els.btnRotate270.addEventListener('click', () => this._rotateCurrentPage(270));
        this.els.btnDeletePage.addEventListener('click', () => this._deleteCurrentPage());
        this.els.btnDuplicatePage.addEventListener('click', () => this._duplicateCurrentPage());
        this.els.btnExportPage.addEventListener('click', () => this._exportCurrentPage());
        this.els.btnExtractText.addEventListener('click', () => this._extractCurrentPageText());
        this.els.btnContextDelete.addEventListener('mousedown', (e) => e.stopPropagation());
        this.els.btnContextDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            this._deleteSelectedObjects();
        });
        this.els.btnContextPin.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleStickyPin(true);
        });
        this.els.btnContextUnpin.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleStickyPin(false);
        });

        document.querySelectorAll('[data-page-align]').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._alignSelectionToPageMargins(btn.dataset.pageAlign);
            });
        });

        this.els.imageInput.addEventListener('change', (e) => this._onImageSelected(e));

        this.els.stickyPopupClose.addEventListener('click', () => this._hideStickyPopup(true));
        this.els.stickyPopupTextarea.addEventListener('input', () => this._saveStickyPopupText());

        this.els.editorContextMenu.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        this.els.canvasWrapper.addEventListener('contextmenu', (e) => {
            if (this.els.canvasWrapper.contains(e.target)) {
                e.preventDefault();
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.els.editorContextMenu.contains(e.target)) {
                this._hideCanvasContextMenu();
            }
        });
        document.addEventListener('contextmenu', (e) => {
            const onCanvas = this.els.canvasWrapper.contains(e.target);
            const onAppMenu = this.els.editorContextMenu.contains(e.target);
            if (onCanvas) {
                e.preventDefault();
                return;
            }
            if (!onAppMenu) {
                this._hideCanvasContextMenu();
            }
        });
        window.addEventListener('resize', () => {
            this._hideCanvasContextMenu();
            this.formLayer.syncPosition();
        });
        this.els.canvasWrapper.addEventListener('scroll', () => {
            this._hideCanvasContextMenu();
            this._repositionStickyPopup();
        });

        const modalBackdrop = this.els.newPdfModal.querySelector('.modal-backdrop');
        modalBackdrop.addEventListener('click', () => this._hideNewPdfModal());
        this._initShapeDropdown();

        window.addEventListener('beforeunload', (e) => {
            this._persistDraft();
            if (this._hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
        window.addEventListener('pagehide', () => { void this._persistDraft(); });
    }

    _initShapeDropdown() {
        const shapeBtn = document.getElementById('btn-shape-main');
        const menu = document.getElementById('shape-dropdown-menu');
        if (!shapeBtn || !menu) return;

        // Selecting a shape from the dropdown menu
        const menuItems = menu.querySelectorAll('.menu-item');
        menuItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const shape = item.dataset.shape;
                
                // Update main button data-tool
                shapeBtn.dataset.tool = shape === 'arrow' ? 'line' : shape;
                
                // Adjust Arrow/Line mode settings
                if (shape === 'arrow') {
                    this.editor.arrowMode = true;
                } else if (shape === 'line') {
                    this.editor.arrowMode = false;
                }
                
                // Update active state in selector menu
                menuItems.forEach(mi => mi.classList.toggle('active', mi === item));
                
                // Auto-activate selected shape tool
                this._onToolChange(shapeBtn.dataset.tool);
                
                // Hide menu
                menu.style.display = 'none';
            });
        });

        // Close menu if user clicks anywhere else
        document.addEventListener('click', () => {
            menu.style.display = 'none';
        });
    }

    _bindKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.els.aboutModal?.style.display === 'flex') {
                    e.preventDefault();
                    this._hideAboutModal();
                    return;
                }
                if (this.els.quitModal?.style.display === 'flex') {
                    e.preventDefault();
                    this._hideQuitModal();
                    return;
                }
                if (this.els.unsavedModal?.style.display === 'flex') {
                    e.preventDefault();
                    this._resolveUnsavedModal('cancel');
                    return;
                }
            }

            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                if (this.editor.handleTableCellKeyboard?.(e)) {
                    e.preventDefault();
                    return;
                }
                if (e.key === 'Escape') {
                    const active = this.editor.getActiveObject();
                    if (active?._isTableCellText && active.isEditing) {
                        active.exitEditing();
                        e.preventDefault();
                        return;
                    }
                    e.target.blur();
                }
                return;
            }

            if (this.editor.handleTableCellKeyboard?.(e)) {
                e.preventDefault();
                return;
            }

            if (this.editor.canvas && this.editor.canvas.getActiveObject()?.isEditing) return;

            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'z':
                        e.preventDefault();
                        this._undo();
                        return;
                    case 'y':
                        e.preventDefault();
                        this._redo();
                        return;
                    case 's':
                        e.preventDefault();
                        this._saveCurrentPage();
                        return;
                    case 'o':
                        e.preventDefault();
                        this._openFilePicker();
                        return;
                    case 'w':
                        if (this.sessionId) {
                            e.preventDefault();
                            this._closeDocument();
                        }
                        return;
                }
            }

            if (this.toolbar.activeTool === 'forms' || (
                this.toolbar.activeTool === 'select' && this.formLayer.getSelectedFields().length > 0
            )) {
                const step = e.shiftKey ? 10 : 1;
                let moved = false;

                switch (e.key) {
                    case 'ArrowLeft':
                        moved = this.formLayer.nudgeSelectedFields(-step, 0);
                        break;
                    case 'ArrowRight':
                        moved = this.formLayer.nudgeSelectedFields(step, 0);
                        break;
                    case 'ArrowUp':
                        moved = this.formLayer.nudgeSelectedFields(0, -step);
                        break;
                    case 'ArrowDown':
                        moved = this.formLayer.nudgeSelectedFields(0, step);
                        break;
                }

                if (moved) {
                    e.preventDefault();
                    return;
                }
            }

            if (this.editor.canvas) {
                const step = e.shiftKey ? 10 : 1;
                let moved = false;

                switch (e.key) {
                    case 'ArrowLeft':
                        moved = this.editor.nudgeSelectedObjects(-step, 0);
                        break;
                    case 'ArrowRight':
                        moved = this.editor.nudgeSelectedObjects(step, 0);
                        break;
                    case 'ArrowUp':
                        moved = this.editor.nudgeSelectedObjects(0, -step);
                        break;
                    case 'ArrowDown':
                        moved = this.editor.nudgeSelectedObjects(0, step);
                        break;
                }

                if (moved) {
                    e.preventDefault();
                    return;
                }
            }

            switch (e.key.toLowerCase()) {
                case 'v':
                    this._onToolChange('select');
                    break;
                case 'o':
                    this._onToolChange('forms');
                    break;
                case 't':
                    this._onToolChange('text');
                    break;
                case 'i':
                    this._onToolChange('image');
                    break;
                case 'g':
                    this._onToolChange('table');
                    break;
                case 'r':
                    this._onToolChange('rect');
                    break;
                case 'e':
                    this._onToolChange('ellipse');
                    break;
                case 'l':
                    this._onToolChange('line');
                    break;
                case 'f':
                    this._onToolChange('freehand');
                    break;
                case 'h':
                    this._onToolChange('highlight');
                    break;
                case 'n':
                    this._onToolChange('sticky');
                    break;
                case 'x':
                    this._onToolChange('redaction');
                    break;
                case 'p':
                    this._onToolChange('stamp');
                    break;
                case 'k':
                    this._onToolChange('link');
                    break;
                case 'delete':
                case 'backspace':
                    if (this.toolbar.activeTool === 'forms') {
                        e.preventDefault();
                        this._deleteFormField(this.selectedFormXref);
                    } else if (this.editor.currentTool === 'select' || this.editor.currentTool === 'eraser') {
                        this._deleteSelectedObjects();
                    }
                    break;
                case '=':
                case '+':
                    this._setZoom(this.editor.zoomLevel + 0.1);
                    break;
                case '-':
                    this._setZoom(this.editor.zoomLevel - 0.1);
                    break;
                case 'escape':
                    this._hideCanvasContextMenu();
                    this.toolbar.setActiveTool('select');
                    this.editor.setTool('select');
                    break;
            }
        });
    }

    _initTheme() {
        const saved = localStorage.getItem('pdfedit-theme');
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
        }
    }

    _toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('pdfedit-theme', next);
    }

    _initDragDrop() {
        const zone = this.els.uploadZone;
        ['dragenter', 'dragover'].forEach((evt) => {
            zone.addEventListener(evt, (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });
        });
        ['dragleave', 'drop'].forEach((evt) => {
            zone.addEventListener(evt, (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');
            });
        });
        zone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type === 'application/pdf') {
                this._uploadFile(files[0]);
            } else {
                this._showToast('Please drop a PDF file', 'error');
            }
        });

        document.body.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!e.dataTransfer || !this.sessionId) return;
            const hasPdf = Array.from(e.dataTransfer.types).some(
                (t) => t === 'application/pdf' || t === 'Files'
            );
            if (hasPdf && this.els.editorContainer.style.display !== 'none') {
                this.els.dropOverlay.style.display = 'flex';
            }
        });

        document.body.addEventListener('dragleave', (e) => {
            if (e.relatedTarget === null) {
                this.els.dropOverlay.style.display = 'none';
            }
        });

        document.body.addEventListener('drop', (e) => {
            e.preventDefault();
            this.els.dropOverlay.style.display = 'none';
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                if (files[0].type === 'application/pdf') {
                    this._uploadFile(files[0]);
                } else {
                    this._showToast('Please drop a PDF file', 'error');
                }
            }
        });
    }

    _checkMobile() {
        const banner = document.getElementById('mobile-banner');
        if (window.innerWidth < 768) {
            banner.style.display = 'flex';
        }
        window.addEventListener('resize', () => {
            banner.style.display = window.innerWidth < 768 ? 'flex' : 'none';
        });
    }

    async _openFilePicker() {
        if (this.sessionId) {
            if (!(await this._proceedPastUnsaved({
                message: 'You have unsaved changes. Save them before opening another file?',
            }))) {
                return;
            }
        }
        if (window.pdfEditDesktop?.openFile) {
            const files = await window.pdfEditDesktop.openFile({
                filters: [{ name: 'PDF', extensions: ['pdf'] }],
            });
            const file = files && files[0];
            if (file) {
                this._uploadFile(file, null, { skipUnsavedCheck: true });
            }
            return;
        }
        this.els.fileInput.click();
    }

    _onFileSelected(e) {
        const file = e.target.files[0];
        if (file) this._uploadFile(file, null, { skipUnsavedCheck: true });
        e.target.value = '';
    }

    _markDirty() {
        this.isDirty = true;
        this.dirtyPages.add(this.currentPage);
        this._scheduleDraftPersist();
        this._scheduleThumbnailRefresh();
        this._updateSaveUnsavedIndicator();
    }

    _scheduleThumbnailRefresh() {
        clearTimeout(this._thumbnailRefreshTimer);
        this._thumbnailRefreshTimer = setTimeout(() => {
            this._storeThumbnailFromCanvas();
        }, 350);
    }

    _getThumbnailCaptureHeight(pageNum = this.currentPage) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const pageSize = this.pageSizes[pageNum];
        const canvasH = this.editor?.canvasHeight
            || (pageSize ? pageSize.height * (this.editor?.pdfScale || 2) : 0);
        const maxH = Math.round(this._thumbnailCaptureBaseHeight * dpr);
        return canvasH > 0 ? Math.min(canvasH, maxH) : maxH;
    }

    _storeThumbnailFromCanvas(pageNum = this.currentPage) {
        if (pageNum !== this.currentPage || !this.editor?.canvas || this.isLoading) {
            return;
        }
        const dataUrl = this.editor.capturePreviewDataUrl(this._getThumbnailCaptureHeight(pageNum));
        if (!dataUrl) {
            return;
        }
        this.thumbnails[pageNum] = dataUrl;
        if (this.thumbnailsVisible) {
            this._updateThumbnail(pageNum);
        }
    }

    _initStampPresetGrid() {
        this.refreshStampPresetGrid(this.els.propStampType?.value || 'approved');
    }

    refreshStampPresetGrid(activeKey = null) {
        const grid = document.getElementById('stamp-preset-grid');
        if (!grid || !window.StampKit) return;

        const selected = activeKey
            || this.els.propStampType?.value
            || this.editor?.stampConfig?.preset
            || 'approved';

        grid.innerHTML = '';
        StampKit.listPresets().forEach((key) => {
            const cfg = StampKit.getPreset(key);
            const btn = StampKit.createPresetButton(key, cfg, { active: key === selected });
            grid.appendChild(btn);
        });

        this._bindStampPresetButtons();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    selectStampPreset(key) {
        if (!key || !StampKit.listPresets().includes(key)) return;
        if (this.toolbar.onPropertyChange) {
            this.toolbar.onPropertyChange('stamp', 'stampType', key);
        }
        if (this.toolbar.activeTool !== 'stamp') {
            this._onToolChange('stamp');
        }
    }

    _saveActiveStampToLibrary() {
        const obj = this.editor.getActiveObject();
        if (!obj || obj._elementType !== 'stamp') return;

        let cfg = this.editor.getStampConfigFromGroup(obj);
        const textEl = document.getElementById('prop-stamp-text');
        const accentEl = document.getElementById('prop-stamp-accent');
        if (textEl) cfg.text = textEl.value;
        if (accentEl) cfg = StampKit.applyAccentColor(cfg, accentEl.value);

        const s = this.editor.pdfScale || 1;
        cfg.width = Math.round((obj.width || 1) * (obj.scaleX || 1) / s);
        cfg.height = Math.round((obj.height || 1) * (obj.scaleY || 1) / s);

        const existingId = cfg.preset && StampKit.isCustom(cfg.preset) ? cfg.preset : null;
        const id = StampKit.saveCustomStamp(cfg, existingId);
        this.refreshStampPresetGrid(id);
        this._showToast(existingId ? 'Stamp updated in library' : 'Stamp saved to library', 'success');
    }

    _bindStampPresetButtons() {
        document.querySelectorAll('.stamp-preset-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.stampType;
                if (type && this.toolbar.onPropertyChange) {
                    this.toolbar.onPropertyChange('stamp', 'stampType', type);
                }
            });
        });
    }

    _bindStampDesignControls() {
        const applyPlacement = () => {
            if (this.editor.getActiveObject()?._elementType === 'stamp') return;
            const patch = this._readStampConfigFromPanel();
            this.editor.setStampConfig(patch);
        };

        ['prop-stamp-text', 'prop-stamp-accent'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const evt = el.type === 'color' ? 'change' : 'input';
            el.addEventListener(evt, applyPlacement);
        });
    }

    _readStampConfigFromPanel() {
        const base = StampKit.cloneConfig(this.editor.stampConfig);
        const textEl = document.getElementById('prop-stamp-text');
        const accentEl = document.getElementById('prop-stamp-accent');
        if (textEl) base.text = textEl.value;
        if (accentEl) {
            return StampKit.applyAccentColor(base, accentEl.value);
        }
        return base;
    }

    _updateSaveUnsavedIndicator() {
        const btn = this.els.btnSave;
        if (!btn) return;

        const dirty = this._hasUnsavedChanges();
        const count = this._getDirtyPageNumbers().length;

        btn.classList.toggle('has-unsaved', dirty && !this.isSaving);

        if (dirty && count > 1) {
            btn.dataset.unsavedCount = String(count);
        } else {
            delete btn.dataset.unsavedCount;
        }

        if (dirty && this.sessionId) {
            const pagesLabel = count > 1 ? `${count} pages` : 'this page';
            btn.title = `Save unsaved changes on ${pagesLabel} (Ctrl+S)`;
            btn.setAttribute(
                'aria-label',
                `Save, unsaved changes on ${count} page${count === 1 ? '' : 's'}`
            );
        } else {
            btn.title = 'Save (Ctrl+S)';
            btn.setAttribute('aria-label', 'Save');
        }
    }

    _hasUnsavedChanges() {
        if (!this.sessionId) return false;
        return this.dirtyPages.size > 0;
    }

    _getDirtyPageNumbers() {
        return [...this.dirtyPages].sort((a, b) => a - b);
    }

    _reindexDirtyPages(remapFn) {
        this.dirtyPages = new Set(
            [...this.dirtyPages]
                .map((page) => remapFn(page))
                .filter((page) => Number.isInteger(page) && page >= 0 && page < this.pageCount)
        );
    }

    _promptUnsavedChanges(options = {}) {
        const {
            title = 'Unsaved changes',
            message = 'You have unsaved changes. Save them before continuing?',
            showSave = true,
        } = options;

        if (!this._hasUnsavedChanges()) {
            return Promise.resolve('discard');
        }

        return new Promise((resolve) => {
            this._unsavedModalResolver = resolve;
            this.els.unsavedModalTitle.textContent = title;
            this.els.unsavedModalMessage.textContent = message;
            this.els.btnUnsavedSave.style.display = showSave ? '' : 'none';
            this.els.unsavedModal.style.display = 'flex';
        });
    }

    _resolveUnsavedModal(choice) {
        if (this._unsavedModalResolver) {
            const resolve = this._unsavedModalResolver;
            this._unsavedModalResolver = null;
            resolve(choice);
        }
        this._hideUnsavedModal();
    }

    _hideUnsavedModal() {
        if (this.els.unsavedModal) {
            this.els.unsavedModal.style.display = 'none';
        }
    }

    async _proceedPastUnsaved(options = {}) {
        if (!this._hasUnsavedChanges()) return true;

        const choice = await this._promptUnsavedChanges(options);
        if (choice === 'cancel') return false;
        if (choice === 'save') {
            return this._saveAllDirtyPages();
        }
        return true;
    }

    async _saveAllDirtyPages() {
        const pages = this._getDirtyPageNumbers();
        if (pages.length === 0) {
            this.isDirty = false;
            this._updateSaveUnsavedIndicator();
            return true;
        }

        this._persistDraft();
        const originalPage = this.currentPage;

        for (const pageNum of pages) {
            if (pageNum !== this.currentPage) {
                await this._goToPage(pageNum);
                await this._awaitPendingPageLoad();
            }
            const ok = await this._saveCurrentPage({ silent: true });
            if (!ok) {
                if (this.currentPage !== originalPage) {
                    await this._goToPage(originalPage);
                }
                this._updateSaveUnsavedIndicator();
                return false;
            }
        }

        if (this.currentPage !== originalPage) {
            await this._goToPage(originalPage);
        }
        this._showToast(
            `Saved ${pages.length} page${pages.length === 1 ? '' : 's'}`,
            'success'
        );
        this._updateSaveUnsavedIndicator();
        return true;
    }

    _persistSessionMeta() {
        if (!this.sessionId) return;
        try {
            localStorage.setItem(this._SESSION_STORAGE_KEY, JSON.stringify({
                sessionId: this.sessionId,
                currentPage: this.currentPage,
                pageCount: this.pageCount,
                updatedAt: Date.now(),
            }));
        } catch (err) {
            console.warn('Failed to persist session metadata:', err);
        }
    }

    async _persistDraft() {
        if (!this.sessionId) return;
        if (this.editor.canvas && this.isDirty) {
            this.pageStates[this.currentPage] = this.editor.toJSON();
            this._syncCurrentPageFormsState();
        }
        const payload = {
            pageStates: this.pageStates,
            pageFormStates: this.pageFormStates,
            currentPage: this.currentPage,
            updatedAt: Date.now(),
        };
        try {
            await API.saveDrafts(this.sessionId, payload);
        } catch (err) {
            console.warn('Failed to persist draft on server:', err);
        }
        try {
            localStorage.setItem(this._draftStorageKey(this.sessionId), JSON.stringify(payload));
            this._persistSessionMeta();
        } catch (err) {
            console.warn('Failed to persist draft locally:', err);
        }
    }

    _scheduleDraftPersist() {
        clearTimeout(this._draftPersistTimer);
        this._draftPersistTimer = setTimeout(() => {
            void this._persistDraft();
        }, 500);
    }

    async _loadDraft(sessionId) {
        try {
            const serverDraft = await API.getDrafts(sessionId);
            if (serverDraft?.pageStates && Object.keys(serverDraft.pageStates).length) {
                return serverDraft;
            }
        } catch {
            /* fall back to localStorage */
        }
        try {
            const raw = localStorage.getItem(this._draftStorageKey(sessionId));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    _clearSessionStorage(sessionId) {
        localStorage.removeItem(this._SESSION_STORAGE_KEY);
        if (sessionId) {
            localStorage.removeItem(this._draftStorageKey(sessionId));
        }
    }

    async _restoreSessionOnInit() {
        let stored;
        try {
            const raw = localStorage.getItem(this._SESSION_STORAGE_KEY);
            if (!raw) return;
            stored = JSON.parse(raw);
        } catch {
            this._clearSessionStorage();
            return;
        }

        if (!stored?.sessionId) return;

        try {
            const data = await API.getSession(stored.sessionId);
            const draft = await this._loadDraft(stored.sessionId);

            this._initSession(data, {
                deleteOldSession: false,
                clearDraft: false,
                skipInitialLoad: true,
            });

            if (draft) {
                this.pageStates = draft.pageStates || {};
                this.pageFormStates = draft.pageFormStates || {};
                this.dirtyPages = new Set(
                    Object.keys(this.pageStates).map((key) => parseInt(key, 10))
                );
            }

            const page = Math.min(
                Math.max(0, stored.currentPage ?? draft?.currentPage ?? 0),
                this.pageCount - 1
            );
            this.currentPage = page;
            this._updatePageInfo();
            await this._loadPage(page);
            this._showToast('Restored your previous document', 'success');
        } catch (err) {
            console.warn('Session restore failed:', err);
            this._clearSessionStorage(stored.sessionId);
            this.els.uploadZone.style.display = '';
            this.els.editorContainer.style.display = 'none';
            this.els.canvasLoading.style.display = 'none';
        }
    }

    async _uploadFile(file, password = null, options = {}) {
        const { skipUnsavedCheck = false } = options;
        if (!skipUnsavedCheck && !(await this._proceedPastUnsaved({
            message: 'You have unsaved changes. Save them before opening another file?',
        }))) {
            return;
        }

        if (file.type !== 'application/pdf') {
            this._showToast('Please select a PDF file', 'error');
            return;
        }
        if (file.size > 50 * 1024 * 1024) {
            this._showToast('File too large. Maximum size is 50MB.', 'error');
            return;
        }

        try {
            this._showToast('Uploading PDF...', 'success');
            const data = await API.uploadPDF(file, password);
            this._hidePasswordModal();
            this._initSession(data);
            this._showToast('PDF loaded successfully', 'success');
        } catch (err) {
            if (err.passwordRequired) {
                this._pendingUploadFile = file;
                this._showPasswordModal();
                return;
            }
            this._showToast(err.message, 'error');
        }
    }

    _showPasswordModal() {
        if (!this.els.passwordModal) return;
        this.els.pdfPasswordInput.value = '';
        this.els.passwordModal.style.display = 'flex';
        this.els.pdfPasswordInput.focus();
    }

    _hidePasswordModal() {
        if (this.els.passwordModal) this.els.passwordModal.style.display = 'none';
        this._pendingUploadFile = null;
    }

    async _confirmPasswordUpload() {
        const file = this._pendingUploadFile;
        const password = this.els.pdfPasswordInput.value;
        if (!file || !password) {
            this._showToast('Enter a password', 'error');
            return;
        }
        await this._uploadFile(file, password);
    }

    _initDesktopControls() {
        this.els.btnAbout?.addEventListener('click', () => this._showAboutModal());
        this.els.btnQuit?.addEventListener('click', () => this._showQuitModal());
        this.els.btnAboutClose?.addEventListener('click', () => this._hideAboutModal());
        this.els.btnQuitCancel?.addEventListener('click', () => this._hideQuitModal());
        this.els.btnQuitConfirm?.addEventListener('click', () => this._confirmQuit());
        this.els.aboutModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => this._hideAboutModal());
        this.els.quitModal?.querySelector('.modal-backdrop')?.addEventListener('click', () => this._hideQuitModal());
    }

    async _showAboutModal() {
        if (!this.els.aboutModal) return;
        if (!window.pdfEditDesktop?.getAppInfo) {
            this.els.aboutVersion.textContent = 'Version 1.0.0';
            this.els.aboutDataDir.textContent = 'Desktop mode only';
        } else {
            try {
                const info = await window.pdfEditDesktop.getAppInfo();
                this.els.aboutVersion.textContent = `Version ${info.version || '1.0.0'}`;
                this.els.aboutDataDir.textContent = info.dataDir || '—';
            } catch (_) {
                this.els.aboutVersion.textContent = 'Version 1.0.0';
                this.els.aboutDataDir.textContent = '—';
            }
        }
        this.els.aboutModal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [this.els.aboutModal] });
    }

    _hideAboutModal() {
        if (this.els.aboutModal) this.els.aboutModal.style.display = 'none';
    }

    _showQuitModal() {
        if (!this.els.quitModal) return;
        const hasUnsaved = this.isDirty && this.sessionId;
        this.els.quitModalMessage.textContent = hasUnsaved
            ? 'You have unsaved changes. Quitting now will discard them.'
            : 'Are you sure you want to quit PDFEdit?';
        this.els.quitModal.style.display = 'flex';
    }

    _hideQuitModal() {
        if (this.els.quitModal) this.els.quitModal.style.display = 'none';
    }

    async _confirmQuit() {
        this._hideQuitModal();
        if (window.pdfEditDesktop?.quit) {
            await window.pdfEditDesktop.quit();
            return;
        }
        this._showToast('Quit is only available in the desktop app', 'error');
    }

    _showNewPdfModal() {
        this.els.newPdfModal.style.display = 'flex';
        this.els.newPageSize.value = 'A4';
        this.els.customSizeFields.style.display = 'none';
    }

    _hideNewPdfModal() {
        this.els.newPdfModal.style.display = 'none';
    }

    async _closeDocument() {
        if (!this.sessionId) return;

        if (!(await this._proceedPastUnsaved({
            message: 'You have unsaved changes. Save them before closing?',
        }))) {
            return;
        }

        const sessionId = this.sessionId;
        this._unloadDocument(sessionId);
        this._showToast('Document closed', 'success');
    }

    _unloadDocument(sessionId) {
        clearTimeout(this._draftPersistTimer);

        if (this.editor.canvas) {
            this.editor.dispose();
        }
        const oldWrapper = this.els.canvasWrapper.querySelector('.canvas-container');
        if (oldWrapper) oldWrapper.remove();
        const oldCanvas = this.els.canvasWrapper.querySelector('#fabric-canvas');
        if (oldCanvas) oldCanvas.remove();

        this._clearSessionStorage(sessionId);
        API.deleteSession(sessionId).catch(() => {});

        this.sessionId = null;
        this.pageCount = 0;
        this.currentPage = 0;
        this.pageSizes = [];
        this.undoStack = [];
        this.undoIndex = -1;
        this.pageStates = {};
        this.pageFormStates = {};
        this.thumbnails = {};
        this.selectedFormXref = null;
        this.isDirty = false;
        this.dirtyPages = new Set();
        this.isLoading = false;
        this.isSaving = false;
        this.documentMode = false;
        this.searchResults = [];
        this.searchIndex = 0;
        this.pageLinks = [];
        this.documentLinks = [];
        this.selectedLink = null;
        this._detectedTables = [];
        this.pendingPageLoad = null;

        this.formLayer.clear();
        this._hideStickyPopup();
        this._hideCanvasContextMenu();
        this._hideExportModal();
        this._hidePasswordModal();

        if (this.els.thumbnailsList) {
            this.els.thumbnailsList.innerHTML = '';
        }
        if (this.els.findInput) {
            this.els.findInput.value = '';
            this.els.findInput.disabled = true;
            this.els.btnFindPrev.disabled = true;
            this.els.btnFindNext.disabled = true;
            if (this.els.findStatus) this.els.findStatus.textContent = '';
        }

        this.els.uploadZone.style.display = '';
        this.els.editorContainer.style.display = 'none';
        this.els.canvasLoading.style.display = 'none';
        this.els.canvasError.style.display = 'none';
        this.els.pageCountBadge.style.display = 'none';

        this.els.btnSave.disabled = true;
        this.els.btnDownload.disabled = true;
        if (this.els.btnMerge) this.els.btnMerge.disabled = true;
        if (this.els.btnDocument) this.els.btnDocument.disabled = true;
        if (this.els.btnClose) this.els.btnClose.disabled = true;
        this.els.btnUndo.disabled = true;
        this.els.btnRedo.disabled = true;

        this._updateSaveUnsavedIndicator();
        this.onAiConfiguredChanged(false);
        AIAssistant.clearHistory();
        AIAssistant.close();
        this.toolbar.setActiveTool('select');
        this._showContextProperties();
    }

    async _createNewPdf() {
        if (!(await this._proceedPastUnsaved({
            message: 'You have unsaved changes. Save them before creating a new document?',
        }))) {
            return;
        }

        const size = this.els.newPageSize.value;
        let width, height;
        if (size === 'custom') {
            width = parseInt(this.els.newCustomWidth.value) || 595;
            height = parseInt(this.els.newCustomHeight.value) || 842;
        }

        try {
            this._hideNewPdfModal();
            this._showToast('Creating new PDF...', 'success');
            const data = await API.newPDF(size, width, height);
            this._initSession(data);
            this._showToast('New PDF created', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _initSession(data, options = {}) {
        const {
            deleteOldSession = true,
            clearDraft = true,
            skipInitialLoad = false,
            initialPage = 0,
        } = options;
        const oldSessionId = this.sessionId;

        if (deleteOldSession && oldSessionId && oldSessionId !== data.session_id) {
            this._clearSessionStorage(oldSessionId);
            API.deleteSession(oldSessionId).catch(() => {});
        }

        this.sessionId = data.session_id;
        this.pageCount = data.page_count;
        this.pageSizes = data.page_sizes || [];
        this.currentPage = initialPage;
        this.undoStack = [];
        this.undoIndex = -1;
        if (clearDraft) {
            this.pageStates = {};
            this.pageFormStates = {};
            this.dirtyPages = new Set();
        }
        this.thumbnails = {};
        this.selectedFormXref = null;
        this.isDirty = false;
        this.formLayer.clear();
        this._updateSaveUnsavedIndicator();

        this.els.uploadZone.style.display = 'none';
        this.els.editorContainer.style.display = 'flex';
        this.els.btnSave.disabled = false;
        this.els.btnDownload.disabled = false;
        if (this.els.btnMerge) this.els.btnMerge.disabled = false;
        if (this.els.btnDocument) this.els.btnDocument.disabled = false;
        if (this.els.btnClose) this.els.btnClose.disabled = false;
        if (this.els.findInput) {
            this.els.findInput.disabled = false;
            this.els.btnFindPrev.disabled = false;
            this.els.btnFindNext.disabled = false;
        }
        this.documentMode = false;
        this.els.pageCountBadge.style.display = 'flex';
        this._updatePageInfo();
        this._updateUndoRedoButtons();
        this.onAiConfiguredChanged(AISettings.configured);
        this.toolbar.setActiveTool('select');
        this._toggleThumbnails(true);
        this._persistSessionMeta();

        if (!skipInitialLoad) {
            this._loadPage(initialPage);
        }
    }

    async _loadPage(pageNum, options = {}) {
        if (pageNum < 0 || pageNum >= this.pageCount) return;
        const { preserveCurrentPage = false, fallbackPage = pageNum } = options;
        this.isLoading = true;
        this.editor.clearDeletedOriginals();
        this.editor.clearSearchHighlights();
        this.editor.clearTableOverlays();
        this.editor.clearLinkOverlays();
        this.formLayer.clear();
        if (this.els.tablesOverlayInfo) this.els.tablesOverlayInfo.style.display = 'none';
        if (this.els.btnExportTables) this.els.btnExportTables.style.display = 'none';

        this.els.canvasLoading.style.display = 'flex';
        this.els.canvasError.style.display = 'none';

        try {
            const pageData = await API.getPage(this.sessionId, pageNum, { maskEditable: true });
            const canvasW = pageData.width;
            const canvasH = pageData.height;

            this.pageSizes[pageNum] = {
                width: pageData.pdf_width,
                height: pageData.pdf_height,
            };

            if (this.editor.canvas) {
                this.editor.dispose();
            }

            const oldWrapper = this.els.canvasWrapper.querySelector('.canvas-container');
            if (oldWrapper) oldWrapper.remove();
            const oldCanvas = this.els.canvasWrapper.querySelector('#fabric-canvas');
            if (oldCanvas) oldCanvas.remove();

            const newCanvas = document.createElement('canvas');
            newCanvas.id = 'fabric-canvas';
            this.els.canvasWrapper.insertBefore(newCanvas, this.els.canvasWrapper.firstChild);
            this.els.fabricCanvas = newCanvas;

            this.editor.init(newCanvas, canvasW, canvasH);
            this.editor.pdfScale = 2;
            this._attachEditorCallbacks();

            await this.editor.setBackground(pageData.image);

            this.els.canvasLoading.style.display = 'none';

            if (this.pageStates[pageNum]) {
                const localState = this.pageStates[pageNum];
                if (localState.objects && localState.objects.length > 0) {
                    await this.editor.loadFromJSON(localState);
                    await this.editor.setBackground(pageData.image);
                } else {
                    await this._loadPageElements(pageNum);
                }
            } else {
                await this._loadPageElements(pageNum);
            }

            await this._loadPageForms(pageNum);
            await this._loadPageLinks(pageNum);

            if (!preserveCurrentPage) {
                this.currentPage = pageNum;
            }
            this._updatePageInfo();
            this._fitToView();
            this._resetCanvasScrollTop();

            this._showContextProperties();

            this.editor.setTool(this.toolbar.activeTool);
            this._syncFormLayerInteraction();

            this._storeThumbnailFromCanvas(pageNum);

            this.undoStack = [];
            this.undoIndex = -1;
            this._seedUndoHistory();

        } catch (err) {
            if (preserveCurrentPage) {
                this.currentPage = fallbackPage;
                this._updatePageInfo();
            }
            this.els.canvasLoading.style.display = 'none';
            this.els.canvasError.style.display = 'flex';
            console.error('Failed to load page:', err);
        } finally {
            this.isLoading = false;
            this.isDirty = false;
            this._updateSaveUnsavedIndicator();
        }
    }

    _seedUndoHistory() {
        if (!this.editor?.canvas) return;
        this.editor.assignIdsToAllObjects();
        this.editor.canvas.getObjects().forEach((obj) => obj.setCoords());
        this.editor.renderAll();
        this._recordUndoState();
        this._updateUndoRedoButtons();
    }

    async _loadPageElements(pageNum) {
        try {
            const data = await API.getPageElements(this.sessionId, pageNum);
            if (data.elements && data.elements.length > 0) {
                this.editor.loadElements(data.elements);
            }
            this.editor.assignIdsToAllObjects();
        } catch (err) {
            console.warn('Failed to load page elements:', err);
        }
    }

    async _loadPageForms(pageNum) {
        try {
            let forms = this.pageFormStates[pageNum];
            if (!forms) {
                const data = await API.getPageForms(this.sessionId, pageNum);
                forms = data.forms || [];
                this.pageFormStates[pageNum] = forms;
            }

            this.formLayer.setForms(forms, this.editor.canvasWidth, this.editor.canvasHeight);
            this.formLayer.setZoom(this.editor.zoomLevel);
            this.formLayer.syncPosition();
        } catch (err) {
            console.warn('Failed to load page forms:', err);
            this.formLayer.clear();
            this.pageFormStates[pageNum] = [];
        }
    }

    async _goToPage(pageNum) {
        if (pageNum < 0 || pageNum >= this.pageCount || pageNum === this.currentPage) return;
        if (this.isSaving) return;

        const previousPage = this.currentPage;
        this._storeThumbnailFromCanvas(previousPage);
        if (this.isDirty) {
            this.pageStates[previousPage] = this.editor.toJSON();
            this._syncCurrentPageFormsState();
            this.dirtyPages.add(previousPage);
        } else {
            delete this.pageStates[previousPage];
        }
        this._persistDraft();
        this._updateSaveUnsavedIndicator();

        this.currentPage = pageNum;
        this._updatePageInfo();
        this._persistSessionMeta();

        const loadPromise = this._loadPage(pageNum, { preserveCurrentPage: true, fallbackPage: previousPage });
        this.pendingPageLoad = loadPromise;

        try {
            await loadPromise;
        } finally {
            if (this.pendingPageLoad === loadPromise) {
                this.pendingPageLoad = null;
            }
        }
    }

    async _awaitPendingPageLoad() {
        if (!this.pendingPageLoad) return;
        try {
            await this.pendingPageLoad;
        } catch (_) {
            // _loadPage already updates the visible error state.
        }
    }

    _updatePageInfo() {
        this.els.pageInput.value = this.currentPage + 1;
        this.els.totalPages.textContent = this.pageCount;
        this.els.prevPage.disabled = this.currentPage <= 0;
        this.els.nextPage.disabled = this.currentPage >= this.pageCount - 1;
        this.els.pageCountText.textContent = `${this.pageCount} page${this.pageCount !== 1 ? 's' : ''}`;
        this._highlightActiveThumbnail();
    }

    _setZoom(zoom) {
        this.editor.setZoom(zoom);
        this.formLayer.setZoom(this.editor.zoomLevel);
        this.formLayer.syncPosition();
        this.els.zoomLevel.textContent = Math.round(this.editor.zoomLevel * 100) + '%';
        this._repositionStickyPopup();
    }

    _handleCanvasContextMenu(context) {
        if (!context || !context.hasSelection) {
            this._hideCanvasContextMenu();
            return;
        }

        const menu = this.els.editorContextMenu;
        const btnPin = this.els.btnContextPin;
        const btnUnpin = this.els.btnContextUnpin;

        const target = context.target;
        const isSticky = target && target._elementType === 'sticky';
        if (isSticky) {
            const pinned = !!target._stickyPinned;
            btnPin.style.display = pinned ? 'none' : 'flex';
            btnUnpin.style.display = pinned ? 'flex' : 'none';
        } else {
            btnPin.style.display = 'none';
            btnUnpin.style.display = 'none';
        }

        const textObjects = (context.selectedObjects || []).filter((o) => this.editor.isTextObject(o));
        this._contextMenuTextObjects = textObjects;

        const tableContext = context.tableCellHit
            ? {
                table: context.tableCellHit.table,
                row: context.tableCellHit.row,
                col: context.tableCellHit.col,
            }
            : this.editor.getTableContextFromTarget?.(target);
        this._contextMenuTableTarget = tableContext;
        if (tableContext?.table) {
            tableContext.table._activeCell = { row: tableContext.row, col: tableContext.col };
        }

        const showPageAlign = textObjects.length >= 2 && !tableContext;
        this.els.contextAlignSection.style.display = showPageAlign ? 'block' : 'none';
        this.els.contextMenuDivider.style.display = showPageAlign ? 'block' : 'none';

        const showMerge = textObjects.length >= 2;
        if (this.els.btnContextMergeText) {
            this.els.btnContextMergeText.style.display = showMerge ? 'flex' : 'none';
        }

        const showAi = textObjects.length >= 1 && AISettings.configured;
        if (this.els.editorContextAiSection) {
            this.els.editorContextAiSection.style.display = showAi ? 'block' : 'none';
        }
        if (this.els.contextMenuDividerAi) {
            this.els.contextMenuDividerAi.style.display = showAi ? 'block' : 'none';
        }

        const showTable = !!tableContext;
        if (this.els.contextTableSection) {
            this.els.contextTableSection.style.display = showTable ? 'block' : 'none';
        }
        if (this.els.contextTableDivider) {
            this.els.contextTableDivider.style.display = showTable ? 'block' : 'none';
        }

        menu.style.display = 'block';

        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [menu] });
        }

        const { innerWidth, innerHeight } = window;
        const menuRect = menu.getBoundingClientRect();
        const left = Math.min(context.x, innerWidth - menuRect.width - 12);
        const top = Math.min(context.y, innerHeight - menuRect.height - 12);

        menu.style.left = `${Math.max(12, left)}px`;
        menu.style.top = `${Math.max(12, top)}px`;
    }

    _pushAlignUndoPair(beforeItems, afterItems) {
        if (!beforeItems?.length || !afterItems?.length) return;
        this._pushUndoEntry({ kind: 'positions', items: beforeItems });
        this._pushUndoEntry({ kind: 'positions', items: afterItems });
    }

    _alignSelectionToPageMargins(mode) {
        const objects = (this._contextMenuTextObjects || []).filter((o) => this.editor.isTextObject(o));
        this._hideCanvasContextMenu();
        if (objects.length < 2) return;

        const beforePositions = this.editor.captureObjectPositionsForUndo(objects);

        this._suppressUndoRecording = true;
        let ok = false;
        try {
            ok = this.editor.alignTextObjectsToPageMargins(objects, mode, { skipModifiedCallback: true });
        } finally {
            this._suppressUndoRecording = false;
        }

        if (ok) {
            const afterPositions = this.editor.captureObjectPositionsForUndo(objects);
            this._pushAlignUndoPair(beforePositions, afterPositions);
            this._markDirty();
        }
        this._contextMenuTextObjects = null;
    }

    _hideCanvasContextMenu() {
        this.els.editorContextMenu.style.display = 'none';
        this._contextMenuTextObjects = null;
        this._contextMenuTableTarget = null;
    }

    _deleteSelectedObjects() {
        this._hideCanvasContextMenu();
        this.editor.deleteSelected();
    }

    _toggleStickyPin(pin) {
        this._hideCanvasContextMenu();
        const obj = this.editor.getActiveObject();
        if (!obj || obj._elementType !== 'sticky') return;
        obj._stickyPinned = pin;
        obj.set({
            lockMovementX: pin,
            lockMovementY: pin,
        });
        if (pin) {
            this._showStickyPopup(obj);
        } else {
            this._hideStickyPopup(true);
        }
        this.editor.canvas.requestRenderAll();
    }

    _fitToView() {
        if (!this.editor.canvas) return;
        const wrapper = this.els.canvasWrapper;
        const styles = window.getComputedStyle(wrapper);
        const padX = parseFloat(styles.paddingLeft || '0') + parseFloat(styles.paddingRight || '0');
        const padY = parseFloat(styles.paddingTop || '0') + parseFloat(styles.paddingBottom || '0');
        const w = Math.max(0, wrapper.clientWidth - padX);
        const h = Math.max(0, wrapper.clientHeight - padY);
        this.editor.fitToView(w, h);
        this.formLayer.setZoom(this.editor.zoomLevel);
        this.formLayer.syncPosition();
        this.els.zoomLevel.textContent = Math.round(this.editor.zoomLevel * 100) + '%';
    }

    _resetCanvasScrollTop() {
        requestAnimationFrame(() => {
            if (this.els.canvasWrapper) {
                this.els.canvasWrapper.scrollTop = 0;
            }
            this.formLayer.syncPosition();
        });
    }

    async _saveCurrentPage(options = {}) {
        if (this.isSaving || !this.sessionId) return false;
        const { silent = false } = options;
        this.isSaving = true;
        this._updateSaveUnsavedIndicator();
        this.els.btnSave.disabled = true;
        const originalHTML = this.els.btnSave.innerHTML;
        this.els.btnSave.innerHTML = '<span class="spinner"></span><span>Saving</span>';

        try {
            const elements = this.editor.getObjects();
            const deleted_originals = [
                ...this.editor.getDeletedOriginals(),
                ...this.editor.getOcrRedactAreas(),
            ];
            const forms = this.formLayer.getForms();
            this.pageFormStates[this.currentPage] = forms;
            const result = await API.savePage(this.sessionId, this.currentPage, elements, deleted_originals, forms);

            if (result.thumbnail) {
                this.thumbnails[this.currentPage] = result.thumbnail;
                this._updateThumbnail(this.currentPage);
            } else {
                this._storeThumbnailFromCanvas();
            }

            this.editor.clearDeletedOriginals();
            delete this.pageStates[this.currentPage];
            this.dirtyPages.delete(this.currentPage);
            this.isDirty = false;
            void this._persistDraft();
            if (!silent) {
                this._showToast(
                    result.saved_path ? 'Page saved to data/saved' : 'Page saved',
                    'success',
                );
            }
            return true;
        } catch (err) {
            this._showToast(err.message, 'error');
            return false;
        } finally {
            this.isSaving = false;
            this.els.btnSave.disabled = false;
            this.els.btnSave.innerHTML = originalHTML;
            lucide.createIcons();
            this._updateSaveUnsavedIndicator();
        }
    }

    _downloadBlob(blob, filename) {
        if (window.pdfEditDesktop?.saveFile) {
            window.pdfEditDesktop.saveFile(blob, filename).catch((err) => {
                console.error('Native save failed, falling back to browser download:', err);
                this._downloadBlobBrowser(blob, filename);
            });
            return;
        }
        this._downloadBlobBrowser(blob, filename);
    }

    _downloadBlobBrowser(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    _showExportModal() {
        if (!this.sessionId || !this.els.exportModal) return;
        this.els.exportFromPage.value = 1;
        this.els.exportToPage.value = this.pageCount;
        this.els.exportFlatten.checked = false;
        this.els.exportSplitPages.checked = false;
        this.els.exportUserPassword.value = '';
        this.els.exportOwnerPassword.value = '';
        this.els.exportModal.style.display = 'flex';
    }

    _hideExportModal() {
        if (this.els.exportModal) this.els.exportModal.style.display = 'none';
    }

    async _confirmExport() {
        if (!this.sessionId) return;
        this._hideExportModal();
        await this._exportPDF({
            flatten: this.els.exportFlatten.checked,
            split_pages: this.els.exportSplitPages.checked,
            from_page: parseInt(this.els.exportFromPage.value, 10) - 1,
            to_page: parseInt(this.els.exportToPage.value, 10) - 1,
            user_password: this.els.exportUserPassword.value || null,
            owner_password: this.els.exportOwnerPassword.value || null,
        });
    }

    async _exportPDF(options = {}) {
        if (!this.sessionId) return;
        this.els.btnDownload.disabled = true;
        const originalHTML = this.els.btnDownload.innerHTML;
        this.els.btnDownload.innerHTML = '<span class="spinner"></span><span>Exporting</span>';

        try {
            await this._saveAllPagesBeforeExport();

            const blob = await API.exportPDF(this.sessionId, options);
            const filename = options.split_pages ? 'pages.zip' : 'edited.pdf';
            this._downloadBlob(blob, filename);
            this._showToast(options.split_pages ? 'ZIP downloaded' : 'PDF downloaded', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        } finally {
            this.els.btnDownload.disabled = false;
            this.els.btnDownload.innerHTML = originalHTML;
            lucide.createIcons();
        }
    }

    async _saveAllPagesBeforeExport() {
        const elements = this.editor.getObjects();
        const deleted_originals = [
            ...this.editor.getDeletedOriginals(),
            ...this.editor.getOcrRedactAreas(),
        ];
        const forms = this.formLayer.getForms();
        this.pageFormStates[this.currentPage] = forms;
        await API.savePage(this.sessionId, this.currentPage, elements, deleted_originals, forms);
    }

    _pushUndoEntry(entry) {
        if (!entry) return;

        if (this.undoIndex >= 0 && this.undoIndex < this.undoStack.length - 1) {
            this.undoStack = this.undoStack.slice(0, this.undoIndex + 1);
        }

        this.undoStack.push(entry);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.undoIndex = this.undoStack.length - 1;
        this._updateUndoRedoButtons();
    }

    _pushUndoSnapshot() {
        const snapshot = this.editor?.captureUndoSnapshot?.();
        if (snapshot) {
            this._pushUndoEntry(snapshot);
        }
    }

    _recordUndoState() {
        if (this.isLoading || this._suppressUndoRecording) return;
        if (!this.editor?.canvas) return;

        try {
            const items = this.editor.captureObjectPositions();
            if (!items.length) return;
            this._pushUndoEntry({ kind: 'positions', items });
        } catch (err) {
            console.warn('Failed to record undo state:', err);
        }
    }

    async _applyUndoState(state) {
        if (!state) return;
        this._suppressUndoRecording = true;
        try {
            if (state.kind === 'positions') {
                this.editor.restoreObjectPositions(state.items);
            } else if (state.kind === 'snapshot') {
                await this.editor.restoreUndoSnapshot(state);
            }
            this.toolbar.showPropertiesForObjects(this.editor.getActiveObjects());
        } finally {
            this._suppressUndoRecording = false;
        }
    }

    async _undo() {
        if (this.undoIndex <= 0) return;
        this.undoIndex -= 1;
        await this._applyUndoState(this.undoStack[this.undoIndex]);
        this._markDirty();
        this._updateUndoRedoButtons();
    }

    async _redo() {
        if (this.undoIndex >= this.undoStack.length - 1) return;
        this.undoIndex += 1;
        await this._applyUndoState(this.undoStack[this.undoIndex]);
        this._markDirty();
        this._updateUndoRedoButtons();
    }

    _updateUndoRedoButtons() {
        const canUndo = this.undoIndex > 0;
        const canRedo = this.undoIndex >= 0 && this.undoIndex < this.undoStack.length - 1;
        this.els.btnUndo.disabled = !canUndo;
        this.els.btnRedo.disabled = !canRedo;
    }

    _selectToolAfterDraw(createdObject) {
        const placementTools = new Set([
            'stamp', 'rect', 'ellipse', 'line', 'star',
            'highlight', 'redaction', 'sticky', 'freehand', 'table',
        ]);
        if (!placementTools.has(this.toolbar.activeTool) && !placementTools.has(this.editor.currentTool)) {
            return;
        }

        this.toolbar.setActiveTool('select');
        this.editor.activateSelectTool();

        if (createdObject) {
            const shapeMap = { rect: 'rect', ellipse: 'ellipse', star: 'star', line: 'line' };
            const shape = shapeMap[createdObject._elementType] || (createdObject.type === 'line' ? 'line' : 'rect');
            const shapeBtn = document.getElementById('btn-shape-main');
            const shapeMenu = document.getElementById('shape-dropdown-menu');
            if (shapeBtn && shapeMenu) {
                shapeMenu.querySelectorAll('.menu-item').forEach((item) => {
                    item.classList.toggle('active', item.dataset.shape === shape);
                });
                shapeBtn.dataset.tool = shape;
            }
        }

        if (createdObject && this.editor.canvas) {
            this.editor.canvas.setActiveObject(createdObject);
            createdObject.setCoords();
            this.editor.canvas.requestRenderAll();
            this.toolbar.showPropertiesForObjects([createdObject]);
            return;
        }

        this._showContextProperties();
    }

    _onToolChange(tool) {
        this.documentMode = false;

        if (tool !== 'forms' && tool !== 'select') {
            this._clearFormSelection(false);
        }

        if (this.toolbar.activeTool === 'link' && tool !== 'link') {
            this.editor.clearLinkOverlays();
            this._linkDrawAreaMode = false;
            this._cancelCertSignPlacement(false);
        }

        if (tool === 'stamp') {
            this.toolbar.setActiveTool('stamp');
            this.editor.setTool('stamp');
            this.editor.setStampType(this.els.propStampType?.value || 'approved');
            this.formLayer.setInteractive(false);
            this.formLayer.setMovable(false);
            this.toolbar.showStampProperties('place');
            const cfg = this.editor.stampConfig || StampKit.getPreset('approved');
            this.toolbar.syncStampConfigForPlacement(cfg);
            return;
        }

        if (tool === 'link') {
            this.toolbar.setActiveTool('link');
            this.editor.setTool('link');
            this.editor.setLinkDrawMode(this._linkDrawAreaMode);
            this.formLayer.setInteractive(false);
            this.formLayer.setMovable(false);
            this.toolbar.showLinkProperties();
            this._updateLinkPropVisibility();
            this._updateLinkSelectedTextButton();
            this._refreshLinkList();
            return;
        }

        if (tool === 'signature') {
            this.toolbar.setActiveTool('signature');
            this.editor.setTool('select');
            this.formLayer.setInteractive(false);
            this.formLayer.setMovable(false);
            this._showContextProperties();
            return;
        }

        if (tool === 'image') {
            this.formLayer.setInteractive(false);
            this.formLayer.setMovable(false);
            const cellTarget = this.editor.getTableCellTargetFromSelection?.();
            if (cellTarget) {
                this.els.imageInput.click();
                this._showContextProperties();
                return;
            }
            this.els.imageInput.click();
            this.toolbar.setActiveTool('select');
            this.editor.setTool('select');
            this._showContextProperties();
            return;
        }

        if (tool === 'forms') {
            this.toolbar.setActiveTool('forms');
            this.editor.setTool('forms');
            this._syncFormLayerInteraction();
            this._showFormProperties();
            return;
        }

        this.toolbar.setActiveTool(tool);
        if (tool === 'select') {
            this.editor.activateSelectTool();
        } else {
            this.editor.setTool(tool);
        }
        this._syncFormLayerInteraction();
        this._showContextProperties();

        // Sync shape tool dropdown active item if tool is rect, ellipse, line, or star
        if (['rect', 'ellipse', 'line', 'star'].includes(tool)) {
            const shapeBtn = document.getElementById('btn-shape-main');
            const menu = document.getElementById('shape-dropdown-menu');
            if (shapeBtn && menu) {
                let shapeName = tool;
                if (tool === 'line') {
                    shapeName = this.editor.arrowMode ? 'arrow' : 'line';
                }
                
                shapeBtn.dataset.tool = tool;

                const menuItems = menu.querySelectorAll('.menu-item');
                menuItems.forEach(item => {
                    const isActive = item.dataset.shape === shapeName;
                    item.classList.toggle('active', isActive);
                });
            }
        }
    }

    _syncCurrentPageFormsState() {
        if (this.currentPage < 0) return;
        this.pageFormStates[this.currentPage] = this.formLayer.getForms();
    }

    _showFormProperties() {
        this.toolbar.showFormProperties(this.formLayer.getForms(), this.formLayer.getSelectedFields());
    }

    _syncFormLayerInteraction() {
        const formsTool = this.toolbar.activeTool === 'forms';
        const selectTool = this.toolbar.activeTool === 'select';

        this.formLayer.setInteractive(formsTool);
        this.formLayer.setMovable(selectTool && this.formLayer.getSelectedFields().length > 0);
        this.formLayer._updateSelectionUI();
        this.formLayer.syncPosition();
    }

    _hitTestFormFieldAtClientPoint(clientX, clientY) {
        const forms = this.formLayer.getForms();
        if (!forms.length || !this.els.formLayer) return null;

        const layerRect = this.els.formLayer.getBoundingClientRect();
        if (
            clientX < layerRect.left
            || clientX > layerRect.right
            || clientY < layerRect.top
            || clientY > layerRect.bottom
        ) {
            return null;
        }

        const zoom = this.formLayer.zoom || 1;
        const x = (clientX - layerRect.left) / zoom;
        const y = (clientY - layerRect.top) / zoom;

        for (let index = forms.length - 1; index >= 0; index -= 1) {
            const field = forms[index];
            const bbox = field.bbox || [0, 0, 0, 0];
            if (x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3]) {
                return field;
            }
        }

        return null;
    }

    _rectsIntersect(a, b) {
        return a.left < b.right
            && a.right > b.left
            && a.top < b.bottom
            && a.bottom > b.top;
    }

    _getFormsInCanvasRect(rect) {
        return this.formLayer.getForms().filter((field) => {
            const bbox = field.bbox || [0, 0, 0, 0];
            return this._rectsIntersect(rect, {
                left: bbox[0],
                top: bbox[1],
                right: bbox[2],
                bottom: bbox[3],
            });
        });
    }

    _onSelectCanvasPointerDown(opt) {
        if (this.toolbar.activeTool !== 'select') return false;

        const event = opt.e;
        const formHit = this._hitTestFormFieldAtClientPoint(event.clientX, event.clientY);
        const selectedForms = this.formLayer.getSelectedFields();

        if (formHit) {
            const alreadySelected = selectedForms.some((field) => field.xref === formHit.xref);
            if (!alreadySelected) {
                this._selectFormField(formHit.xref, {
                    extend: event.ctrlKey || event.metaKey,
                    range: event.shiftKey,
                });
                if (this.editor.canvas) {
                    this.editor.canvas.discardActiveObject();
                    this.editor.canvas.requestRenderAll();
                }
                return true;
            }
            return false;
        }

        if (selectedForms.length > 0) {
            this._clearFormSelection(false);
        }

        return false;
    }

    _onSelectCanvasPointerUp(selection) {
        if (this.toolbar.activeTool !== 'select' || !selection?.start || !selection?.end) return false;

        const dx = selection.end.x - selection.start.x;
        const dy = selection.end.y - selection.start.y;
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return false;

        const rect = {
            left: Math.min(selection.start.x, selection.end.x),
            top: Math.min(selection.start.y, selection.end.y),
            right: Math.max(selection.start.x, selection.end.x),
            bottom: Math.max(selection.start.y, selection.end.y),
        };
        const fields = this._getFormsInCanvasRect(rect);

        if (!fields.length) {
            if (this.formLayer.getSelectedFields().length > 0) {
                this._clearFormSelection(false);
            }
            return false;
        }

        if (this.editor.canvas) {
            this.editor.canvas.discardActiveObject();
            this.editor.canvas.requestRenderAll();
        }
        this.formLayer.selectFields(fields.map((field) => field.xref));
        return true;
    }

    _showContextProperties() {
        if (this.documentMode) {
            return;
        }

        if (this.toolbar.activeTool === 'stamp') {
            const active = this.editor.getActiveObject();
            if (active?._elementType === 'stamp') {
                this.toolbar._showStampProps(active);
            } else {
                this.toolbar.showStampProperties('place');
            }
            return;
        }

        if (this.toolbar.activeTool === 'table') {
            const active = this.editor.getActiveObject();
            const cellTarget = this.editor.getTableCellTargetFromSelection?.();
            const table = active?._elementType === 'table' ? active : cellTarget?.table;
            if (table) {
                this.toolbar._showTableProps(table);
                this.toolbar.syncTableCellOps(cellTarget || (table._activeCell
                    ? { table, row: table._activeCell.row, col: table._activeCell.col }
                    : null));
            } else {
                this.toolbar.showTableProperties('place');
            }
            return;
        }

        if (this.toolbar.activeTool === 'link') {
            this.toolbar.showLinkProperties();
            return;
        }

        if (this.toolbar.activeTool === 'signature') {
            this.toolbar._hideAllProps();
            const sigProps = document.getElementById('props-signature');
            if (sigProps) sigProps.style.display = 'block';
            return;
        }

        if (this.toolbar.activeTool === 'forms' || this.formLayer.getSelectedFields().length > 0) {
            this._showFormProperties();
            return;
        }

        const activeObjects = this.editor.canvas ? this.editor.getActiveObjects() : [];
        if (activeObjects && activeObjects.length > 0) {
            this.toolbar.showPropertiesForObjects(activeObjects);
            return;
        }

        if (this.toolbar.activeTool === 'freehand') {
            this.toolbar.showBrushProperties(this.editor.getBrushSettings());
            return;
        }

        this.toolbar.showPageProperties(
            this.pageSizes[this.currentPage]?.width || 595,
            this.pageSizes[this.currentPage]?.height || 842
        );
    }

    _clearFormSelection(refreshPanel = true) {
        this.selectedFormXref = null;
        this.formLayer.clearSelection();
        this._syncFormLayerInteraction();
        if (refreshPanel) {
            this._showContextProperties();
        }
    }

    _selectFormField(xref, options = {}) {
        this.formLayer.selectField(xref, {
            focus: options.focus,
            extend: options.extend,
            range: options.range,
        });
    }

    _onFormFieldSelected(field, selectedFields = null) {
        this.selectedFormXref = field?.xref ?? null;
        this._syncCurrentPageFormsState();
        this._syncFormLayerInteraction();
        if (selectedFields) {
            this.toolbar.showFormProperties(this.formLayer.getForms(), selectedFields);
        } else {
            this._showFormProperties();
        }
    }

    _onFormFieldChanged(field) {
        this.selectedFormXref = field?.xref ?? this.selectedFormXref;
        this._syncCurrentPageFormsState();
        this._showFormProperties();
        this._markDirty();
    }

    _onFormFieldsBatchChanged(fields) {
        this._syncCurrentPageFormsState();
        this._showFormProperties();
        this._markDirty();
    }

    _matchFormFieldSizes(dimension) {
        const updated = this.formLayer.matchSelectedFieldSizes(dimension);
        if (!updated.length) {
            this._showToast('Select two or more fields of the same type first', 'info');
            return;
        }
        this._showToast(`Resized ${updated.length} field${updated.length === 1 ? '' : 's'} to match`, 'success');
    }

    _onFormValueChange(value) {
        const field = this.formLayer.getSelectedField();
        if (!field) return;
        this.formLayer.updateFieldValue(field.xref, value);
    }

    _onFormPropertiesChange(properties) {
        const field = this.formLayer.getSelectedField();
        if (!field) return;
        this.formLayer.updateFieldProperties(field.xref, properties);
    }

    async _createFormField(kind) {
        if (!this.sessionId || this.isLoading || this.isSaving) return;

        try {
            const result = await API.createPageForm(this.sessionId, this.currentPage, kind);
            const forms = result.forms || [];
            this.pageFormStates[this.currentPage] = forms;
            this.formLayer.setForms(forms, this.editor.canvasWidth, this.editor.canvasHeight);
            this.formLayer.setZoom(this.editor.zoomLevel);
            this._syncFormLayerInteraction();

            if (result.thumbnail) {
                this.thumbnails[this.currentPage] = result.thumbnail;
                this._updateThumbnail(this.currentPage);
            }

            if (result.form?.xref) {
                this._selectFormField(result.form.xref, { focus: this.toolbar.activeTool === 'forms' });
            } else {
                this._showFormProperties();
            }

            this._showToast('Form field created', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _deleteFormField(xref) {
        if (!this.sessionId || this.isLoading || this.isSaving || !xref) return;

        this.selectedFormXref = null;

        try {
            const result = await API.deletePageForm(this.sessionId, this.currentPage, xref);
            const forms = result.forms || [];
            this.pageFormStates[this.currentPage] = forms;
            this.formLayer.setForms(forms, this.editor.canvasWidth, this.editor.canvasHeight);
            this.formLayer.setZoom(this.editor.zoomLevel);
            this._syncFormLayerInteraction();

            if (result.thumbnail) {
                this.thumbnails[this.currentPage] = result.thumbnail;
                this._updateThumbnail(this.currentPage);
            }

            this._showFormProperties();
            this._showToast('Form field deleted', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _duplicateFormField(xref) {
        if (!this.sessionId || this.isLoading || this.isSaving || !xref) return;

        const sourceField = this.formLayer.getForms().find((field) => field.xref === xref) || null;

        try {
            const result = await API.duplicatePageForm(this.sessionId, this.currentPage, xref, sourceField);
            const forms = result.forms || [];
            this.pageFormStates[this.currentPage] = forms;
            this.formLayer.setForms(forms, this.editor.canvasWidth, this.editor.canvasHeight);
            this.formLayer.setZoom(this.editor.zoomLevel);
            this._syncFormLayerInteraction();

            if (result.thumbnail) {
                this.thumbnails[this.currentPage] = result.thumbnail;
                this._updateThumbnail(this.currentPage);
            }

            if (result.form?.xref) {
                this._selectFormField(result.form.xref, { focus: this.toolbar.activeTool === 'forms' });
            } else {
                this._showFormProperties();
            }

            this._showToast('Form field duplicated', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _onPropertyChange(type, prop, value) {
        if (type === 'brush') {
            this.editor.setBrushSetting(prop, value);
            return;
        }

        if (type === 'stamp' && prop === 'stampType') {
            const active = this.editor.getActiveObject();
            const preset = StampKit.getPreset(value);
            if (this.els.propStampType) this.els.propStampType.value = value;
            this.toolbar._syncStampPresetButtons(value);
            this.refreshStampPresetGrid(value);

            if (active?._elementType === 'stamp') {
                const cfg = this.getStampConfigFromPanelForRebuild(active, preset);
                const updated = this.editor.rebuildStamp(active, cfg);
                if (updated) {
                    this.toolbar.syncStampPropsFromObject(updated);
                    this._markDirty();
                }
                return;
            }

            this.editor.setStampConfig(preset);
            this.toolbar.syncStampConfigForPlacement(preset);
            return;
        }

        if (type === 'table') {
            const active = this.editor.getActiveObject();
            const cellTarget = this.editor.getTableCellTargetFromSelection?.();
            const table = active?._elementType === 'table' ? active : cellTarget?.table;
            if (table) {
                const updated = prop === 'textLayer'
                    ? this.editor.setTableTextLayer(table, value)
                    : this.editor.rebuildTable(table, { [prop]: value });
                if (updated) {
                    this.toolbar.syncTablePropsFromObject(updated);
                    this._markDirty();
                }
            } else {
                this.editor.setTableDefault(prop, value);
                this.toolbar.syncTableDefaults(this.editor.tableDefaults);
            }
            return;
        }

        const obj = this.editor.getActiveObject();
        if (!obj) return;

        switch (type) {
            case 'text':
                if (prop === 'pageAlign') {
                    const targets = obj.type === 'activeSelection'
                        ? obj.getObjects().filter((o) => this.editor.isTextObject(o))
                        : [obj];
                    if (!targets.length) return;
                    const before = this.editor.captureObjectPositionsForUndo(targets);
                    targets.forEach((t) => this._applyTextProp(t, prop, value));
                    const after = this.editor.captureObjectPositionsForUndo(targets);
                    this._pushAlignUndoPair(before, after);
                    targets.forEach((t) => {
                        if (t.origin === 'pdf') t._modified = true;
                        t.setCoords();
                    });
                    this.editor.renderAll();
                    this._markDirty();
                    return;
                }
                if (prop === 'textAlign'
                    && obj.isEditing
                    && obj.selectionStart !== obj.selectionEnd
                    && obj.textAlign !== value) {
                    this._pushUndoSnapshot();
                    this._suppressUndoRecording = true;
                    try {
                        this.editor.alignSelectedLines(obj, value);
                    } finally {
                        this._suppressUndoRecording = false;
                    }
                    this._pushUndoSnapshot();
                    this._markDirty();
                    return;
                }
                this._applyTextProp(obj, prop, value);
                break;
            case 'shape':
                this._applyShapeProp(obj, prop, value);
                break;
            case 'image':
                this._applyImageProp(obj, prop, value);
                break;
            case 'sticky':
                this._applyStickyProp(obj, prop, value);
                break;
            case 'stamp':
                this._applyStampProp(obj, prop, value);
                break;
        }

        if (obj.origin === 'pdf') {
            obj._modified = true;
        }

        if (obj._isTableCellText) {
            this.editor._enforceTableCellTextBounds(obj, { allowRevert: false });
        }

        obj.setCoords();
        this.editor.renderAll();
        this._markDirty();
    }

    _applyTextProp(obj, prop, value) {
        switch (prop) {
            case 'fontFamily':
                obj.set('fontFamily', value);
                break;
            case 'fontSize':
                obj.set('fontSize', value);
                break;
            case 'fontWeight':
                obj.set('fontWeight', value);
                break;
            case 'fill':
                obj.set('fill', value);
                break;
            case 'backgroundColor':
                obj.set('backgroundColor', value || 'transparent');
                break;
            case 'opacity':
                obj.set('opacity', value);
                break;
            case 'angle':
                obj.set('angle', value);
                break;
            case 'bold':
                obj.set('fontWeight', value ? 700 : 400);
                break;
            case 'italic':
                obj.set('fontStyle', value ? 'italic' : 'normal');
                break;
            case 'underline':
                obj.set('underline', value);
                break;
            case 'linethrough':
                obj.set('linethrough', value);
                break;
            case 'textAlign':
                obj.set('textAlign', value);
                if (obj.type === 'textbox' && typeof obj.initDimensions === 'function') {
                    obj.initDimensions();
                }
                break;
            case 'pageAlign':
                this.editor.alignTextToPageMargin(obj, value);
                break;
            case 'lineHeight':
                obj.set('lineHeight', value);
                break;
            case 'charSpacing':
                obj.set('charSpacing', value);
                break;
            case 'textCase': {
                obj._textCase = value;
                const raw = obj.text || '';
                let transformed = raw;
                if (value === 'upper') transformed = raw.toUpperCase();
                else if (value === 'lower') transformed = raw.toLowerCase();
                else if (value === 'title') {
                    transformed = raw.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
                }
                if (transformed !== raw) obj.set('text', transformed);
                break;
            }
            case 'textStrokeColor':
                obj.set('stroke', value);
                break;
            case 'textStrokeWidth':
                obj.set('strokeWidth', value);
                if (value > 0) {
                    const colorEl = document.getElementById('prop-text-stroke-color');
                    const strokeColor = colorEl ? colorEl.value : '#000000';
                    if (!obj.stroke || obj.stroke === 'transparent') {
                        obj.set('stroke', strokeColor);
                    }
                } else {
                    obj.set('stroke', 'transparent');
                }
                break;
            case 'textShadow':
                if (value) {
                    obj.set('shadow', new fabric.Shadow({
                        color: 'rgba(0,0,0,0.35)',
                        blur: 5,
                        offsetX: 2,
                        offsetY: 2,
                    }));
                } else {
                    obj.set('shadow', null);
                }
                break;
        }
        obj.dirty = true;
    }

    _applyShapeProp(obj, prop, value) {
        switch (prop) {
            case 'fill':
                obj.set('fill', value);
                break;
            case 'stroke':
                obj.set('stroke', value);
                break;
            case 'strokeWidth':
                obj.set('strokeWidth', value);
                break;
            case 'opacity':
                obj.set('opacity', value);
                break;
            case 'angle':
                obj.set('angle', value);
                break;
            case 'rx':
                obj.set('rx', value);
                obj.set('ry', value);
                break;
            case 'ry':
                obj.set('ry', value);
                break;
            case 'lineStyle':
                obj.lineStyle = value;
                obj.strokeDashArray = this.editor.getDashArrayForStyle(value, obj.strokeWidth || 2);
                break;
        }
    }

    _applyImageProp(obj, prop, value) {
        switch (prop) {
            case 'width': {
                const locked = document.getElementById('prop-lock-ratio').classList.contains('active');
                if (locked && obj.width) {
                    const ratio = obj.height / obj.width;
                    obj.set('scaleX', value / obj.width);
                    obj.set('scaleY', (value * ratio) / obj.height);
                } else {
                    obj.set('scaleX', value / obj.width);
                }
                break;
            }
            case 'height': {
                const locked = document.getElementById('prop-lock-ratio').classList.contains('active');
                if (locked && obj.height) {
                    const ratio = obj.width / obj.height;
                    obj.set('scaleY', value / obj.height);
                    obj.set('scaleX', (value * ratio) / obj.width);
                } else {
                    obj.set('scaleY', value / obj.height);
                }
                break;
            }
            case 'opacity':
                obj.set('opacity', value);
                break;
            case 'angle':
                obj.set('angle', value);
                break;
            case 'bringFront':
                this.editor.bringToFront(obj);
                return;
            case 'sendBack':
                this.editor.sendToBack(obj);
                return;
        }
    }

    getStampConfigFromPanelForRebuild(obj, presetOverride = null) {
        const base = presetOverride
            ? StampKit.cloneConfig(presetOverride)
            : StampKit.cloneConfig(obj.stampConfig || this.editor.getStampConfigFromGroup(obj));
        const textEl = document.getElementById('prop-stamp-text');
        const accentEl = document.getElementById('prop-stamp-accent');
        if (textEl) base.text = textEl.value;
        if (accentEl) {
            return StampKit.applyAccentColor(base, accentEl.value);
        }
        return base;
    }

    _applyStampProp(obj, prop, value) {
        if (!obj || obj._elementType !== 'stamp') return;

        let patch;
        if (prop === 'accentColor') {
            patch = StampKit.applyAccentColor(this.editor.getStampConfigFromGroup(obj), value);
            patch.preset = obj.stampConfig?.preset || 'custom';
        } else if (prop === 'text') {
            patch = { text: value, preset: obj.stampConfig?.preset || 'custom' };
        } else {
            return;
        }

        const updated = this.editor.rebuildStamp(obj, patch);
        if (updated) {
            this.toolbar.syncStampPropsFromObject(updated);
            this._markDirty();
        }
    }

    _applyStickyProp(obj, prop, value) {
        switch (prop) {
            case 'opacity':
                obj.set('opacity', value);
                break;
            case 'stickyColor': {
                const darkColor = this.editor._darkenStickyColor(value);
                obj.set('_stickyColor', value);
                const children = obj.getObjects();
                if (children[0]) {
                    children[0].set({ fill: value, stroke: darkColor });
                }
                if (children[1]) {
                    children[1].set({ fill: darkColor, stroke: darkColor });
                }
                obj.dirty = true;
                if (this._currentStickyObj === obj) {
                    this._updateStickyPopupColor(value);
                }
                this.editor.renderAll();
                break;
            }
        }
    }



    _showStickyPopup(obj) {
        this._hideStickyPopup(true);
        this._currentStickyObj = obj;

        const color = obj._stickyColor || '#fff9c4';
        this._updateStickyPopupColor(color);
        this.els.stickyPopupTextarea.value = obj._stickyText || '';
        this._positionStickyPopup(obj);
        this.els.stickyPopup.style.display = 'block';

        const pinIcon = this.els.stickyPopup.querySelector('.sticky-popup-pin-icon');
        if (pinIcon) pinIcon.style.display = obj._stickyPinned ? 'inline' : 'none';

        setTimeout(() => this.els.stickyPopupTextarea.focus(), 50);
    }

    _hideStickyPopup(force) {
        if (!force && this._currentStickyObj && this._currentStickyObj._stickyPinned) return;
        this._saveStickyPopupText();
        this._currentStickyObj = null;
        this.els.stickyPopup.style.display = 'none';
        const pinIcon = this.els.stickyPopup.querySelector('.sticky-popup-pin-icon');
        if (pinIcon) pinIcon.style.display = 'none';
    }

    _saveStickyPopupText() {
        if (!this._currentStickyObj) return;
        const newText = this.els.stickyPopupTextarea.value;
        if (this._currentStickyObj._stickyText !== newText) {
            this._currentStickyObj._stickyText = newText;
        }
    }

    _updateStickyPopupColor(color) {
        const darkColor = this.editor._darkenStickyColor(color);
        this.els.stickyPopup.querySelector('.sticky-popup-header').style.background = darkColor;
        this.els.stickyPopup.querySelector('.sticky-popup-body').style.background = color;
    }

    _positionStickyPopup(obj) {
        const bounds = obj.getBoundingRect();
        const canvasContainer = this.els.canvasWrapper.querySelector('.canvas-container') || this.els.canvasWrapper.querySelector('#fabric-canvas');
        if (!canvasContainer) return;

        const canvasRect = canvasContainer.getBoundingClientRect();
        const wrapperRect = this.els.canvasWrapper.getBoundingClientRect();

        const offsetLeft = canvasRect.left - wrapperRect.left + this.els.canvasWrapper.scrollLeft;
        const offsetTop = canvasRect.top - wrapperRect.top + this.els.canvasWrapper.scrollTop;

        const popupWidth = 220;
        const popupHeight = 180;

        let left = offsetLeft + bounds.left + bounds.width + 8;
        let top = offsetTop + bounds.top - 10;

        if (left + popupWidth > this.els.canvasWrapper.scrollLeft + this.els.canvasWrapper.clientWidth) {
            left = offsetLeft + bounds.left - popupWidth - 8;
        }
        if (top + popupHeight > this.els.canvasWrapper.scrollTop + this.els.canvasWrapper.clientHeight) {
            top = offsetTop + bounds.top + bounds.height - popupHeight + 10;
        }

        this.els.stickyPopup.style.left = `${Math.max(4, left)}px`;
        this.els.stickyPopup.style.top = `${Math.max(4, top)}px`;
    }

    _repositionStickyPopup() {
        if (!this._currentStickyObj || this.els.stickyPopup.style.display === 'none') return;
        this._positionStickyPopup(this._currentStickyObj);
    }

    async _onImageSelected(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (ev) => {
            const dataUrl = ev.target.result;
            const cellTarget = this.editor.getTableCellTargetFromSelection?.();
            await this.editor.addImage(dataUrl, cellTarget);
            this._recordUndoState();
            if (cellTarget) {
                this._showToast('Image added to table cell', 'success');
            }
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    }

    _toggleThumbnails(forceState) {
        this.thumbnailsVisible = forceState !== undefined ? forceState : !this.thumbnailsVisible;
        this.els.thumbnailsPanel.classList.toggle('collapsed', !this.thumbnailsVisible);
        requestAnimationFrame(() => this.formLayer.syncPosition());
        if (this.thumbnailsVisible && this.sessionId) {
            this._loadAllThumbnails();
        }
    }

    async _loadAllThumbnails() {
        this.els.thumbnailsList.innerHTML = '';
        for (let i = 0; i < this.pageCount; i++) {
            this._createThumbnailSlot(i);
            if (!this.thumbnails[i]) {
                await this._loadThumbnail(i);
            } else {
                this._updateThumbnail(i);
            }
        }
        this._highlightActiveThumbnail();
    }

    _createThumbAction(icon, title, handler, extraClass = '') {
        const button = document.createElement('button');
        button.className = `thumb-action-btn ${extraClass}`.trim();
        button.type = 'button';
        button.title = title;
        button.innerHTML = `<i data-lucide="${icon}" class="btn-icon-sm"></i>`;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            handler();
        });
        return button;
    }

    _formatPageSize(pageNum) {
        const size = this.pageSizes[pageNum];
        if (!size) return '';
        return `${Math.round(size.width)} × ${Math.round(size.height)}`;
    }

    _createThumbnailSlot(pageNum) {
        const div = document.createElement('div');
        div.className = 'thumb-item' + (pageNum === this.currentPage ? ' active' : '');
        div.dataset.page = pageNum;
        div.draggable = true;

        div.addEventListener('click', () => this._goToPage(pageNum));

        div.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', String(pageNum));
            div.classList.add('dragging');
        });
        div.addEventListener('dragend', () => div.classList.remove('dragging'));
        div.addEventListener('dragover', (e) => {
            e.preventDefault();
            div.classList.add('drag-over-thumb');
        });
        div.addEventListener('dragleave', () => div.classList.remove('drag-over-thumb'));
        div.addEventListener('drop', async (e) => {
            e.preventDefault();
            div.classList.remove('drag-over-thumb');
            const fromPage = parseInt(e.dataTransfer.getData('text/plain'));
            const toPage = pageNum;
            if (fromPage !== toPage) {
                await this._reorderPages(fromPage, toPage);
            }
        });

        const preview = document.createElement('div');
        preview.className = 'thumb-preview';

        const placeholder = document.createElement('div');
        placeholder.className = 'skeleton-shimmer';
        placeholder.style.height = '150px';
        preview.appendChild(placeholder);
        div.appendChild(preview);

        const footer = document.createElement('div');
        footer.className = 'thumb-footer';

        const title = document.createElement('span');
        title.className = 'thumb-page-name';
        title.textContent = `Page ${pageNum + 1}`;

        const size = document.createElement('span');
        size.className = 'thumb-page-size';
        size.textContent = this._formatPageSize(pageNum);

        footer.appendChild(title);
        footer.appendChild(size);
        div.appendChild(footer);

        const actions = document.createElement('div');
        actions.className = 'thumb-actions';
        actions.appendChild(this._createThumbAction('plus', 'Insert blank page after', () => this._insertPageAt(pageNum + 1)));
        actions.appendChild(this._createThumbAction('copy', 'Duplicate page', () => this._duplicatePage(pageNum)));
        actions.appendChild(this._createThumbAction('rotate-cw', 'Rotate page 90°', () => this._rotatePage(pageNum, 90)));
        actions.appendChild(this._createThumbAction('trash-2', 'Delete page', () => this._deletePage(pageNum), 'danger'));
        div.appendChild(actions);

        this.els.thumbnailsList.appendChild(div);
        lucide.createIcons();
    }

    async _loadThumbnail(pageNum) {
        if (pageNum === this.currentPage && this.editor?.canvas && !this.isLoading) {
            this._storeThumbnailFromCanvas(pageNum);
            if (this.thumbnails[pageNum]) {
                return;
            }
        }
        await this._loadThumbnailFromServer(pageNum);
    }

    async _loadThumbnailFromServer(pageNum) {
        try {
            const pageData = await API.getPage(this.sessionId, pageNum, { maskEditable: false });
            const canvas = document.createElement('canvas');
            const maxH = this._getThumbnailCaptureHeight(pageNum);
            const scale = maxH / pageData.height;
            canvas.width = pageData.width * scale;
            canvas.height = maxH;
            const ctx = canvas.getContext('2d');

            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = pageData.image;
            });
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            this.thumbnails[pageNum] = canvas.toDataURL('image/png');
            this._updateThumbnail(pageNum);
        } catch (err) {
            console.warn('Failed to load thumbnail:', err);
        }
    }

    _updateThumbnail(pageNum) {
        const slot = this.els.thumbnailsList.querySelector(`[data-page="${pageNum}"]`);
        if (!slot) return;
        const preview = slot.querySelector('.thumb-preview');
        const existing = preview?.querySelector('img');
        if (existing) existing.remove();
        const skeleton = preview?.querySelector('.skeleton-shimmer');
        if (skeleton) skeleton.remove();

        const img = document.createElement('img');
        img.src = this.thumbnails[pageNum];
        img.alt = `Page ${pageNum + 1}`;
        preview.insertBefore(img, preview.firstChild);

        const title = slot.querySelector('.thumb-page-name');
        if (title) title.textContent = `Page ${pageNum + 1}`;

        const size = slot.querySelector('.thumb-page-size');
        if (size) size.textContent = this._formatPageSize(pageNum);
    }

    _highlightActiveThumbnail() {
        this.els.thumbnailsList.querySelectorAll('.thumb-item').forEach((el) => {
            el.classList.toggle('active', parseInt(el.dataset.page) === this.currentPage);
        });
    }

    async _reorderPages(from, to) {
        if (!this.sessionId || from === to) return;
        try {
            if (this.editor.canvas) {
                this.pageStates[this.currentPage] = this.editor.toJSON();
            }

            const result = await API.movePage(this.sessionId, from, to);
            this.pageSizes = this._moveArrayEntry(this.pageSizes, from, to);
            this.pageStates = this._moveIndexedObject(this.pageStates, from, to, this.pageCount);
            this.pageFormStates = this._moveIndexedObject(this.pageFormStates, from, to, this.pageCount);
            this.thumbnails = this._moveIndexedObject(this.thumbnails, from, to, this.pageCount);
            this._reindexDirtyPages((index) => {
                if (index === from) return to;
                if (from < index && index <= to) return index - 1;
                if (to <= index && index < from) return index + 1;
                return index;
            });

            if (this.currentPage === from) {
                this.currentPage = to;
            } else if (from < this.currentPage && this.currentPage <= to) {
                this.currentPage -= 1;
            } else if (to <= this.currentPage && this.currentPage < from) {
                this.currentPage += 1;
            }

            this.pageCount = result.page_count;
            this._updatePageInfo();
            if (this.thumbnailsVisible) {
                await this._loadAllThumbnails();
            }
            await this._loadPage(this.currentPage);
            this._showToast('Pages reordered', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _moveArrayEntry(array, from, to) {
        const next = [...array];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        return next;
    }

    _moveIndexedObject(source, from, to, length) {
        const buffer = Array.from({ length }, (_, index) => source[index]);
        const [item] = buffer.splice(from, 1);
        buffer.splice(to, 0, item);
        return buffer.reduce((acc, value, index) => {
            if (value !== undefined) acc[index] = value;
            return acc;
        }, {});
    }

    _reindexIndexedObject(source, remapFn) {
        return Object.keys(source).reduce((acc, key) => {
            const nextKey = remapFn(parseInt(key, 10));
            if (Number.isInteger(nextKey) && nextKey >= 0) {
                acc[nextKey] = source[key];
            }
            return acc;
        }, {});
    }

    async _insertPageAt(position) {
        if (!this.sessionId) return;
        try {
            if (this.editor.canvas) {
                this.pageStates[this.currentPage] = this.editor.toJSON();
            }

            const result = await API.addPage(this.sessionId, position, 'A4');
            const insertAt = result.page_num;

            this.pageCount = result.page_count;
            this.pageSizes.splice(insertAt, 0, {
                width: result.pdf_width || 595,
                height: result.pdf_height || 842,
            });
            this.pageStates = this._reindexIndexedObject(this.pageStates, (index) => index >= insertAt ? index + 1 : index);
            this.pageFormStates = this._reindexIndexedObject(this.pageFormStates, (index) => index >= insertAt ? index + 1 : index);
            this.thumbnails = this._reindexIndexedObject(this.thumbnails, (index) => index >= insertAt ? index + 1 : index);
            this._reindexDirtyPages((index) => (index >= insertAt ? index + 1 : index));

            this._updatePageInfo();
            if (this.thumbnailsVisible) {
                await this._loadAllThumbnails();
            }
            await this._loadPage(insertAt);
            this._showToast('Page added', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _addNewPage() {
        await this._insertPageAt(this.pageCount);
    }

    async _deleteCurrentPage() {
        await this._deletePage(this.currentPage);
    }

    async _duplicateCurrentPage() {
        await this._duplicatePage(this.currentPage);
    }

    async _deletePage(pageNum) {
        if (!this.sessionId || this.pageCount <= 1) {
            this._showToast('Cannot delete the only page', 'error');
            return;
        }

        await this._awaitPendingPageLoad();

        try {
            if (this.editor.canvas) {
                this.pageStates[this.currentPage] = this.editor.toJSON();
            }

            const result = await API.deletePage(this.sessionId, pageNum);
            this.pageCount = result.page_count;
            this.pageSizes.splice(pageNum, 1);
            this.pageStates = this._reindexIndexedObject(this.pageStates, (index) => {
                if (index === pageNum) return null;
                return index > pageNum ? index - 1 : index;
            });
            this.pageFormStates = this._reindexIndexedObject(this.pageFormStates, (index) => {
                if (index === pageNum) return null;
                return index > pageNum ? index - 1 : index;
            });
            this.thumbnails = this._reindexIndexedObject(this.thumbnails, (index) => {
                if (index === pageNum) return null;
                return index > pageNum ? index - 1 : index;
            });
            this._reindexDirtyPages((index) => {
                if (index === pageNum) return null;
                return index > pageNum ? index - 1 : index;
            });

            if (pageNum === this.currentPage) {
                this.currentPage = Math.min(pageNum, this.pageCount - 1);
            } else if (pageNum < this.currentPage) {
                this.currentPage -= 1;
            }
            this._updatePageInfo();
            await this._loadPage(this.currentPage);
            if (this.thumbnailsVisible) {
                await this._loadAllThumbnails();
            }
            this._showToast('Page deleted', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _duplicatePage(pageNum) {
        if (!this.sessionId) return;

        try {
            if (pageNum === this.currentPage && this.editor.canvas) {
                await this._saveCurrentPage({ silent: true });
            }

            const result = await API.duplicatePage(this.sessionId, pageNum);
            const insertAt = result.page_num;

            this.pageCount = result.page_count;
            this.pageSizes.splice(insertAt, 0, result.page_size || this.pageSizes[pageNum] || { width: 595, height: 842 });
            this.pageStates = this._reindexIndexedObject(this.pageStates, (index) => index >= insertAt ? index + 1 : index);
            this.pageFormStates = this._reindexIndexedObject(this.pageFormStates, (index) => index >= insertAt ? index + 1 : index);
            this.thumbnails = this._reindexIndexedObject(this.thumbnails, (index) => index >= insertAt ? index + 1 : index);
            this._reindexDirtyPages((index) => (index >= insertAt ? index + 1 : index));

            if (result.thumbnail) {
                this.thumbnails[insertAt] = result.thumbnail;
            }

            this._updatePageInfo();
            if (this.thumbnailsVisible) {
                await this._loadAllThumbnails();
            }
            await this._loadPage(insertAt);
            this._showToast('Page duplicated', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _rotateCurrentPage(degrees) {
        await this._rotatePage(this.currentPage, degrees);
    }

    async _exportCurrentPage() {
        if (!this.sessionId) return;

        try {
            if (this.editor.canvas) {
                await this._saveCurrentPage({ silent: true });
            }

            const blob = await API.exportPage(this.sessionId, this.currentPage);
            this._downloadBlob(blob, `page-${this.currentPage + 1}.pdf`);
            this._showToast('Current page exported', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _extractCurrentPageText() {
        if (!this.sessionId) return;

        try {
            if (this.editor.canvas) {
                await this._saveCurrentPage({ silent: true });
            }

            const blob = await API.extractPageText(this.sessionId, this.currentPage);
            this._downloadBlob(blob, `page-${this.currentPage + 1}.txt`);
            this._showToast('Page text extracted', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _rotatePage(pageNum, degrees) {
        if (!this.sessionId) return;
        try {
            const result = await API.rotatePage(this.sessionId, pageNum, degrees);

            this.pageSizes[pageNum] = {
                width: result.pdf_width,
                height: result.pdf_height,
            };

            if (pageNum === this.currentPage) {
                const oldWidth = this.editor.canvasWidth;
                const oldHeight = this.editor.canvasHeight;
                const newWidth = result.width;
                const newHeight = result.height;

                this.editor.resizeCanvas(newWidth, newHeight);
                this.editor.rotatePageObjects(degrees, oldWidth, oldHeight, newWidth, newHeight);
                await this.editor.setBackground(result.image);
                this.pageStates[pageNum] = this.editor.toJSON();
                this._fitToView();
                this.toolbar.showPageProperties(
                    this.pageSizes[pageNum]?.width || 595,
                    this.pageSizes[pageNum]?.height || 842
                );
                this.editor.setTool(this.toolbar.activeTool);
            } else {
                delete this.pageStates[pageNum];
            }

            if (result.thumbnail) {
                this.thumbnails[pageNum] = result.thumbnail;
            }
            if (this.thumbnailsVisible) {
                this._updateThumbnail(pageNum);
            }

            this._showToast(`Page rotated ${degrees}°`, 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _onMergeFileSelected(e) {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file || !this.sessionId) return;
        try {
            const result = await API.mergePDF(this.sessionId, file);
            this.pageCount = result.page_count;
            this.pageSizes = result.page_sizes || this.pageSizes;
            this._updatePageInfo();
            this._loadAllThumbnails();
            this._showToast('PDF merged', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _toggleDocumentPanel() {
        this.documentMode = !this.documentMode;
        if (!this.documentMode) {
            this._showContextProperties();
            return;
        }
        try {
            const meta = await API.getMetadata(this.sessionId);
            const bm = await API.getBookmarks(this.sessionId);
            this.toolbar.showDocumentProperties(meta.metadata || {}, bm.bookmarks || []);
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _saveMetadata() {
        if (!this.sessionId) return;
        const metadata = {
            title: document.getElementById('meta-title').value,
            author: document.getElementById('meta-author').value,
            subject: document.getElementById('meta-subject').value,
            keywords: document.getElementById('meta-keywords').value,
        };
        try {
            await API.setMetadata(this.sessionId, metadata);
            this._showToast('Metadata saved', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _saveBookmarks() {
        if (!this.sessionId) return;
        const text = document.getElementById('meta-bookmarks').value || '';
        const bookmarks = text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
            const parts = line.split('|');
            return {
                level: parseInt(parts[0], 10) || 1,
                title: parts[1] || 'Section',
                page: Math.max(0, (parseInt(parts[2], 10) || 1) - 1),
            };
        });
        try {
            await API.setBookmarks(this.sessionId, bookmarks);
            this._showToast('Bookmarks saved', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _updateLinkPropVisibility() {
        const kind = this.els.propLinkKind?.value || 'uri';
        if (this.els.propLinkUriGroup) {
            this.els.propLinkUriGroup.style.display = kind === 'uri' ? 'block' : 'none';
        }
        if (this.els.propLinkPageGroup) {
            this.els.propLinkPageGroup.style.display = kind === 'goto' ? 'block' : 'none';
        }
        if (this.els.propLinkUriLabel) {
            const labels = { web: 'URL', email: 'Email', phone: 'Phone number' };
            this.els.propLinkUriLabel.textContent = labels[this.linkPreset] || 'URL';
        }
        if (this.els.btnLinkTest) {
            this.els.btnLinkTest.disabled = kind === 'goto' && !this.selectedLink;
        }
    }

    _applyLinkPreset(preset) {
        this.linkPreset = preset;
        this.els.linkPresetChips?.querySelectorAll('.prop-chip').forEach((chip) => {
            chip.classList.toggle('active', chip.dataset.preset === preset);
        });

        if (preset === 'page') {
            this.els.propLinkKind.value = 'goto';
            if (this.els.propLinkPage && !this.els.propLinkPage.value) {
                this.els.propLinkPage.value = String(this.currentPage + 1);
            }
        } else {
            this.els.propLinkKind.value = 'uri';
            if (this.els.propLinkUri) {
                const placeholders = {
                    web: 'https://example.com',
                    email: 'name@example.com',
                    phone: '+1 555 0100',
                };
                this.els.propLinkUri.placeholder = placeholders[preset] || 'https://example.com';
            }
        }
        this._updateLinkPropVisibility();
    }

    _updateLinkSelectedTextButton() {
        const hasText = !!this.editor.getSelectedTextLinkArea();
        if (this.els.btnLinkSelectedText) {
            this.els.btnLinkSelectedText.disabled = !hasText;
            this.els.btnLinkSelectedText.classList.toggle('primary', hasText && !this._linkDrawAreaMode);
        }
        if (this.els.btnLinkDrawArea) {
            this.els.btnLinkDrawArea.classList.toggle('primary', this._linkDrawAreaMode || !hasText);
        }
    }

    _enableLinkDrawMode() {
        this._linkDrawAreaMode = true;
        this.editor.setLinkDrawMode(true);
        this._updateLinkSelectedTextButton();
        this._showToast('Draw a rectangle on the page for the link area', 'info');
    }

    _buildLinkPayload(area) {
        const kind = this.els.propLinkKind?.value || 'uri';
        const payload = {
            pdf_bbox: area.pdf_bbox,
            bbox: area.bbox,
            kind,
        };

        if (kind === 'goto') {
            payload.page = Math.max(0, parseInt(this.els.propLinkPage?.value || '1', 10) - 1);
        } else {
            const uri = (this.els.propLinkUri?.value || '').trim();
            if (!uri) {
                throw new Error('Enter a destination in the link panel');
            }
            payload.uri = uri;
        }
        return payload;
    }

    async _createLinkFromArea(area, pageNum = this.currentPage) {
        if (!this.sessionId) return null;
        const payload = this._buildLinkPayload(area);
        const result = await API.createPageLink(this.sessionId, pageNum, payload);
        if (pageNum === this.currentPage) {
            this.pageLinks = result.links || [];
        }
        await this._refreshLinkList();
        this._renderLinkHighlights();
        const label = result.link?.uri || (result.link?.page != null ? `page ${result.link.page + 1}` : 'link');
        this._showToast(`Link added (${label})`, 'success');
        if (result.link) this._selectLinkEntry(result.link, pageNum);
        this._linkDrawAreaMode = false;
        this.editor.setLinkDrawMode(false);
        this._updateLinkSelectedTextButton();
        return result;
    }

    async _linkSelectedText() {
        const area = this.editor.getSelectedTextLinkArea();
        if (!area) {
            this._showToast('Select a text object first', 'error');
            return;
        }
        try {
            await this._createLinkFromArea(area);
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _getLinksForList() {
        return this.linkScope === 'document' ? this.documentLinks : this.pageLinks;
    }

    async _refreshLinkList() {
        if (!this.sessionId) return;

        try {
            const pageData = await API.getPageLinks(this.sessionId, this.currentPage);
            this.pageLinks = pageData.links || [];
        } catch (err) {
            console.warn('Failed to load page links:', err);
            this.pageLinks = [];
        }

        if (this.linkScope === 'document') {
            try {
                const docData = await API.getDocumentLinks(this.sessionId);
                this.documentLinks = docData.links || [];
            } catch (err) {
                console.warn('Failed to load document links:', err);
                this.documentLinks = [];
            }
        }

        const listLinks = this._getLinksForList();
        this.toolbar.renderLinkList(listLinks, {
            scope: this.linkScope,
            selectedPage: this.selectedLink?.page_num ?? this.currentPage,
            selectedLinkIndex: this.selectedLink?.index ?? null,
            onSelect: (link) => this._selectLinkEntry(link),
            onDelete: (link) => this._deleteLinkEntry(link),
            onJump: (link) => this._jumpToLinkEntry(link),
        });

        if (this.toolbar.activeTool === 'link') {
            this._renderLinkHighlights();
        }
    }

    async _loadPageLinks(pageNum) {
        if (!this.sessionId) return;
        try {
            const data = await API.getPageLinks(this.sessionId, pageNum);
            this.pageLinks = data.links || [];
            if (this.toolbar.activeTool === 'link') {
                await this._refreshLinkList();
            }
        } catch (err) {
            console.warn('Failed to load page links:', err);
            this.pageLinks = [];
            if (this.toolbar.activeTool === 'link') {
                this.editor.clearLinkOverlays();
            }
        }
    }

    _renderLinkHighlights() {
        if (!this.linkShowHighlights || this.toolbar.activeTool !== 'link') {
            this.editor.clearLinkOverlays();
            return;
        }
        const links = this.pageLinks;
        const listIndex = links.findIndex((l) =>
            this.selectedLink &&
            l.index === this.selectedLink.index &&
            (this.selectedLink.page_num == null || l.page_num === this.selectedLink.page_num)
        );
        this.editor.showLinkOverlays(links, {
            visible: true,
            selectedListIndex: listIndex >= 0 ? listIndex : null,
            selectedLinkIndex: this.selectedLink?.index ?? null,
        });
    }

    _populateLinkForm(link) {
        if (!link) return;
        const isGoto = link.link_type === 'goto' || (link.page != null && !link.uri);
        if (isGoto) {
            this._applyLinkPreset('page');
            this.els.propLinkPage.value = String((link.page ?? 0) + 1);
        } else {
            const uri = link.uri || '';
            if (uri.toLowerCase().startsWith('mailto:')) {
                this._applyLinkPreset('email');
                this.els.propLinkUri.value = uri.replace(/^mailto:/i, '');
            } else if (uri.toLowerCase().startsWith('tel:')) {
                this._applyLinkPreset('phone');
                this.els.propLinkUri.value = uri.replace(/^tel:/i, '');
            } else {
                this._applyLinkPreset('web');
                this.els.propLinkUri.value = uri;
            }
        }
        this._updateLinkPropVisibility();
    }

    async _selectLinkEntry(link, pageNum = link.page_num ?? this.currentPage) {
        if (pageNum !== this.currentPage) {
            await this._goToPage(pageNum);
        }
        this.selectedLink = { ...link, page_num: pageNum };
        this._populateLinkForm(link);
        this.toolbar.renderLinkList(this._getLinksForList(), {
            scope: this.linkScope,
            selectedPage: pageNum,
            selectedLinkIndex: link.index,
            onSelect: (l) => this._selectLinkEntry(l),
            onDelete: (l) => this._deleteLinkEntry(l),
            onJump: (l) => this._jumpToLinkEntry(l),
        });
        this.editor.refreshLinkOverlaySelection(
            this.pageLinks.findIndex((l) => l.index === link.index),
            link.index
        );
    }

    async _deleteLinkEntry(link) {
        if (!this.sessionId || link.index == null) return;
        const pageNum = link.page_num ?? this.currentPage;
        try {
            await API.deletePageLink(this.sessionId, pageNum, link.index);
            if (this.selectedLink?.index === link.index && (this.selectedLink?.page_num ?? pageNum) === pageNum) {
                this.selectedLink = null;
            }
            await this._refreshLinkList();
            this._showToast('Link removed', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _updateSelectedLink() {
        if (!this.sessionId || !this.selectedLink || this.selectedLink.index == null) return;
        const pageNum = this.selectedLink.page_num ?? this.currentPage;
        try {
            const payload = {
                kind: this.els.propLinkKind?.value || 'uri',
                pdf_bbox: this.selectedLink.pdf_bbox,
                bbox: this.selectedLink.bbox,
            };
            if (payload.kind === 'goto') {
                const rawPage = parseInt(this.els.propLinkPage?.value, 10);
                payload.page = Math.max(0, (Number.isFinite(rawPage) ? rawPage : 1) - 1);
            } else {
                payload.uri = (this.els.propLinkUri?.value || '').trim();
            }
            const result = await API.updatePageLink(this.sessionId, pageNum, this.selectedLink.index, payload);
            if (pageNum === this.currentPage) {
                this.pageLinks = result.links || [];
            }
            const updated = result.link || result.links?.find((l) => l.index === this.selectedLink.index);
            if (updated) this.selectedLink = { ...updated, page_num: pageNum };
            await this._refreshLinkList();
            this._showToast('Link updated', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _resolveLinkHref(link) {
        const isGoto = link.link_type === 'goto' || (link.page != null && !link.uri);
        if (isGoto) return null;
        let uri = (link.uri || '').trim();
        if (!uri) return null;
        const lower = uri.toLowerCase();
        if (!lower.startsWith('http://') && !lower.startsWith('https://') &&
            !lower.startsWith('mailto:') && !lower.startsWith('tel:')) {
            if (uri.includes('@')) uri = `mailto:${uri}`;
            else if (/^[\d\s+\-()]+$/.test(uri)) uri = `tel:${uri}`;
            else uri = `https://${uri}`;
        }
        return uri;
    }

    _testLinkEntry(link) {
        const isGoto = link.link_type === 'goto' || (link.page != null && !link.uri);
        if (isGoto) {
            this._jumpToLinkEntry(link);
            return;
        }
        const href = this._resolveLinkHref(link);
        if (!href) {
            this._showToast('No URL to open', 'error');
            return;
        }
        if (window.pdfEditDesktop?.openExternal) {
            window.pdfEditDesktop.openExternal(href);
            return;
        }
        window.open(href, '_blank', 'noopener,noreferrer');
    }

    _testCurrentLinkTarget() {
        if (this.selectedLink) {
            this._testLinkEntry(this.selectedLink);
            return;
        }
        const kind = this.els.propLinkKind?.value || 'uri';
        if (kind === 'goto') {
            const rawPage = parseInt(this.els.propLinkPage?.value, 10);
            const page = Math.max(0, (Number.isFinite(rawPage) ? rawPage : 1) - 1);
            if (page >= this.pageCount) {
                this._showToast('Target page does not exist', 'error');
                return;
            }
            this._goToPage(page);
            return;
        }
        const uri = (this.els.propLinkUri?.value || '').trim();
        if (!uri) {
            this._showToast('Enter a URL first', 'error');
            return;
        }
        this._testLinkEntry({ uri, link_type: 'uri' });
    }

    async _jumpToLinkEntry(link) {
        const isGoto = link.link_type === 'goto' || (link.page != null && !link.uri);
        if (isGoto && link.page != null) {
            await this._goToPage(link.page);
            return;
        }
        const pageNum = link.page_num ?? this.currentPage;
        await this._selectLinkEntry(link, pageNum);
    }

    async _onLinkAreaDrawn(area) {
        if (!this.sessionId) return;
        if (this._certSignPlacementMode && this._certSignPending) {
            try {
                await this._executeCertSign(area);
            } catch (err) {
                this._showToast(err.message, 'error');
            }
            return;
        }
        try {
            await this._createLinkFromArea(area);
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    startCertSignPlacement(pending) {
        if (!this.sessionId || !pending?.certificateFile) return;
        this._certSignPending = pending;
        this._certSignPlacementMode = true;
        this.toolbar.setActiveTool('link');
        this.editor.setTool('link');
        this._linkDrawAreaMode = true;
        this.editor.setLinkDrawMode(true);
        this.toolbar.showLinkProperties?.();
        this._showToast('Draw a rectangle where the digital signature should appear', 'info');
    }

    _cancelCertSignPlacement(showToast = true) {
        if (!this._certSignPlacementMode) return;
        this._certSignPlacementMode = false;
        this._certSignPending = null;
        this._linkDrawAreaMode = false;
        this.editor.setLinkDrawMode(false);
        if (showToast) {
            this._showToast('Certificate signing cancelled', 'info');
        }
    }

    async _executeCertSign(area) {
        const pending = this._certSignPending;
        if (!this.sessionId || !pending) return;

        this._linkDrawAreaMode = false;
        this.editor.setLinkDrawMode(false);

        this._showToast('Signing document with certificate…', 'info');

        const pageNum = this.currentPage;
        try {
            const result = await API.certSign(this.sessionId, {
                ...pending,
                pageNum,
                pdf_bbox: area.pdf_bbox,
                bbox: area.bbox,
            });

            this._certSignPlacementMode = false;
            this._certSignPending = null;

            this.pageStates = {};
            this.pageFormStates = {};
            this.dirtyPages = new Set();
            this.isDirty = false;
            this._updateSaveUnsavedIndicator();

            if (result.page_count != null) {
                this.pageCount = result.page_count;
                this._updatePageInfo();
            }

            if (result.thumbnail) {
                this.thumbnails[pageNum] = result.thumbnail;
                this._updateThumbnail(pageNum);
            }

            await this._loadPage(pageNum);
            this.isDirty = true;
            this.dirtyPages.add(pageNum);
            this._updateSaveUnsavedIndicator();
            this._onToolChange('signature');
            this._showToast(result.message || 'Document signed with certificate', 'success');
        } catch (err) {
            this._certSignPlacementMode = true;
            this._linkDrawAreaMode = true;
            this.editor.setLinkDrawMode(true);
            throw err;
        }
    }

    async _runSearch(reverse = false) {
        if (!this.sessionId || !this.els.findInput) return;
        const query = this.els.findInput.value.trim();
        if (!query) return;

        try {
            if (!this.searchResults.length || this._lastSearchQuery !== query) {
                const data = await API.searchDocument(this.sessionId, query);
                this.searchResults = data.results || [];
                this.searchIndex = 0;
                this._lastSearchQuery = query;
            } else if (reverse) {
                this.searchIndex = (this.searchIndex - 1 + this.searchResults.length) % this.searchResults.length;
            } else {
                this.searchIndex = (this.searchIndex + 1) % this.searchResults.length;
            }

            if (!this.searchResults.length) {
                this.els.findStatus.textContent = 'No matches';
                this.editor.clearSearchHighlights();
                return;
            }

            const match = this.searchResults[this.searchIndex];
            if (match.page !== this.currentPage) {
                await this._goToPage(match.page);
            }
            const pageMatches = this.searchResults.filter((r) => r.page === this.currentPage);
            this.editor.showSearchHighlights(pageMatches, pageMatches.indexOf(match));
            this.els.findStatus.textContent = `${this.searchIndex + 1} / ${this.searchResults.length}`;
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _exportCurrentPagePng() {
        if (!this.sessionId) return;
        try {
            await this._saveCurrentPage();
            const blob = await API.exportPagePng(this.sessionId, this.currentPage);
            this._downloadBlob(blob, `page-${this.currentPage + 1}.png`);
            this._showToast('PNG exported', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _ocrCurrentPage() {
        if (!this.sessionId) return;
        try {
            this._showToast('Running OCR...', 'success');
            const result = await API.ocrPage(this.sessionId, this.currentPage);
            const count = result.elements?.length || 0;
            if (count > 0) {
                await this.editor.loadElements(result.elements);
                this._recordUndoState();
                this._showToast(`OCR added ${count} text block(s)`, 'success');
            } else {
                this._showToast(
                    'No text detected. Install Tesseract on the server for scanned pages, or use AI OCR with a vision model.',
                    'error'
                );
            }
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _aiOcrTextFromResult(result) {
        let text = (result?.text || '').trim();
        if (text) return text;
        const fromElements = (result?.elements || [])
            .filter((e) => e && e.type === 'text' && e.text)
            .map((e) => String(e.text).trim())
            .filter(Boolean);
        if (fromElements.length) {
            return fromElements.join('\n');
        }
        return '';
    }

    _setAiOcrBusy(busy) {
        const btn = this.els.btnAiOcrPage;
        if (btn) {
            btn.disabled = busy || !AISettings.configured;
            btn.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
        const overlay = this.els.aiOcrBusy;
        if (overlay) {
            overlay.style.display = busy ? 'flex' : 'none';
            overlay.setAttribute('aria-hidden', busy ? 'false' : 'true');
        }
        if (busy) {
            this._startAiOcrStatusCycle();
        } else {
            this._stopAiOcrStatusCycle();
        }
    }

    _startAiOcrStatusCycle() {
        this._stopAiOcrStatusCycle();
        const messages = [
            'Reading page content…',
            'Analyzing text and layout…',
            'Recognizing characters…',
            'Finalizing results…',
        ];
        const statusEl = this.els.aiOcrBusyStatus;
        let i = 0;
        if (statusEl) {
            statusEl.textContent = messages[0];
            statusEl.style.opacity = '1';
        }
        this._aiOcrStatusTimer = setInterval(() => {
            i = (i + 1) % messages.length;
            if (!statusEl) return;
            statusEl.style.opacity = '0';
            setTimeout(() => {
                if (this._aiOcrStatusTimer === null) return;
                statusEl.textContent = messages[i];
                statusEl.style.opacity = '1';
            }, 180);
        }, 2500);
    }

    _stopAiOcrStatusCycle() {
        if (this._aiOcrStatusTimer) {
            clearInterval(this._aiOcrStatusTimer);
            this._aiOcrStatusTimer = null;
        }
    }

    async _aiOcrCurrentPage() {
        if (!this.sessionId) {
            console.warn('AI OCR blocked: no session');
            this._showToast('Open a PDF first', 'error');
            return;
        }
        if (!AISettings.configured) {
            this._showToast('Configure AI Settings first', 'error');
            return;
        }
        if (this._aiOcrInFlight) {
            console.warn('AI OCR blocked: already in flight');
            return;
        }
        this._aiOcrInFlight = true;
        this._setAiOcrBusy(true);
        try {
            this._showToast('Running AI OCR… this may take up to a minute.', 'success', 8000);
            const result = await API.aiOcr(
                this.sessionId,
                this.currentPage,
                this._getAiOcrFontFamily()
            );
            const text = this._aiOcrTextFromResult(result);
            if (!text) {
                this._showToast(
                    'AI OCR found no text. Use a vision model in AI Settings (e.g. openai/gpt-4o or google/gemini-2.0-flash-001), then try again.',
                    'error',
                    6000
                );
                return;
            }
            this._aiOcrElements = Array.isArray(result.elements) ? result.elements : [];
            this._aiOcrSourcePdfBboxes = Array.isArray(result.source_pdf_bboxes)
                ? result.source_pdf_bboxes
                : [];
            this._showAiOcrModal(text);
        } catch (err) {
            console.error('AI OCR failed:', err);
            this._showToast(err.message || 'AI OCR failed', 'error', 6000);
        } finally {
            this._aiOcrInFlight = false;
            this._setAiOcrBusy(false);
        }
    }

    _showAiOcrModal(text) {
        if (!this.els.aiOcrModal || !this.els.aiOcrText) {
            console.error('AI OCR modal elements missing from DOM');
            this._showToast('Could not open OCR dialog — reload the page.', 'error');
            return;
        }
        try {
            this._aiOcrPendingSource = this.editor?.resolveOcrReplaceSource?.() || {
                kind: 'page',
                target: null,
                bounds: null,
            };
        } catch (err) {
            console.warn('resolveOcrReplaceSource failed:', err);
            this._aiOcrPendingSource = { kind: 'page', target: null, bounds: null };
        }
        this.els.aiOcrText.value = text;
        const isPicture = this._aiOcrPendingSource?.kind === 'image';
        if (this.els.btnAiOcrReplace) {
            this.els.btnAiOcrReplace.disabled = false;
            this.els.btnAiOcrReplace.title = isPicture
                ? 'Replace the selected picture with a same-size text box'
                : 'Cover the scanned handwriting and place editable text in the same area';
        }
        if (this.els.aiOcrModalHint) {
            this.els.aiOcrModalHint.textContent = isPicture
                ? 'Replace source removes the selected picture and puts editable text in a box the same size and position. Keep image copies the text for your own text box.'
                : 'Replace source adds white masks over the scan and places editable text in that region. Select a picture first to replace only that image. Keep image copies the text for your own text box.';
        }
        this.els.aiOcrModal.style.display = 'flex';
        this.els.aiOcrText.focus();
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [this.els.aiOcrModal] });
        }
    }

    _hideAiOcrModal() {
        if (this.els.aiOcrModal) {
            this.els.aiOcrModal.style.display = 'none';
        }
        this._aiOcrPendingSource = null;
        this._aiOcrElements = null;
        this._aiOcrSourcePdfBboxes = null;
    }

    _getAiOcrModalText() {
        return (this.els.aiOcrText?.value || '').trim();
    }

    async _applyAiOcrKeepImage() {
        const text = this._getAiOcrModalText();
        if (!text) {
            this._showToast('No text to copy', 'error');
            return;
        }
        this.editor.setPendingOcrText(text);
        let copied = false;
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
        } catch (_) {
            // clipboard may be blocked; pending paste still works on next text box
        }
        this._hideAiOcrModal();
        this._showToast(
            copied
                ? 'Text copied. Use the Text tool, click where you want it, and paste (or it will be pre-filled).'
                : 'Text ready. Use the Text tool and click on the page — the recognized text will be inserted.',
            'success'
        );
    }

    async _applyAiOcrReplaceImage() {
        const text = this._getAiOcrModalText();
        if (!text) {
            this._showToast('No text to place', 'error');
            return;
        }
        const source = this._aiOcrPendingSource || this.editor.resolveOcrReplaceSource();
        if (source.target && this.editor.canvas?.getObjects().includes(source.target)) {
            source.bounds = this.editor._captureOcrReplaceBounds(source.target);
        }

        let sourcePdfBboxes = [...(this._aiOcrSourcePdfBboxes || [])];
        if (!sourcePdfBboxes.length && this.sessionId) {
            try {
                const regions = await API.getPageSourceRegions(this.sessionId, this.currentPage);
                sourcePdfBboxes = regions.pdf_bboxes || [];
            } catch (err) {
                console.warn('Could not load page source regions:', err);
            }
            if (!sourcePdfBboxes.length) {
                try {
                    const data = await API.getPageElements(this.sessionId, this.currentPage);
                    sourcePdfBboxes = (data.elements || [])
                        .filter((e) => e.type === 'image' && e.pdf_bbox)
                        .map((e) => e.pdf_bbox);
                } catch (err) {
                    console.warn('Could not load page images:', err);
                }
            }
        }

        this._suppressUndoRecording = true;
        try {
            const textbox = await this.editor.applyOcrReplaceSource(source, text, {
                elements: this._aiOcrElements,
                sourcePdfBboxes,
                sessionId: this.sessionId,
                pageNum: this.currentPage,
            });
            if (!textbox) {
                this._showToast('Could not replace source', 'error');
                return;
            }
            this._hideAiOcrModal();
            this._recordUndoState();
            this._markDirty();
            this.toolbar.showPropertiesForObjects([textbox]);
            const msg = source.kind === 'image'
                ? 'Picture replaced with editable text — adjust and Save'
                : 'Scan removed from page — adjust text and Save to keep changes';
            this._showToast(msg, 'success');
        } catch (err) {
            console.error('AI OCR replace failed:', err);
            this._showToast(err.message || 'Replace failed', 'error');
        } finally {
            this._suppressUndoRecording = false;
        }
    }

    _getActiveTextObjects(objects) {
        const list = objects || (this.editor.canvas ? this.editor.getSelectedTextObjects() : []);
        return list.filter((o) => this.editor.isTextObject(o));
    }

    _mergeSelectedTextBlocks(objects) {
        const texts = this._getActiveTextObjects(objects);
        if (texts.length < 2) {
            this._showToast('Select at least two text blocks (Shift+click)', 'error');
            return;
        }

        this._suppressUndoRecording = true;
        let merged;
        try {
            merged = this.editor.mergeSelectedTextBlocks(texts);
        } catch (err) {
            console.error('Merge text blocks failed:', err);
            this._showToast(err.message || 'Merge failed', 'error');
            return;
        } finally {
            this._suppressUndoRecording = false;
        }

        if (!merged) {
            this._showToast('Nothing to merge', 'error');
            return;
        }

        this._recordUndoState();
        this._markDirty();
        this._storeThumbnailFromCanvas();
        this.toolbar.showPropertiesForObjects([merged]);
        this._showToast('Text blocks merged into one', 'success');
    }

    _bindAiTranslateLanguage() {
        const comboEl = document.getElementById('ai-translate-combo');
        const triggerEl = document.getElementById('ai-translate-trigger');
        const panelEl = document.getElementById('ai-translate-panel');
        const listEl = document.getElementById('ai-translate-list');
        const searchEl = document.getElementById('ai-translate-search');
        const customEl = document.getElementById('ai-translate-lang-custom');
        const hiddenEl = document.getElementById('ai-translate-lang');
        const flagEl = document.getElementById('ai-translate-flag');
        const nameEl = document.getElementById('ai-translate-name');
        if (!comboEl || !listEl || !hiddenEl) return;

        // Portal the dropdown to <body> so position:fixed anchors to the viewport.
        // The .properties-panel uses backdrop-filter, which would otherwise become
        // the containing block for fixed descendants and break the coordinates.
        if (panelEl && panelEl.parentElement !== document.body) {
            document.body.appendChild(panelEl);
        }

        const LANGS = AI_TRANSLATE_LANGUAGES;
        const CUSTOM_VALUE = '__custom__';
        let isOpen = false;

        const renderList = (filter = '') => {
            const q = filter.trim().toLowerCase();
            listEl.innerHTML = '';
            const matches = LANGS.filter((l) => !q || l.value.toLowerCase().includes(q));
            matches.forEach((l) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'ai-translate-item';
                item.dataset.value = l.value;
                item.dataset.flag = l.flag;
                item.setAttribute('role', 'option');
                item.innerHTML =
                    `<span class="ai-translate-item-flag">${l.flag}</span>` +
                    `<span class="ai-translate-item-name">${l.value}</span>`;
                if (hiddenEl.value === l.value) {
                    item.classList.add('selected');
                    item.setAttribute('aria-selected', 'true');
                }
                item.addEventListener('click', () => selectLanguage(l.value, l.flag));
                listEl.appendChild(item);
            });
            const showCustom =
                !q || 'other…'.includes(q) || 'custom'.includes(q) || 'other'.includes(q);
            if (showCustom) {
                const customItem = document.createElement('button');
                customItem.type = 'button';
                customItem.className = 'ai-translate-item ai-translate-item-other';
                customItem.dataset.value = CUSTOM_VALUE;
                customItem.setAttribute('role', 'option');
                customItem.innerHTML =
                    `<span class="ai-translate-item-name">Other…</span>`;
                if (hiddenEl.value === CUSTOM_VALUE) {
                    customItem.classList.add('selected');
                    customItem.setAttribute('aria-selected', 'true');
                }
                customItem.addEventListener('click', () => selectLanguage(CUSTOM_VALUE));
                listEl.appendChild(customItem);
            }
            if (matches.length === 0 && !showCustom) {
                const empty = document.createElement('div');
                empty.className = 'ai-translate-empty';
                empty.textContent = 'No languages match';
                listEl.appendChild(empty);
            }
        };

        const updateTrigger = (value, flag) => {
            if (flagEl) flagEl.textContent = flag;
            if (nameEl) {
                nameEl.textContent = value === CUSTOM_VALUE ? 'Other…' : value;
            }
        };

        const selectLanguage = (value, flag, closePanel = true) => {
            hiddenEl.value = value;
            updateTrigger(value, flag || '');
            const showCustom = value === CUSTOM_VALUE;
            if (customEl) {
                customEl.style.display = showCustom ? 'block' : 'none';
                if (showCustom) customEl.focus();
            }
            listEl.querySelectorAll('.ai-translate-item').forEach((el) => {
                const isSel = el.dataset.value === value;
                el.classList.toggle('selected', isSel);
                if (isSel) el.setAttribute('aria-selected', 'true');
                else el.removeAttribute('aria-selected');
            });
            if (closePanel && isOpen) closeDropdown();
        };

        const positionPanel = () => {
            if (!panelEl || !triggerEl) return;
            const rect = triggerEl.getBoundingClientRect();
            const estHeight = Math.min(window.innerHeight * 0.55, 320);
            let top = rect.bottom + 4;
            if (top + estHeight > window.innerHeight - 8) {
                top = rect.top - 4 - estHeight;
            }
            panelEl.style.left = rect.left + 'px';
            panelEl.style.top = Math.max(8, top) + 'px';
            panelEl.style.width = rect.width + 'px';
        };

        const onOutsideScroll = (e) => {
            // Ignore scrolls coming from inside the dropdown (e.g. the language list scrollbar).
            if (panelEl && panelEl.contains(e.target)) return;
            closeDropdown();
        };
        const onResize = () => closeDropdown();

        const openDropdown = () => {
            if (isOpen || triggerEl?.disabled) return;
            isOpen = true;
            if (panelEl) panelEl.hidden = false;
            comboEl.classList.add('open');
            if (triggerEl) triggerEl.setAttribute('aria-expanded', 'true');
            positionPanel();
            if (searchEl) {
                searchEl.value = '';
                renderList();
                requestAnimationFrame(() => searchEl.focus());
            }
            document.addEventListener('click', onDocClick);
            window.addEventListener('scroll', onOutsideScroll, true);
            window.addEventListener('resize', onResize);
        };

        const closeDropdown = () => {
            if (!isOpen) return;
            isOpen = false;
            if (panelEl) panelEl.hidden = true;
            comboEl.classList.remove('open');
            if (triggerEl) triggerEl.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', onDocClick);
            window.removeEventListener('scroll', onOutsideScroll, true);
            window.removeEventListener('resize', onResize);
        };

        const onDocClick = (e) => {
            if (comboEl?.contains(e.target) || panelEl?.contains(e.target)) return;
            closeDropdown();
        };

        if (triggerEl) {
            triggerEl.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isOpen) closeDropdown();
                else openDropdown();
            });
        }
        if (searchEl) {
            searchEl.addEventListener('input', () => renderList(searchEl.value));
            searchEl.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    closeDropdown();
                    triggerEl?.focus();
                } else if (e.key === 'Enter') {
                    const first = listEl.querySelector('.ai-translate-item');
                    if (first) first.click();
                }
            });
        }

        renderList();
        if (customEl) {
            customEl.style.display = hiddenEl.value === CUSTOM_VALUE ? 'block' : 'none';
        }
    }

    _getAiTranslateTargetLanguage() {
        const sel = document.getElementById('ai-translate-lang');
        if (!sel) return 'English';
        if (sel.value === '__custom__') {
            const custom = document.getElementById('ai-translate-lang-custom')?.value?.trim();
            return custom || 'English';
        }
        return (sel.value || 'English').trim();
    }

    async _aiTextAction(action, objects) {
        if (!AISettings.configured) {
            this._showToast('Configure AI Settings first', 'error');
            return;
        }
        const textObjects = this._getActiveTextObjects(objects);
        if (!textObjects.length) {
            this._showToast('Select a text object first', 'error');
            return;
        }
        if (action === 'translate' && document.getElementById('ai-translate-lang')?.value === '__custom__') {
            const custom = document.getElementById('ai-translate-lang-custom')?.value?.trim();
            if (!custom) {
                this._showToast('Choose a language or type one under Other…', 'error');
                return;
            }
        }
        const targetLang = this._getAiTranslateTargetLanguage();
        try {
            this._showToast('AI processing…', 'success');
            for (const obj of textObjects) {
                const original = (obj.text || '').trim();
                if (!original) continue;
                const result = await API.aiTextAction({
                    action,
                    text: original,
                    targetLang,
                });
                if (result.text) {
                    obj.set('text', result.text);
                    obj.setCoords();
                }
            }
            this.editor.canvas.requestRenderAll();
            this._recordUndoState();
            this._markDirty();
            this._showToast('Text updated', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _aiSuggestMetadata() {
        if (!this.sessionId || !AISettings.configured) return;
        try {
            this._showToast('Generating metadata suggestions…', 'success');
            const result = await API.aiSuggestMetadata(this.sessionId);
            const titleEl = document.getElementById('meta-title');
            const subjectEl = document.getElementById('meta-subject');
            const keywordsEl = document.getElementById('meta-keywords');
            if (titleEl && result.title) titleEl.value = result.title;
            if (subjectEl && result.subject) subjectEl.value = result.subject;
            if (keywordsEl && result.keywords) keywordsEl.value = result.keywords;
            const summaryGroup = document.getElementById('ai-meta-summary-group');
            const summaryEl = document.getElementById('ai-meta-summary');
            if (result.summary && summaryGroup && summaryEl) {
                summaryEl.textContent = result.summary;
                summaryGroup.style.display = 'block';
            }
            this._showToast('Metadata suggestions applied — review and save', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _aiFillForms() {
        if (!this.sessionId || !AISettings.configured) return;
        const forms = this.formLayer.getForms();
        if (!forms.length) {
            this._showToast('No form fields on this page', 'error');
            return;
        }
        try {
            this._showToast('AI suggesting form values…', 'success');
            const result = await API.aiSuggestForms({
                sessionId: this.sessionId,
                pageNum: this.currentPage,
                fields: forms,
            });
            const suggestions = result.suggestions || {};
            let applied = 0;
            forms.forEach((field) => {
                const key = field.field_name;
                if (!(key in suggestions)) return;
                const val = suggestions[key];
                if (field.widget_kind === 'text' || field.widget_kind === 'choice') {
                    this.formLayer.updateFieldValue(field.xref, String(val ?? ''), { silent: true });
                    applied += 1;
                } else if (field.widget_kind === 'listbox') {
                    const values = Array.isArray(val)
                        ? val
                        : String(val ?? '').split(',').map((item) => item.trim()).filter(Boolean);
                    this.formLayer.updateFieldValue(field.xref, values, { silent: true });
                    applied += 1;
                } else if (field.widget_kind === 'checkbox' || field.widget_kind === 'radio') {
                    const checked = /^(true|yes|1|on|checked)$/i.test(String(val));
                    this.formLayer.updateFieldValue(field.xref, checked, { silent: true });
                    applied += 1;
                }
            });
            this._syncCurrentPageFormsState();
            this._showFormProperties();
            this._markDirty();
            this._showToast(`Applied ${applied} suggestion(s) — review and save page`, 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _detectTablesOnPage() {
        if (!this.sessionId) return;
        try {
            const data = await API.getPageTables(this.sessionId, this.currentPage);
            this._detectedTables = data.tables || [];
            this.editor.showTableOverlays(this._detectedTables);
            if (this.els.tablesOverlayInfo) {
                this.els.tablesOverlayInfo.style.display = 'block';
                this.els.tablesCountText.textContent = `${data.count} table${data.count === 1 ? '' : 's'} detected`;
            }
            if (this.els.btnExportTables) {
                this.els.btnExportTables.style.display = data.count > 0 ? 'inline-flex' : 'none';
            }
            this._syncDetectedTableSelect();
            this._showToast(`${data.count} table(s) found`, 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    async _exportTablesCsv() {
        if (!this.sessionId) return;
        try {
            const blob = await API.exportPageTablesCsv(this.sessionId, this.currentPage);
            this._downloadBlob(blob, `page-${this.currentPage + 1}-tables.csv`);
            this._showToast('Tables exported', 'success');
        } catch (err) {
            this._showToast(err.message, 'error');
        }
    }

    _getActiveTableTarget(explicitTarget = null) {
        if (explicitTarget?.table) return explicitTarget;
        const cellTarget = this.editor.getTableCellTargetFromSelection?.();
        if (cellTarget?.table) return cellTarget;
        const active = this.editor.getActiveObject();
        if (active?._elementType === 'table') {
            return {
                table: active,
                row: active._activeCell?.row ?? 0,
                col: active._activeCell?.col ?? 0,
            };
        }
        return null;
    }

    _onTableAction(action, explicitTarget = null) {
        const target = this._getActiveTableTarget(explicitTarget);
        const table = target?.table || (action === 'importCsv' ? null : this.editor.getActiveObject());
        const row = target?.row ?? 0;
        const col = target?.col ?? 0;

        let updated = null;
        switch (action) {
            case 'insertRowAbove':
                if (!table) return;
                updated = this.editor.insertTableRow(table, row, 'above');
                break;
            case 'insertRowBelow':
                if (!table) return;
                updated = this.editor.insertTableRow(table, row, 'below');
                break;
            case 'insertColLeft':
                if (!table) return;
                updated = this.editor.insertTableColumn(table, col, 'left');
                break;
            case 'insertColRight':
                if (!table) return;
                updated = this.editor.insertTableColumn(table, col, 'right');
                break;
            case 'deleteRow':
                if (!table) return;
                updated = this.editor.deleteTableRow(table, row);
                break;
            case 'deleteCol':
                if (!table) return;
                updated = this.editor.deleteTableColumn(table, col);
                break;
            case 'distributeEvenly':
                if (!table || table._elementType !== 'table') return;
                updated = this.editor.distributeTableSizesEvenly(table);
                break;
            case 'exportCsv':
                if (!table || table._elementType !== 'table') return;
                this._exportCanvasTableCsv(table);
                return;
            case 'importCsv':
                if (this.els.tableCsvInput) this.els.tableCsvInput.click();
                return;
            default:
                return;
        }

        if (!updated) {
            this._showToast('Table action failed', 'error');
            return;
        }

        this.toolbar.syncTablePropsFromObject(updated);
        const activeCell = updated._activeCell;
        if (activeCell) {
            this.toolbar.syncTableCellOps({
                table: updated,
                row: activeCell.row,
                col: activeCell.col,
            });
        }
        this._markDirty();
    }

    _exportCanvasTableCsv(table) {
        const csv = this.editor.exportTableCsv(table);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        this._downloadBlob(blob, 'table.csv');
        this._showToast('Table exported', 'success');
    }

    async _onTableCsvFileSelected(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        try {
            const csvText = await file.text();
            const table = this.editor.importTableFromCsv(csvText);
            if (!table) {
                this._showToast('Could not import CSV', 'error');
                return;
            }
            this.toolbar._showTableProps(table);
            this._onToolChange('select');
            this._markDirty();
            this._showToast('Table imported from CSV', 'success');
        } catch (err) {
            this._showToast(err.message || 'CSV import failed', 'error');
        }
    }

    _syncDetectedTableSelect() {
        const select = this.els.detectedTableSelect;
        const actions = this.els.detectedTableActions;
        if (!select || !actions) return;

        const tables = this._detectedTables || [];
        select.innerHTML = '';
        tables.forEach((table, index) => {
            const option = document.createElement('option');
            option.value = String(index);
            const rowCount = table.row_count || table.rows?.length || 0;
            const colCount = table.col_count || table.rows?.[0]?.length || 0;
            option.textContent = `Table ${index + 1} (${rowCount}×${colCount})`;
            select.appendChild(option);
        });
        actions.style.display = tables.length > 0 ? 'block' : 'none';
    }

    _makeDetectedTableEditable() {
        const tables = this._detectedTables || [];
        if (!tables.length) {
            this._showToast('No detected tables', 'error');
            return;
        }

        const index = parseInt(this.els.detectedTableSelect?.value || '0', 10) || 0;
        const detected = tables[index];
        if (!detected) {
            this._showToast('Table not found', 'error');
            return;
        }

        const table = this.editor.addTableFromDetection(detected.bbox, detected.rows || []);
        if (!table) {
            this._showToast('Could not create table', 'error');
            return;
        }

        if (this.editor._tableOverlays?.[index]) {
            this.editor.canvas.remove(this.editor._tableOverlays[index]);
            this.editor._tableOverlays.splice(index, 1);
            this.editor.canvas.requestRenderAll();
        }

        this._detectedTables.splice(index, 1);
        this._syncDetectedTableSelect();
        if (this.els.tablesCountText) {
            const count = this._detectedTables.length;
            this.els.tablesCountText.textContent = `${count} table${count === 1 ? '' : 's'} detected`;
            if (count === 0 && this.els.tablesOverlayInfo) {
                this.els.tablesOverlayInfo.style.display = 'none';
            }
            if (this.els.btnExportTables) {
                this.els.btnExportTables.style.display = count > 0 ? 'inline-flex' : 'none';
            }
        }

        this.toolbar._showTableProps(table);
        this._onToolChange('select');
        this._markDirty();
        this._showToast('Editable table created', 'success');
    }

    _showToast(message, type = 'success', durationMs = 3000) {
        if (!this.els.toastContainer) {
            console.warn('Toast:', message);
            return;
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const iconName = type === 'success' ? 'check-circle' : 'alert-circle';
        const span = document.createElement('span');
        span.textContent = message;
        toast.innerHTML = `<i data-lucide="${iconName}" class="toast-icon"></i>`;
        toast.appendChild(span);

        this.els.toastContainer.appendChild(toast);
        if (typeof lucide !== 'undefined') {
            lucide.createIcons({ nodes: [toast] });
        }

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 250);
        }, durationMs);
    }
}

const app = new App();
window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());

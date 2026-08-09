class SignatureManager {
    constructor() {
        this.activeColor = '#000000';
        this.selectedFont = 'Great Vibes';
        this.modalMode = 'signature'; // 'signature' or 'initials'
        this.currentTab = 'sig-draw';
        this.uploadedImageSrc = null;
        
        // Pad properties
        this.padCanvas = null;
        this.padCtx = null;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.lineWidth = 3.5;
    }

    init() {
        this._cacheElements();
        this._initDrawingPad();
        this._initTabs();
        this._initColorSelectors();
        this._initTypeInput();
        this._initUploadDropzone();
        this._initModalActions();
        this._initGalleryActions();
        
        // Load saved signatures/initials from local storage
        this.loadGalleries();
    }

    _cacheElements() {
        this.els = {
            modal: document.getElementById('signature-modal'),
            modalTitle: document.getElementById('sig-modal-title'),
            btnCancel: document.getElementById('btn-cancel-sig'),
            btnSave: document.getElementById('btn-save-sig'),
            
            // Tabs
            tabButtons: document.querySelectorAll('.sig-tab'),
            tabContents: document.querySelectorAll('.sig-tab-content'),
            
            // Draw Tab
            padCanvas: document.getElementById('signature-pad-canvas'),
            btnClearPad: document.getElementById('btn-clear-sig-pad'),
            colorBtns: document.querySelectorAll('.sig-color-btn:not(.sig-color-picker-wrapper)'),
            
            // Type Tab
            typeInput: document.getElementById('sig-type-input'),
            fontPreviews: document.querySelectorAll('.sig-font-row'),
            
            // Upload Tab
            dropzone: document.getElementById('sig-upload-dropzone'),
            fileInput: document.getElementById('sig-image-file'),
            btnBrowse: document.getElementById('btn-browse-sig-img'),
            previewContainer: document.getElementById('sig-upload-preview-container'),
            previewImg: document.getElementById('sig-upload-preview-img'),
            btnRemoveUpload: document.getElementById('btn-remove-sig-upload'),
            removeBgCheckbox: document.getElementById('sig-upload-remove-bg'),
            
            // Sidebar Galleries
            btnAddSigGallery: document.getElementById('btn-add-sig-gallery'),
            btnAddInitGallery: document.getElementById('btn-add-init-gallery'),
            signatureList: document.getElementById('signature-list'),
            initialsList: document.getElementById('initials-list')
        };
    }

    _initDrawingPad() {
        this.padCanvas = this.els.padCanvas;
        if (!this.padCanvas) return;
        
        this.padCtx = this.padCanvas.getContext('2d');
        
        const getPos = (e) => {
            const rect = this.padCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            
            // Scale according to actual canvas internal resolution
            const x = ((clientX - rect.left) / rect.width) * this.padCanvas.width;
            const y = ((clientY - rect.top) / rect.height) * this.padCanvas.height;
            return { x, y };
        };

        const startDrawing = (e) => {
            e.preventDefault();
            this.isDrawing = true;
            const pos = getPos(e);
            this.lastX = pos.x;
            this.lastY = pos.y;
            
            // Draw a single dot on click
            this.padCtx.beginPath();
            this.padCtx.arc(pos.x, pos.y, this.lineWidth / 2, 0, Math.PI * 2);
            this.padCtx.fillStyle = this.activeColor;
            this.padCtx.fill();
        };

        const draw = (e) => {
            if (!this.isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            
            this.padCtx.beginPath();
            this.padCtx.moveTo(this.lastX, this.lastY);
            this.padCtx.lineTo(pos.x, pos.y);
            this.padCtx.strokeStyle = this.activeColor;
            this.padCtx.lineWidth = this.lineWidth;
            this.padCtx.lineCap = 'round';
            this.padCtx.lineJoin = 'round';
            this.padCtx.stroke();

            this.lastX = pos.x;
            this.lastY = pos.y;
        };

        const stopDrawing = () => {
            this.isDrawing = false;
        };

        // Desktop mouse events
        this.padCanvas.addEventListener('mousedown', startDrawing);
        this.padCanvas.addEventListener('mousemove', draw);
        this.padCanvas.addEventListener('mouseup', stopDrawing);
        this.padCanvas.addEventListener('mouseleave', stopDrawing);

        // Mobile touch events
        this.padCanvas.addEventListener('touchstart', startDrawing, { passive: false });
        this.padCanvas.addEventListener('touchmove', draw, { passive: false });
        this.padCanvas.addEventListener('touchend', stopDrawing);
        
        // Clear Pad
        this.els.btnClearPad.addEventListener('click', () => {
            this.clearPad();
        });
    }

    clearPad() {
        if (!this.padCtx) return;
        this.padCtx.clearRect(0, 0, this.padCanvas.width, this.padCanvas.height);
    }

    isPadEmpty() {
        if (!this.padCanvas) return true;
        const buffer = new Uint32Array(this.padCtx.getImageData(0, 0, this.padCanvas.width, this.padCanvas.height).data.buffer);
        return !buffer.some(color => color !== 0);
    }

    _initTabs() {
        this.els.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTab = btn.dataset.tab;
                this.currentTab = targetTab;
                
                // Toggle active buttons
                this.els.tabButtons.forEach(b => b.classList.toggle('active', b === btn));
                
                // Toggle tab content panels
                this.els.tabContents.forEach(panel => {
                    panel.style.display = panel.id === 'tab-' + targetTab ? 'block' : 'none';
                });
            });
        });
    }

    _initColorSelectors() {
        const picker = document.getElementById('sig-color-picker');
        const pickerWrapper = document.getElementById('sig-color-picker-wrapper');

        this.els.colorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.activeColor = btn.dataset.color;
                this.els.colorBtns.forEach(b => b.classList.toggle('active', b === btn));
                if (pickerWrapper) {
                    pickerWrapper.classList.remove('active');
                    // Reset custom picker back to its soft rainbow gradient background
                    pickerWrapper.style.background = 'conic-gradient(from 180deg at 50% 50%, #f43f5e, #eab308, #10b981, #3b82f6, #a855f7, #f43f5e)';
                }
                
                // Also update the font previews text color in the Type tab
                document.querySelectorAll('.sig-font-preview-text').forEach(el => {
                    el.style.color = this.activeColor;
                });
            });
        });

        if (picker && pickerWrapper) {
            const handlePickerColor = () => {
                this.activeColor = picker.value;
                this.els.colorBtns.forEach(b => b.classList.remove('active'));
                pickerWrapper.classList.add('active');
                
                // Set custom picker background to the selected color
                pickerWrapper.style.background = picker.value;
                
                // Update the font previews text color in the Type tab
                document.querySelectorAll('.sig-font-preview-text').forEach(el => {
                    el.style.color = this.activeColor;
                });
            };

            picker.addEventListener('input', handlePickerColor);
            picker.addEventListener('change', handlePickerColor);
        }
    }

    _initTypeInput() {
        const previews = document.querySelectorAll('.sig-font-preview-text');
        
        const updatePreviews = () => {
            let name = this.els.typeInput.value.trim();
            if (!name) {
                name = this.modalMode === 'signature' ? 'Your Signature' : 'YS';
            }
            previews.forEach(el => {
                el.textContent = name;
            });
        };

        this.els.typeInput.addEventListener('input', updatePreviews);

        // Font family row selection
        this.els.fontPreviews.forEach(row => {
            row.addEventListener('click', () => {
                this.selectedFont = row.dataset.font;
                this.els.fontPreviews.forEach(r => r.classList.toggle('active', r === row));
            });
        });
    }

    _initUploadDropzone() {
        const dropzone = this.els.dropzone;
        const fileInput = this.els.fileInput;
        
        this.els.btnBrowse.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('click', (e) => {
            if (e.target !== this.els.btnBrowse) {
                fileInput.click();
            }
        });

        // Drag events
        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropzone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropzone.classList.remove('dragover');
            }, false);
        });

        dropzone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length > 0) {
                this._handleUploadedFile(files[0]);
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this._handleUploadedFile(e.target.files[0]);
            }
        });

        // Remove upload
        this.els.btnRemoveUpload.addEventListener('click', () => {
            this.uploadedImageSrc = null;
            fileInput.value = '';
            this.els.previewContainer.style.display = 'none';
            dropzone.style.display = 'flex';
        });

        // Checkbox change triggers preview update
        this.els.removeBgCheckbox.addEventListener('change', () => {
            if (this.uploadedImageSrc) {
                this._updateUploadedPreview();
            }
        });
    }

    _handleUploadedFile(file) {
        if (!file.type.match('image.*')) {
            if (window.app) window.app._showToast('Please upload an image file (PNG/JPEG)', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.uploadedImageSrc = e.target.result;
            this._updateUploadedPreview();
        };
        reader.readAsDataURL(file);
    }

    async _updateUploadedPreview() {
        const removeBg = this.els.removeBgCheckbox.checked;
        const processedUrl = await this._processImageBg(this.uploadedImageSrc, removeBg);
        this.els.previewImg.src = processedUrl;
        this.els.dropzone.style.display = 'none';
        this.els.previewContainer.style.display = 'flex';
    }

    _processImageBg(imgSrc, removeBg) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                
                if (removeBg) {
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imgData.data;
                    const threshold = 238; // Threshold to define "white" background (238/255)
                    
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i];
                        const g = data[i+1];
                        const b = data[i+2];
                        
                        // If all red, green, and blue channels are close to white, make transparent
                        if (r > threshold && g > threshold && b > threshold) {
                            data[i+3] = 0; // Alpha
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);
                }
                resolve(canvas.toDataURL('image/png'));
            };
            img.src = imgSrc;
        });
    }

    _initModalActions() {
        this.els.btnCancel.addEventListener('click', () => {
            this.closeModal();
        });
        
        // Modal backdrop click closes modal
        this.els.modal.querySelector('.modal-backdrop').addEventListener('click', () => {
            this.closeModal();
        });

        this.els.btnSave.addEventListener('click', async () => {
            let dataUrl = null;
            
            if (this.currentTab === 'sig-draw') {
                if (this.isPadEmpty()) {
                    if (window.app) window.app._showToast('Please draw your signature first', 'error');
                    return;
                }
                dataUrl = this.padCanvas.toDataURL('image/png');
            } else if (this.currentTab === 'sig-type') {
                const text = this.els.typeInput.value.trim() || (this.modalMode === 'signature' ? 'Your Signature' : 'YS');
                dataUrl = this._generateTypedSignature(text, this.selectedFont, this.activeColor);
            } else if (this.currentTab === 'sig-upload') {
                if (!this.uploadedImageSrc) {
                    if (window.app) window.app._showToast('Please upload an image first', 'error');
                    return;
                }
                dataUrl = this.els.previewImg.src;
            }

            if (dataUrl) {
                // Save signature
                this.saveSignature(this.modalMode, dataUrl);
                this.loadGalleries();
                
                // Auto-place signature on current canvas!
                if (window.app && window.app.editor) {
                    await window.app.editor.addImage(dataUrl);
                    window.app._recordUndoState();
                    
                    // Switch tool back to select so user can directly drag & position it
                    window.app._onToolChange('select');
                }
                
                this.closeModal();
                if (window.app) window.app._showToast(`${this.modalMode === 'signature' ? 'Signature' : 'Initials'} created and placed`, 'success');
            }
        });
    }

    _generateTypedSignature(text, fontName, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 600;
        canvas.height = 200;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `italic 68px "${fontName}", cursive`;
        
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        return canvas.toDataURL('image/png');
    }

    _initGalleryActions() {
        this.els.btnAddSigGallery.addEventListener('click', () => {
            this.openModal('signature');
        });

        this.els.btnAddInitGallery.addEventListener('click', () => {
            this.openModal('initials');
        });
    }

    openModal(mode = 'signature') {
        this.modalMode = mode;
        this.els.modalTitle.textContent = mode === 'signature' ? 'Create Signature' : 'Create Initials';
        
        // Reset pad & input states
        this.clearPad();
        this.els.typeInput.value = '';
        this.uploadedImageSrc = null;
        this.els.fileInput.value = '';
        this.els.previewContainer.style.display = 'none';
        this.els.dropzone.style.display = 'flex';
        
        // Switch to the first tab (Draw) by default
        this.els.tabButtons[0].click();
        
        // Trigger font text preview update
        this.els.typeInput.dispatchEvent(new Event('input'));
        
        // Show modal
        this.els.modal.style.display = 'flex';
    }

    closeModal() {
        this.els.modal.style.display = 'none';
    }

    // Local Storage helpers
    getSavedSignatures(type = 'signature') {
        const key = type === 'signature' ? 'pdf_saved_signatures' : 'pdf_saved_initials';
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Error reading signatures from localStorage:', e);
            return [];
        }
    }

    saveSignature(type = 'signature', dataUrl) {
        const key = type === 'signature' ? 'pdf_saved_signatures' : 'pdf_saved_initials';
        const items = this.getSavedSignatures(type);
        items.push(dataUrl);
        localStorage.setItem(key, JSON.stringify(items));
    }

    removeSignature(type = 'signature', index) {
        const key = type === 'signature' ? 'pdf_saved_signatures' : 'pdf_saved_initials';
        const items = this.getSavedSignatures(type);
        if (index >= 0 && index < items.length) {
            items.splice(index, 1);
            localStorage.setItem(key, JSON.stringify(items));
            this.loadGalleries();
            if (window.app) window.app._showToast('Item deleted from gallery', 'success');
        }
    }

    loadGalleries() {
        this._renderGallery('signature', this.els.signatureList);
        this._renderGallery('initials', this.els.initialsList);
    }

    _renderGallery(type, container) {
        if (!container) return;
        container.innerHTML = '';
        
        const items = this.getSavedSignatures(type);
        
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'signature-empty-item';
            empty.textContent = type === 'signature' ? 'No signatures saved' : 'No initials saved';
            container.appendChild(empty);
            return;
        }

        items.forEach((dataUrl, index) => {
            const card = document.createElement('div');
            card.className = 'signature-gallery-item';
            
            const img = document.createElement('img');
            img.src = dataUrl;
            img.className = 'sig-item-preview';
            img.alt = `${type} preview`;
            
            const delBtn = document.createElement('button');
            delBtn.className = 'sig-item-delete';
            delBtn.type = 'button';
            delBtn.title = 'Delete';
            delBtn.innerHTML = '<i data-lucide="x" style="width: 12px; height: 12px;"></i>';
            
            // Delete signature click handler
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeSignature(type, index);
            });

            // Click signature card adds it to the page canvas immediately!
            card.addEventListener('click', () => {
                if (window.app && window.app.editor) {
                    window.app.editor.addImage(dataUrl).then(() => {
                        window.app._recordUndoState();
                        // Automatically switch active tool back to select
                        window.app._onToolChange('select');
                    });
                }
            });

            card.appendChild(img);
            card.appendChild(delBtn);
            container.appendChild(card);
        });
        
        // Re-trigger Lucide icon instantiation in the gallery cards
        lucide.createIcons();
    }
}

// Instantiate and bind to window
window.signatureManager = new SignatureManager();
document.addEventListener('DOMContentLoaded', () => {
    window.signatureManager.init();
});

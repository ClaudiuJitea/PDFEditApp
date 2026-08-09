function apiErrorMessage(body, fallback) {
    const msg = (body && body.error) || fallback;
    const detail = body && body.detail;
    if (detail && !String(msg).includes(detail)) {
        return `${msg} (${detail})`;
    }
    return msg;
}

function getAuthToken() {
    return window.__PDFEDIT_AUTH_TOKEN__ || '';
}

function apiFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = getAuthToken();
    if (token) {
        headers.set('X-PDFEdit-Token', token);
    }
    return fetch(url, { ...options, headers });
}

const API = {
    baseUrl: '/api',

    async uploadPDF(file, password = null) {
        const formData = new FormData();
        formData.append('file', file);
        if (password) formData.append('password', password);
        const resp = await apiFetch(`${this.baseUrl}/upload`, {
            method: 'POST',
            body: formData,
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Upload failed' }));
            const error = new Error(err.error || 'Upload failed');
            error.passwordRequired = err.password_required;
            throw error;
        }
        return resp.json();
    },

    async mergePDF(sessionId, file, password = null, position = 'end') {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('position', position);
        if (password) formData.append('password', password);
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/merge`, {
            method: 'POST',
            body: formData,
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Merge failed' }));
            const error = new Error(err.error || 'Merge failed');
            error.passwordRequired = err.password_required;
            throw error;
        }
        return resp.json();
    },

    async newPDF(size = 'A4', width, height) {
        const body = { size };
        if (size === 'custom') {
            body.width = width || 595;
            body.height = height || 842;
        }
        const resp = await apiFetch(`${this.baseUrl}/new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to create PDF' }));
            throw new Error(err.error || 'Failed to create PDF');
        }
        return resp.json();
    },

    async getPage(sessionId, pageNum, options = {}) {
        const maskEditable = options.maskEditable !== false;
        const query = new URLSearchParams({ mask_editable: maskEditable ? '1' : '0' });
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}?${query.toString()}`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to load page' }));
            throw new Error(err.error || 'Failed to load page');
        }
        return resp.json();
    },

    async getPageSourceRegions(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/source-regions`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to load source regions' }));
            throw new Error(err.error || 'Failed to load source regions');
        }
        return resp.json();
    },

    async getPageMaskedPreview(sessionId, pageNum, pdfBboxes) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/masked-preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdf_bboxes: pdfBboxes }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to refresh page preview' }));
            throw new Error(err.error || 'Failed to refresh page preview');
        }
        return resp.json();
    },

    async getPageElements(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/elements`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to load elements' }));
            throw new Error(err.error || 'Failed to load elements');
        }
        return resp.json();
    },

    async getPageForms(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/forms`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to load form fields' }));
            throw new Error(err.error || 'Failed to load form fields');
        }
        return resp.json();
    },

    async createPageForm(sessionId, pageNum, kind) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/forms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to create form field' }));
            throw new Error(err.error || 'Failed to create form field');
        }
        return resp.json();
    },

    async deletePageForm(sessionId, pageNum, xref) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/forms/${xref}`, {
            method: 'DELETE',
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to delete form field' }));
            throw new Error(err.error || 'Failed to delete form field');
        }
        return resp.json();
    },

    async duplicatePageForm(sessionId, pageNum, xref, field = null) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/forms/${xref}/duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(field ? { field } : {}),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to duplicate form field' }));
            throw new Error(err.error || 'Failed to duplicate form field');
        }
        return resp.json();
    },

    async savePage(sessionId, pageNum, elements, deletedOriginals = [], forms = []) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ elements, deleted_originals: deletedOriginals, forms }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Save failed' }));
            throw new Error(err.error || 'Save failed');
        }
        return resp.json();
    },

    async exportPDF(sessionId, options = {}) {
        const resp = await apiFetch(`${this.baseUrl}/export/${sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Export failed' }));
            throw new Error(err.error || 'Export failed');
        }
        return resp.blob();
    },

    async exportPage(sessionId, pageNum, options = {}) {
        const resp = await apiFetch(`${this.baseUrl}/export/${sessionId}/${pageNum}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(options),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to export page' }));
            throw new Error(err.error || 'Failed to export page');
        }
        return resp.blob();
    },

    async exportPagePng(sessionId, pageNum, dpi = 150) {
        const resp = await apiFetch(`${this.baseUrl}/export/${sessionId}/${pageNum}/png`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dpi }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to export PNG' }));
            throw new Error(err.error || 'Failed to export PNG');
        }
        return resp.blob();
    },

    async searchDocument(sessionId, query, page = null) {
        const params = new URLSearchParams({ q: query });
        if (page !== null && page !== undefined) params.set('page', String(page));
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/search?${params.toString()}`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Search failed' }));
            throw new Error(err.error || 'Search failed');
        }
        return resp.json();
    },

    async getMetadata(sessionId) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/metadata`);
        if (!resp.ok) throw new Error('Failed to load metadata');
        return resp.json();
    },

    async setMetadata(sessionId, metadata) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/metadata`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata }),
        });
        if (!resp.ok) throw new Error('Failed to save metadata');
        return resp.json();
    },

    async getBookmarks(sessionId) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/bookmarks`);
        if (!resp.ok) throw new Error('Failed to load bookmarks');
        return resp.json();
    },

    async setBookmarks(sessionId, bookmarks) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/bookmarks`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookmarks }),
        });
        if (!resp.ok) throw new Error('Failed to save bookmarks');
        return resp.json();
    },

    async getPageLinks(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/links`);
        if (!resp.ok) throw new Error('Failed to load links');
        return resp.json();
    },

    async createPageLink(sessionId, pageNum, linkData) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(linkData),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to create link' }));
            throw new Error(err.error || 'Failed to create link');
        }
        return resp.json();
    },

    async updatePageLink(sessionId, pageNum, linkIndex, linkData) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/links/${linkIndex}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(linkData),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to update link' }));
            throw new Error(err.error || 'Failed to update link');
        }
        return resp.json();
    },

    async deletePageLink(sessionId, pageNum, linkIndex) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/links/${linkIndex}`, {
            method: 'DELETE',
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to delete link' }));
            throw new Error(err.error || 'Failed to delete link');
        }
        return resp.json();
    },

    async getDocumentLinks(sessionId) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/links`);
        if (!resp.ok) throw new Error('Failed to load document links');
        return resp.json();
    },

    async ocrPage(sessionId, pageNum, language = 'eng') {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/ocr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'OCR failed' }));
            throw new Error(apiErrorMessage(err, 'OCR failed'));
        }
        return resp.json();
    },

    async getPageTables(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/tables`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to detect tables' }));
            throw new Error(err.error || 'Failed to detect tables');
        }
        return resp.json();
    },

    async exportPageTablesCsv(sessionId, pageNum, tableIndex = null) {
        const query = tableIndex != null ? `?index=${encodeURIComponent(tableIndex)}` : '';
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/tables/export${query}`);
        if (!resp.ok) throw new Error('Failed to export tables');
        return resp.blob();
    },

    async extractPageText(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/text`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to extract page text' }));
            throw new Error(err.error || 'Failed to extract page text');
        }
        return resp.blob();
    },

    async duplicatePage(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/duplicate`, {
            method: 'POST',
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to duplicate page' }));
            throw new Error(err.error || 'Failed to duplicate page');
        }
        return resp.json();
    },

    async addPage(sessionId, position = -1, size = 'A4') {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position, size }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to add page' }));
            throw new Error(err.error || 'Failed to add page');
        }
        return resp.json();
    },

    async deletePage(sessionId, pageNum) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}`, {
            method: 'DELETE',
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to delete page' }));
            throw new Error(err.error || 'Failed to delete page');
        }
        return resp.json();
    },

    async rotatePage(sessionId, pageNum, degrees) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/${pageNum}/rotate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ degrees }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to rotate page' }));
            throw new Error(err.error || 'Failed to rotate page');
        }
        return resp.json();
    },

    async movePage(sessionId, fromPage, toPage) {
        const resp = await apiFetch(`${this.baseUrl}/page/${sessionId}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_page: fromPage, to_page: toPage }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to move page' }));
            throw new Error(err.error || 'Failed to move page');
        }
        return resp.json();
    },

    async getSession(sessionId) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Session not found' }));
            throw new Error(err.error || 'Session not found');
        }
        return resp.json();
    },

    async getDrafts(sessionId) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/drafts`);
        if (!resp.ok) {
            return null;
        }
        return resp.json();
    },

    async saveDrafts(sessionId, payload) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/drafts`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            throw new Error('Failed to save drafts');
        }
        return resp.json();
    },

    async deleteSession(sessionId) {
        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}`, {
            method: 'DELETE',
        });
        return resp.json();
    },

    async getAiSettings() {
        const resp = await apiFetch(`${this.baseUrl}/ai/settings`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to load AI settings' }));
            throw new Error(err.error || 'Failed to load AI settings');
        }
        return resp.json();
    },

    async saveAiSettings({ apiKey, model, settingsToken } = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (settingsToken) headers['X-AI-Settings-Token'] = settingsToken;
        const body = {};
        if (apiKey) body.api_key = apiKey;
        if (model) body.model = model;
        const resp = await apiFetch(`${this.baseUrl}/ai/settings`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to save AI settings' }));
            throw new Error(err.error || 'Failed to save AI settings');
        }
        return resp.json();
    },

    async testAiSettings() {
        const resp = await apiFetch(`${this.baseUrl}/ai/settings/test`, { method: 'POST' });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Connection test failed' }));
            throw new Error(err.error || 'Connection test failed');
        }
        return resp.json();
    },

    async listAiModels() {
        const resp = await apiFetch(`${this.baseUrl}/ai/models`);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Failed to load models' }));
            throw new Error(err.error || 'Failed to load models');
        }
        return resp.json();
    },

    async aiChat({ sessionId, pageNum, scope, messages, selectionText }) {
        const resp = await apiFetch(`${this.baseUrl}/ai/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                page_num: pageNum,
                scope,
                messages,
                selection_text: selectionText || undefined,
            }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'AI chat failed' }));
            throw new Error(err.error || 'AI chat failed');
        }
        return resp.json();
    },

    async aiTextAction({ action, text, targetLang }) {
        const resp = await apiFetch(`${this.baseUrl}/ai/text-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, text, target_lang: targetLang }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'AI text action failed' }));
            throw new Error(err.error || 'AI text action failed');
        }
        return resp.json();
    },

    async aiSuggestMetadata(sessionId) {
        const resp = await apiFetch(`${this.baseUrl}/ai/metadata/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Metadata suggestion failed' }));
            throw new Error(err.error || 'Metadata suggestion failed');
        }
        return resp.json();
    },

    async aiSuggestForms({ sessionId, pageNum, fields }) {
        const resp = await apiFetch(`${this.baseUrl}/ai/forms/suggest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                page_num: pageNum,
                fields,
            }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Form suggestion failed' }));
            throw new Error(err.error || 'Form suggestion failed');
        }
        return resp.json();
    },

    async _readJsonResponse(resp, fallbackError) {
        const raw = await resp.text();
        if (!raw) {
            return { error: fallbackError };
        }
        try {
            return JSON.parse(raw);
        } catch {
            return { error: fallbackError, detail: raw.slice(0, 300) };
        }
    },

    async aiOcr(sessionId, pageNum, fontFamily = 'Helvetica') {
        const resp = await apiFetch(`${this.baseUrl}/ai/ocr`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                page_num: pageNum,
                font_family: fontFamily,
            }),
        });
        const data = await this._readJsonResponse(resp, 'AI OCR failed');
        if (!resp.ok) {
            throw new Error(apiErrorMessage(data, 'AI OCR failed'));
        }
        return data;
    },

    async certSign(sessionId, options) {
        const formData = new FormData();
        formData.append('certificate', options.certificateFile);
        formData.append('password', options.password || '');
        formData.append('page_num', String(options.pageNum ?? 0));
        formData.append('pdf_bbox', JSON.stringify(options.pdf_bbox));
        if (options.bbox) formData.append('bbox', JSON.stringify(options.bbox));
        if (options.reason) formData.append('reason', options.reason);
        if (options.location) formData.append('location', options.location);
        if (options.contact_info) formData.append('contact_info', options.contact_info);
        if (options.appearance_text) formData.append('appearance_text', options.appearance_text);

        const resp = await apiFetch(`${this.baseUrl}/session/${sessionId}/cert-sign`, {
            method: 'POST',
            body: formData,
        });
        const data = await this._readJsonResponse(resp, 'Certificate signing failed');
        if (!resp.ok) {
            throw new Error(apiErrorMessage(data, 'Certificate signing failed'));
        }
        return data;
    },

    async generateCertificate(body) {
        const resp = await apiFetch(`${this.baseUrl}/cert/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await this._readJsonResponse(resp, 'Certificate generation failed');
        if (!resp.ok) {
            throw new Error(apiErrorMessage(data, 'Certificate generation failed'));
        }
        return data;
    },
};

window.API = API;

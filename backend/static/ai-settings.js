/** Server-backed OpenRouter settings (no localStorage for API key). */
const AISettings = {
    configured: false,
    model: '',
    keyPreview: null,

    async refresh() {
        try {
            const data = await API.getAiSettings();
            this.configured = !!data.configured;
            this.model = data.model || '';
            this.keyPreview = data.key_preview || null;
            this._envKey = !!data.key_from_env;
            this._envModel = !!data.model_from_env;
            return data;
        } catch {
            this.configured = false;
            return { configured: false };
        }
    },

    async openModal() {
        const modal = document.getElementById('ai-settings-modal');
        if (!modal) return;

        const data = await this.refresh();
        const keyPreview = document.getElementById('ai-key-preview');
        const envNote = document.getElementById('ai-settings-env-note');
        const apiKeyInput = document.getElementById('ai-api-key');
        const customModel = document.getElementById('ai-model-custom');

        if (apiKeyInput) apiKeyInput.value = '';
        if (keyPreview) {
            keyPreview.textContent = data.key_preview
                ? `Current key: ${data.key_preview}`
                : 'No API key saved yet.';
        }
        if (envNote) {
            envNote.style.display = (data.key_from_env || data.model_from_env) ? 'block' : 'none';
        }
        if (customModel) customModel.value = data.model || '';

        await this._populateModels(data.model);
        modal.style.display = 'flex';
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [modal] });
    },

    closeModal() {
        const modal = document.getElementById('ai-settings-modal');
        if (modal) modal.style.display = 'none';
    },

    async _populateModels(selectedModel) {
        const select = document.getElementById('ai-model-select');
        if (!select) return;

        select.innerHTML = '<option value="">— Select model —</option>';
        if (!this.configured) {
            select.innerHTML = '<option value="">Configure API key first</option>';
            return;
        }

        try {
            const { models } = await API.listAiModels();
            const popular = [
                'openai/gpt-4o-mini',
                'openai/gpt-4o',
                'anthropic/claude-3.5-sonnet',
                'google/gemini-2.0-flash-001',
            ];
            const ids = new Set();
            popular.forEach((id) => {
                if (models.some((m) => m.id === id)) ids.add(id);
            });
            models.forEach((m) => ids.add(m.id));

            [...ids].sort().forEach((id) => {
                const m = models.find((x) => x.id === id);
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = m?.name || id;
                if (id === selectedModel) opt.selected = true;
                select.appendChild(opt);
            });
        } catch {
            select.innerHTML = '<option value="">Could not load models</option>';
        }
    },

    _resolvedModel() {
        const custom = document.getElementById('ai-model-custom')?.value?.trim();
        if (custom) return custom;
        return document.getElementById('ai-model-select')?.value?.trim() || '';
    },

    async save() {
        const apiKey = document.getElementById('ai-api-key')?.value?.trim() || undefined;
        const model = this._resolvedModel() || undefined;
        const settingsToken = document.getElementById('ai-settings-token')?.value?.trim() || undefined;

        if (!apiKey && !model && !this.configured) {
            throw new Error('Enter an API key or choose a model');
        }

        const data = await API.saveAiSettings({ apiKey, model, settingsToken });
        await this.refresh();
        if (window.app?.onAiConfiguredChanged) {
            window.app.onAiConfiguredChanged(this.configured);
        }
        return data;
    },

    async test() {
        await this.save();
        return API.testAiSettings();
    },

    bind() {
        document.getElementById('btn-ai-settings')?.addEventListener('click', () => this.openModal());
        document.getElementById('btn-ai-settings-cancel')?.addEventListener('click', () => this.closeModal());
        document.getElementById('ai-settings-modal')?.querySelector('.modal-backdrop')
            ?.addEventListener('click', () => this.closeModal());

        document.getElementById('btn-ai-settings-save')?.addEventListener('click', async () => {
            try {
                await this.save();
                this.closeModal();
                window.app?._showToast?.('AI settings saved', 'success');
            } catch (err) {
                window.app?._showToast?.(err.message, 'error');
            }
        });

        document.getElementById('btn-ai-settings-test')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-ai-settings-test');
            try {
                if (btn) btn.disabled = true;
                const result = await this.test();
                window.app?._showToast?.(`Connected: ${result.reply || 'OK'}`, 'success');
            } catch (err) {
                window.app?._showToast?.(err.message, 'error');
            } finally {
                if (btn) btn.disabled = false;
            }
        });
    },
};

window.AISettings = AISettings;

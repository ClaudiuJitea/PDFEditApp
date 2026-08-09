/** AI assistant chat panel. */
const AIAssistant = {
    messages: [],
    open: false,
    busy: false,

    init() {
        document.getElementById('btn-ai-assistant')?.addEventListener('click', () => this.toggle());
        document.getElementById('btn-ai-panel-close')?.addEventListener('click', () => this.close());
        document.getElementById('btn-ai-chat-send')?.addEventListener('click', () => this.send());
        document.getElementById('ai-chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.send();
            }
        });

        document.querySelectorAll('.ai-quick-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const input = document.getElementById('ai-chat-input');
                if (input) input.value = btn.dataset.aiPrompt || '';
                this.send();
            });
        });
    },

    getScope() {
        const checked = document.querySelector('input[name="ai-scope"]:checked');
        return checked?.value === 'document' ? 'document' : 'page';
    },

    toggle() {
        if (this.open) this.close();
        else this.openPanel();
    },

    openPanel() {
        const panel = document.getElementById('ai-panel');
        if (!panel) return;
        if (!AISettings.configured) {
            window.app?._showToast?.('Configure OpenRouter in AI Settings first', 'error');
            AISettings.openModal();
            return;
        }
        if (!window.app?.sessionId) {
            window.app?._showToast?.('Open a PDF first', 'error');
            return;
        }
        panel.style.display = 'flex';
        this.open = true;
        if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [panel] });
    },

    close() {
        const panel = document.getElementById('ai-panel');
        if (panel) panel.style.display = 'none';
        this.open = false;
    },

    clearHistory() {
        this.messages = [];
        this._renderMessages();
    },

    _renderMessages() {
        const container = document.getElementById('ai-chat-messages');
        if (!container) return;
        container.innerHTML = '';
        this.messages.forEach((msg) => {
            const el = document.createElement('div');
            el.className = `ai-chat-bubble ai-chat-${msg.role}`;
            el.textContent = msg.content;
            container.appendChild(el);
        });
        container.scrollTop = container.scrollHeight;
    },

    _setStatus(text) {
        const el = document.getElementById('ai-chat-status');
        if (el) el.textContent = text || '';
    },

    _getSelectionText() {
        const app = window.app;
        if (!app?.editor) return null;
        const active = app.editor.getActiveObject();
        if (!active || !app.editor.isTextObject(active)) return null;
        return (active.text || '').trim() || null;
    },

    async send() {
        if (this.busy) return;
        const app = window.app;
        if (!app?.sessionId) {
            app?._showToast?.('Open a PDF first', 'error');
            return;
        }
        if (!AISettings.configured) {
            app?._showToast?.('Configure AI Settings first', 'error');
            return;
        }

        const input = document.getElementById('ai-chat-input');
        const text = (input?.value || '').trim();
        if (!text) return;

        this.messages.push({ role: 'user', content: text });
        if (input) input.value = '';
        this._renderMessages();

        const sendBtn = document.getElementById('btn-ai-chat-send');
        this.busy = true;
        if (sendBtn) sendBtn.disabled = true;
        this._setStatus('Thinking…');

        try {
            const result = await API.aiChat({
                sessionId: app.sessionId,
                pageNum: app.currentPage,
                scope: this.getScope(),
                messages: this.messages,
                selectionText: this._getSelectionText(),
            });
            this.messages.push({ role: 'assistant', content: result.reply });
            this._renderMessages();
            if (result.truncated) {
                this._setStatus('Note: document context was truncated.');
            } else {
                this._setStatus('');
            }
        } catch (err) {
            this._setStatus('');
            app._showToast(err.message, 'error');
            this.messages.pop();
            this._renderMessages();
        } finally {
            this.busy = false;
            if (sendBtn) sendBtn.disabled = !AISettings.configured;
        }
    },

    setEnabled(enabled) {
        const btn = document.getElementById('btn-ai-assistant');
        const sendBtn = document.getElementById('btn-ai-chat-send');
        if (btn) btn.disabled = !enabled;
        if (sendBtn) sendBtn.disabled = !enabled;
    },
};

window.AIAssistant = AIAssistant;

class CertSignatureManager {
    constructor() {
        this.els = {};
        this._generatedFile = null;
        this._activeTab = 'sign';
    }

    init() {
        this._cacheElements();
        if (!this.els.modal) return;

        this.els.btnOpen?.addEventListener('click', () => this.openModal());
        this.els.btnCancel?.addEventListener('click', () => this.closeModal());
        this.els.btnCancelGenerate?.addEventListener('click', () => this.closeModal());
        this.els.btnPlace?.addEventListener('click', () => this._startPlacement());
        this.els.btnGenerate?.addEventListener('click', () => this._generateCertificate());
        this.els.modal.querySelector('.modal-backdrop')?.addEventListener('click', () => this.closeModal());

        this.els.certInput?.addEventListener('change', () => {
            this._generatedFile = null;
            this._updateFileLabel();
        });
        this.els.btnBrowse?.addEventListener('click', () => this.els.certInput?.click());

        this.els.tabButtons?.forEach((btn) => {
            btn.addEventListener('click', () => this._switchTab(btn.dataset.certTab));
        });
    }

    _cacheElements() {
        this.els = {
            modal: document.getElementById('cert-sign-modal'),
            btnOpen: document.getElementById('btn-cert-sign'),
            btnCancel: document.getElementById('btn-cancel-cert-sign'),
            btnCancelGenerate: document.getElementById('btn-cancel-cert-generate'),
            btnPlace: document.getElementById('btn-place-cert-sign'),
            btnGenerate: document.getElementById('btn-generate-cert'),
            btnBrowse: document.getElementById('btn-browse-cert'),
            certInput: document.getElementById('cert-file-input'),
            fileLabel: document.getElementById('cert-file-label'),
            password: document.getElementById('cert-password'),
            reason: document.getElementById('cert-reason'),
            location: document.getElementById('cert-location'),
            contactInfo: document.getElementById('cert-contact-info'),
            appearanceText: document.getElementById('cert-appearance-text'),
            tabButtons: document.querySelectorAll('.cert-modal-tab'),
            tabSign: document.getElementById('cert-tab-sign'),
            tabGenerate: document.getElementById('cert-tab-generate'),
            genCn: document.getElementById('gen-cn'),
            genEmail: document.getElementById('gen-email'),
            genCountry: document.getElementById('gen-country'),
            genOrganization: document.getElementById('gen-organization'),
            genOu: document.getElementById('gen-ou'),
            genState: document.getElementById('gen-state'),
            genLocality: document.getElementById('gen-locality'),
            genDays: document.getElementById('gen-days'),
            genKeyBits: document.getElementById('gen-key-bits'),
            genExportPassword: document.getElementById('gen-export-password'),
        };
    }

    openModal() {
        if (!window.app?.sessionId) {
            window.app?._showToast('Open a PDF document first', 'error');
            return;
        }
        this._switchTab('sign');
        this.els.modal.style.display = 'flex';
        lucide.createIcons();
    }

    closeModal() {
        if (this.els.modal) this.els.modal.style.display = 'none';
    }

    _switchTab(tab) {
        this._activeTab = tab;
        this.els.tabButtons?.forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.certTab === tab);
        });
        if (this.els.tabSign) this.els.tabSign.style.display = tab === 'sign' ? 'block' : 'none';
        if (this.els.tabGenerate) this.els.tabGenerate.style.display = tab === 'generate' ? 'block' : 'none';
    }

    _updateFileLabel() {
        const file = this._generatedFile || this.els.certInput?.files?.[0];
        if (this.els.fileLabel) {
            this.els.fileLabel.textContent = file ? file.name : 'No certificate selected';
        }
    }

    _getCertificateFile() {
        return this._generatedFile || this.els.certInput?.files?.[0] || null;
    }

    _setGeneratedCertificate(file, password) {
        this._generatedFile = file;
        if (this.els.certInput) this.els.certInput.value = '';
        if (this.els.password) this.els.password.value = password || '';
        this._updateFileLabel();
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    async _generateCertificate() {
        const commonName = this.els.genCn?.value.trim();
        const exportPassword = this.els.genExportPassword?.value || '';

        if (!commonName) {
            window.app?._showToast('Common Name is required', 'error');
            return;
        }
        if (!exportPassword) {
            window.app?._showToast('Export password is required for the .p12 file', 'error');
            return;
        }

        const email = this.els.genEmail?.value.trim() || '';
        const body = {
            common_name: commonName,
            email,
            organization: this.els.genOrganization?.value.trim() || '',
            organizational_unit: this.els.genOu?.value.trim() || '',
            country: this.els.genCountry?.value.trim() || '',
            state: this.els.genState?.value.trim() || '',
            locality: this.els.genLocality?.value.trim() || '',
            days: parseInt(this.els.genDays?.value || '365', 10),
            key_bits: parseInt(this.els.genKeyBits?.value || '4096', 10),
            export_password: exportPassword,
        };

        const btn = this.els.btnGenerate;
        const originalText = btn?.textContent;
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Generating…';
        }

        try {
            const result = await API.generateCertificate(body);
            const bytes = Uint8Array.from(atob(result.certificate_base64), (c) => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'application/x-pkcs12' });
            const file = new File([blob], result.filename || 'certificate.p12', {
                type: 'application/x-pkcs12',
            });

            this._setGeneratedCertificate(file, exportPassword);

            if (email && this.els.contactInfo && !this.els.contactInfo.value.trim()) {
                this.els.contactInfo.value = email;
            }
            if (this.els.genLocality?.value.trim() && this.els.location && !this.els.location.value.trim()) {
                this.els.location.value = this.els.genLocality.value.trim();
            }

            this._downloadBlob(blob, result.filename || 'certificate.p12');
            this._switchTab('sign');
            window.app?._showToast('Certificate generated — ready to sign', 'success');
        } catch (err) {
            window.app?._showToast(err.message, 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }
    }

    _startPlacement() {
        const file = this._getCertificateFile();
        if (!file) {
            window.app?._showToast('Select or generate a .p12 / .pfx certificate first', 'error');
            return;
        }

        const name = file.name.toLowerCase();
        if (!name.endsWith('.p12') && !name.endsWith('.pfx')) {
            window.app?._showToast('Certificate must be a .p12 or .pfx file', 'error');
            return;
        }

        const pending = {
            certificateFile: file,
            password: this.els.password?.value || '',
            reason: (this.els.reason?.value || '').trim(),
            location: (this.els.location?.value || '').trim(),
            contact_info: (this.els.contactInfo?.value || '').trim(),
            appearance_text: (this.els.appearanceText?.value || '').trim(),
        };

        this.closeModal();
        window.app?.startCertSignPlacement(pending);
    }
}

window.certSignatureManager = new CertSignatureManager();
document.addEventListener('DOMContentLoaded', () => {
    window.certSignatureManager.init();
});

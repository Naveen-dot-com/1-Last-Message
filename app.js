// App Controller
const App = {
  state: {
    message: { recipients: [], text: "", attachments: [], deliveryMode: "manual" }
  },

  init: async function() {
    await db.init();
    await emailService.loadConfig(db);
    this.bindEvents();
    this.applyTheme();
    
    // Service Worker is disabled in Android WebView to prevent Chromium cache backend errors
    // as WebViewAssetLoader already serves files locally.
    /*
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(console.warn);
    }
    */
    
    // Check if initialized
    const saltConfig = await db.get('settings', 'salt');
    if (saltConfig) {
      document.getElementById('auth-title').innerText = "Unlock Vault";
      document.getElementById('auth-subtitle').innerText = "Enter your master passphrase";
      document.getElementById('passphrase-confirm-group').classList.add('hidden');
      document.getElementById('auth-btn').innerText = "Unlock";
    }
  },

  bindEvents: function() {
    document.getElementById('splash-droplet').addEventListener('click', () => this.nav('screen-auth'));
    document.getElementById('auth-btn').addEventListener('click', () => this.handleAuth());
    document.getElementById('hero-send-btn').addEventListener('click', () => this.handleSend());
    document.getElementById('go-editor-btn').addEventListener('click', () => { this.loadEditor(); this.nav('screen-editor'); });
    document.getElementById('editor-back-btn').addEventListener('click', () => { this.saveMessage(false); this.nav('screen-dashboard'); });
    document.getElementById('editor-save-btn').addEventListener('click', () => this.saveMessage(true));
    document.getElementById('go-settings-btn').addEventListener('click', () => this.nav('screen-settings'));
    document.getElementById('settings-back-btn').addEventListener('click', () => this.nav('screen-dashboard'));
    
    // Auth password strength
    document.getElementById('passphrase-input').addEventListener('input', (e) => this.checkStrength(e.target.value));
    
    // Editor UI
    document.getElementById('add-recipient-btn').addEventListener('click', () => this.addRecipientUI());
    document.querySelectorAll('.toolbar button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.execCommand(e.target.dataset.cmd, false, null);
      });
    });
    
    const editorEl = document.getElementById('rich-text-editor');
    editorEl.addEventListener('input', () => {
      document.getElementById('char-count').innerText = editorEl.innerText.length;
    });

    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.background = 'rgba(0,0,0,0.1)'; });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.style.background = ''; });
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.style.background = ''; this.handleFiles(e.dataTransfer.files); });
    
    document.getElementById('delivery-mode').addEventListener('change', (e) => {
      document.getElementById('dms-settings').classList.toggle('hidden', e.target.value !== 'dms');
    });

    // Settings
    document.getElementById('theme-selector').addEventListener('change', (e) => this.setTheme(e.target.value));
    document.getElementById('factory-reset-btn').addEventListener('click', () => this.showModal("Factory Reset", "This will delete all encrypted data locally. Proceed?", () => this.factoryReset()));
    
    // Check-in
    document.getElementById('checkin-btn').addEventListener('click', () => this.handleCheckIn());
    document.getElementById('checkin-edit-btn').addEventListener('click', () => { this.loadEditor(); this.nav('screen-editor'); });
  },
  
  nav: function(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  },

  showToast: function(msg) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  },
  
  showModal: function(title, desc, onConfirm) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-desc').innerText = desc;
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.remove('hidden');
    
    const cancel = document.getElementById('modal-cancel');
    const confirm = document.getElementById('modal-confirm');
    
    const cleanup = () => {
        overlay.classList.add('hidden');
        cancel.replaceWith(cancel.cloneNode(true));
        confirm.replaceWith(confirm.cloneNode(true));
    };
    cancel.addEventListener('click', cleanup);
    confirm.addEventListener('click', () => { onConfirm(); cleanup(); });
  },

  checkStrength: function(val) {
    const meter = document.getElementById('password-strength');
    const isNewUser = !document.getElementById('passphrase-confirm-group').classList.contains('hidden');
    if (!isNewUser) return;
    
    if (val.length === 0) {
        meter.classList.add('hidden');
        return;
    }
    meter.classList.remove('hidden');
    let strength = 0;
    if (val.length > 7) strength++;
    if (val.match(/[a-z]/) && val.match(/[A-Z]/)) strength++;
    if (val.match(/\d/)) strength++;
    if (val.match(/[^a-zA-Z\d]/)) strength++;
    
    const bar = document.getElementById('strength-bar');
    const txt = document.getElementById('strength-text');
    const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759'];
    const labels = ['Weak', 'Fair', 'Good', 'Strong'];
    
    const idx = Math.max(0, strength - 1);
    bar.style.width = `${(idx + 1) * 25}%`;
    bar.style.backgroundColor = colors[idx];
    txt.innerText = labels[idx];
  },

  handleAuth: async function() {
    const pass = document.getElementById('passphrase-input').value;
    if (!pass) return this.showError("Enter a passphrase");
    
    const btn = document.getElementById('auth-btn');
    const spinner = document.getElementById('auth-spinner');
    btn.classList.add('hidden');
    spinner.classList.remove('hidden');
    
    try {
        const saltConfig = await db.get('settings', 'salt');
        if (saltConfig) {
            // Unlock
            await crypt.unlock(pass, saltConfig.value.salt, saltConfig.value.hash);
            await this.postUnlock();
        } else {
            // Setup
            const confirm = document.getElementById('passphrase-confirm').value;
            if (!confirm) throw new Error("Please confirm your passphrase.");
            if (pass !== confirm) throw new Error("Passphrases do not match. Try again.");
            const config = await crypt.initialize(pass);
            await db.put('settings', { key: 'salt', value: config });
            await this.postUnlock();
        }
    } catch (e) {
        this.showError(e.message);
    } finally {
        btn.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
  },
  
  showError: function(msg) {
    document.getElementById('auth-error').innerText = msg;
  },

  postUnlock: async function() {
    // Load message data if exists
    const stored = await db.get('vault', 'primary');
    if (stored) {
        try {
            const dec = await crypt.decryptString(stored.encrypted);
            this.state.message = JSON.parse(dec);
        } catch(e) {
            console.error(e);
            this.showToast("Failed to decrypt message data.");
        }
    }
    
    // Check Dead Man's Switch condition
    if (this.state.message.deliveryMode === 'dms') {
        const lastCheckIn = await db.get('settings', 'lastCheckIn');
        const duration = await db.get('settings', 'dmsDuration');
        if (lastCheckIn && duration) {
            const now = Date.now();
            const targetDate = lastCheckIn.value + (duration.value * 24 * 60 * 60 * 1000);
            const daysLeft = Math.max(0, Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24)));
            document.getElementById('days-remaining').innerText = daysLeft;
            this.nav('screen-checkin');
            return;
        }
    }
    
    this.nav('screen-dashboard');
  },
  
  handleCheckIn: async function() {
    await db.put('settings', { key: 'lastCheckIn', value: Date.now() });
    this.showToast("Check-in successful");
    const duration = await db.get('settings', 'dmsDuration');
    document.getElementById('days-remaining').innerText = duration.value;
  },

  loadEditor: function() {
    const m = this.state.message;
    document.getElementById('rich-text-editor').innerHTML = m.text || "";
    document.getElementById('char-count').innerText = (m.text || "").replace(/<[^>]*>?/gm, '').length;
    
    document.getElementById('recipients-list').innerHTML = '';
    (m.recipients || []).forEach(r => this.addRecipientUI(r.email, r.name, r.rel));
    
    document.getElementById('delivery-mode').value = m.deliveryMode || 'manual';
    document.getElementById('delivery-mode').dispatchEvent(new Event('change'));
    
    this.updateAttachmentUI();
  },

  addRecipientUI: function(email="", name="", rel="") {
    const list = document.getElementById('recipients-list');
    if (list.children.length >= 5) return this.showToast("Max 5 recipients allowed.");
    
    const div = document.createElement('div');
    div.className = 'recipient-row';
    div.innerHTML = `
      <input type="email" placeholder="Email" class="glass-input" value="${email}">
      <input type="text" placeholder="Name" class="glass-input" value="${name}">
      <button class="remove-btn">×</button>
    `;
    div.querySelector('.remove-btn').addEventListener('click', () => div.remove());
    list.appendChild(div);
  },

  handleFiles: async function(files) {
    if (!files.length) return;
    
    let totalCurrent = this.state.message.attachments.reduce((sum, a) => sum + a.size, 0);
    
    for (let file of files) {
      if (file.size > 50 * 1024 * 1024) {
          this.showToast(`${file.name} exceeds 50MB`);
          continue;
      }
      if (totalCurrent + file.size > 200 * 1024 * 1024) {
          this.showToast(`Total size exceeds 200MB limit`);
          break;
      }
      
      this.showToast(`Encrypting ${file.name}...`);
      try {
          const enc = await crypt.encryptFile(file);
          const id = 'att_' + Date.now();
          await db.put('attachments', { id: id, data: enc.data });
          
          const meta = { id, name: file.name, size: file.size, type: file.type, iv: enc.iv };
          this.state.message.attachments.push(meta);
          totalCurrent += file.size;
          this.updateAttachmentUI();
      } catch (e) {
          this.showToast(`Failed to encrypt ${file.name}`);
      }
    }
  },

  updateAttachmentUI: function() {
    const list = document.getElementById('attachments-list');
    list.innerHTML = '';
    let total = 0;
    
    this.state.message.attachments.forEach((a, index) => {
        total += a.size;
        const li = document.createElement('li');
        li.className = 'attachment-item';
        li.innerHTML = `
          <span>${a.name} (${(a.size/1024/1024).toFixed(1)}MB)</span>
          <button class="icon-btn remove-btn">×</button>
        `;
        li.querySelector('.remove-btn').addEventListener('click', async () => {
            await db.delete('attachments', a.id);
            this.state.message.attachments.splice(index, 1);
            this.updateAttachmentUI();
        });
        list.appendChild(li);
    });
    
    const percent = (total / (200 * 1024 * 1024)) * 100;
    document.getElementById('storage-bar').style.width = `${percent}%`;
    document.getElementById('storage-text').innerText = `${(total/1024/1024).toFixed(1)}MB / 200.0MB`;
  },

  saveMessage: async function(showToast = false) {
    const m = this.state.message;
    m.text = document.getElementById('rich-text-editor').innerHTML;
    
    const rows = document.querySelectorAll('.recipient-row');
    m.recipients = Array.from(rows).map(row => {
        const inputs = row.querySelectorAll('input');
        return { email: inputs[0].value, name: inputs[1].value };
    }).filter(r => r.email);
    
    m.deliveryMode = document.getElementById('delivery-mode').value;
    
    if (m.deliveryMode === 'dms') {
        let dur = document.getElementById('dms-duration').value;
        if (dur === 'custom') dur = document.getElementById('dms-custom').value;
        await db.put('settings', { key: 'dmsDuration', value: parseInt(dur) || 7 });
        
        const s = document.getElementById('emailjs-service').value;
        const t = document.getElementById('emailjs-template').value;
        const p = document.getElementById('emailjs-public').value;
        if (s && t && p) {
            await emailService.saveConfig(db, s, t, p);
        }
        
        const last = await db.get('settings', 'lastCheckIn');
        if (!last) await db.put('settings', { key: 'lastCheckIn', value: Date.now() });
    }
    
    const jsonStr = JSON.stringify(m);
    const enc = await crypt.encryptString(jsonStr);
    await db.put('vault', { id: 'primary', encrypted: enc });
    if (showToast) this.showToast("Vault Updated");
  },

  handleSend: async function() {
    if (!this.state.message.recipients.length) {
        this.showToast("No recipients configured. Edit message first.");
        this.loadEditor();
        this.nav('screen-editor');
        return;
    }
    this.showModal("Send Now", "Are you sure you want to send this message manually right now?", async () => {
        if (emailService.isInitialized) {
            try {
                this.showToast("Sending emails...");
                for (let r of this.state.message.recipients) {
                    await emailService.sendEmail(r.email, r.name, "A legacy message awaits you.");
                }
                this.showToast("Emails sent successfully!");
            } catch (e) {
                this.showToast("Error: " + e.message);
            }
        } else {
            // Fallback to mailto
            const r = this.state.message.recipients[0];
            window.location.href = `mailto:${r.email}?subject=One Last Message&body=Please check the legacy system.`;
            this.showToast("Opening email client as fallback...");
        }
    });
  },

  applyTheme: async function() {
    const t = await db.get('settings', 'theme');
    const defaultTheme = 'light';
    this.setTheme(t ? t.value : defaultTheme, false);
    document.getElementById('theme-selector').value = t ? t.value : defaultTheme;
  },

  setTheme: async function(mode, save = true) {
    document.body.className = `theme-${mode}`;
    const meta = document.getElementById('themeColorMeta');
    if (mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        meta.content = '#050505';
    } else {
        meta.content = '#f0f4f8';
    }
    if (save) await db.put('settings', { key: 'theme', value: mode });
  },

  factoryReset: async function() {
    await db.clearAll();
    window.location.reload();
  }
};

window.onload = () => App.init();

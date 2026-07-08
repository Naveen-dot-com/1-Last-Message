// App Controller
const App = {
  state: {
    message: { recipients: [], text: "", attachments: [], deliveryMode: "manual" },
    particles: []
  },

  init: async function() {
    await db.init();
    await emailService.loadConfig(db);
    this.bindEvents();
    this.applyTheme();
    this.initParticles();
    
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

  initParticles: function() {
    const canvas = document.getElementById('particles-bg');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    
    const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resize);
    resize();

    // Create dot particles
    this.state.particles = Array.from({ length: 60 }).map(() => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4
    }));

    const animate = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const isDark = document.body.classList.contains('theme-dark');
        ctx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';

        this.state.particles.forEach(p => {
            // Randomly wander
            p.vx += (Math.random() - 0.5) * 0.05;
            p.vy += (Math.random() - 0.5) * 0.05;
            
            // Limit max speed
            const speed = Math.hypot(p.vx, p.vy);
            if (speed > 0.8) {
                p.vx = (p.vx / speed) * 0.8;
                p.vy = (p.vy / speed) * 0.8;
            }

            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;

            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
            ctx.fill();
        });

        requestAnimationFrame(animate);
    };
    animate();
  },

  bindEvents: function() {
    document.getElementById('splash-droplet').addEventListener('click', () => {
        this.nav('screen-auth');
        this.checkBiometricSupport();
    });
    document.getElementById('auth-btn').addEventListener('click', () => this.handleAuth());
    document.getElementById('biometric-auth-btn').addEventListener('click', () => this.handleBiometricAuth());
    document.getElementById('hero-send-btn').addEventListener('click', () => this.handleSend());
    document.getElementById('go-editor-btn').addEventListener('click', () => { this.loadEditor(); this.nav('screen-editor'); });
    document.getElementById('editor-back-btn').addEventListener('click', () => { this.saveMessage(false); this.nav('screen-dashboard'); });
    document.getElementById('editor-save-btn').addEventListener('click', () => this.saveMessage(true));
    document.getElementById('go-settings-btn').addEventListener('click', () => {
        this.updateBiometricSettingsUI();
        this.nav('screen-settings');
    });
    document.getElementById('settings-back-btn').addEventListener('click', () => this.nav('screen-dashboard'));

    document.getElementById('enable-biometric-btn').addEventListener('click', () => this.enableBiometric());
    document.getElementById('disable-biometric-btn').addEventListener('click', () => this.disableBiometric());
    
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
    
    const doSignOut = () => {
      this.state.derivedKey = null;
      this.state.message = null;
      window.location.reload();
    };
    document.getElementById('signout-btn').addEventListener('click', doSignOut);
    document.getElementById('dashboard-signout-btn').addEventListener('click', doSignOut);
    document.getElementById('factory-reset-btn').addEventListener('click', () => this.showModal("Factory Reset", "This will delete all encrypted data locally. Proceed?", () => this.factoryReset()));
    document.getElementById('export-backup-btn').addEventListener('click', () => this.exportBackup());
    document.getElementById('import-backup-btn').addEventListener('click', () => document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change', (e) => this.importBackup(e.target.files[0]));
    
    // Check-in
    document.getElementById('checkin-btn').addEventListener('click', () => this.handleCheckIn());
    document.getElementById('checkin-edit-btn').addEventListener('click', () => { this.loadEditor(); this.nav('screen-editor'); });
  },

  checkBiometricSupport: async function() {
    if (!window.PublicKeyCredential) {
        document.getElementById('biometric-settings-panel').classList.add('hidden');
        return;
    }
    const hasCred = !!localStorage.getItem('biometric_cred_id');
    const saltConfig = await db.get('settings', 'salt');
    if (hasCred && saltConfig) {
        document.getElementById('biometric-auth-btn').classList.remove('hidden');
    }
  },

  updateBiometricSettingsUI: function() {
    if (!window.PublicKeyCredential) {
        document.getElementById('biometric-settings-panel').classList.add('hidden');
        return;
    }
    const hasCred = !!localStorage.getItem('biometric_cred_id');
    document.getElementById('enable-biometric-btn').classList.toggle('hidden', hasCred);
    document.getElementById('disable-biometric-btn').classList.toggle('hidden', !hasCred);
  },

  enableBiometric: async function() {
    try {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const userId = crypto.getRandomValues(new Uint8Array(16));
        
        const publicKey = {
            challenge: challenge,
            rp: { name: "One Last Message", id: window.location.hostname || "localhost" },
            user: { id: userId, name: "owner", displayName: "Vault Owner" },
            pubKeyCredParams: [ { type: "public-key", alg: -7 }, { type: "public-key", alg: -257 } ],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
            timeout: 60000,
            attestation: "none"
        };
        const cred = await navigator.credentials.create({ publicKey });
        const credId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
        
        localStorage.setItem('biometric_cred_id', credId);
        // Note: Without PRF, we must store the passphrase in local storage obfuscated.
        localStorage.setItem('biometric_key', btoa(this.state.derivedKeyPassphrase || document.getElementById('passphrase-input').value));
        
        this.updateBiometricSettingsUI();
        this.showToast("Biometrics enabled successfully.");
    } catch (e) {
        console.error(e);
        this.showToast("Biometric setup failed or cancelled.");
    }
  },

  disableBiometric: function() {
    localStorage.removeItem('biometric_cred_id');
    localStorage.removeItem('biometric_key');
    this.updateBiometricSettingsUI();
    this.showToast("Biometrics disabled.");
  },

  handleBiometricAuth: async function() {
    if (navigator.vibrate) navigator.vibrate(50);
    try {
        const credIdBase64 = localStorage.getItem('biometric_cred_id');
        const obfuscatedKey = localStorage.getItem('biometric_key');
        if (!credIdBase64 || !obfuscatedKey) throw new Error("Biometrics not configured");

        const credId = Uint8Array.from(atob(credIdBase64), c => c.charCodeAt(0));
        const challenge = crypto.getRandomValues(new Uint8Array(32));

        const publicKey = {
            challenge: challenge,
            rpId: window.location.hostname || "localhost",
            allowCredentials: [{ type: "public-key", id: credId }],
            userVerification: "required",
            timeout: 60000
        };

        await navigator.credentials.get({ publicKey });
        
        // Success! Decrypt the obfuscated key
        const pass = atob(obfuscatedKey);
        
        const btn = document.getElementById('biometric-auth-btn');
        const spinner = document.getElementById('auth-spinner');
        btn.classList.add('hidden');
        spinner.classList.remove('hidden');

        const saltConfig = await db.get('settings', 'salt');
        if (saltConfig) {
            await crypt.unlock(pass, saltConfig.value.salt, saltConfig.value.hash);
            this.state.derivedKeyPassphrase = pass;
            await this.postUnlock();
        } else {
            throw new Error("Vault not initialized.");
        }
    } catch (e) {
        console.error(e);
        this.showError("Biometric auth failed.");
        document.getElementById('biometric-auth-btn').classList.remove('hidden');
        document.getElementById('auth-spinner').classList.add('hidden');
    }
  },
  
  nav: function(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    
    const dots = document.getElementById('particles-bg');
    if (dots) {
        if (screenId === 'screen-editor' || screenId === 'screen-settings' || screenId === 'screen-dashboard') {
            dots.style.display = 'none';
        } else {
            dots.style.display = 'block';
        }
    }
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
            this.state.derivedKeyPassphrase = pass;
            await this.postUnlock();
        } else {
            // Setup
            const confirm = document.getElementById('passphrase-confirm').value;
            if (!confirm) throw new Error("Please confirm your passphrase.");
            if (pass !== confirm) throw new Error("Passphrases do not match. Try again.");
            const config = await crypt.initialize(pass);
            await db.put('settings', { key: 'salt', value: config });
            this.state.derivedKeyPassphrase = pass;
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
    if (!this.state.message.recipients || !this.state.message.recipients.length) {
        this.showToast("No recipients configured. Edit message first.");
        this.loadEditor();
        this.nav('screen-editor');
        return;
    }
    this.showModal("Send Now", "Are you sure you want to send this message manually right now?", async () => {
        const rawText = document.createElement('div');
        rawText.innerHTML = this.state.message.text || '';
        const plainText = rawText.innerText || "A legacy message awaits you.";
        const emails = this.state.message.recipients.map(r => r.email).join(',');
        
        const filesToShare = [];
        if (this.state.message.attachments && this.state.message.attachments.length > 0) {
            this.showToast("Preparing attachments...");
            for (let att of this.state.message.attachments) {
                try {
                    const stored = await db.get('attachments', att.id);
                    if (stored) {
                        const decryptedBuffer = await crypt.decryptFile(stored.data, att.iv);
                        const blob = new Blob([decryptedBuffer], { type: att.type });
                        const file = new File([blob], att.name, { type: att.type });
                        filesToShare.push(file);
                    }
                } catch (e) {
                    console.error("Failed to decrypt attachment", e);
                }
            }
        }

        // If emailJS is fully initialized and they have an active connection, prefer it for silent sending?
        // Wait, the user wants to use their native email client. EmailJS is for automated delivery (check-ins).
        // Let's use mailto/share as the primary manual method.
        
        if (filesToShare.length === 0) {
            // No attachments! We can perfectly use mailto: to open their email app seamlessly with ALL recipients.
            const subject = encodeURIComponent("One Last Message");
            const body = encodeURIComponent(plainText);
            window.location.href = `mailto:${emails}?subject=${subject}&body=${body}`;
            this.showToast("Opening your default email app...");
            return;
        }

        // Try native share first (works great on Android for files + text)
        if (navigator.share) {
            // Append emails to the text so the user knows who to send it to, since Web Share API doesn't support 'to' field.
            const textWithRecipients = `To: ${emails.replace(/,/g, ', ')}\n\n${plainText}`;
            const shareData = {
                title: 'One Last Message',
                text: textWithRecipients,
            };
            if (filesToShare.length > 0 && navigator.canShare && navigator.canShare({ files: filesToShare })) {
                shareData.files = filesToShare;
            }
            try {
                await navigator.share(shareData);
                this.showToast("Shared successfully!");
                return;
            } catch (e) {
                console.log("Share API failed or cancelled", e);
                // User cancelled the share sheet, DO NOT pop up another app. Just return.
                return;
            }
        }
        
        // If navigator.share doesn't exist (e.g. older browser) and we have attachments, fallback to EmailJS or mailto (without attachments).
        if (emailService.isInitialized) {
            try {
                this.showToast("Sending emails...");
                for (let r of this.state.message.recipients) {
                    await emailService.sendEmail(r.email, r.name, plainText);
                }
                this.showToast("Emails sent successfully!");
            } catch (e) {
                this.showToast("Error: " + e.message);
            }
        } else {
            // Ultimate fallback
            const subject = encodeURIComponent("One Last Message");
            const body = encodeURIComponent(plainText);
            window.location.href = `mailto:${emails}?subject=${subject}&body=${body}`;
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
  },

  exportBackup: async function() {
    try {
      const vault = await db.getAll('vault');
      const attachments = await db.getAll('attachments');
      const settings = await db.getAll('settings');
      
      const backupData = {
        version: 1,
        timestamp: new Date().toISOString(),
        vault,
        attachments,
        settings
      };
      
      const blob = new Blob([JSON.stringify(backupData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `olm_backup_${new Date().toISOString().split('T')[0]}.olm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
      
      this.showToast("Backup exported successfully");
    } catch (e) {
      console.error(e);
      this.showToast("Export failed");
    }
  },

  importBackup: async function(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.vault || !data.attachments || !data.settings) {
        throw new Error("Invalid backup format");
      }
      
      await db.clearAll();
      
      for (const item of data.vault) await db.put('vault', item);
      for (const item of data.attachments) await db.put('attachments', item);
      for (const item of data.settings) await db.put('settings', item);
      
      this.showToast("Backup imported successfully. Reloading...");
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      console.error(e);
      this.showToast("Import failed: " + e.message);
    }
    document.getElementById('import-file').value = '';
  }
};

window.onload = () => App.init();

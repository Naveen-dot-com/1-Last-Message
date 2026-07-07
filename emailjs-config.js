class EmailService {
  constructor() {
    this.serviceId = null;
    this.templateId = null;
    this.publicKey = null;
    this.isInitialized = false;
  }

  async loadConfig(dbInstance) {
    try {
      const config = await dbInstance.get('settings', 'emailjs_config');
      if (config && config.value) {
        this.serviceId = config.value.serviceId;
        this.templateId = config.value.templateId;
        this.publicKey = config.value.publicKey;
        if (this.publicKey) {
            emailjs.init(this.publicKey);
            this.isInitialized = true;
        }
      }
    } catch (e) {
      console.warn("Could not load EmailJS config:", e);
    }
  }

  async saveConfig(dbInstance, serviceId, templateId, publicKey) {
    this.serviceId = serviceId;
    this.templateId = templateId;
    this.publicKey = publicKey;
    await dbInstance.put('settings', { key: 'emailjs_config', value: { serviceId, templateId, publicKey } });
    emailjs.init(this.publicKey);
    this.isInitialized = true;
  }

  async sendEmail(to_email, to_name, message_preview) {
    if (!this.isInitialized || !this.serviceId || !this.templateId) {
      throw new Error("EmailJS not configured. Please set it up in settings.");
    }
    
    if (!navigator.onLine) {
        throw new Error("You are offline. Cannot send email right now.");
    }
    
    const templateParams = {
        to_email: to_email,
        to_name: to_name,
        from_name: "One Last Message (Auto-Delivery)",
        message_preview: message_preview,
        app_link: window.location.origin
    };

    return await emailjs.send(this.serviceId, this.templateId, templateParams);
  }
}

const emailService = new EmailService();

// Web Crypto API Utilities
class CryptoService {
  constructor() {
    this.key = null;
    this.salt = null;
    this.hashCache = null; // quick verify hash
  }

  // Derive AES-GCM key using PBKDF2
  async deriveKey(passphrase, saltBuffer) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveBits", "deriveKey"]
    );
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBuffer,
        iterations: 600000,
        hash: "SHA-256"
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false, // non-extractable
      ["encrypt", "decrypt"]
    );
  }

  // Hash (passphrase + salt) for quick login verification
  async hashPassphrase(passphrase, saltBuffer) {
    const encoder = new TextEncoder();
    const data = new Uint8Array([...encoder.encode(passphrase), ...new Uint8Array(saltBuffer)]);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async initialize(passphrase) {
    this.salt = crypto.getRandomValues(new Uint8Array(16));
    this.key = await this.deriveKey(passphrase, this.salt);
    this.hashCache = await this.hashPassphrase(passphrase, this.salt);
    return { salt: Array.from(this.salt), hash: this.hashCache };
  }

  async unlock(passphrase, savedSalt, savedHash) {
    this.salt = new Uint8Array(savedSalt);
    const testHash = await this.hashPassphrase(passphrase, this.salt);
    if (testHash !== savedHash) {
      throw new Error("Incorrect passphrase");
    }
    this.key = await this.deriveKey(passphrase, this.salt);
    this.hashCache = savedHash;
    return true;
  }

  async encryptString(text) {
    if (!this.key) throw new Error("Key not initialized");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, encoded);
    return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
  }

  async decryptString(encryptedObj) {
    if (!this.key) throw new Error("Key not initialized");
    const iv = new Uint8Array(encryptedObj.iv);
    const data = new Uint8Array(encryptedObj.data);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, data);
    return new TextDecoder().decode(decrypted);
  }

  async encryptFile(file) {
    if (!this.key) throw new Error("Key not initialized");
    const arrayBuffer = await file.arrayBuffer();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, arrayBuffer);
    return { iv: Array.from(iv), data: encrypted }; // Blob/ArrayBuffer ready
  }

  async decryptFile(encryptedBuffer, ivArray) {
    if (!this.key) throw new Error("Key not initialized");
    const iv = new Uint8Array(ivArray);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, this.key, encryptedBuffer);
    return decrypted;
  }
  
  // Custom .olm Backup Format 
  // Binary Layout: 
  // [4 bytes "OLM1"] [16 bytes salt] 
  // [12 bytes IV for JSON] [4 bytes JSON len] [JSON Encrypted] 
  // For each attachment: [12 bytes IV] [4 bytes length] [Encrypted binary]
  async exportBackup(metadataJsonString, attachments) {
    if (!this.key || !this.salt) throw new Error("Key not initialized");
    
    const magic = new TextEncoder().encode("OLM1");
    const jsonEnc = await this.encryptString(metadataJsonString);
    const jsonIV = new Uint8Array(jsonEnc.iv);
    const jsonData = new Uint8Array(jsonEnc.data);
    
    let totalSize = magic.length + this.salt.length + jsonIV.length + 4 + jsonData.length;
    for(const att of attachments) {
        totalSize += 12 + 4 + att.data.byteLength;
    }
    
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const uint8View = new Uint8Array(buffer);
    
    let offset = 0;
    uint8View.set(magic, offset); offset += magic.length;
    uint8View.set(this.salt, offset); offset += this.salt.length;
    
    uint8View.set(jsonIV, offset); offset += jsonIV.length;
    view.setUint32(offset, jsonData.length, false); offset += 4;
    uint8View.set(jsonData, offset); offset += jsonData.length;
    
    for(const att of attachments) {
        const attIV = new Uint8Array(att.iv);
        uint8View.set(attIV, offset); offset += attIV.length;
        view.setUint32(offset, att.data.byteLength, false); offset += 4;
        uint8View.set(new Uint8Array(att.data), offset); offset += att.data.byteLength;
    }
    
    return buffer;
  }

  async importBackup(buffer, passphrase) {
    const view = new DataView(buffer);
    const uint8View = new Uint8Array(buffer);
    let offset = 0;
    
    const magic = new TextDecoder().decode(uint8View.slice(0, 4));
    if (magic !== "OLM1") throw new Error("Invalid backup format");
    offset += 4;
    
    const salt = uint8View.slice(offset, offset + 16);
    offset += 16;
    
    // Test passphrase with salt... well, we can't test hash quickly here unless we stored it in the backup.
    // Instead we derive key and try decrypting JSON.
    const tempKey = await this.deriveKey(passphrase, salt);
    
    const jsonIV = uint8View.slice(offset, offset + 12);
    offset += 12;
    const jsonLen = view.getUint32(offset, false);
    offset += 4;
    const jsonData = uint8View.slice(offset, offset + jsonLen);
    offset += jsonLen;
    
    let decryptedJsonString;
    try {
        const decryptedJsonBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: jsonIV }, tempKey, jsonData);
        decryptedJsonString = new TextDecoder().decode(decryptedJsonBuf);
    } catch (e) {
        throw new Error("Incorrect passphrase or corrupted backup");
    }
    
    // If successful, update our own key
    this.key = tempKey;
    this.salt = salt;
    this.hashCache = await this.hashPassphrase(passphrase, salt);
    
    const attachments = [];
    while (offset < buffer.byteLength) {
        const attIV = uint8View.slice(offset, offset + 12); offset += 12;
        const attLen = view.getUint32(offset, false); offset += 4;
        const attData = buffer.slice(offset, offset + attLen); offset += attLen;
        attachments.push({ iv: Array.from(attIV), data: attData });
    }
    
    return { metadata: JSON.parse(decryptedJsonString), attachments };
  }
}

const crypt = new CryptoService();

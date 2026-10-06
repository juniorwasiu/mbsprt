/**
 * SPRT App Configuration & State Manager
 * Powered by Google Cloud Firestore (Real-Time Cloud Backend)
 * Handles instantaneous real-time mode switching and settings synchronization across all devices.
 */

const DEFAULT_CONFIG = {
  mode: "download", // 'download' | 'task'
  downloadUrl: "https://phygitals.onelink.me/1HmK/xpc4jlwy",
  referralCode: "d15a567f50d0",
  autoRedirect: false,
  autoRedirectSeconds: 3,
  taskTitle: "App Registration Task",
  taskSubtitle: "Follow the steps in order. Earn a $1 bonus.",
  vpnWarning: "This task must be done from the USA or Germany. If you are not in one of these countries, turn on a VPN and connect to a USA or Germany server before you start. Keep the VPN on until the task is finished.",
  adminPin: "admin123",
  updatedAt: Date.now()
};

const STORAGE_KEY = "sprt_site_config_v4";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBWWXPq-DsPJbfg0i6yLgX1Ruzf1CSYk4A",
  authDomain: "sprt-9a37b.firebaseapp.com",
  projectId: "sprt-9a37b",
  storageBucket: "sprt-9a37b.firebasestorage.app",
  messagingSenderId: "786883085986",
  appId: "1:786883085986:web:e3f6ab649f306c5aa0b9fb"
};

class AppConfigManager {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.listeners = [];
    this.statusListeners = [];
    this.db = null;
    this.docRef = null;
    this.unsubscribe = null;
    this.firebaseReady = false;
    this.isReady = false;

    // Ready promise to ensure page never renders incorrect initial mode
    this._resolveReady = null;
    this.readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });

    // Fallback safety timeout: resolve ready after 1200ms if network is slow/offline
    setTimeout(() => {
      if (!this.isReady) {
        this.isReady = true;
        if (this._resolveReady) this._resolveReady(this.config);
      }
    }, 1200);

    // 1. Read cached config from LocalStorage as fallback
    this.loadFromLocalStorage();

    // 2. Initialize Firebase and Firestore realtime listener
    this.initFirebase();
  }

  loadFromLocalStorage() {
    try {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        this.config = { ...this.config, ...parsed };
      }
    } catch (e) {
      console.warn("[AppConfig] LocalStorage read error", e);
    }
  }

  saveToLocalStorage(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn("[AppConfig] LocalStorage write error", e);
    }
  }

  // Returns a promise that resolves as soon as the authoritative Firestore config is loaded
  whenReady() {
    return this.readyPromise;
  }

  // Check URL query parameters for test overrides (e.g. ?mode=download or ?mode=task)
  getUrlOverride() {
    try {
      const params = new URLSearchParams(window.location.search);
      const mode = params.get("mode");
      if (mode === "download" || mode === "task") {
        return { mode };
      }
    } catch (e) {
      console.warn("[AppConfig] Could not parse URL params", e);
    }
    return null;
  }

  // Initialize Firebase App & Firestore
  async initFirebase() {
    try {
      if (typeof firebase === "undefined") {
        console.warn("[AppConfig] Firebase SDK not yet loaded. Retrying...");
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          if (typeof firebase !== "undefined") {
            clearInterval(checkInterval);
            this.initFirebase();
          } else if (attempts > 20) {
            clearInterval(checkInterval);
            console.error("[AppConfig] Firebase SDK script load timeout.");
            this.notifyStatus(false);
            if (!this.isReady) {
              this.isReady = true;
              if (this._resolveReady) this._resolveReady(this.config);
            }
          }
        }, 100);
        return;
      }

      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }

      this.db = firebase.firestore();

      // Enable offline persistence gracefully if supported
      try {
        await this.db.enablePersistence({ synchronizeTabs: true });
      } catch (err) {
        // Safe to ignore in incognito / multi-tab
      }

      this.docRef = this.db.collection("settings").doc("app_config");
      this.firebaseReady = true;
      this.notifyStatus(true);

      // Start listening in real-time
      this.subscribeRealtime();
    } catch (err) {
      console.error("[AppConfig] Firebase init failed:", err);
      this.notifyStatus(false);
      if (!this.isReady) {
        this.isReady = true;
        if (this._resolveReady) this._resolveReady(this.config);
      }
    }
  }

  // Subscribe to real-time changes in Firestore
  subscribeRealtime() {
    if (!this.docRef) return;

    if (this.unsubscribe) {
      this.unsubscribe();
    }

    this.unsubscribe = this.docRef.onSnapshot(
      (docSnapshot) => {
        if (docSnapshot.exists) {
          const cloudData = docSnapshot.data();
          if (cloudData) {
            this.config = {
              ...DEFAULT_CONFIG,
              ...cloudData
            };

            // Apply URL test override if specified
            const urlOverride = this.getUrlOverride();
            if (urlOverride) {
              this.config = { ...this.config, ...urlOverride };
            }

            this.saveToLocalStorage(this.config);

            if (!this.isReady) {
              this.isReady = true;
              if (this._resolveReady) this._resolveReady(this.config);
            }

            this.notifyListeners(true);
          }
        } else {
          // Document doesn't exist yet in Firestore, seed it with default config
          this.docRef.set(DEFAULT_CONFIG, { merge: true }).catch((e) => {
            console.warn("[AppConfig] Error seeding initial Firestore doc:", e);
          });
          this.config = { ...DEFAULT_CONFIG };
          if (!this.isReady) {
            this.isReady = true;
            if (this._resolveReady) this._resolveReady(this.config);
          }
          this.notifyListeners(true);
        }
      },
      (error) => {
        console.warn("[AppConfig] Firestore realtime listener warning:", error);
        this.notifyStatus(false);
        if (!this.isReady) {
          this.isReady = true;
          if (this._resolveReady) this._resolveReady(this.config);
        }
      }
    );
  }

  // Save updated config to Firebase Firestore in real-time
  async saveConfig(newConfigUpdates) {
    this.config = {
      ...this.config,
      ...newConfigUpdates,
      updatedAt: Date.now()
    };

    // Save locally
    this.saveToLocalStorage(this.config);
    this.notifyListeners(false);

    let cloudSaved = false;

    if (!this.docRef && typeof firebase !== "undefined") {
      await this.initFirebase();
    }

    if (this.docRef) {
      try {
        await this.docRef.set(this.config, { merge: true });
        cloudSaved = true;
      } catch (e) {
        console.error("[AppConfig] Firestore save failed:", e);
      }
    }

    return { success: true, cloudSaved, config: this.config };
  }

  // Instant mode switcher helper
  async setMode(mode) {
    if (mode !== "download" && mode !== "task") return;
    return await this.saveConfig({ mode });
  }

  getConfig() {
    return { ...this.config };
  }

  onConfigChange(callback) {
    this.listeners.push(callback);
    // If initial config is already resolved, trigger immediately
    if (this.isReady) {
      callback(this.config, false);
    }
  }

  onStatusChange(callback) {
    this.statusListeners.push(callback);
    callback(this.firebaseReady);
  }

  notifyStatus(isReady) {
    for (const listener of this.statusListeners) {
      try {
        listener(isReady);
      } catch (e) {
        console.error("[AppConfig] Status listener error", e);
      }
    }
  }

  notifyListeners(fromCloud = false) {
    for (const listener of this.listeners) {
      try {
        listener(this.config, fromCloud);
      } catch (e) {
        console.error("[AppConfig] Listener error", e);
      }
    }
  }
}

// Global singleton instance
window.appConfig = new AppConfigManager();

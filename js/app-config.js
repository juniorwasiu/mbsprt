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

const STORAGE_KEY = "sprt_site_config_v3";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDlLjchxFjMx14xnisrZ6w91Oz44UKOuqg",
  authDomain: "sbb2-e04b6.firebaseapp.com",
  projectId: "sbb2-e04b6",
  storageBucket: "sbb2-e04b6.firebasestorage.app",
  messagingSenderId: "258334430487",
  appId: "1:258334430487:web:cf15dda3df12f8bfd31352",
  measurementId: "G-1KJYVH7CD3"
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
    this.initialLoadDone = false;

    // Load fast cached config from LocalStorage first for instant paint
    this.loadFromLocalStorage();

    // Initialize Firebase in background
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
        console.warn("[AppConfig] Firebase SDK not loaded in window. Waiting for script...");
        return;
      }

      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }

      this.db = firebase.firestore();

      // Enable offline persistence if supported
      try {
        await this.db.enablePersistence({ synchronizeTabs: true });
      } catch (err) {
        if (err.code !== "failed-precondition" && err.code !== "unimplemented") {
          console.debug("[AppConfig] Firestore persistence notice:", err.message);
        }
      }

      this.docRef = this.db.collection("settings").doc("app_config");
      this.firebaseReady = true;
      this.notifyStatus(true);

      // Start listening in real-time
      this.subscribeRealtime();
    } catch (err) {
      console.error("[AppConfig] Firebase init failed:", err);
      this.notifyStatus(false);
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

            // Apply URL test override if specified in URL
            const urlOverride = this.getUrlOverride();
            if (urlOverride) {
              this.config = { ...this.config, ...urlOverride };
            }

            this.saveToLocalStorage(this.config);
            this.initialLoadDone = true;
            this.notifyListeners();
          }
        } else {
          // Document doesn't exist yet in Firestore, seed it with default config
          this.docRef.set(this.config, { merge: true }).catch((e) => {
            console.warn("[AppConfig] Error seeding initial Firestore doc:", e);
          });
          this.initialLoadDone = true;
          this.notifyListeners();
        }
      },
      (error) => {
        console.warn("[AppConfig] Firestore realtime listener warning:", error);
      }
    );
  }

  // Load config asynchronously (returns current active state)
  async loadConfig() {
    // If Firebase is already initialized and snapshot is active, return current
    if (this.firebaseReady && this.docRef) {
      try {
        const snap = await this.docRef.get();
        if (snap.exists) {
          const data = snap.data();
          this.config = { ...DEFAULT_CONFIG, ...data };
        }
      } catch (e) {
        console.warn("[AppConfig] Direct get fallback to cache:", e);
      }
    } else if (typeof firebase !== "undefined" && !this.firebaseReady) {
      await this.initFirebase();
    }

    // Apply URL override if present
    const urlOverride = this.getUrlOverride();
    if (urlOverride) {
      this.config = { ...this.config, ...urlOverride };
    }

    this.initialLoadDone = true;
    this.notifyListeners();
    return this.config;
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
    this.notifyListeners();

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

  getConfig() {
    return { ...this.config };
  }

  onConfigChange(callback) {
    this.listeners.push(callback);
    // Trigger immediately with current available state
    callback(this.config);
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

  notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.config);
      } catch (e) {
        console.error("[AppConfig] Listener error", e);
      }
    }
  }
}

// Global singleton instance
window.appConfig = new AppConfigManager();

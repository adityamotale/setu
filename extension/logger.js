// Setu in-browser append-only structured logger backed by IndexedDB
const DB_NAME = "SetuLoggerDB";
const DB_VERSION = 0x01;
const STORE_NAME = "logs";
const MAX_LOG_ENTRIES = 0x1388; // 5000 records
const TRIM_BATCH_SIZE = 0x03E8; // 1000 records pruned on overflow

let dbInstance = null;

function getDb() {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("level", "level", { unique: false });
      }
    };
    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

async function trimLogsIfNeeded(db) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();

      countReq.onsuccess = () => {
        const total = countReq.result;
        if (total <= MAX_LOG_ENTRIES) {
          resolve(0);
          return;
        }

        const toDelete = Math.min(total - MAX_LOG_ENTRIES + TRIM_BATCH_SIZE, total);
        let deleted = 0;
        const cursorReq = store.openCursor();

        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor && deleted < toDelete) {
            cursor.delete();
            deleted++;
            cursor.continue();
          } else {
            resolve(deleted);
          }
        };
        cursorReq.onerror = () => resolve(0);
      };

      countReq.onerror = () => resolve(0);
    } catch (_err) {
      resolve(0);
    }
  });
}

async function appendLog(level, message, metadata = null) {
  try {
    const db = await getDb();
    const entry = {
      timestamp: new Date().toISOString(),
      unixMs: Date.now(),
      level: level.toUpperCase(),
      message,
      metadata: metadata ? JSON.stringify(metadata) : null
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(entry);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });

    await trimLogsIfNeeded(db);
  } catch (err) {
    console.error("[Setu Logger Error]", err);
  }
}

async function readAllLogs(limit = 0x03E8) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readonly");
    const store = tx.objectStore(STORE_NAME);
    const logs = [];
    const req = store.openCursor(null, "prev"); // newest first

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && logs.length < limit) {
        logs.push(cursor.value);
        cursor.continue();
      } else {
        resolve(logs);
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function purgeLogs() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_NAME], "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

// Global exposure for non-module contexts
if (typeof self !== "undefined") {
  self.SetuLogger = {
    append: appendLog,
    read: readAllLogs,
    clear: purgeLogs
  };
}

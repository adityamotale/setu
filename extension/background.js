// Background service worker for Setu Bridge
importScripts("logger.js");

const SETU_PORT = 0x2328; // 9000
const WS_URL = `ws://127.0.0.1:${SETU_PORT}`;
const POLL_INTERVAL_MS = 0x03E8; // 1000ms

let socket = null;
let pollTimer = null;
let isSuspended = true; // Suspended by default until user initializes
let isConnectionEstablished = false;
let geminiTabId = null;

async function log(level, message, meta = null) {
  if (self.SetuLogger) {
    await self.SetuLogger.append(level, message, meta);
  }
}

function clearPoll() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function scheduleReconnect() {
  clearPoll();
  if (isSuspended) {
    return;
  }
  pollTimer = setTimeout(() => {
    pollTimer = null;
    connectWs();
  }, POLL_INTERVAL_MS);
}

function sendWs(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    socket.send(raw);
    return true;
  }
  return false;
}

async function triggerModelSelection(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "SELECT_BEST_MODEL" });
    await log("INFO", "Dispatched SELECT_BEST_MODEL to Gemini tab", { tabId });
  } catch (err) {
    await log("WARN", "SELECT_BEST_MODEL delivery deferred or retrying", {
      tabId,
      error: String(err)
    });
  }
}

async function openGeminiSessionTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: "*://gemini.google.com/*" }, (tabs) => {
      if (tabs && tabs.length > 0) {
        geminiTabId = tabs[0].id;
        log("INFO", "Reusing existing Gemini tab", { tabId: geminiTabId });
        resolve(geminiTabId);
      } else {
        chrome.tabs.create({ url: "https://gemini.google.com/app" }, (tab) => {
          geminiTabId = tab.id;
          log("INFO", "Created new Gemini tab on demand", {
            tabId: geminiTabId
          });
          const listener = (tabId, changeInfo) => {
            if (tabId === geminiTabId && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve(geminiTabId);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
      }
    });
  });
}

async function ensureGeminiTabReady() {
  if (geminiTabId) {
    try {
      const tab = await chrome.tabs.get(geminiTabId);
      if (tab) {
        return geminiTabId;
      }
    } catch (_e) {
      geminiTabId = null;
    }
  }
  return await openGeminiSessionTab();
}

function connectWs() {
  clearPoll();
  if (isSuspended) {
    log("INFO", "Bridge is suspended; skipping connection attempt");
    return;
  }

  if (socket && (socket.readyState === WebSocket.OPEN ||
                 socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    log("ERROR", "WebSocket instantiation error", { error: String(err) });
    scheduleReconnect();
    return;
  }

  socket.onopen = async () => {
    await log("INFO", `WebSocket transport opened to ${WS_URL}; awaiting host handshake`);
    sendWs({ type: "ping", source: "extension-bg", timestamp: Date.now() });
    // Note: Do not open tab here; wait for host handshake/pong confirmation
  };

  socket.onmessage = async (event) => {
    try {
      const payload = JSON.parse(event.data);

      // Handle handshake acknowledgment
      if (payload.type === "pong") {
        if (!isConnectionEstablished) {
          isConnectionEstablished = true;
          await log("INFO", "MCP host handshake confirmed on port " + SETU_PORT);
        }
        return;
      }

      if (payload.type === "ping") {
        sendWs({ type: "pong", source: "extension-bg", timestamp: Date.now() });
        return;
      }

      if (payload.action === "handoff" || payload.action === "calculate" || payload.type === "calculate") {
        if (!isConnectionEstablished) {
          isConnectionEstablished = true;
        }
        await log("INFO", `Received handoff request [${payload.id}]`, payload);
        const targetTabId = await ensureGeminiTabReady();
        chrome.tabs.sendMessage(targetTabId, {
          action: "EXECUTE_CALCULATION",
          payload
        }, (_res) => {
          if (chrome.runtime.lastError) {
            log("ERROR", "Failed to forward request to tab", {
              error: chrome.runtime.lastError.message
            });
            sendWs({
              id: payload.id ?? null,
              action: payload.action ?? "handoff",
              status: "error",
              error: "Gemini tab content script not ready",
              timestamp: Date.now()
            });
          }
        });
      }
    } catch (_err) {
      if (event.data === "ping") {
        sendWs("pong");
      }
    }
  };

  socket.onclose = () => {
    socket = null;
    isConnectionEstablished = false;
    log("WARN", "WebSocket closed; will retry if active");
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

function disconnectWs() {
  clearPoll();
  isConnectionEstablished = false;
  if (socket) {
    socket.close();
    socket = null;
  }
}

// Track tab closures to avoid stale references
chrome.tabs.onRemoved.addListener((closedTabId) => {
  if (closedTabId === geminiTabId) {
    geminiTabId = null;
  }
});

// Initialize state from storage (defaulting to suspended)
chrome.storage.local.get({ isSuspended: true }, (res) => {
  isSuspended = Boolean(res.isSuspended);
  if (!isSuspended) {
    connectWs();
  }
});

// Message hub for popup, options, and content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "GET_STATUS") {
    sendResponse({
      isSuspended,
      isConnected: socket !== null &&
                   socket.readyState === WebSocket.OPEN &&
                   isConnectionEstablished,
      geminiTabId
    });
    return true;
  }

  if (msg.action === "SET_SUSPENDED") {
    isSuspended = Boolean(msg.value);
    chrome.storage.local.set({ isSuspended });
    if (isSuspended) {
      disconnectWs();
      log("INFO", "User suspended Setu bridge");
    } else {
      log("INFO", "User initialized Setu bridge");
      connectWs();
    }
    sendResponse({ success: true, isSuspended });
    return true;
  }

  if (msg.action === "TRIGGER_MODEL_SELECT") {
    if (geminiTabId) {
      triggerModelSelection(geminiTabId);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "No active Gemini tab" });
    }
    return true;
  }

  if (msg.action === "BRIDGE_PROGRESS") {
    const forwarded = sendWs({
      id: msg.id,
      action: "calculate",
      status: "loading",
      progress: msg.progress || "generating",
      timestamp: Date.now()
    });
    sendResponse({ forwarded });
    return true;
  }

  if (msg.action === "BRIDGE_RESULT") {
    const forwarded = sendWs(msg.payload);
    log("INFO", `Completed calculation dispatch [${msg.payload.id}]`, msg.payload);
    sendResponse({ forwarded });
    return true;
  }

  if (msg.action === "LOG_EVENT") {
    log(msg.level || "INFO", msg.message, msg.meta);
    sendResponse({ success: true });
    return true;
  }
});

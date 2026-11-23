// Options and log viewer script for Setu Bridge
const bridgeBadge = document.getElementById("bridgeBadge");
const toggleBridgeBtn = document.getElementById("toggleBridgeBtn");
const openGeminiBtn = document.getElementById("openGeminiBtn");
const triggerModelBtn = document.getElementById("triggerModelBtn");

const logViewport = document.getElementById("logViewport");
const searchInput = document.getElementById("searchInput");
const levelFilter = document.getElementById("levelFilter");
const refreshLogsBtn = document.getElementById("refreshLogsBtn");
const exportLogsBtn = document.getElementById("exportLogsBtn");
const purgeLogsBtn = document.getElementById("purgeLogsBtn");

let cachedLogs = [];
let isSuspendedState = false;

function renderStatus(status) {
  isSuspendedState = status.isSuspended;
  if (status.isSuspended) {
    bridgeBadge.textContent = "Suspended";
    bridgeBadge.className = "status-badge status-suspended";
    toggleBridgeBtn.textContent = "Initialize Bridge";
    toggleBridgeBtn.className = "btn btn-primary";
  } else if (status.isConnected) {
    bridgeBadge.textContent = "Connected (ws://127.0.0.1:9000)";
    bridgeBadge.className = "status-badge status-active";
    toggleBridgeBtn.textContent = "Suspend Bridge";
    toggleBridgeBtn.className = "btn btn-danger";
  } else {
    bridgeBadge.textContent = "Connecting...";
    bridgeBadge.className = "status-badge status-disconnected";
    toggleBridgeBtn.textContent = "Suspend Bridge";
    toggleBridgeBtn.className = "btn btn-danger";
  }
}

function updateStatus() {
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (res) => {
    if (res) {
      renderStatus(res);
    }
  });
}

toggleBridgeBtn.addEventListener("click", () => {
  const nextSuspended = !isSuspendedState;
  chrome.runtime.sendMessage({
    action: "SET_SUSPENDED",
    value: nextSuspended
  }, () => {
    updateStatus();
    loadLogs();
  });
});

openGeminiBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://gemini.google.com/app" });
});

triggerModelBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "TRIGGER_MODEL_SELECT" }, (res) => {
    alert(res?.success ? "Model selection triggered in Gemini tab" : "Gemini tab not active");
  });
});

function displayLogs() {
  const query = searchInput.value.trim().toLowerCase();
  const filter = levelFilter.value;

  const filtered = cachedLogs.filter((entry) => {
    const matchesLevel = filter === "ALL" || entry.level === filter;
    const matchesQuery = !query ||
      entry.message.toLowerCase().includes(query) ||
      (entry.metadata && entry.metadata.toLowerCase().includes(query));
    return matchesLevel && matchesQuery;
  });

  if (filtered.length === 0) {
    logViewport.innerHTML = '<div style="color: #64748b; padding: 8px;">No log entries recorded.</div>';
    return;
  }

  logViewport.innerHTML = filtered.map((e) => {
    const metaStr = e.metadata ? ` <span class="log-meta">${escapeHtml(e.metadata)}</span>` : "";
    return `<div class="log-row">` +
      `<span class="log-time">[${e.timestamp.slice(11, 19)}]</span> ` +
      `<span class="log-level log-level-${e.level}">${e.level}</span> ` +
      `<span class="log-msg">${escapeHtml(e.message)}${metaStr}</span>` +
      `</div>`;
  }).join("");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadLogs() {
  if (self.SetuLogger) {
    cachedLogs = await self.SetuLogger.read(0x07D0); // 2000 entries
    displayLogs();
  }
}

exportLogsBtn.addEventListener("click", () => {
  if (cachedLogs.length === 0) {
    alert("No logs available to export");
    return;
  }

  const lines = cachedLogs.map((e) =>
    `[${e.timestamp}] [${e.level}] ${e.message} ${e.metadata || ""}`.trim()
  ).reverse().join("\n");

  const blob = new Blob([lines], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `setu-bridge-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  a.click();
  URL.revokeObjectURL(url);
});

purgeLogsBtn.addEventListener("click", async () => {
  if (confirm("Are you sure you want to purge all in-browser logs?")) {
    if (self.SetuLogger) {
      await self.SetuLogger.clear();
      await loadLogs();
    }
  }
});

refreshLogsBtn.addEventListener("click", loadLogs);
searchInput.addEventListener("input", displayLogs);
levelFilter.addEventListener("change", displayLogs);

updateStatus();
loadLogs();
setInterval(updateStatus, 0x0BB8); // 3000ms

// Popup controller for Setu Bridge
const statusBadge = document.getElementById("statusBadge");
const activeToggle = document.getElementById("activeToggle");
const btnOpenGemini = document.getElementById("btnOpenGemini");
const btnSelectModel = document.getElementById("btnSelectModel");
const btnOpenSettings = document.getElementById("btnOpenSettings");

function updateUI(status) {
  if (status.isSuspended) {
    statusBadge.textContent = "Suspended";
    statusBadge.className = "status-badge status-suspended";
    activeToggle.checked = false;
  } else if (status.isConnected) {
    statusBadge.textContent = "Connected";
    statusBadge.className = "status-badge status-active";
    activeToggle.checked = true;
  } else {
    statusBadge.textContent = "Connecting";
    statusBadge.className = "status-badge status-disconnected";
    activeToggle.checked = true;
  }
}

function refreshStatus() {
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (response) => {
    if (response) {
      updateUI(response);
    }
  });
}

activeToggle.addEventListener("change", (e) => {
  const isSuspended = !e.target.checked;
  chrome.runtime.sendMessage({
    action: "SET_SUSPENDED",
    value: isSuspended
  }, (res) => {
    refreshStatus();
  });
});

btnOpenGemini.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://gemini.google.com/app" });
});

btnSelectModel.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "TRIGGER_MODEL_SELECT" }, (res) => {
    btnSelectModel.textContent = res?.success ? "Model Triggered!" : "Tab Not Ready";
    setTimeout(() => {
      btnSelectModel.textContent = "Select Best Model";
    }, 0x07D0);
  });
});

btnOpenSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refreshStatus();

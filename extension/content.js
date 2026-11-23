// Content script running in https://gemini.google.com/*
const CHECK_INTERVAL_MS = 0xC8; // 200ms
const DEFAULT_TIMEOUT_MS = 0xEA60; // 60000ms
const PROGRESS_INTERVAL_MS = 0x0320; // 800ms

function logEvent(level, message, meta = null) {
  try {
    chrome.runtime.sendMessage({
      action: "LOG_EVENT",
      level,
      message,
      meta
    });
  } catch (_e) {}
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomDelay(minMs = 0x012C, maxMs = 0x03E8) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function humanDelay(minMs = 0x012C, maxMs = 0x03E8) {
  const ms = getRandomDelay(minMs, maxMs);
  await delay(ms);
  return ms;
}

async function humanClick(el) {
  if (!el) {
    return;
  }
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width * (0.3 + Math.random() * 0.4);
  const clientY = rect.top + rect.height * (0.3 + Math.random() * 0.4);
  const eventInit = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    view: window
  };

  el.dispatchEvent(new PointerEvent("pointerover", eventInit));
  el.dispatchEvent(new PointerEvent("pointerenter", eventInit));
  el.dispatchEvent(new MouseEvent("mouseover", eventInit));
  await humanDelay(0x0020, 0x0050); // 32-80ms micro-pause

  el.dispatchEvent(new PointerEvent("pointerdown", eventInit));
  el.dispatchEvent(new MouseEvent("mousedown", eventInit));
  await humanDelay(0x0032, 0x0078); // 50-120ms press duration

  el.dispatchEvent(new PointerEvent("pointerup", eventInit));
  el.dispatchEvent(new MouseEvent("mouseup", eventInit));
  el.click();

  await humanDelay(0x00C8, 0x0190); // 200-400ms post-click settle delay
}

async function humanKeySubmit(el) {
  const eventInit = {
    key: "Enter",
    code: "Enter",
    keyCode: 0x0D,
    which: 0x0D,
    bubbles: true,
    cancelable: true
  };
  el.dispatchEvent(new KeyboardEvent("keydown", eventInit));
  await humanDelay(0x0028, 0x005A); // 40-90ms hold
  el.dispatchEvent(new KeyboardEvent("keypress", eventInit));
  el.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  await humanDelay(0x00C8, 0x0190);
}

function formatPrompt(payload) {
  if (payload.prompt) {
    return payload.prompt;
  }
  const { op, a, b } = payload;
  return `Calculate the following:\n` +
         `Operation: ${op}\n` +
         `Operands: ${a}, ${b}\n` +
         `Output the final result in structured markdown format`;
}

async function selectBestAvailableModel() {
  logEvent("INFO", "Initiating model selection sequence");

  const trigger = document.querySelector(
    'button[data-test-id="bard-mode-menu-button"], gem-mode-picker button, button[aria-label^="Open mode picker"]'
  );

  if (!trigger) {
    logEvent("WARN", "Model picker trigger button not found in DOM");
    return false;
  }

  // Open menu if not already opened
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await humanClick(trigger);
    await humanDelay(0x0190, 0x02BC); // 400-700ms overlay render & inspection
  }

  const items = Array.from(document.querySelectorAll('gem-menu-item[role="menuitemradio"]'));
  if (items.length === 0) {
    logEvent("WARN", "No gem-menu-item radio elements discovered");
    if (trigger.getAttribute("aria-expanded") === "true") {
      await humanClick(trigger);
    }
    return false;
  }

  let selectedOption = null;

  // Evaluate from bottom-most (highest index) to top-most
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    const isAriaDisabled = item.getAttribute("aria-disabled") === "true";
    const hasDisabledClass = item.classList.contains("disabled") ||
                             item.querySelector(".disabled") !== null;
    const hasLockIcon = item.querySelector(
      'mat-icon[fonticon="lock"], [data-mat-icon-name="lock"]'
    ) !== null;
    const isSignInBtn = item.classList.contains("mode-picker-sign-in-button");

    if (!isAriaDisabled && !hasDisabledClass && !hasLockIcon && !isSignInBtn) {
      selectedOption = item;
      break;
    }
  }

  // If no advanced model is accessible, fallback to Auto
  if (!selectedOption) {
    selectedOption = items.find((item) => {
      const label = item.querySelector(".label")?.innerText || "";
      return label.trim().toLowerCase() === "auto" ||
             item.getAttribute("data-mode-id") === "cf41b0e0dd7d53e5";
    }) || items[0];
    logEvent("INFO", "Defaulting to Auto model option");
  }

  if (selectedOption) {
    const isAlreadyChecked = selectedOption.getAttribute("aria-checked") === "true" ||
                             selectedOption.getAttribute("data-active") === "true";
    const labelText = selectedOption.querySelector(".label")?.innerText || "Unknown";

    if (isAlreadyChecked) {
      logEvent("INFO", `Target model already active: ${labelText}`);
      if (trigger.getAttribute("aria-expanded") === "true") {
        await humanClick(trigger);
      }
    } else {
      await humanClick(selectedOption);
      logEvent("INFO", `Selected best available model: ${labelText}`);
    }
    return true;
  }

  return false;
}

function waitForResponse(initialCount, id, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stableCount = 0;
    let lastLength = -1;

    // Periodic progress reporter interval
    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const stopBtn = document.querySelector('button[aria-label="Stop response"]');
      const stateText = stopBtn ? "streaming" : "generating";

      try {
        chrome.runtime.sendMessage({
          action: "BRIDGE_PROGRESS",
          id,
          progress: `${stateText} (${Math.round(elapsed / 0x03E8)}s elapsed)`
        });
      } catch (_e) {}
    }, PROGRESS_INTERVAL_MS);

    const checkInterval = setInterval(() => {
      const stopBtn = document.querySelector('button[aria-label="Stop response"]');
      const responses = document.querySelectorAll("model-response");
      const hasNewResponse = responses.length > initialCount;

      if (hasNewResponse) {
        const last = responses[responses.length - 1];
        const copyBtn = last.querySelector('button[aria-label="Copy"]');
        const contentEl = last.querySelector("message-content .markdown") ||
                          last.querySelector("message-content");
        const currentLength = contentEl ? contentEl.innerText.length : 0;

        if (!stopBtn && copyBtn && currentLength > 0 && currentLength === lastLength) {
          stableCount++;
          if (stableCount >= 2) {
            clearInterval(checkInterval);
            clearInterval(progressTimer);
            resolve({ success: true });
            return;
          }
        } else {
          stableCount = 0;
        }
        lastLength = currentLength;
      }

      if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        clearInterval(progressTimer);
        resolve({ success: false, reason: "Response extraction timed out" });
      }
    }, CHECK_INTERVAL_MS);
  });
}

function extractLastResponse() {
  const responses = document.querySelectorAll("model-response");
  if (responses.length === 0) {
    return null;
  }
  const last = responses[responses.length - 1];
  const contentEl = last.querySelector("message-content .markdown") ||
                    last.querySelector("message-content");
  return contentEl ? contentEl.innerText.trim() : "";
}

async function handleCalculationRequest(payload) {
  const { id } = payload;
  const promptText = formatPrompt(payload);

  logEvent("INFO", `Executing calculation request [${id}]`, { promptText });

  try {
    let editor = document.querySelector('div.ql-editor[contenteditable="true"]');
    if (!editor) {
      await humanDelay(0x01F4, 0x0320); // 500-800ms
      editor = document.querySelector('div.ql-editor[contenteditable="true"]');
    }
    if (!editor) {
      throw new Error("Gemini editor element not found in DOM");
    }

    // Ensure best available model is selected just-in-time for calculation
    await selectBestAvailableModel();
    await humanDelay(0x00C8, 0x0190);

    const initialCount = document.querySelectorAll("model-response").length;

    editor.focus();
    await humanDelay(0x00C8, 0x01F4); // 200-500ms post-focus cadence

    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, promptText);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));

    // Human pre-submit jitter delay (600ms - 2000ms)
    await humanDelay(0x0258, 0x07D0);

    const sendBtn = document.querySelector('button[aria-label="Send message"]');
    if (sendBtn && !sendBtn.disabled) {
      await humanClick(sendBtn);
    } else {
      await humanKeySubmit(editor);
    }

    const outcome = await waitForResponse(initialCount, id);
    if (!outcome.success) {
      throw new Error(outcome.reason || "Response generation timed out");
    }

    const resultText = extractLastResponse();
    const reply = {
      id: id ?? null,
      action: "calculate",
      status: resultText ? "ok" : "error",
      ...(resultText ? { result: resultText } : { error: "Failed to extract result" }),
      timestamp: Date.now()
    };

    chrome.runtime.sendMessage({
      action: "BRIDGE_RESULT",
      payload: reply
    });
  } catch (err) {
    logEvent("ERROR", `Calculation failed for [${id}]`, { error: String(err) });
    chrome.runtime.sendMessage({
      action: "BRIDGE_RESULT",
      payload: {
        id: id ?? null,
        action: "calculate",
        status: "error",
        error: err.message || String(err),
        timestamp: Date.now()
      }
    });
  }
}

// Runtime message receiver from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SELECT_BEST_MODEL") {
    selectBestAvailableModel().then((res) => sendResponse({ success: res }));
    return true;
  }

  if (request.action === "EXECUTE_CALCULATION") {
    handleCalculationRequest(request.payload);
    sendResponse({ status: "acknowledged" });
    return true;
  }
});

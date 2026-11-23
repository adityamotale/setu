// Setu loopback WebSocket client for Gemini Web
const SETU_PORT = 0x2328; // 9000
const WS_URL = `ws://127.0.0.1:${SETU_PORT}`;
const POLL_INTERVAL_MS = 0x3E8; // 1000ms
const DEFAULT_TIMEOUT_MS = 0xEA60; // 60000ms
const CHECK_INTERVAL_MS = 0xC8; // 200ms

let socket = null;
let pollTimer = null;

function logNotice(message, data) {
  const prefix = "++++++++++++++++++++ [SETU] ";
  const suffix = " ++++++++++++++++++++";
  if (data !== undefined) {
    console.log(`${prefix}${message}${suffix}`, data);
  } else {
    console.log(`${prefix}${message}${suffix}`);
  }
}

function clearPendingPoll() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function scheduleNextPoll() {
  clearPendingPoll();

  pollTimer = setTimeout(() => {
    pollTimer = null;
    connect();
  }, POLL_INTERVAL_MS);
}

function getRandomDelay(minMs = 0x3E8, maxMs = 0x7D0) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
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

function waitForResponse(initialCount, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stableCount = 0;
    let lastLength = -1;

    const interval = setInterval(() => {
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
            clearInterval(interval);
            resolve();
            return;
          }
        } else {
          stableCount = 0;
        }
        lastLength = currentLength;
      }

      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        resolve();
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

  logNotice(`Processing prompt for id [${id}]:`, promptText);

  try {
    const editor = document.querySelector('div.ql-editor[contenteditable="true"]');
    if (!editor) {
      throw new Error("Gemini editor element not found in DOM");
    }

    const initialCount = document.querySelectorAll("model-response").length;

    editor.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, promptText);
    editor.dispatchEvent(new Event("input", { bubbles: true }));

    const delayMs = getRandomDelay(0x3E8, 0x7D0);
    logNotice(`Waiting ${delayMs}ms before submitting...`);
    await new Promise((res) => setTimeout(res, delayMs));

    const sendBtn = document.querySelector('button[aria-label="Send message"]');
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
    } else {
      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 0xD,
        which: 0xD,
        bubbles: true
      }));
    }

    await waitForResponse(initialCount);

    const resultText = extractLastResponse();
    const reply = {
      id: id ?? null,
      action: "calculate",
      status: resultText ? "ok" : "error",
      ...(resultText ? { result: resultText } : { error: "Failed to extract result" }),
      timestamp: Date.now()
    };

    logNotice(`Dispatched calculation reply for id [${id}]:`, reply);
    socket.send(JSON.stringify(reply));
  } catch (err) {
    const reply = {
      id: id ?? null,
      action: "calculate",
      status: "error",
      error: err.message || String(err),
      timestamp: Date.now()
    };
    logNotice(`Dispatched error reply for id [${id}]:`, reply);
    socket.send(JSON.stringify(reply));
  }
}

function handleMessage(event) {
  logNotice("Incoming frame received:", event.data);
  try {
    const payload = JSON.parse(event.data);

    if (payload.type === "ping") {
      logNotice("Responding to ping with pong");
      socket.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
    } else if (payload.type === "pong") {
      logNotice("Received pong acknowledgment from Setu host");
    } else if (payload.action === "calculate" || payload.type === "calculate") {
      handleCalculationRequest(payload);
    }
  } catch (_err) {
    if (event.data === "ping") {
      socket.send("pong");
    }
  }
}

function connect() {
  clearPendingPoll();

  if (socket && (socket.readyState === WebSocket.OPEN ||
                 socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    logNotice("Socket initialization error:", err);
    scheduleNextPoll();
    return;
  }

  socket.onopen = () => {
    logNotice("WebSocket connection ESTABLISHED on 127.0.0.1:" + SETU_PORT);
    socket.send(JSON.stringify({ type: "ping", source: "extension", timestamp: Date.now() }));
    logNotice("Dispatched initial test ping frame to Setu host");
  };

  socket.onmessage = handleMessage;

  socket.onclose = () => {
    socket = null;
    scheduleNextPoll();
  };

  socket.onerror = () => {
    socket?.close();
  };
}

window.addEventListener("online", () => {
  connect();
});

window.addEventListener("pagehide", () => {
  clearPendingPoll();
  if (socket) {
    socket.close();
    socket = null;
  }
});

// Initial connection attempt
connect();

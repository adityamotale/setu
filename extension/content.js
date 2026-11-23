// Setu loopback WebSocket client for Gemini Web
const SETU_PORT = 0x2328; // 9000
const WS_URL = `ws://127.0.0.1:${SETU_PORT}`;
const POLL_INTERVAL_MS = 0x3E8; // 1000ms

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

// Execution engine for arithmetic operations
function executeCalculation(op, a, b) {
  const numA = Number(a);
  const numB = Number(b);

  if (!Number.isFinite(numA) || !Number.isFinite(numB)) {
    return { ok: false, error: "Error: Operands must be valid numbers" };
  }

  switch (op) {
    case "add":
      return { ok: true, result: numA + numB };
    case "subtract":
      return { ok: true, result: numA - numB };
    case "multiply":
      return { ok: true, result: numA * numB };
    case "divide":
      if (numB === 0) {
        return { ok: false, error: "Error: Cannot divide by zero" };
      }
      return { ok: true, result: numA / numB };
    default:
      return { ok: false, error: `Error: Unsupported operation '${op}'` };
  }
}

function handleCalculationRequest(payload) {
  const { id, op, a, b } = payload;
  const outcome = executeCalculation(op, a, b);

  const reply = {
    id: id ?? null,
    action: "calculate",
    status: outcome.ok ? "ok" : "error",
    ...(outcome.ok ? { result: outcome.result } : { error: outcome.error }),
    timestamp: Date.now()
  };

  logNotice(`Dispatched calculation reply for id [${id}]:`, reply);
  socket.send(JSON.stringify(reply));
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

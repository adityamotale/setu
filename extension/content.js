// Setu loopback WebSocket client for Gemini Web
const SETU_PORT = 0x2328; // 9000
const WS_URL = `ws://127.0.0.1:${SETU_PORT}`;
const BASE_DELAY_MS = 0x3E8; // 1000ms
const MAX_DELAY_MS = 0x7530; // 30000ms

let socket = null;
let reconnectTimer = null;
let currentDelay = BASE_DELAY_MS;

function logNotice(message, data) {
  const prefix = "++++++++++++++++++++ [SETU] ";
  const suffix = " ++++++++++++++++++++";
  if (data !== undefined) {
    console.log(`${prefix}${message}${suffix}`, data);
  } else {
    console.log(`${prefix}${message}${suffix}`);
  }
}

function clearPendingReconnect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearPendingReconnect();
  const jitter = Math.floor(Math.random() * 0x3E8);
  const backoff = Math.min(currentDelay, MAX_DELAY_MS) + jitter;

  logNotice(`Connection closed/unavailable; retrying in ${backoff}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoff);

  currentDelay = Math.min(currentDelay * 2, MAX_DELAY_MS);
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
    }
  } catch (_err) {
    // Non-JSON frame handling
    if (event.data === "ping") {
      socket.send("pong");
    }
  }
}

function connect() {
  clearPendingReconnect();

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    logNotice("Socket initialization error:", err);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    currentDelay = BASE_DELAY_MS;
    logNotice("WebSocket connection ESTABLISHED on 127.0.0.1:" + SETU_PORT);
    // Send immediate ping test frame
    socket.send(JSON.stringify({ type: "ping", source: "extension", timestamp: Date.now() }));
    logNotice("Dispatched initial test ping frame to Setu host");
  };

  socket.onmessage = handleMessage;

  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    logNotice("Socket encountered error (host likely offline):", err);
    socket?.close();
  };
}

// Initial connection attempt
connect();

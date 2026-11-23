use anyhow::Result;
use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

const PORT: u16 = 0x2328; // 9000
const TIMEOUT_MS: u64 = 0xEA60; // 60000ms
const MAGIC_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

static BRIDGE: OnceLock<Arc<ExtensionBridge>> = OnceLock::new();

#[derive(Serialize)]
struct CalculationRequest {
    id: String,
    action: &'static str,
    op: String,
    a: f64,
    b: f64,
}

#[derive(Deserialize)]
struct ExtensionMessage {
    #[serde(default)]
    id: Option<String>,
    #[serde(rename = "type", default)]
    msg_type: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<String>,
}

pub struct ExtensionBridge {
    active_tx: Mutex<Option<mpsc::Sender<String>>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>,
}

impl ExtensionBridge {
    pub fn global() -> Arc<Self> {
        BRIDGE.get_or_init(|| Self::init(PORT)).clone()
    }

    pub fn init(port: u16) -> Arc<Self> {
        let bridge = Arc::new(Self {
            active_tx: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
        });

        let bridge_clone = bridge.clone();
        tokio::spawn(async move {
            bridge_clone.run_server(port).await;
        });

        bridge
    }

    pub async fn calculate(&self, op: &str, a: f64, b: f64) -> Result<String, String> {
        let (tx, rx) = oneshot::channel();
        let id = Uuid::new_v4().to_string();

        let req = CalculationRequest {
            id: id.clone(),
            action: "calculate",
            op: op.to_string(),
            a,
            b,
        };

        let json_payload = serde_json::to_string(&req)
            .map_err(|e| format!("Serialization failure: {e}"))?;

        {
            let active = self.active_tx.lock().await;
            if let Some(sender) = active.as_ref() {
                if sender.send(json_payload).await.is_err() {
                    return Err("Extension disconnected during send".to_string());
                }
            } else {
                return Err("Browser extension not connected on ws://127.0.0.1:0x2328".to_string());
            }
        }

        self.pending.lock().await.insert(id.clone(), tx);

        match tokio::time::timeout(Duration::from_millis(TIMEOUT_MS), rx).await {
            Ok(Ok(calc_res)) => calc_res,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                Err("Channel canceled or extension terminated".to_string())
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err("Extension response timed out".to_string())
            }
        }
    }

    async fn run_server(self: Arc<Self>, port: u16) {
        let addr = format!("127.0.0.1:{port}");
        let listener = match TcpListener::bind(&addr).await {
            Ok(l) => {
                tracing::info!("Setu WebSocket listener bound on ws://{addr}");
                l
            }
            Err(e) => {
                tracing::error!("Failed binding listener to {addr}: {e}");
                return;
            }
        };

        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let bridge = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = bridge.handle_connection(stream).await {
                            tracing::warn!("Connection session ended: {e}");
                        }
                    });
                }
                Err(e) => {
                    tracing::error!("TcpListener accept error: {e}");
                }
            }
        }
    }

    async fn handle_connection(self: Arc<Self>, mut stream: TcpStream) -> Result<()> {
        Self::perform_handshake(&mut stream).await?;

        let (mut reader, mut writer) = stream.into_split();
        let (out_tx, mut out_rx) = mpsc::channel::<String>(0x20);

        *self.active_tx.lock().await = Some(out_tx);

        let writer_task = tokio::spawn(async move {
            while let Some(msg) = out_rx.recv().await {
                let frame = Self::encode_text_frame(&msg);
                if writer.write_all(&frame).await.is_err() || writer.flush().await.is_err() {
                    break;
                }
            }
        });

        loop {
            match Self::read_frame(&mut reader).await {
                Ok(Some((0x01, payload))) => {
                    let text = String::from_utf8_lossy(&payload).into_owned();
                    self.dispatch_frame(text).await;
                }
                Ok(Some((0x08, _))) => break,
                Ok(Some((0x09, _))) => {
                    let pong = [0x8A, 0x00];
                    let mut active = self.active_tx.lock().await;
                    if active.is_some() {
                        let _ = active.as_mut();
                    }
                    let _ = pong;
                }
                Ok(Some(_)) => continue,
                Ok(None) | Err(_) => break,
            }
        }

        *self.active_tx.lock().await = None;
        writer_task.abort();
        Ok(())
    }

    async fn dispatch_frame(&self, text: String) {
        if let Ok(msg) = serde_json::from_str::<ExtensionMessage>(&text) {
            if msg.msg_type.as_deref() == Some("ping") {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis();
                let pong = format!(
                    "{{\"type\":\"pong\",\"source\":\"host\",\"timestamp\":{now}}}"
                );
                let active = self.active_tx.lock().await;
                if let Some(s) = active.as_ref() {
                    let _ = s.send(pong).await;
                }
                return;
            }

            if let Some(id) = msg.id {
                let mut pending = self.pending.lock().await;
                if let Some(tx) = pending.remove(&id) {
                    let outcome = if msg.status.as_deref() == Some("ok") {
                        let res_str = match msg.result {
                            Some(serde_json::Value::String(s)) => s,
                            Some(v) => v.to_string(),
                            None => String::new(),
                        };
                        Ok(res_str)
                    } else {
                        Err(msg.error.unwrap_or_else(|| "Unknown extension error".into()))
                    };
                    let _ = tx.send(outcome);
                }
            }
        }
    }

    async fn perform_handshake(stream: &mut TcpStream) -> Result<()> {
        let mut buf = [0u8; 0x1000];
        let n = stream.read(&mut buf).await?;
        let req = std::str::from_utf8(&buf[..n])?;

        let key = req
            .lines()
            .find(|line| line.to_ascii_lowercase().starts_with("sec-websocket-key:"))
            .and_then(|line| line.split(':').nth(1))
            .map(|k| k.trim())
            .ok_or_else(|| anyhow::anyhow!("Missing Sec-WebSocket-Key header"))?;

        let magic = format!("{key}{MAGIC_GUID}");
        let mut hasher = sha1_smol::Sha1::new();
        hasher.update(magic.as_bytes());
        let digest = hasher.digest().bytes();
        let accept = BASE64_STANDARD.encode(digest);

        let response = format!(
            "HTTP/1.1 101 Switching Protocols\r\n\
             Upgrade: websocket\r\n\
             Connection: Upgrade\r\n\
             Sec-WebSocket-Accept: {accept}\r\n\r\n"
        );

        stream.write_all(response.as_bytes()).await?;
        stream.flush().await?;
        Ok(())
    }

    fn encode_text_frame(payload: &str) -> Vec<u8> {
        let bytes = payload.as_bytes();
        let len = bytes.len();
        let mut frame = Vec::with_capacity(len + 0x0A);
        frame.push(0x81);

        if len < 0x7E {
            frame.push(len as u8);
        } else if len <= 0xFFFF {
            frame.push(0x7E);
            frame.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            frame.push(0x7F);
            frame.extend_from_slice(&(len as u64).to_be_bytes());
        }

        frame.extend_from_slice(bytes);
        frame
    }

    async fn read_frame(
        reader: &mut tokio::net::tcp::OwnedReadHalf,
    ) -> Result<Option<(u8, Vec<u8>)>> {
        let mut header = [0u8; 2];
        if let Err(e) = reader.read_exact(&mut header).await {
            if e.kind() == std::io::ErrorKind::UnexpectedEof {
                return Ok(None);
            }
            return Err(e.into());
        }

        let opcode = header[0] & 0x0F;
        let is_masked = (header[1] & 0x80) != 0;
        let len_ind = header[1] & 0x7F;

        let len: usize = match len_ind {
            0x7E => {
                let mut buf = [0u8; 2];
                reader.read_exact(&mut buf).await?;
                u16::from_be_bytes(buf) as usize
            }
            0x7F => {
                let mut buf = [0u8; 8];
                reader.read_exact(&mut buf).await?;
                u64::from_be_bytes(buf) as usize
            }
            l => l as usize,
        };

        let mask = if is_masked {
            let mut m = [0u8; 4];
            reader.read_exact(&mut m).await?;
            Some(m)
        } else {
            None
        };

        let mut payload = vec![0u8; len];
        reader.read_exact(&mut payload).await?;

        if let Some(m) = mask {
            for (i, byte) in payload.iter_mut().enumerate() {
                *byte ^= m[i % 4];
            }
        }

        Ok(Some((opcode, payload)))
    }
}

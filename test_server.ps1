# Minimal WebSocket test server for Setu (Port 9000 / 0x2328)
$port = 9000
$endpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Loopback, $port)
$listener = [System.Net.Sockets.TcpListener]::new($endpoint)

$listener.Start()
Write-Host "++++++++++++++++++++ [HOST] Listening on ws://127.0.0.1:$port ++++++++++++++++++++"
Write-Host "++++++++++++++++++++ [HOST] Waiting for Chrome extension connection... ++++++++++++++++++++"

try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    Write-Host "++++++++++++++++++++ [HOST] Client connected! Performing WebSocket handshake... ++++++++++++++++++++"

    # Read HTTP Handshake request
    $buffer = [byte[]]::new(4096)
    $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
    $request = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $bytesRead)

    if ($request -match 'Sec-WebSocket-Key:\s*([^\r\n]+)') {
        $key = $matches[1].Trim()
        $magic = $key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        $sha1 = [System.Security.Cryptography.SHA1]::Create()
        $hash = $sha1.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($magic))
        $accept = [Convert]::ToBase64String($hash)

        $response = "HTTP/1.1 101 Switching Protocols`r`n" +
                    "Upgrade: websocket`r`n" +
                    "Connection: Upgrade`r`n" +
                    "Sec-WebSocket-Accept: $accept`r`n`r`n"

        $respBytes = [System.Text.Encoding]::UTF8.GetBytes($response)
        $stream.Write($respBytes, 0, $respBytes.Length)
        Write-Host "++++++++++++++++++++ [HOST] WebSocket handshake completed successfully! ++++++++++++++++++++"

        # Loop reading incoming frames
        while ($client.Connected) {
            $b0 = $stream.ReadByte()
            if ($b0 -eq -1) { break }
            $b1 = $stream.ReadByte()
            if ($b1 -eq -1) { break }

            $isMasked = ($b1 -band 0x80) -ne 0
            $payloadLen = $b1 -band 0x7F

            if ($payloadLen -eq 126) {
                $lenBuf = [byte[]]::new(2)
                $stream.Read($lenBuf, 0, 2) | Out-Null
                if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBuf) }
                $payloadLen = [BitConverter]::ToUInt16($lenBuf, 0)
            }

            $mask = [byte[]]::new(4)
            if ($isMasked) {
                $stream.Read($mask, 0, 4) | Out-Null
            }

            $payload = [byte[]]::new($payloadLen)
            $readTotal = 0
            while ($readTotal -lt $payloadLen) {
                $r = $stream.Read($payload, $readTotal, $payloadLen - $readTotal)
                if ($r -le 0) { break }
                $readTotal += $r
            }

            if ($isMasked) {
                for ($i = 0; $i -lt $payloadLen; $i++) {
                    $payload[$i] = $payload[$i] -bxor $mask[$i % 4]
                }
            }

            $msg = [System.Text.Encoding]::UTF8.GetString($payload)
            Write-Host "++++++++++++++++++++ [HOST] Received frame: $msg ++++++++++++++++++++"

            # Auto-respond to ping with pong
            if ($msg -match 'ping') {
                $replyText = '{"type":"pong","source":"host","timestamp":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '}'
                $replyBytes = [System.Text.Encoding]::UTF8.GetBytes($replyText)

                # Send unmasked text frame (0x81)
                $frame = [System.Collections.Generic.List[byte]]::new()
                $frame.Add(0x81)
                if ($replyBytes.Length -lt 126) {
                    $frame.Add([byte]$replyBytes.Length)
                } else {
                    $frame.Add(126)
                    $lenBytes = [BitConverter]::GetBytes([uint16]$replyBytes.Length)
                    if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBytes) }
                    $frame.AddRange($lenBytes)
                }
                $frame.AddRange($replyBytes)
                $sendArr = $frame.ToArray()
                $stream.Write($sendArr, 0, $sendArr.Length)
                Write-Host "++++++++++++++++++++ [HOST] Sent pong frame to browser! ++++++++++++++++++++"
                Start-Sleep -Milliseconds 500
                break
            }
        }
    }
} finally {
    $listener.Stop()
    Write-Host "++++++++++++++++++++ [HOST] Test server stopped ++++++++++++++++++++"
}

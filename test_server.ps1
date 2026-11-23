# Minimal WebSocket test server for Setu verification (Port 9000 / 0x2328)
$port = 0x2328
$endpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Loopback, $port)
$listener = [System.Net.Sockets.TcpListener]::new($endpoint)

function Send-WsFrame {
    param(
        [System.Net.Sockets.NetworkStream]$Stream,
        [string]$Message
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Message)
    $frame = [System.Collections.Generic.List[byte]]::new()
    $frame.Add(0x81) # FIN + text opcode

    if ($bytes.Length -lt 126) {
        $frame.Add([byte]$bytes.Length)
    } elseif ($bytes.Length -le 0xFFFF) {
        $frame.Add(126)
        $lenBytes = [BitConverter]::GetBytes([uint16]$bytes.Length)
        if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBytes) }
        $frame.AddRange($lenBytes)
    } else {
        $frame.Add(127)
        $lenBytes = [BitConverter]::GetBytes([uint64]$bytes.Length)
        if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBytes) }
        $frame.AddRange($lenBytes)
    }

    $frame.AddRange($bytes)
    $arr = $frame.ToArray()
    $Stream.Write($arr, 0, $arr.Length)
    $Stream.Flush()
}

function Read-WsFrame {
    param([System.Net.Sockets.NetworkStream]$Stream)

    $b0 = $Stream.ReadByte()
    if ($b0 -eq -1) { return $null }
    $b1 = $Stream.ReadByte()
    if ($b1 -eq -1) { return $null }

    $opcode = $b0 -band 0x0F
    $isMasked = ($b1 -band 0x80) -ne 0
    $payloadLen = $b1 -band 0x7F

    if ($payloadLen -eq 126) {
        $lenBuf = [byte[]]::new(2)
        $Stream.Read($lenBuf, 0, 2) | Out-Null
        if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBuf) }
        $payloadLen = [BitConverter]::ToUInt16($lenBuf, 0)
    } elseif ($payloadLen -eq 127) {
        $lenBuf = [byte[]]::new(8)
        $Stream.Read($lenBuf, 0, 8) | Out-Null
        if ([BitConverter]::IsLittleEndian) { [Array]::Reverse($lenBuf) }
        $payloadLen = [BitConverter]::ToUInt64($lenBuf, 0)
    }

    $mask = [byte[]]::new(4)
    if ($isMasked) {
        $Stream.Read($mask, 0, 4) | Out-Null
    }

    $payload = [byte[]]::new($payloadLen)
    $readTotal = 0
    while ($readTotal -lt $payloadLen) {
        $r = $Stream.Read($payload, $readTotal, $payloadLen - $readTotal)
        if ($r -le 0) { break }
        $readTotal += $r
    }

    if ($isMasked) {
        for ($i = 0; $i -lt $payloadLen; $i++) {
            $payload[$i] = $payload[$i] -bxor $mask[$i % 4]
        }
    }

    $text = ""
    if ($opcode -eq 0x01) {
        $text = [System.Text.Encoding]::UTF8.GetString($payload)
    }

    return [PSCustomObject]@{
        Opcode = $opcode
        Payload = $text
        RawLength = $payloadLen
    }
}

$listener.Start()
Write-Host "++++++++++++++++++++ [HOST] Listening on ws://127.0.0.1:$port ++++++++++++++++++++"

$testCases = @(
    @{ Id = "req-01"; Action = "calculate"; Op = "add"; A = 25; B = 17;
       ExpectedResult = 42; ExpectedStatus = "ok" },
    @{ Id = "req-02"; Action = "calculate"; Op = "multiply"; A = 6; B = 7;
       ExpectedResult = 42; ExpectedStatus = "ok" },
    @{ Id = "req-03"; Action = "calculate"; Op = "divide"; A = 84; B = 2;
       ExpectedResult = 42; ExpectedStatus = "ok" }
)

$allTestsPassed = $false

try {
    while (-not $allTestsPassed) {
        Write-Host "++++++++++++++++++++ [HOST] Waiting for client connection... ++++++++++++++++++++"
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        Write-Host "++++++++++++++++++++ [HOST] Client connected! Handshaking... ++++++++++++++++++++"

        # Read HTTP Handshake request
        $buffer = [byte[]]::new(4096)
        $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
        $request = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $bytesRead)

        if ($request -notmatch 'Sec-WebSocket-Key:\s*([^\r\n]+)') {
            $client.Close()
            continue
        }

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
        Write-Host "++++++++++++++++++++ [HOST] Handshake complete! ++++++++++++++++++++"

        $testsPassed = 0

        while ($client.Connected) {
            $frame = Read-WsFrame -Stream $stream
            if ($null -eq $frame -or $frame.Opcode -eq 0x08) {
                Write-Host "++++++++++++++++++++ [HOST] Client closed connection ++++++++++++++++++++"
                break
            }

            if ($frame.Opcode -ne 0x01) {
                continue
            }

            $msg = $frame.Payload
            Write-Host "++++++++++++++++++++ [HOST] Received frame: $msg ++++++++++++++++++++"

            # Initial ping response followed by running test suite
            if ($msg -match '"type"\s*:\s*"ping"') {
                $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                $pong = "{`"type`":`"pong`",`"source`":`"host`",`"timestamp`":$now}"
                Send-WsFrame -Stream $stream -Message $pong
                Write-Host "++++++++++++++++++++ [HOST] Sent pong acknowledgment ++++++++++++++++"

                Write-Host "`n>>> Dispatching test cases to browser extension mind...`n"

                $interrupted = $false

                foreach ($test in $testCases) {
                    $reqObj = @{
                        id = $test.Id
                        action = $test.Action
                        op = $test.Op
                        a = $test.A
                        b = $test.B
                    }
                    $jsonReq = $reqObj | ConvertTo-Json -Compress
                    Write-Host "[TEST SEND] $($test.Id): $($test.Op)($($test.A), $($test.B))"
                    Send-WsFrame -Stream $stream -Message $jsonReq

                    # Read corresponding response, draining intermediate heartbeat frames
                    do {
                        $respFrame = Read-WsFrame -Stream $stream
                        if ($null -eq $respFrame -or $respFrame.Opcode -eq 0x08) {
                            Write-Host "[TEST FAIL] Disconnected awaiting $($test.Id)" `
                                -ForegroundColor Red
                            $interrupted = $true
                            break
                        }

                        if ($respFrame.Opcode -ne 0x01) {
                            Write-Host "[TEST SKIP] Non-text opcode $($respFrame.Opcode)"
                            continue
                        }

                        Write-Host "[TEST RECV] $($respFrame.Payload)"
                        $respData = $respFrame.Payload | ConvertFrom-Json
                    } while ($respData.status -eq "loading" -or
                             $respData.status -eq "generating" -or
                             $respData.status -eq "progress")

                    if ($interrupted) { break }

                    $isSuccess = $false
                    if ($test.ExpectedStatus -eq "ok") {
                        if ($respData.status -eq "ok" -and
                            ($respData.result -eq $test.ExpectedResult -or
                             "$($respData.result)" -match "\b$($test.ExpectedResult)\b")) {
                            $isSuccess = $true
                        }
                    } elseif ($test.ExpectedStatus -eq "error") {
                        if (($respData.status -eq "error" -and
                             !([string]::IsNullOrEmpty($respData.error))) -or
                            ("$($respData.result)" -match "(?i)division by zero|undefined|cannot divide|zero")) {
                            $isSuccess = $true
                        }
                    }

                    if ($isSuccess) {
                        Write-Host "[TEST PASS] $($test.Id) passed (Result: " `
                            "$($respData.result)$($respData.error))`n" -ForegroundColor Green
                        $testsPassed++
                    } else {
                        Write-Host "[TEST FAIL] $($test.Id) mismatch`n" -ForegroundColor Red
                    }
                }

                if (-not $interrupted) {
                    Write-Host "=========================================================="
                    Write-Host "Verification Suite: $testsPassed/$($testCases.Count) passed"
                    Write-Host "=========================================================="
                    if ($testsPassed -eq $testCases.Count) {
                        $allTestsPassed = $true
                        Start-Sleep -Milliseconds 0x1F4
                        break
                    }
                }
            }
        }

        $client.Close()
    }
} finally {
    $listener.Stop()
    Write-Host "++++++++++++++++++++ [HOST] Test server stopped ++++++++++++++++++++"
}

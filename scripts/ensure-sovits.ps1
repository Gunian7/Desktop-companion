$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$sovitsRoot = "F:\You\GPT-SoVITS\GPT-SoVITS-v2pro-20250604"
$pythonExe = Join-Path $sovitsRoot "runtime\python.exe"
$scriptPath = Join-Path $sovitsRoot "api_v2.py"
$configPath = "GPT_SoVITS/configs/tts_infer_custom.yaml"
$hostName = "127.0.0.1"
$port = 9880
$deadline = (Get-Date).AddMinutes(5)

function Test-PortOpen {
  param(
    [string]$TargetHost,
    [int]$TargetPort
  )

  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $asyncResult = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
    $connected = $asyncResult.AsyncWaitHandle.WaitOne(1500, $false)
    if (-not $connected) {
      $client.Close()
      return $false
    }
    $client.EndConnect($asyncResult) | Out-Null
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-PortOpen -TargetHost $hostName -TargetPort $port)) {
  Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList "/c", "cd /d `"$sovitsRoot`" && set PYTHONPATH=. && `"$pythonExe`" api_v2.py -a $hostName -p $port -c $configPath" `
    -WorkingDirectory $sovitsRoot `
    -WindowStyle Minimized | Out-Null
}

do {
  Start-Sleep -Seconds 2
  if (Test-PortOpen -TargetHost $hostName -TargetPort $port) {
    exit 0
  }
} while ((Get-Date) -lt $deadline)

Write-Error ("GPT-SoVITS did not start listening on {0}:{1} within 5 minutes." -f $hostName, $port)
exit 1

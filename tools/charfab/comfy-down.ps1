# Stop the ComfyUI started by comfy-up.ps1: only the process that owns the :8188 listener (and its cmd parent).
$l = Get-NetTCPConnection -LocalPort 8188 -State Listen -EA SilentlyContinue | Select-Object -First 1
if (-not $l) { "comfy not running"; exit 0 }
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)"
Stop-Process -Id $l.OwningProcess -Force
if ($p.ParentProcessId) { $pp = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; if ($pp.Name -eq 'cmd.exe') { Stop-Process -Id $pp.ProcessId -Force -EA SilentlyContinue } }
Start-Sleep 4
"comfy stopped (pid $($l.OwningProcess)); vram=" + (nvidia-smi --query-gpu=memory.used --format=csv,noheader)

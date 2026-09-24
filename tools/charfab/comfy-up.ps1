$root = 'D:\ComfyUI_windows_portable'
$busy = Get-NetTCPConnection -LocalPort 8188 -State Listen -EA SilentlyContinue
if ($busy) { "8188 already listening pid=" + $busy.OwningProcess; exit 0 }
New-Item -ItemType Directory -Force C:\Users\xam88\charfab-io | Out-Null
$cmd = "cmd.exe /c `"$root\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --disable-auto-launch --listen 0.0.0.0 --port 8188 > C:\Users\xam88\charfab-io\comfy.log 2>&1`""
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $root }
"create rc=" + $r.ReturnValue + " pid=" + $r.ProcessId

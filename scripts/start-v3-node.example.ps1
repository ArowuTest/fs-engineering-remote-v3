$env:FS_REMOTE_CONTROL_PLANE_URL='https://YOUR-CONTROL-PLANE.example.com'
$env:FS_REMOTE_NODE_ID=$env:COMPUTERNAME
$credentialFile=Join-Path $env:LOCALAPPDATA 'FS-Remote-v3\credentials\node-secret.dpapi'
if(-not (Test-Path $credentialFile)){throw 'Run Provision-V3-NodeCredential.ps1 first.'}
$secure=ConvertTo-SecureString ((Get-Content $credentialFile -Raw).Trim())
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$env:FS_REMOTE_NODE_SECRET=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
Set-Location 'C:\path\to\FS-Remote-MCP-v3'
$logDir=Join-Path $env:LOCALAPPDATA 'FS-Remote-v3\logs';New-Item -ItemType Directory -Force -Path $logDir|Out-Null
npm.cmd run node:agent *>> (Join-Path $logDir ("node-"+(Get-Date -Format 'yyyyMMdd')+".log"))

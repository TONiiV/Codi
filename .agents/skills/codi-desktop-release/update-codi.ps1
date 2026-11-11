[CmdletBinding()]
param(
  [string]$Branch = "main",
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$Message) { Write-Host "`n==> $Message" }
function Invoke-Checked([string]$FilePath, [string[]]$ArgumentList) {
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) { throw "$FilePath exited with code $LASTEXITCODE" }
}
function Find-CodiExecutable {
  $roots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )
  # The NSIS entry is named "Codi <version>", has no InstallLocation, and sets DisplayIcon to "<exe>,0".
  # Not every entry has those values, and a Chrome web app is also named "Codi" (its icon is a .ico).
  $entry = Get-ItemProperty $roots -ErrorAction SilentlyContinue |
    Where-Object {
      $_.PSObject.Properties["DisplayName"] -and $_.PSObject.Properties["DisplayIcon"] -and
      $_.DisplayName -match '^Codi \d' -and $_.DisplayIcon -match '\.exe,\d+$'
    } |
    Select-Object -First 1
  if ($null -ne $entry) {
    $candidate = $entry.DisplayIcon -replace ',\d+$'
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA "Programs\t3code\Codi.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Codi\Codi.exe")
  )) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}
function Remove-ReleaseWorktree([string]$Repo, [string]$Worktree) {
  if (!(Test-Path -LiteralPath $Worktree)) { return }
  $resolvedRepo = [IO.Path]::GetFullPath($Repo).TrimEnd('\')
  $resolvedWorktree = [IO.Path]::GetFullPath($Worktree)
  if (!$resolvedWorktree.StartsWith("$resolvedRepo\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove worktree outside repository: $resolvedWorktree"
  }
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & git -C $Repo worktree remove --force $Worktree 2>$null
  $ErrorActionPreference = $oldPreference
  if (Test-Path -LiteralPath $Worktree) {
    $empty = "$Worktree-empty"
    New-Item -ItemType Directory -Path $empty -Force | Out-Null
    & robocopy.exe $empty $Worktree /MIR /XJ /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not clean temporary worktree (robocopy $LASTEXITCODE)" }
    Remove-Item -LiteralPath $Worktree -Force
    Remove-Item -LiteralPath $empty -Force
  }
  & git -C $Repo worktree prune
}

if (-not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) {
  throw "update-codi.ps1 requires Windows"
}
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne "X64") {
  throw "update-codi.ps1 currently supports Windows x64 only"
}

$Repo = & git -C $PSScriptRoot rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) { throw "Could not resolve repository root" }
$Vp = Join-Path $Repo "node_modules\.bin\vp.cmd"
if (!(Test-Path -LiteralPath $Vp)) { throw "Missing $Vp; run vp i in $Repo first" }
$Worktree = Join-Path $Repo ".worktrees\codi-release-win-$PID"
$Output = Join-Path $env:USERPROFILE "codi-local"
$BuildLog = Join-Path $Output "last-build-windows.log"
$Database = Join-Path $env:USERPROFILE ".t3\userdata\statev2.sqlite"
New-Item -ItemType Directory -Path $Output -Force | Out-Null

try {
  Step "Worktree from origin/$Branch"
  Invoke-Checked git @("-C", $Repo, "fetch", "origin", $Branch)
  Invoke-Checked git @("-C", $Repo, "worktree", "add", "--detach", $Worktree, "origin/$Branch")
  Push-Location $Worktree
  try {
    Write-Host "commit: $((& git log --oneline -1).Trim())"
    $sourceEnv = if (Test-Path -LiteralPath (Join-Path $Repo ".env")) {
      Join-Path $Repo ".env"
    } else {
      Join-Path $Worktree ".env.example"
    }
    Copy-Item -LiteralPath $sourceEnv -Destination (Join-Path $Worktree ".env")

    Step "Dependencies and Rust MSVC target"
    Invoke-Checked $Vp @("i")
    $rustToolchain = "stable-x86_64-pc-windows-msvc"
    $rustTargets = & rustup target list --installed --toolchain $rustToolchain
    if ($LASTEXITCODE -ne 0 -or $rustTargets -notcontains "x86_64-pc-windows-msvc") {
      throw "Rust toolchain $rustToolchain with target x86_64-pc-windows-msvc is not installed; install it after the user authorizes"
    }
    $env:RUSTUP_TOOLCHAIN = $rustToolchain

    Step "Local Codi identity"
    $buildScript = Join-Path $Worktree "scripts\build-desktop-artifact.ts"
    $text = [IO.File]::ReadAllText($buildScript)
    $replacements = [ordered]@{
      "    appId: DESKTOP_APP_ID," = "    appId: `"com.tonic.codi`",";
      '    artifactName: "T3-Code-${version}-${arch}.${ext}",' = '    artifactName: "Codi-${version}-${arch}.${ext}",'
      "export const WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT = 80;" = "export const WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT = 100;"
    }
    foreach ($pair in $replacements.GetEnumerator()) {
      if (!$text.Contains($pair.Key)) { throw "Identity patch did not match: $($pair.Key)" }
      $text = $text.Replace($pair.Key, $pair.Value)
    }
    [IO.File]::WriteAllText($buildScript, $text, [Text.UTF8Encoding]::new($false))
    $desktopPackage = Join-Path $Worktree "apps\desktop\package.json"
    $packageText = [IO.File]::ReadAllText($desktopPackage)
    if (!$packageText.Contains('"productName": "Codi (Beta)"')) {
      throw "Desktop productName patch did not match Codi (Beta)"
    }
    $packageText = $packageText.Replace('"productName": "Codi (Beta)"', '"productName": "Codi"')
    [IO.File]::WriteAllText($desktopPackage, $packageText, [Text.UTF8Encoding]::new($false))

    Step "Build Windows x64 installer"
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Remove-Item Env:GITHUB_REPOSITORY -ErrorAction SilentlyContinue
    Remove-Item Env:T3CODE_DESKTOP_UPDATE_REPOSITORY -ErrorAction SilentlyContinue
    $ErrorActionPreference = "Continue"
    & $Vp run dist:desktop:win:x64 *>&1 | Tee-Object -FilePath $BuildLog
    $ErrorActionPreference = "Stop"
    if ($LASTEXITCODE -ne 0) { throw "Windows desktop build failed; see $BuildLog" }
    Remove-Item Env:RUSTUP_TOOLCHAIN -ErrorAction SilentlyContinue

    $installer = Get-ChildItem (Join-Path $Worktree "release") -Filter "Codi-*-x64.exe" |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (!$installer -or $installer.Length -lt 100MB) { throw "Verified Codi installer was not produced" }
    $version = (Get-Content -Raw (Join-Path $Worktree "apps\desktop\package.json") | ConvertFrom-Json).version
    $keptInstaller = Join-Path $Output $installer.Name
    Copy-Item -LiteralPath $installer.FullName -Destination $keptInstaller -Force
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $keptInstaller).Hash
    [IO.File]::WriteAllText("$keptInstaller.sha256", "$hash  $($installer.Name)`n", [Text.UTF8Encoding]::new($false))
  } finally {
    Pop-Location
  }

  $installedBefore = Find-CodiExecutable
  if ($installedBefore) {
    Step "Close installed Codi"
    $installDir = [IO.Path]::GetFullPath((Split-Path -Parent $installedBefore)).TrimEnd('\') + "\"
    $running = Get-Process | Where-Object {
      try { $_.Path -and [IO.Path]::GetFullPath($_.Path).StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    }
    # A process that already exited (its siblings close together) throws here and needs no close.
    foreach ($process in $running) { try { [void]$process.CloseMainWindow() } catch { } }
    foreach ($process in $running) {
      Wait-Process -Id $process.Id -Timeout 30 -ErrorAction SilentlyContinue
      if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
        throw "Codi did not close gracefully (PID $($process.Id)); close it manually and rerun"
      }
    }
  }
  if (Get-Process | Where-Object { try { $_.Path -like "*\T3 Code*.exe" } catch { $false } }) {
    throw "official T3 Code is running; quit it first"
  }

  if (Test-Path -LiteralPath $Database) {
    Step "Snapshot statev2.sqlite"
    $backup = Join-Path $Output ("t3-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $snapshotCode = "new (require('bun:sqlite').Database)(process.argv[1],{readonly:true}).run('VACUUM INTO ?',process.argv[2])"
    Invoke-Checked bun @("-e", $snapshotCode, $Database, (Join-Path $backup "statev2.sqlite"))
    Write-Host "backup: $backup"
  }

  Step "Install $($installer.Name)"
  $install = Start-Process -FilePath $keptInstaller -ArgumentList "/S" -WindowStyle Hidden -Wait -PassThru
  if ($install.ExitCode -notin 0, 3010) { throw "Installer exited with code $($install.ExitCode)" }
  $installed = Find-CodiExecutable
  if (!$installed) { throw "Installer finished but Codi.exe was not found" }
  $installedVersion = (Get-Item -LiteralPath $installed).VersionInfo.ProductVersion
  # The exe reports 0.1.8.0 for artifact 0.1.8, so compare the first three parts exactly.
  if (!$installedVersion -or ([version]($installedVersion -replace '[-+].*$')).ToString(3) -ne ([version]($version -replace '[-+].*$')).ToString(3)) {
    throw "Installed version $installedVersion does not match artifact version $version"
  }
  Write-Host "installed: $installed ($installedVersion)"

  if (!$NoLaunch) {
    Step "Launch Codi"
    Start-Process -FilePath $installed
  }
} finally {
  Remove-ReleaseWorktree $Repo $Worktree
}

Write-Host "Updated Codi to $version. Installer: $keptInstaller"

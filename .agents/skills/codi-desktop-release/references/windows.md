# Windows x64 release

Use this reference only on a Windows x64 host.

## Prerequisites

The repository build preflight is authoritative. A native x64 installer needs:

- Python 3 discoverable by node-gyp.
- Rust toolchain `stable-x86_64-pc-windows-msvc` with the
  `x86_64-pc-windows-msvc` target already installed. The updater builds with
  `RUSTUP_TOOLCHAIN` set to it, so a GNU default toolchain is fine and no
  `rustup override` is written. It stops if the toolchain or target is missing;
  adding them needs explicit user authorization.
- The latest Visual Studio instance returned by `vswhere` must contain the x64
  C++ tools, a Windows SDK, and the latest toolset's
  `VC\Tools\MSVC\<version>\lib\spectre\x64` directory.

When Spectre libraries are the only missing component, modify the latest Visual
Studio instance with
`Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`. Passive or
quiet Visual Studio modifications must start elevated. Quote `--installPath`
as one argument and use `--norestart`. A reboot-required result is a stop
condition.

Installing or modifying system components is outside an ordinary update.
Obtain explicit user authorization immediately before doing it.

## Install and data safety

- Snapshot `%USERPROFILE%\.t3\userdata\statev2.sqlite` with SQLite `VACUUM INTO`
  when it exists. Do not copy a live database byte-for-byte.
- Resolve an existing app from its uninstall registry entry (named
  `Codi <version>`; its `DisplayIcon` holds the exe path) or the current
  `%LOCALAPPDATA%\Programs\t3code\Codi.exe` path. Keep
  `%LOCALAPPDATA%\Programs\Codi\Codi.exe` as a legacy fallback.
- Close only processes whose executable path is inside that resolved app's
  install directory, so an older `Codi (Beta).exe` there is closed too. Request
  manual closure if graceful shutdown does not finish; never kill by
  process-name or command-line pattern. Stop if an official `T3 Code*.exe` is
  still running.
- Run the NSIS installer with `/S`, then verify the installed executable's
  product version equals the artifact version before launch.
- Remove `ELECTRON_RUN_AS_NODE` from the launch environment.

Keep the installer, SHA-256 file, build log, and database backup under
`%USERPROFILE%\codi-local`. Keep the identity edit only in the detached release
worktree.

## Current upstream packaging guard

The audio-transcription runtime added CPU-specific and Vulkan DLLs, making the
audited Windows x64 payload 89 files while upstream's generic limit remains 80.
The local updater changes that exact constant from 80 to 100 only inside its
detached worktree. A changed upstream constant makes the patch stop instead of
silently overriding it. Keep the remaining payload validation intact: required
sidecars, unpacked natives, the primary fff load probe, and the self-contained
bundle check must still pass.

Windows identity must be consistent in both places: set `appId` and artifact
name in `createBuildConfig`, and change `apps/desktop/package.json` productName
from `Codi (Beta)` to `Codi`. Patching only electron-builder's product name
causes validation to look for `Codi (Beta).exe` after producing `Codi.exe`.

# Installing Hearth

Hearth runs on Linux, Windows and macOS. The Linux path builds from source and is
the one the project is developed against; Windows and macOS use the installers
built by GitHub Actions.

Wherever you install it, **your study data is a local SQLite database plus a git
vault directory, and no installer or uninstaller ever removes it silently.**

---

## Linux — build from source

```bash
git clone https://github.com/sundoesdev/Bonfire.git hearth
cd hearth
./install.sh
```

This installs the binary to `~/.local/bin/hearth`, adds an application-launcher
entry, and offers to set up vault sync (skippable). Everything it creates is
recorded in `install-manifest.txt`, so the uninstaller removes exactly that.

Data lives in `~/.local/share/com.bonfire.app/`:

| Path | What it is |
| --- | --- |
| `vault.db` | every card, deck, setting and review |
| `vault/` | the git working copy pushed to your sync remote |
| `install-manifest.txt` | what the installer put where |
| `launch-mode` | `binary` or `dev` |

To update: `git pull && ./install.sh`. The app can also do this itself on launch
(see **Updating** below).

To remove: `./uninstall.sh`. It deletes your data **only** once it has confirmed
everything is published to your remote, and refuses otherwise. `--keep-data`
removes the app alone; `--force` deletes unsynced data and is not recoverable.

---

## Windows

Windows ships as a prebuilt installer rather than a source build — there is no
need for Rust, Node or a compiler.

1. Open the [Releases page](https://github.com/sundoesdev/Bonfire/releases) and
   download the latest **`Hearth_<version>_x64-setup.exe`** (NSIS). An `.msi` is
   published alongside it if you prefer that or need to deploy it centrally.
2. Run it. Builds are **unsigned**, so SmartScreen shows a one-time
   "Windows protected your PC" notice — choose **More info → Run anyway**.
3. Hearth installs for the current user only, so there is no UAC prompt and no
   admin account required. It appears in the Start menu as **Hearth**.

### Where your data lives

```
%APPDATA%\com.bonfire.app\
```

which is normally `C:\Users\<you>\AppData\Roaming\com.bonfire.app\`. Paste that
path into Explorer's address bar to open it. It holds the same `vault.db` and
`vault\` as the Linux layout above — this is the directory to back up.

### Sync on Windows

Sync shells out to the system `git`, so install [Git for Windows](https://git-scm.com/download/win)
if you want it. Hearth is fully usable without it; sync is off until configured,
and the app does not complain when git is absent.

### Uninstalling

**Settings → Apps → Installed apps → Hearth → Uninstall**, or the uninstall entry
in the Start-menu **Hearth** folder.

The uninstaller shows a **"Delete application data"** checkbox. It is **unchecked
by default**, so your cards survive an uninstall unless you deliberately tick it —
and it is skipped entirely when an installer is upgrading in place.

Leave it unchecked unless you mean it. Ticking it removes
`%APPDATA%\com.bonfire.app\` and with it every card, deck and review you have
not pushed to a sync remote. Unlike `uninstall.sh` on Linux, **nothing checks
whether your vault is synced first** — so if you do want a clean removal, open
Hearth beforehand and confirm Settings → Sync reports no pending changes.

### Updating on Windows

Download the newer installer and run it over the top — it upgrades in place and
leaves your data alone. There is no in-app auto-update on Windows: that would
need code signing, which is deliberately deferred. The app's built-in updater is
source-checkout based and reports "Not installed from a source checkout" rather
than failing, so it stays silent.

---

## macOS

Not yet packaged or tested. The release workflow already builds `.dmg` bundles
for both Apple Silicon and Intel, and they are attached to each release, but
nothing about the install or uninstall path has been verified — treat them as
untested. Windows was prioritised first.

---

## Updating

| Platform | How |
| --- | --- |
| Linux (source) | `git pull && ./install.sh`, or let the app do it on launch |
| Windows | download and run the newer installer |
| macOS | not yet supported |

Hearth's in-app updater only applies to a Linux source install. It fast-forwards
the checkout from GitHub `main` and reruns `install.sh --update`, and it refuses
to run if `origin` is not the real Bonfire repository or if the checkout is dirty
or diverged. A running binary cannot replace itself, so an update applies on the
next launch.

---

## Building the installers yourself

Push a version tag, or run the **Release** workflow manually from the Actions
tab:

```bash
git tag v0.4.0
git push origin v0.4.0
```

GitHub Actions builds on `windows-latest`, `ubuntu-22.04` and `macos-latest`
(arm64 and x86_64) and attaches every bundle to a **draft** release, which you
then review and publish by hand.

Builds are unsigned on every platform. Signing means a paid certificate on
Windows and an Apple Developer account on macOS, and — for Windows — committing
to signing every release from then on, so it has been left for later rather than
set up half-way.

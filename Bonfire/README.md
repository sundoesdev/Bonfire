# Hearth — application source

This is the Tauri project. Documentation, the installer, and the uninstaller
live one level up at the repository root:

- [../README.md](../README.md) — install, sync setup, troubleshooting
- [../docs/SYNC.md](../docs/SYNC.md) — vault format and merge rules
- [../docs/WEBAPP.md](../docs/WEBAPP.md) — how a browser version would fit in

Run `npm` and `cargo` commands from **this** directory:

```bash
npm install
npm run tauri dev
npm run tauri build

cd src-tauri && cargo test
```

Recommended editor setup: [VS Code](https://code.visualstudio.com/) with
[Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
and [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

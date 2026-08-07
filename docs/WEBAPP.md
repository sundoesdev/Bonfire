# A web version of Hearth

**Status: design note, not built.** This records how a browser version would fit
in, so that today's decisions do not have to be undone to get there.

## The question this answers

The original planning question was: *does building sync now, this way, create
more work later when Hearth also runs in a browser?*

The answer is no, provided one rule holds — and the code is arranged so it does.

## The rule

**Git is a transport. The merge rules are the product.**

`merge.rs` is pure functions over `VaultData`: no database, no filesystem, no
git, no network. Everything transport-shaped lives in `git.rs` and `sync.rs`,
and everything storage-shaped lives in `vault.rs`.

A browser cannot shell out to git. But a browser does not need to — it can talk
HTTP to a server that does. And that server runs the *same* `merge.rs`.

## What a web version looks like

```
    desktop Hearth ──git──┐
                          ├──> vault repo (private)
    hearth-server ──git───┘
          ▲
          │ HTTP
          ▼
     browser Hearth
```

`hearth-server` is a small Rust service that:

1. keeps a checkout of the vault repo, exactly as the desktop app does;
2. reuses `merge.rs` **unchanged** to reconcile what a browser client sends;
3. exposes the record set over HTTP;
4. commits and pushes with the same `git.rs` primitives.

The desktop app does not change. It keeps syncing over git, and the server is
simply a third peer on the same vault. A browser client is then a frontend that
speaks HTTP instead of `invoke` — the view layer is already separated behind
`api.js`, which is the app's single backend-call site, so a web build swaps that
one module rather than rewriting views.

## What would need doing

- **A server binary.** Extract the crate's `merge`/`vault` modules into a shared
  library, then two thin binaries over it (the Tauri app, the server). The
  modules were written with no Tauri dependency for this reason.
- **Auth.** The desktop has none because the vault repo's own git credentials are
  the boundary. A hosted browser version needs real accounts, which is the single
  biggest piece of new work — and the reason this is not being built casually.
- **A storage decision for media.** Base64 data-URLs are fine over `invoke` and
  fine as files in git, but a browser pulling a large deck over HTTP would want
  them served as separate cacheable resources. The vault already stores them as
  discrete files, so the server can serve them directly.
- **Hosting.** Out of scope here; the current constraint is that nothing is
  public-facing.

## What must not happen

If git-specific logic leaks into `merge.rs` — a commit id in a merge decision, a
filesystem path in a rule, a `Command` invocation — then the web version stops
being additive and becomes a rewrite. That is the one thing to guard, and it is
why `merge.rs` has no `use std::fs`, no `use std::process`, and unit tests that
construct `VaultData` in memory rather than from disk.

// Command palette (Ctrl+P): fuzzy search over actions, deck switches, view
// navigation, and every card (open by title, switching deck if needed).
import { el, esc } from "../dom.js";

function buildItems(ctx) {
  const items = [];
  const add = (cat, label, run) =>
    items.push({ cat, label, run, search: (cat + " " + label).toLowerCase() });

  add("Action", "New card", () => ctx.newShard());
  add("Action", "Quick capture", () => ctx.openQuickCapture());
  add("Action", "Start study", () => ctx.startStudy());
  add("Action", "Daily study", () => ctx.quickStudy());
  add("Action", "Drill weak spots", () => ctx.weakStudy());

  [
    ["dashboard", "Dashboard"],
    ["library", "Library"],
    ["study", "Study"],
    ["tags", "Tags"],
    ["settings", "Settings"],
  ].forEach(([v, label]) => add("Go to", label, () => ctx.navigate(v)));

  ctx.decks().forEach((d) => add("Deck", `Switch to: ${d.name}`, () => ctx.setDeck(d.id)));

  // Every card across decks; opening one switches to its deck first if needed.
  ctx.state.allShards.forEach((s) =>
    add("Card", s.title || "(untitled)", async () => {
      if (s.deckId && s.deckId !== ctx.currentDeckId()) await ctx.setDeck(s.deckId);
      ctx.openShard(s.id);
    })
  );
  return items;
}

export function openCommandPalette(ctx) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return; // already open (palette or another modal)

  const items = buildItems(ctx);

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal palette">
        <input type="text" id="cp-input" placeholder="Type a command or card title…" autocomplete="off" spellcheck="false" />
        <div id="cp-results" class="cp-results"></div>
      </div>
    </div>
  `);

  const input = backdrop.querySelector("#cp-input");
  const results = backdrop.querySelector("#cp-results");
  let filtered = [];
  let sel = 0;

  function render() {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    filtered = items.filter((it) => words.every((w) => it.search.includes(w))).slice(0, 50);
    if (sel >= filtered.length) sel = Math.max(0, filtered.length - 1);
    results.innerHTML = "";
    if (!filtered.length) {
      results.appendChild(el('<div class="cp-empty">No matches</div>'));
      return;
    }
    filtered.forEach((it, i) => {
      const r = el(`
        <div class="cp-item ${i === sel ? "active" : ""}">
          <span class="cp-cat">${esc(it.cat)}</span>
          <span class="cp-label">${esc(it.label)}</span>
        </div>
      `);
      r.addEventListener("mousemove", () => {
        if (sel !== i) {
          sel = i;
          paint();
        }
      });
      r.addEventListener("click", () => run(it));
      results.appendChild(r);
    });
  }

  function paint() {
    [...results.querySelectorAll(".cp-item")].forEach((c, i) => c.classList.toggle("active", i === sel));
    const active = results.querySelectorAll(".cp-item")[sel];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  async function run(it) {
    close();
    await it.run();
  }

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey, true);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length) {
        sel = (sel + 1) % filtered.length;
        paint();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length) {
        sel = (sel - 1 + filtered.length) % filtered.length;
        paint();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[sel]) run(filtered[sel]);
    }
  }

  input.addEventListener("input", () => {
    sel = 0;
    render();
  });
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey, true);
  render();
  input.focus();
}

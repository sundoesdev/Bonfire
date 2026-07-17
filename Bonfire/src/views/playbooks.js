// Playbooks: self-authored, step-by-step tutorials over EXISTING cards. A playbook is
// NOT a study session — no grading, no spaced-repetition. It's an N-ary tree of nodes
// (each referencing a card), walked one root→leaf path at a time (branches are
// alternative threads). Cards are only referenced — they stay in the library and every
// deck they belong to; deleting a playbook/node never touches a card.
//
// Three surfaces, all rendered into the same container:
//   • list   — create / open / run / delete playbooks
//   • editor — nested tree editor (add child/sibling, move, indent/outdent, delete)
//   • runner — main card pane + nested step sidebar + Cytoscape graph + Next/Prev
import { el, esc, metaBadges } from "../dom.js";
import { mdLite } from "../markdown.js";
import { highlightInto } from "../highlight.js";
import { confirmDialog } from "../components/confirm.js";
import { openQuickCapture } from "../components/quickCapture.js";

// Opaque unique node id (client-generated; only needs to be unique within a playbook).
let uidSeq = 0;
function uid() {
  return `n-${Date.now().toString(36)}-${(uidSeq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- tree helpers (operate on a flat node array; parentId "" = root) ----------
const childrenOf = (nodes, parentId) =>
  nodes.filter((n) => (n.parentId || "") === (parentId || "")).sort((a, b) => a.position - b.position);
const roots = (nodes) => childrenOf(nodes, "");
const nodeById = (nodes, id) => nodes.find((n) => n.id === id);
function descendantIds(nodes, id) {
  const out = [];
  for (const c of childrenOf(nodes, id)) {
    out.push(c.id, ...descendantIds(nodes, c.id));
  }
  return out;
}
// Dense 0..n sibling positions per parent group (keeps ordering deterministic).
function normalize(nodes) {
  const groups = {};
  nodes.forEach((n) => ((groups[n.parentId || ""] ||= []).push(n)));
  Object.values(groups).forEach((g) => {
    g.sort((a, b) => a.position - b.position);
    g.forEach((n, i) => (n.position = i));
  });
}

// A playbook has exactly ONE root (keeps the tree connected + the graph tidy). If an
// operation left several roots, reparent every extra root under the first one.
function enforceSingleRoot(nodes) {
  const rs = roots(nodes);
  if (rs.length > 1) {
    const main = rs[0];
    let base = childrenOf(nodes, main.id).length;
    rs.slice(1).forEach((r) => {
      r.parentId = main.id;
      r.position = base++;
    });
  }
}

// Fresh card map from the backend (decoupled from the deck-scoped view state).
async function loadCardMap(ctx) {
  const cards = await ctx.api.listShards();
  return { cards, map: new Map(cards.map((c) => [c.id, c])) };
}

// ============================ entry point ============================
export async function renderPlaybooks(container, ctx, _params = {}) {
  await showList(container, ctx);
}

// ============================ list (landing dashboard) ============================
async function showList(container, ctx) {
  const playbooks = await ctx.api.listPlaybooks();
  const details = await Promise.all(playbooks.map((p) => ctx.api.getPlaybook(p.id)));
  const stepCount = {};
  details.forEach((d) => {
    if (d) stepCount[d.playbook.id] = d.nodes.length;
  });

  const selected = new Set();
  let sortMode = "modified"; // "modified" | "count"

  const root = el(`
    <div class="pb-landing">
      <div class="panel pb-create">
        <div class="section-title">New playbook</div>
        <div class="muted" style="margin-bottom:10px">A step-by-step tutorial you write for your future self — a runbook over your existing cards. Following one is a walkthrough, not a graded study session.</div>
        <input type="text" id="pb-new-name" class="search-input" placeholder="Name, e.g. Socket Server in C" style="width:100%;margin-bottom:10px" />
        <button class="btn btn-primary" id="pb-add" style="width:100%"><i class="ti ti-plus"></i> Add playbook</button>
      </div>
      <div class="panel pb-temp"><span class="muted">TEMP</span></div>
      <div class="panel pb-listpanel">
        <div class="pb-listbar">
          <button class="btn btn-primary mini" id="pb-t-addstep" disabled title="Add steps to the selected playbook"><i class="ti ti-plus"></i> Add Step</button>
          <button class="btn btn-tool mini" id="pb-t-start" disabled>Start</button>
          <button class="btn btn-accent mini" id="pb-t-edit" disabled>Edit</button>
          <button class="btn btn-tool mini" id="pb-t-rename" disabled>Rename</button>
          <button class="btn btn-danger mini" id="pb-t-del" disabled>Delete</button>
          <span class="spacer"></span>
          <select id="pb-sort" title="Sort playbooks">
            <option value="modified">Recently modified</option>
            <option value="count">Card count</option>
          </select>
        </div>
        <div class="pb-listrows" id="pb-listrows"></div>
      </div>
    </div>
  `);

  const rowsEl = root.querySelector("#pb-listrows");
  const btnAddStep = root.querySelector("#pb-t-addstep");
  const btnStart = root.querySelector("#pb-t-start");
  const btnEdit = root.querySelector("#pb-t-edit");
  const btnRename = root.querySelector("#pb-t-rename");
  const btnDel = root.querySelector("#pb-t-del");

  const selectedList = () => playbooks.filter((p) => selected.has(p.id));
  function updateToolbar() {
    const sel = selectedList();
    const one = sel.length === 1 ? sel[0] : null;
    btnAddStep.disabled = !one;
    btnStart.disabled = !one || !(stepCount[one.id] || 0);
    btnEdit.disabled = !one;
    btnRename.disabled = !one;
    btnDel.disabled = sel.length === 0;
  }

  function drawRows() {
    const sorted = [...playbooks].sort((a, b) =>
      sortMode === "count"
        ? (stepCount[b.id] || 0) - (stepCount[a.id] || 0)
        : (b.modifiedAt || "").localeCompare(a.modifiedAt || "")
    );
    rowsEl.innerHTML = "";
    if (!sorted.length) {
      rowsEl.appendChild(el('<div class="muted">No playbooks yet — create one on the left.</div>'));
      updateToolbar();
      return;
    }
    sorted.forEach((p) => {
      const n = stepCount[p.id] || 0;
      const row = el(`
        <div class="list-row pb-prow ${selected.has(p.id) ? "selected" : ""}">
          <input type="checkbox" class="row-sel" ${selected.has(p.id) ? "checked" : ""} />
          <span class="title">${esc(p.name) || "(unnamed)"}</span>
          <span class="cat">${n} step${n === 1 ? "" : "s"}</span>
          <span class="muted pb-prow-date">${esc((p.modifiedAt || "").slice(0, 10))}</span>
        </div>
      `);
      const cb = row.querySelector(".row-sel");
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        if (cb.checked) selected.add(p.id);
        else selected.delete(p.id);
        drawRows();
      });
      row.addEventListener("dblclick", () => showEditor(container, ctx, p.id));
      rowsEl.appendChild(row);
    });
    updateToolbar();
  }

  root.querySelector("#pb-sort").addEventListener("change", (e) => {
    sortMode = e.target.value;
    drawRows();
  });
  btnAddStep.addEventListener("click", () => {
    const p = selectedList()[0];
    if (p) quickAddSteps(container, ctx, p.id);
  });
  btnStart.addEventListener("click", () => {
    const p = selectedList()[0];
    if (p && (stepCount[p.id] || 0)) showRunner(container, ctx, p.id);
  });
  btnEdit.addEventListener("click", () => {
    const p = selectedList()[0];
    if (p) showEditor(container, ctx, p.id);
  });
  btnRename.addEventListener("click", async () => {
    const p = selectedList()[0];
    if (!p) return;
    const name = prompt("Rename playbook:", p.name);
    if (name && name.trim() && name.trim() !== p.name) {
      await ctx.api.savePlaybook({ ...p, name: name.trim() });
      ctx.toast("Playbook renamed");
      showList(container, ctx);
    }
  });
  btnDel.addEventListener("click", async () => {
    const sel = selectedList();
    if (!sel.length) return;
    const ok = await confirmDialog({
      title: sel.length === 1 ? `Delete "${sel[0].name}"?` : `Delete ${sel.length} playbooks?`,
      message: "This deletes the playbook(s) and their step ordering. Your cards are NOT affected — they stay in your library.",
      confirmLabel: "Delete",
      confirmClass: "btn-danger",
      cancelLabel: "Keep",
    });
    if (ok) {
      for (const p of sel) await ctx.api.deletePlaybook(p.id);
      ctx.toast(sel.length === 1 ? "Playbook deleted" : `${sel.length} playbooks deleted`);
      showList(container, ctx);
    }
  });

  root.querySelector("#pb-add").addEventListener("click", async () => {
    const nameEl = root.querySelector("#pb-new-name");
    const name = nameEl.value.trim();
    if (!name) {
      alert("Playbook name is required.");
      return;
    }
    await ctx.api.savePlaybook({ name, position: playbooks.length });
    ctx.toast("Playbook created");
    showList(container, ctx);
  });

  drawRows();
  container.innerHTML = "";
  container.appendChild(root);
}

// Quick "Add Step" flow from the landing list: append cards (multi-add) to a playbook
// under its single root, without opening the full tree editor.
async function quickAddSteps(container, ctx, playbookId) {
  const detail = await ctx.api.getPlaybook(playbookId);
  if (!detail) return;
  const { map: cardMap } = await loadCardMap(ctx);
  const nodes = detail.nodes.map((n) => ({ ...n }));
  const persist = async () => {
    enforceSingleRoot(nodes);
    normalize(nodes);
    await ctx.api.savePlaybookNodes(playbookId, nodes);
  };
  pickCard(
    ctx,
    () => [...cardMap.values()],
    async (cardId, freshCard) => {
      if (freshCard) cardMap.set(freshCard.id, freshCard);
      const rs = roots(nodes);
      const parentId = rs.length ? rs[0].id : "";
      nodes.push({ id: uid(), playbookId, cardId, parentId, position: childrenOf(nodes, parentId).length });
      await persist();
    },
    () => showList(container, ctx)
  );
}

// ============================ editor ============================
async function showEditor(container, ctx, playbookId) {
  const detail = await ctx.api.getPlaybook(playbookId);
  if (!detail) {
    showList(container, ctx);
    return;
  }
  const { map: cardMap } = await loadCardMap(ctx);
  const playbook = detail.playbook;
  let nodes = detail.nodes.map((n) => ({ ...n }));

  async function persist() {
    enforceSingleRoot(nodes);
    normalize(nodes);
    await ctx.api.savePlaybookNodes(playbookId, nodes);
  }
  async function persistAndRedraw() {
    await persist();
    draw();
  }

  // Add a card (existing or new) under `parentId`. A top-level add ("" parent) attaches
  // under the single root if one exists (only the first-ever card becomes the root).
  function addStep(parentId) {
    pickCard(
      ctx,
      () => [...cardMap.values()],
      (cardId, freshCard) => {
        if (freshCard) cardMap.set(freshCard.id, freshCard);
        // Recompute per add: a top-level add attaches under the single root (or, for
        // the very first card, creates it) — so later adds in one session stay children.
        let target = parentId || "";
        if (!target) {
          const rs = roots(nodes);
          if (rs.length) target = rs[0].id;
        }
        nodes.push({
          id: uid(),
          playbookId,
          cardId,
          parentId: target,
          position: childrenOf(nodes, target).length,
        });
        persistAndRedraw();
      }
    );
  }

  function draw() {
    const root = el(`
      <div>
        <div class="row" style="margin-bottom:6px;align-items:baseline">
          <button class="btn btn-tool mini" id="pb-back">← Playbooks</button>
          <div class="page-greeting" style="margin-left:10px">${esc(playbook.name) || "(unnamed)"}</div>
        </div>
        <div class="muted" style="margin-bottom:12px">Order the steps of your tutorial. Use <b>→</b>/<b>←</b> to indent/promote a step (branches are alternative threads). Removing a step never deletes the card.</div>
        <div class="panel">
          <div id="pb-tree" class="pb-tree"></div>
          <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
          <button class="btn btn-primary" id="pb-add-root"><i class="ti ti-plus"></i> Add step</button>
          <button class="btn btn-tool" id="pb-run" ${nodes.length ? "" : "disabled"}><i class="ti ti-player-play"></i> Start walkthrough</button>
        </div>
      </div>
    `);

    const tree = root.querySelector("#pb-tree");
    if (!nodes.length) {
      tree.appendChild(el('<div class="muted">No steps yet — add your first step below.</div>'));
    } else {
      renderEditRows(tree, nodes, cardMap, 0, "", {
        moveUp: (n) => {
          const sibs = childrenOf(nodes, n.parentId);
          const i = sibs.findIndex((s) => s.id === n.id);
          if (i > 0) {
            [sibs[i - 1].position, n.position] = [n.position, sibs[i - 1].position];
            persistAndRedraw();
          }
        },
        moveDown: (n) => {
          const sibs = childrenOf(nodes, n.parentId);
          const i = sibs.findIndex((s) => s.id === n.id);
          if (i < sibs.length - 1) {
            [sibs[i + 1].position, n.position] = [n.position, sibs[i + 1].position];
            persistAndRedraw();
          }
        },
        indent: (n) => {
          const sibs = childrenOf(nodes, n.parentId);
          const i = sibs.findIndex((s) => s.id === n.id);
          if (i > 0) {
            const prev = sibs[i - 1];
            n.parentId = prev.id;
            n.position = childrenOf(nodes, prev.id).length;
            persistAndRedraw();
          }
        },
        outdent: (n) => {
          if (!n.parentId) return;
          const parent = nodeById(nodes, n.parentId);
          n.parentId = parent ? parent.parentId || "" : "";
          n.position = childrenOf(nodes, n.parentId).length;
          persistAndRedraw();
        },
        addChild: (n) => addStep(n.id),
        remove: (n) => {
          // Reparent children up to this node's parent (don't lose sub-steps), then drop it.
          const kids = childrenOf(nodes, n.id);
          let base = childrenOf(nodes, n.parentId).length;
          kids.forEach((k) => {
            k.parentId = n.parentId || "";
            k.position = base++;
          });
          nodes = nodes.filter((x) => x.id !== n.id);
          persistAndRedraw();
        },
        open: (n) => ctx.openShard(n.cardId),
      });
    }

    root.querySelector("#pb-back").addEventListener("click", () => showList(container, ctx));
    root.querySelector("#pb-add-root").addEventListener("click", () => addStep(""));
    root.querySelector("#pb-run").addEventListener("click", () => {
      if (nodes.length) showRunner(container, ctx, playbookId);
    });

    container.innerHTML = "";
    container.appendChild(root);
  }

  draw();
}

// Render the nested (file-explorer indented) editable rows.
function renderEditRows(treeEl, nodes, cardMap, depth, parentId, h) {
  const sibs = childrenOf(nodes, parentId);
  // Outdent is blocked for roots (depth 0) AND for direct children of the root
  // (depth 1) — promoting either would create a second root (single-root rule).
  const parentNode = parentId ? nodeById(nodes, parentId) : null;
  const noOutdent = parentId === "" || (parentNode && (parentNode.parentId || "") === "");
  sibs.forEach((n, idx) => {
    const card = cardMap.get(n.cardId);
    const row = el(`
      <div class="pb-tree-row" style="padding-left:${depth * 20}px">
        <span class="pb-tree-title" title="${esc(card?.title || "")}">${esc(card?.title || "(missing card)")}</span>
        <span class="spacer"></span>
        <button class="btn btn-tool mini" data-a="up" ${idx === 0 ? "disabled" : ""} title="Move up">↑</button>
        <button class="btn btn-tool mini" data-a="down" ${idx === sibs.length - 1 ? "disabled" : ""} title="Move down">↓</button>
        <button class="btn btn-tool mini" data-a="indent" ${idx === 0 ? "disabled" : ""} title="Make a child of the step above">→</button>
        <button class="btn btn-tool mini" data-a="outdent" ${noOutdent ? "disabled" : ""} title="Promote out one level">←</button>
        <button class="btn btn-tool mini" data-a="child" title="Add a child step">+ child</button>
        <button class="btn btn-tool mini" data-a="view" title="Open the card">⤢</button>
        <button class="btn btn-danger mini" data-a="del" title="Remove from playbook">✕</button>
      </div>
    `);
    row.querySelector('[data-a="up"]').addEventListener("click", () => h.moveUp(n));
    row.querySelector('[data-a="down"]').addEventListener("click", () => h.moveDown(n));
    row.querySelector('[data-a="indent"]').addEventListener("click", () => h.indent(n));
    row.querySelector('[data-a="outdent"]').addEventListener("click", () => h.outdent(n));
    row.querySelector('[data-a="child"]').addEventListener("click", () => h.addChild(n));
    row.querySelector('[data-a="view"]').addEventListener("click", () => h.open(n));
    row.querySelector('[data-a="del"]').addEventListener("click", () => h.remove(n));
    treeEl.appendChild(row);
    renderEditRows(treeEl, nodes, cardMap, depth + 1, n.id, h);
  });
}

// Multi-add card picker modal: add several steps in one session (each Select appends
// via onAdd and keeps the modal open), or create a new card inline. `getCards()`
// returns the live card list (so freshly-created cards show up). `onClose` fires once
// when the picker is dismissed (Done / cancel / backdrop).
function pickCard(ctx, getCards, onAdd, onClose) {
  const modalRoot = document.querySelector("#modal-root");
  if (modalRoot.querySelector(".modal-backdrop")) return;
  let added = 0;
  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal modal-card">
        <h2>Add steps</h2>
        <div class="muted" style="margin-bottom:8px">Pick existing cards to append as steps (add as many as you like), or create a brand-new card. Click <b>Done</b> when finished.</div>
        <div class="row" style="margin-bottom:8px">
          <input type="text" id="pb-pick-search" class="search-input" placeholder="Search cards by title or language…" />
          <button class="btn btn-primary" id="pb-pick-new"><i class="ti ti-plus"></i> New card</button>
        </div>
        <div id="pb-pick-list" class="nt-card-list"></div>
        <div class="actions"><span class="muted" id="pb-pick-added"></span><div class="spacer"></div><button class="btn btn-primary" id="pb-pick-done">Done</button></div>
      </div>
    </div>
  `);
  const addedLbl = backdrop.querySelector("#pb-pick-added");
  const close = (fireClose = true) => {
    modalRoot.innerHTML = "";
    if (fireClose && onClose) onClose();
  };
  const listEl = backdrop.querySelector("#pb-pick-list");
  const search = backdrop.querySelector("#pb-pick-search");
  const bumpAdded = () => {
    added++;
    addedLbl.textContent = `Added ${added} step${added === 1 ? "" : "s"}`;
  };
  function drawResults() {
    const q = search.value.trim().toLowerCase();
    const matches = getCards()
      .filter((c) => !q || `${c.title} ${c.language}`.toLowerCase().includes(q))
      .slice(0, 50);
    listEl.innerHTML = "";
    if (!matches.length) {
      listEl.appendChild(el('<div class="muted">No cards match.</div>'));
      return;
    }
    matches.forEach((c) => {
      const r = el(`
        <div class="nt-card-row">
          <span class="title">${esc(c.title) || "(untitled)"}</span>
          <span class="muted">${esc(c.language || "")}</span>
          <button class="btn btn-tool mini" data-a="pick">Add</button>
        </div>
      `);
      r.querySelector('[data-a="pick"]').addEventListener("click", () => {
        onAdd(c.id, null);
        bumpAdded();
      });
      listEl.appendChild(r);
    });
  }
  search.addEventListener("input", drawResults);
  backdrop.querySelector("#pb-pick-new").addEventListener("click", () => {
    // quickCapture needs the modal slot free; close without firing onClose, create,
    // append the new card, then reopen the picker to keep adding.
    close(false);
    openQuickCapture(ctx, {
      onSaved: (saved) => {
        if (saved && saved.id) onAdd(saved.id, saved);
        pickCard(ctx, getCards, onAdd, onClose);
      },
    });
  });
  backdrop.querySelector("#pb-pick-done").addEventListener("click", () => close());
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  modalRoot.appendChild(backdrop);
  drawResults();
  search.focus();
}

// ============================ runner ============================
async function showRunner(container, ctx, playbookId) {
  const detail = await ctx.api.getPlaybook(playbookId);
  if (!detail || !detail.nodes.length) {
    showList(container, ctx);
    return;
  }
  const { map: cardMap } = await loadCardMap(ctx);
  const playbook = detail.playbook;
  const nodes = detail.nodes.map((n) => ({ ...n }));

  // The walk: a pre-order DFS visiting EVERY node (root → child 1 → its sub-steps →
  // child 2 → …). So Next/Prev step through all of them in order; clicking any step
  // jumps to it.
  function computePath() {
    const path = [];
    const walk = (parentId) => {
      childrenOf(nodes, parentId).forEach((n) => {
        path.push(n);
        walk(n.id);
      });
    };
    walk("");
    return path;
  }

  let cursor = 0;
  let sideOpen = true;
  let graphMode = false;
  let cy = null; // retained across step changes so pan/zoom survive navigation
  let sideWidth = null; // graph-mode panel width (px); persists across shell rebuilds
  let resizeObs = null;
  // Live element refs (set by renderShell) that updateStep patches in place.
  let elCard, elSteps, elProgress, elPrev, elNext;

  function selectNode(id) {
    const i = computePath().findIndex((n) => n.id === id);
    if (i !== -1) cursor = i;
    updateStep();
  }

  // Patch only the per-step bits (card, progress, nav-disabled, highlights) — never
  // rebuilds the graph, so the user's pan/zoom is preserved while navigating.
  function updateStep() {
    const path = computePath();
    if (cursor >= path.length) cursor = path.length - 1;
    if (cursor < 0) cursor = 0;
    const current = path[cursor];
    renderCardInto(elCard, cardMap.get(current.cardId));
    elProgress.textContent = `Step ${cursor + 1} of ${path.length}`;
    elPrev.disabled = cursor === 0;
    elNext.disabled = cursor >= path.length - 1;
    if (elSteps) renderSteps(elSteps, nodes, cardMap, current.id, selectNode);
    if (cy) {
      cy.nodes().removeClass("pb-current");
      cy.getElementById(current.id).addClass("pb-current");
    }
  }

  // Build the whole runner DOM for the current mode/side state. Called on enter and
  // when toggling graph/steps or hiding/showing the sidebar (not on plain navigation).
  function renderShell() {
    if (resizeObs) {
      resizeObs.disconnect();
      resizeObs = null;
    }
    cy = null;
    const path = computePath();
    if (cursor >= path.length) cursor = path.length - 1;
    if (cursor < 0) cursor = 0;

    const sidebar = sideOpen
      ? `
        <div class="pb-resizer" id="pb-resizer" ${graphMode ? "" : "hidden"} title="Drag to resize"></div>
        <aside class="pb-sidebar ${graphMode ? "graph" : ""}" id="pb-sidebar">
          <div class="pb-sidebar-head">
            <span class="section-title" style="margin:0">${graphMode ? "Graph" : "Steps"}</span>
            <span class="spacer"></span>
            <button class="btn btn-tool mini" id="pb-toggle-graph" title="Toggle step list / node graph"><i class="ti ti-${graphMode ? "list" : "hierarchy-2"}"></i></button>
            <button class="btn btn-tool mini" id="pb-toggle-side" title="Hide the sidebar"><i class="ti ti-x"></i></button>
          </div>
          <div class="pb-steps" id="pb-steps" ${graphMode ? "hidden" : ""}></div>
          <div class="pb-graph" id="pb-graph" ${graphMode ? "" : "hidden"}></div>
        </aside>`
      : "";

    const root = el(`
      <div class="pb-runner">
        <div class="pb-main">
          <div class="row" style="margin-bottom:8px;align-items:baseline">
            <button class="btn btn-tool mini" id="pb-exit">← Playbooks</button>
            <div class="page-greeting" style="margin-left:10px;font-size:18px">${esc(playbook.name) || "(unnamed)"}</div>
            <div class="spacer"></div>
            <button class="btn btn-tool mini" id="pb-side-show" ${sideOpen ? "hidden" : ""} title="Show steps"><i class="ti ti-layout-sidebar-right"></i></button>
          </div>
          <div class="pb-card" id="pb-card"></div>
          <div class="pb-runner-nav">
            <button class="btn btn-tool" id="pb-prev">← Previous</button>
            <span class="pb-progress" id="pb-progress"></span>
            <button class="btn btn-primary" id="pb-next">Next →</button>
            <div class="spacer"></div>
            <button class="btn btn-tool" id="pb-done">Done</button>
          </div>
        </div>
        ${sidebar}
      </div>
    `);

    elCard = root.querySelector("#pb-card");
    elProgress = root.querySelector("#pb-progress");
    elPrev = root.querySelector("#pb-prev");
    elNext = root.querySelector("#pb-next");
    elSteps = root.querySelector("#pb-steps"); // null when sidebar hidden

    root.querySelector("#pb-exit").addEventListener("click", () => showList(container, ctx));
    root.querySelector("#pb-done").addEventListener("click", () => showList(container, ctx));
    elPrev.addEventListener("click", () => {
      if (cursor > 0) {
        cursor--;
        updateStep();
      }
    });
    elNext.addEventListener("click", () => {
      if (cursor < computePath().length - 1) {
        cursor++;
        updateStep();
      }
    });
    const toggleGraph = root.querySelector("#pb-toggle-graph");
    if (toggleGraph)
      toggleGraph.addEventListener("click", () => {
        graphMode = !graphMode;
        renderShell();
      });
    const toggleSide = root.querySelector("#pb-toggle-side");
    if (toggleSide)
      toggleSide.addEventListener("click", () => {
        sideOpen = false;
        renderShell();
      });
    const showBtn = root.querySelector("#pb-side-show");
    if (showBtn)
      showBtn.addEventListener("click", () => {
        sideOpen = true;
        renderShell();
      });

    container.innerHTML = "";
    container.appendChild(root);

    // Graph mode: size the panel (~half the runner on first open, then persisted),
    // create Cytoscape once, and keep it crisp on resize.
    if (graphMode && sideOpen) {
      const sidebarEl = root.querySelector("#pb-sidebar");
      const graphEl = root.querySelector("#pb-graph");
      const runnerEl = root;
      if (sideWidth == null) sideWidth = Math.round(runnerEl.clientWidth * 0.5);
      const maxW = Math.max(320, runnerEl.clientWidth - 280);
      sideWidth = Math.max(320, Math.min(sideWidth, maxW));
      sidebarEl.style.width = `${sideWidth}px`;
      cy = renderGraph(graphEl, nodes, cardMap, path[cursor].id, selectNode);
      resizeObs = new ResizeObserver(() => {
        if (cy) cy.resize();
      });
      resizeObs.observe(graphEl);
      wireResizer(runnerEl, sidebarEl, root.querySelector("#pb-resizer"));
    }

    updateStep();
  }

  // Splitter: drag the bar between the card pane and the graph to resize the panel.
  function wireResizer(runnerEl, sidebarEl, resizerEl) {
    if (!resizerEl) return;
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const rect = runnerEl.getBoundingClientRect();
      const maxW = rect.width - 280;
      sideWidth = Math.max(320, Math.min(rect.right - e.clientX, maxW));
      sidebarEl.style.width = `${sideWidth}px`;
      if (cy) cy.resize();
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      if (cy) {
        cy.resize();
        cy.fit(undefined, 30);
      }
    };
    resizerEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      dragging = true;
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  renderShell();
}

// Read-only card render for a runner step (title, prompt, highlighted code, notes, all media).
function renderCardInto(slot, shard) {
  slot.innerHTML = "";
  if (!shard) {
    slot.appendChild(el('<div class="empty">This step\'s card no longer exists.</div>'));
    return;
  }
  const meta = [shard.language, shard.category].filter(Boolean).join(" · ");
  const body = el(`
    <div>
      <div class="title-big">${esc(shard.title) || "(untitled)"}</div>
      ${shard.prompt ? `<div class="desc markdown-body" style="margin-bottom:6px">${mdLite(shard.prompt)}</div>` : ""}
      <div class="meta-line">${esc(meta)} ${metaBadges(shard.tags)}</div>
      <pre class="code-block"><code class="pb-code"></code></pre>
      ${shard.description ? `<div class="section-title">Notes</div><div class="desc markdown-body">${mdLite(shard.description)}</div>` : ""}
      <div class="pb-card-media"></div>
    </div>
  `);
  highlightInto(body.querySelector(".pb-code"), shard.code, shard.language);
  const mediaWrap = body.querySelector(".pb-card-media");
  (shard.media || []).forEach((m) => {
    const cap = m.caption ? `<div class="muted media-cap">${mdLite(m.caption)}</div>` : "";
    const node =
      m.kind === "image"
        ? `<div class="media-view-item"><img class="study-image" src="${esc(m.dataUrl)}" alt="${esc(m.caption || "image")}" />${cap}</div>`
        : `<div class="media-view-item"><audio controls src="${esc(m.dataUrl)}"></audio>${cap}</div>`;
    mediaWrap.appendChild(el(node));
  });
  slot.appendChild(body);
}

// Nested step list (file-explorer indent); highlights the current node.
function renderSteps(stepsEl, nodes, cardMap, currentId, onSelect) {
  stepsEl.innerHTML = "";
  const walk = (parentId, depth) => {
    childrenOf(nodes, parentId).forEach((n) => {
      const card = cardMap.get(n.cardId);
      const cls = n.id === currentId ? "current" : "";
      const btn = el(
        `<button class="pb-step ${cls}" style="padding-left:${8 + depth * 16}px" title="${esc(card?.title || "")}">${esc(card?.title || "(missing card)")}</button>`
      );
      btn.addEventListener("click", () => onSelect(n.id));
      stepsEl.appendChild(btn);
      walk(n.id, depth + 1);
    });
  };
  walk("", 0);
}

// Cytoscape node-graph of the tree; click a node to navigate. Theme-aware colors.
function renderGraph(graphEl, nodes, cardMap, currentId, onSelect) {
  if (typeof cytoscape === "undefined") {
    graphEl.innerHTML = '<div class="muted" style="padding:10px">Graph view unavailable.</div>';
    return null;
  }
  const cs = getComputedStyle(document.body);
  const v = (name, dflt) => cs.getPropertyValue(name).trim() || dflt;
  const accent = v("--accent", "#c26b3f");
  const accentPressed = v("--accent-pressed", accent);
  const border = v("--border", "#d8cdbd");
  const text = v("--text", "#2b2118");
  const surface = v("--surface", "#fffdf8");

  const elements = [];
  nodes.forEach((n) => {
    elements.push({ data: { id: n.id, label: cardMap.get(n.cardId)?.title || "(missing)" } });
    if (n.parentId) elements.push({ data: { id: `e-${n.id}`, source: n.parentId, target: n.id } });
  });

  const cy = cytoscape({
    container: graphEl,
    elements,
    minZoom: 0.2,
    maxZoom: 2.5,
    wheelSensitivity: 0.2, // gentler mouse-wheel zoom (default 1 snaps fully in/out)
    layout: { name: "breadthfirst", directed: true, spacingFactor: 1.3, padding: 16 },
    style: [
      {
        selector: "node",
        style: {
          "background-color": surface,
          "border-width": 2,
          "border-color": border,
          label: "data(label)",
          "font-size": 11,
          color: text,
          "text-wrap": "wrap",
          "text-max-width": 110,
          "text-valign": "bottom",
          "text-margin-y": 4,
          width: 30,
          height: 30,
        },
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": border,
          "target-arrow-color": border,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
      {
        selector: ".pb-current",
        style: { "background-color": accent, "border-color": accentPressed, "border-width": 3 },
      },
    ],
  });
  cy.getElementById(currentId).addClass("pb-current");
  cy.on("tap", "node", (evt) => onSelect(evt.target.id()));
  cy.fit(undefined, 30);
  return cy;
}

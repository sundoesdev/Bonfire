// Shared attachments editor used by the card editor and quick-capture. Manages a
// list of MediaItem ({id,kind,dataUrl,caption,side}); images/audio are stored as
// base64 data-URLs. Returns { node, getItems, handlePaste }.
import { el, esc } from "../dom.js";
import { MEDIA_SIDES } from "../constants.js";

let mediaSeq = 0;
function mediaId() {
  return `m${Date.now().toString(36)}${(mediaSeq++).toString(36)}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function sideOptions(sel) {
  return MEDIA_SIDES.map(
    (s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${s.label}</option>`
  ).join("");
}

export function buildMediaEditor(initial) {
  let items = (initial || []).map((m) => ({ ...m }));

  const node = el(`
    <div class="media-editor">
      <div class="section-title" style="margin-top:12px">Attachments</div>
      <div class="muted" style="margin-bottom:6px">Images &amp; audio, shown with the question or revealed with the answer. Paste an image anywhere in this card, or use the buttons.</div>
      <div class="media-tools row">
        <button type="button" class="btn btn-tool" data-act="image">Add image…</button>
        <button type="button" class="btn btn-tool" data-act="audio">Add audio file…</button>
      </div>
      <input type="file" accept="image/*" class="media-file-image" hidden />
      <input type="file" accept="audio/*" class="media-file-audio" hidden />
      <div class="media-list"></div>
    </div>
  `);

  const list = node.querySelector(".media-list");

  function renderList() {
    list.innerHTML = "";
    items.forEach((m) => {
      const row = el(`
        <div class="media-item" data-id="${esc(m.id)}">
          <div class="media-thumb"></div>
          <div class="media-meta">
            <input type="text" class="media-caption" placeholder="Caption (optional)" value="${esc(m.caption || "")}" />
            <div class="row">
              <select class="media-side">${sideOptions(m.side || "question")}</select>
              <button type="button" class="btn btn-danger media-remove">Remove</button>
            </div>
          </div>
        </div>
      `);
      const thumb = row.querySelector(".media-thumb");
      if (m.kind === "image") {
        const img = document.createElement("img");
        img.src = m.dataUrl;
        img.alt = m.caption || "image";
        thumb.appendChild(img);
      } else {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.src = m.dataUrl;
        thumb.appendChild(audio);
      }
      row.querySelector(".media-caption").addEventListener("input", (e) => {
        m.caption = e.target.value;
      });
      row.querySelector(".media-side").addEventListener("change", (e) => {
        m.side = e.target.value;
      });
      row.querySelector(".media-remove").addEventListener("click", () => {
        items = items.filter((x) => x.id !== m.id);
        renderList();
      });
      list.appendChild(row);
    });
  }

  function addItem(kind, dataUrl) {
    items.push({ id: mediaId(), kind, dataUrl, caption: "", side: "question" });
    renderList();
  }

  const imgInput = node.querySelector(".media-file-image");
  const audInput = node.querySelector(".media-file-audio");
  node.querySelector('[data-act="image"]').addEventListener("click", () => imgInput.click());
  node.querySelector('[data-act="audio"]').addEventListener("click", () => audInput.click());
  imgInput.addEventListener("change", async () => {
    if (imgInput.files[0]) addItem("image", await fileToDataUrl(imgInput.files[0]));
    imgInput.value = "";
  });
  audInput.addEventListener("change", async () => {
    if (audInput.files[0]) addItem("audio", await fileToDataUrl(audInput.files[0]));
    audInput.value = "";
  });

  // Paste an image from the clipboard anywhere in the host form.
  function handlePaste(e) {
    const data = e.clipboardData && e.clipboardData.items;
    if (!data) return;
    for (const it of data) {
      if (it.type && it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (file) {
          e.preventDefault();
          fileToDataUrl(file).then((url) => addItem("image", url));
        }
      }
    }
  }

  renderList();
  return { node, getItems: () => items, handlePaste };
}

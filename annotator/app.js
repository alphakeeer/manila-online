const BOARD = {
  id: "board", label: "Board", width: 1043, height: 2048,
  src: "../manila_assets/game_board.jpg", allowedTypes: ["jade_share", "player_red"],
};
const SHARES = [
  { id: "share-1", label: "Jade Share", src: "../manila_assets/jade_shares.png" },
  { id: "share-2", label: "Nutmeg Share", src: "../manila_assets/nutmeg_shares.png" },
  { id: "share-3", label: "Silk Share", src: "../manila_assets/silk_shares.png" },
  { id: "share-4", label: "Ginseng Share", src: "../manila_assets/ginseng_shares.png" },
];
const STORAGE_KEY = "manila-board-annotator";
const TYPES = {
  jade_share: { src: "../manila_assets/jade_shares.png", width: 221, height: 568, defaultScale: 1, idPrefix: "share", label: "Jade Share" },
  player_red: { src: "../manila_assets/player_red.png", width: 1254, height: 1254, defaultScale: 0.07, idPrefix: "player", label: "Player Red" },
};

const stageEl = document.getElementById("stage");
const boardEl = document.getElementById("board");
const boardImgEl = document.getElementById("board-img");
const inputX = document.getElementById("input-x");
const inputY = document.getElementById("input-y");
const inputRotation = document.getElementById("input-rotation");
const inputScale = document.getElementById("input-scale");
const selectedTypeEl = document.getElementById("selected-type");
const canvasDescriptionEl = document.getElementById("canvas-description");
const addShareButton = document.getElementById("btn-add-share");
const fileImport = document.getElementById("file-import");
const canvasTabs = [...document.querySelectorAll(".canvas-tab")];

const state = {
  activeCanvasId: "board",
  canvases: [
    { ...BOARD, items: [], selectedId: null },
    ...SHARES.map((share) => ({
      ...share, width: 221, height: 568, allowedTypes: ["player_red"], items: [], selectedId: null,
    })),
  ],
  nextId: 1,
};
let dragging = null;
const itemEls = new Map();

function round(n, digits) { const m = 10 ** digits; return Math.round(n * m) / m; }
function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function typeDef(type) { return TYPES[type] || TYPES.jade_share; }
function activeCanvas() { return state.canvases.find((canvas) => canvas.id === state.activeCanvasId); }
function getBoardRect() { return boardEl.getBoundingClientRect(); }
function clientToCanvas(clientX, clientY) {
  const rect = getBoardRect();
  const canvas = activeCanvas();
  return { x: ((clientX - rect.left) / rect.width) * canvas.width, y: ((clientY - rect.top) / rect.height) * canvas.height };
}
function fitBoard() {
  const canvas = activeCanvas();
  const scale = Math.min(Math.max(0, stageEl.clientWidth - 24) / canvas.width, Math.max(0, stageEl.clientHeight - 24) / canvas.height);
  boardEl.style.width = `${canvas.width * scale}px`;
  boardEl.style.height = `${canvas.height * scale}px`;
}
function serializableItem(item) {
  return {
    id: item.id,
    ...(typeof item.name === "string" ? { name: item.name } : {}),
    type: item.type,
    x: round(item.x, 2),
    y: round(item.y, 2),
    rotation: round(item.rotation, 2),
    scale: round(item.scale, 4),
  };
}
function serialize() {
  const board = state.canvases[0];
  return {
    board: { width: board.width, height: board.height, items: board.items.map(serializableItem) },
    shares: state.canvases.slice(1).map((share) => ({ id: share.id, width: share.width, height: share.height, items: share.items.map(serializableItem) })),
  };
}
function toJson() { return JSON.stringify(serialize(), null, 2); }
function parseIdNumber(id) { const match = /-(\d+)$/.exec(id); return match ? Number(match[1]) : 0; }
function normaliseItems(items, canvas) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => TYPES[item.type] && canvas.allowedTypes.includes(item.type))
    .map((item, index) => {
      const def = typeDef(item.type);
      return {
        id: typeof item.id === "string" ? item.id : `${def.idPrefix}-${index + 1}`,
        ...(typeof item.name === "string" ? { name: item.name } : {}),
        type: item.type, x: clamp(Number(item.x) || 0, 0, canvas.width), y: clamp(Number(item.y) || 0, 0, canvas.height),
        rotation: Number(item.rotation) || 0, scale: Number(item.scale) || def.defaultScale,
      };
    });
}
function applyData(data) {
  const boardItems = Array.isArray(data?.board?.items) ? data.board.items : data?.items;
  const importedShares = Array.isArray(data?.shares) ? data.shares : [];
  state.canvases.forEach((canvas, index) => {
    canvas.items = normaliseItems(index === 0 ? boardItems : importedShares[index - 1]?.items, canvas);
    canvas.selectedId = null;
  });
  state.nextId = state.canvases.flatMap((canvas) => canvas.items).reduce((max, item) => Math.max(max, parseIdNumber(item.id) + 1), 1);
}
function save() { localStorage.setItem(STORAGE_KEY, toJson()); }
function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try { applyData(JSON.parse(raw)); } catch (err) { console.warn("Failed to load saved state", err); }
}
function selectedItem() { const canvas = activeCanvas(); return canvas.items.find((item) => item.id === canvas.selectedId) || null; }
function makeId(type) { return `${typeDef(type).idPrefix}-${state.nextId++}`; }
function itemStyle(item) {
  const canvas = activeCanvas(); const def = typeDef(item.type);
  return { left: `${(item.x / canvas.width) * 100}%`, top: `${(item.y / canvas.height) * 100}%`, width: `${(def.width / canvas.width) * 100}%`, height: `${(def.height / canvas.height) * 100}%`, transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})` };
}
function applyItemStyle(el, item) {
  Object.assign(el.style, itemStyle(item));
  el.classList.toggle("selected", item.id === activeCanvas().selectedId);
  el.classList.toggle("dragging", dragging && dragging.id === item.id);
}
function updatePanel() {
  const canvas = activeCanvas(); const item = selectedItem(); const enabled = Boolean(item);
  [inputX, inputY, inputRotation, inputScale].forEach((input) => { input.disabled = !enabled; });
  document.getElementById("btn-duplicate").disabled = !enabled;
  document.getElementById("btn-delete").disabled = !enabled;
  addShareButton.disabled = !canvas.allowedTypes.includes("jade_share");
  canvasDescriptionEl.textContent = canvas.id === "board" ? "Board：可放置 Share 和 Player" : `${canvas.label}：仅可放置 Player`;
  if (!item) {
    selectedTypeEl.textContent = "未选中";
    [inputX, inputY, inputRotation, inputScale].forEach((input) => { input.value = ""; });
    return;
  }
  selectedTypeEl.textContent = `${typeDef(item.type).label} · ${item.id}`;
  inputX.value = round(item.x, 2); inputY.value = round(item.y, 2); inputRotation.value = round(item.rotation, 2); inputScale.value = round(item.scale, 4);
}
function syncDom() {
  const canvas = activeCanvas(); const ids = new Set(canvas.items.map((item) => item.id));
  for (const [id, el] of itemEls) if (!ids.has(id)) { el.remove(); itemEls.delete(id); }
  for (const item of canvas.items) {
    let el = itemEls.get(item.id);
    if (!el) {
      const def = typeDef(item.type);
      el = document.createElement("div"); el.className = "item"; el.dataset.id = item.id;
      const img = document.createElement("img"); img.src = def.src; img.alt = def.label; img.draggable = false;
      el.appendChild(img); el.addEventListener("pointerdown", onItemPointerDown); boardEl.appendChild(el); itemEls.set(item.id, el);
    }
    applyItemStyle(el, item);
  }
}
function render() {
  const canvas = activeCanvas();
  boardImgEl.src = canvas.src; boardImgEl.alt = canvas.label;
  canvasTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.canvas === canvas.id));
  syncDom(); updatePanel();
}
function commit() { render(); save(); }
function addItem(type, overrides = {}) {
  const canvas = activeCanvas();
  if (!canvas.allowedTypes.includes(type)) return;
  const def = typeDef(type);
  const item = { id: makeId(type), type, x: canvas.width / 2, y: canvas.height / 2, rotation: 0, scale: def.defaultScale, ...overrides };
  canvas.items.push(item); canvas.selectedId = item.id; commit(); return item;
}
function duplicateItem(id) {
  const canvas = activeCanvas(); const item = canvas.items.find((entry) => entry.id === id);
  if (!item) return;
  addItem(item.type, { x: clamp(item.x + 20, 0, canvas.width), y: clamp(item.y + 20, 0, canvas.height), rotation: item.rotation, scale: item.scale });
}
function deleteItem(id) {
  const canvas = activeCanvas(); canvas.items = canvas.items.filter((item) => item.id !== id);
  if (canvas.selectedId === id) canvas.selectedId = null;
  commit();
}
function switchCanvas(id) {
  if (id === state.activeCanvasId) return;
  dragging = null; state.activeCanvasId = id; fitBoard(); render();
}
function onItemPointerDown(event) {
  if (event.button !== 0) return;
  event.preventDefault(); event.stopPropagation();
  const canvas = activeCanvas(); const item = canvas.items.find((entry) => entry.id === event.currentTarget.dataset.id);
  if (!item) return;
  canvas.selectedId = item.id;
  const point = clientToCanvas(event.clientX, event.clientY);
  dragging = { id: item.id, offsetX: item.x - point.x, offsetY: item.y - point.y };
  event.currentTarget.setPointerCapture(event.pointerId); render();
}

boardEl.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const canvas = activeCanvas(); const item = canvas.items.find((entry) => entry.id === dragging.id);
  if (!item) return;
  const point = clientToCanvas(event.clientX, event.clientY);
  item.x = clamp(point.x + dragging.offsetX, 0, canvas.width); item.y = clamp(point.y + dragging.offsetY, 0, canvas.height);
  const el = itemEls.get(item.id); if (el) applyItemStyle(el, item); updatePanel();
});
["pointerup", "pointercancel"].forEach((eventName) => boardEl.addEventListener(eventName, () => {
  if (!dragging) return; dragging = null; commit();
}));
boardEl.addEventListener("pointerdown", (event) => {
  if (event.target === boardEl || event.target.id === "board-img") { activeCanvas().selectedId = null; render(); }
});
function bindNumberInput(el, key, digits) {
  el.addEventListener("input", () => {
    const item = selectedItem(); if (!item) return;
    const canvas = activeCanvas(); const value = Number(el.value); if (Number.isNaN(value)) return;
    if (key === "x") item.x = clamp(value, 0, canvas.width);
    else if (key === "y") item.y = clamp(value, 0, canvas.height);
    else if (key === "scale") item.scale = Math.max(0.01, value);
    else item[key] = value;
    const itemEl = itemEls.get(item.id); if (itemEl) applyItemStyle(itemEl, item); save();
  });
  el.addEventListener("change", () => { const item = selectedItem(); if (!item) return; item[key] = round(item[key], digits); commit(); });
}
bindNumberInput(inputX, "x", 2); bindNumberInput(inputY, "y", 2); bindNumberInput(inputRotation, "rotation", 2); bindNumberInput(inputScale, "scale", 4);
canvasTabs.forEach((tab) => tab.addEventListener("click", () => switchCanvas(tab.dataset.canvas)));
addShareButton.addEventListener("click", () => addItem("jade_share"));
document.getElementById("btn-add-player").addEventListener("click", () => addItem("player_red"));
document.getElementById("btn-duplicate").addEventListener("click", () => { const item = selectedItem(); if (item) duplicateItem(item.id); });
document.getElementById("btn-delete").addEventListener("click", () => { const item = selectedItem(); if (item) deleteItem(item.id); });
document.getElementById("btn-clear").addEventListener("click", () => { activeCanvas().items = []; activeCanvas().selectedId = null; commit(); });
document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([toJson()], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = "board-and-shares-annotations.json"; a.click(); URL.revokeObjectURL(url);
});
document.getElementById("btn-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(toJson()); } catch (err) { console.warn("Clipboard copy failed", err); } });
document.getElementById("btn-import").addEventListener("click", () => fileImport.click());
fileImport.addEventListener("change", async () => {
  const file = fileImport.files?.[0]; fileImport.value = ""; if (!file) return;
  try { applyData(JSON.parse(await file.text())); commit(); } catch (err) { alert("Invalid JSON"); console.warn(err); }
});
function isTypingTarget(el) { return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA"); }
window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  const item = selectedItem(); if (!item) return;
  const canvas = activeCanvas(); const move = event.shiftKey ? 10 : 1; const rotate = event.shiftKey ? 5 : 1;
  if (event.key === "ArrowLeft") item.x = clamp(item.x - move, 0, canvas.width);
  else if (event.key === "ArrowRight") item.x = clamp(item.x + move, 0, canvas.width);
  else if (event.key === "ArrowUp") item.y = clamp(item.y - move, 0, canvas.height);
  else if (event.key === "ArrowDown") item.y = clamp(item.y + move, 0, canvas.height);
  else if (event.key === "q" || event.key === "Q") item.rotation -= rotate;
  else if (event.key === "e" || event.key === "E") item.rotation += rotate;
  else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteItem(item.id); return; }
  else if ((event.ctrlKey || event.metaKey) && (event.key === "d" || event.key === "D")) { event.preventDefault(); duplicateItem(item.id); return; }
  else return;
  event.preventDefault(); commit();
});
new ResizeObserver(fitBoard).observe(stageEl);
fitBoard(); load(); render();

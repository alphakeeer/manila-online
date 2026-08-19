const BOARD_WIDTH = 1043;
const BOARD_HEIGHT = 2048;
const STORAGE_KEY = "manila-board-annotator";

const TYPES = {
  jade_share: {
    src: "../manila_assets/jade_shares.png",
    width: 221,
    height: 568,
    defaultScale: 1,
    idPrefix: "share",
    label: "Jade Share",
  },
  player_red: {
    src: "../manila_assets/player_red.png",
    width: 1254,
    height: 1254,
    defaultScale: 0.07,
    idPrefix: "player",
    label: "Player Red",
  },
};

const stageEl = document.getElementById("stage");
const boardEl = document.getElementById("board");
const inputX = document.getElementById("input-x");
const inputY = document.getElementById("input-y");
const inputRotation = document.getElementById("input-rotation");
const inputScale = document.getElementById("input-scale");
const selectedTypeEl = document.getElementById("selected-type");
const fileImport = document.getElementById("file-import");

const state = {
  items: [],
  selectedId: null,
  nextId: 1,
};

let dragging = null;
const itemEls = new Map();

function round(n, digits) {
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function typeDef(type) {
  return TYPES[type] || TYPES.jade_share;
}

function getBoardRect() {
  return boardEl.getBoundingClientRect();
}

function clientToBoard(clientX, clientY) {
  const rect = getBoardRect();
  return {
    x: ((clientX - rect.left) / rect.width) * BOARD_WIDTH,
    y: ((clientY - rect.top) / rect.height) * BOARD_HEIGHT,
  };
}

function fitBoard() {
  const pad = 24;
  const availW = Math.max(0, stageEl.clientWidth - pad);
  const availH = Math.max(0, stageEl.clientHeight - pad);
  const scale = Math.min(availW / BOARD_WIDTH, availH / BOARD_HEIGHT);
  boardEl.style.width = `${BOARD_WIDTH * scale}px`;
  boardEl.style.height = `${BOARD_HEIGHT * scale}px`;
}

function serialize() {
  return {
    board: { width: BOARD_WIDTH, height: BOARD_HEIGHT },
    items: state.items.map((item) => ({
      id: item.id,
      type: item.type,
      x: round(item.x, 2),
      y: round(item.y, 2),
      rotation: round(item.rotation, 2),
      scale: round(item.scale, 4),
    })),
  };
}

function toJson() {
  return JSON.stringify(serialize(), null, 2);
}

function parseIdNumber(id) {
  const match = /-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function applyData(data) {
  const items = Array.isArray(data && data.items) ? data.items : [];
  state.items = items.map((item, index) => {
    const type = TYPES[item.type] ? item.type : "jade_share";
    const def = typeDef(type);
    return {
      id: typeof item.id === "string" ? item.id : `${def.idPrefix}-${index + 1}`,
      type,
      x: Number(item.x),
      y: Number(item.y),
      rotation: Number(item.rotation) || 0,
      scale: Number(item.scale) || def.defaultScale,
    };
  });
  state.nextId = state.items.reduce((max, item) => {
    return Math.max(max, parseIdNumber(item.id) + 1);
  }, 1);
  if (!state.items.some((item) => item.id === state.selectedId)) {
    state.selectedId = null;
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, toJson());
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    applyData(JSON.parse(raw));
  } catch (err) {
    console.warn("Failed to load saved state", err);
  }
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedId) || null;
}

function makeId(type) {
  return `${typeDef(type).idPrefix}-${state.nextId++}`;
}

function itemStyle(item) {
  const def = typeDef(item.type);
  return {
    left: `${(item.x / BOARD_WIDTH) * 100}%`,
    top: `${(item.y / BOARD_HEIGHT) * 100}%`,
    width: `${(def.width / BOARD_WIDTH) * 100}%`,
    height: `${(def.height / BOARD_HEIGHT) * 100}%`,
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})`,
  };
}

function applyItemStyle(el, item) {
  const style = itemStyle(item);
  el.style.left = style.left;
  el.style.top = style.top;
  el.style.width = style.width;
  el.style.height = style.height;
  el.style.transform = style.transform;
  el.classList.toggle("selected", item.id === state.selectedId);
  el.classList.toggle("dragging", dragging && dragging.id === item.id);
}

function updatePanel() {
  const item = selectedItem();
  const enabled = Boolean(item);
  inputX.disabled = !enabled;
  inputY.disabled = !enabled;
  inputRotation.disabled = !enabled;
  inputScale.disabled = !enabled;
  document.getElementById("btn-duplicate").disabled = !enabled;
  document.getElementById("btn-delete").disabled = !enabled;
  if (!item) {
    selectedTypeEl.textContent = "未选中";
    inputX.value = "";
    inputY.value = "";
    inputRotation.value = "";
    inputScale.value = "";
    return;
  }
  selectedTypeEl.textContent = `${typeDef(item.type).label} · ${item.id}`;
  inputX.value = round(item.x, 2);
  inputY.value = round(item.y, 2);
  inputRotation.value = round(item.rotation, 2);
  inputScale.value = round(item.scale, 4);
}

function syncDom() {
  const ids = new Set(state.items.map((item) => item.id));
  for (const [id, el] of itemEls) {
    if (!ids.has(id)) {
      el.remove();
      itemEls.delete(id);
    }
  }
  for (const item of state.items) {
    let el = itemEls.get(item.id);
    if (!el) {
      const def = typeDef(item.type);
      el = document.createElement("div");
      el.className = "item";
      el.dataset.id = item.id;
      const img = document.createElement("img");
      img.src = def.src;
      img.alt = def.label;
      img.draggable = false;
      el.appendChild(img);
      el.addEventListener("pointerdown", onItemPointerDown);
      boardEl.appendChild(el);
      itemEls.set(item.id, el);
    }
    applyItemStyle(el, item);
  }
}

function render() {
  syncDom();
  updatePanel();
}

function commit() {
  render();
  save();
}

function addItem(type, overrides) {
  const def = typeDef(type);
  const item = {
    id: makeId(type),
    type,
    x: BOARD_WIDTH / 2,
    y: BOARD_HEIGHT / 2,
    rotation: 0,
    scale: def.defaultScale,
    ...overrides,
  };
  state.items.push(item);
  state.selectedId = item.id;
  commit();
  return item;
}

function duplicateItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  addItem(item.type, {
    x: clamp(item.x + 20, 0, BOARD_WIDTH),
    y: clamp(item.y + 20, 0, BOARD_HEIGHT),
    rotation: item.rotation,
    scale: item.scale,
  });
}

function deleteItem(id) {
  state.items = state.items.filter((item) => item.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  commit();
}

function onItemPointerDown(event) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget.dataset.id;
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  state.selectedId = id;
  const point = clientToBoard(event.clientX, event.clientY);
  dragging = {
    id,
    offsetX: item.x - point.x,
    offsetY: item.y - point.y,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  render();
}

boardEl.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const item = state.items.find((entry) => entry.id === dragging.id);
  if (!item) return;
  const point = clientToBoard(event.clientX, event.clientY);
  item.x = clamp(point.x + dragging.offsetX, 0, BOARD_WIDTH);
  item.y = clamp(point.y + dragging.offsetY, 0, BOARD_HEIGHT);
  const el = itemEls.get(item.id);
  if (el) applyItemStyle(el, item);
  updatePanel();
});

boardEl.addEventListener("pointerup", () => {
  if (!dragging) return;
  dragging = null;
  commit();
});

boardEl.addEventListener("pointercancel", () => {
  if (!dragging) return;
  dragging = null;
  commit();
});

boardEl.addEventListener("pointerdown", (event) => {
  if (event.target === boardEl || event.target.id === "board-img") {
    state.selectedId = null;
    render();
  }
});

function bindNumberInput(el, key, digits) {
  el.addEventListener("input", () => {
    const item = selectedItem();
    if (!item) return;
    const value = Number(el.value);
    if (Number.isNaN(value)) return;
    if (key === "x") item.x = clamp(value, 0, BOARD_WIDTH);
    else if (key === "y") item.y = clamp(value, 0, BOARD_HEIGHT);
    else if (key === "scale") item.scale = Math.max(0.01, value);
    else item[key] = value;
    const itemEl = itemEls.get(item.id);
    if (itemEl) applyItemStyle(itemEl, item);
    save();
  });
  el.addEventListener("change", () => {
    const item = selectedItem();
    if (!item) return;
    item[key] = round(item[key], digits);
    commit();
  });
}

bindNumberInput(inputX, "x", 2);
bindNumberInput(inputY, "y", 2);
bindNumberInput(inputRotation, "rotation", 2);
bindNumberInput(inputScale, "scale", 4);

document.getElementById("btn-add-share").addEventListener("click", () => {
  addItem("jade_share");
});
document.getElementById("btn-add-player").addEventListener("click", () => {
  addItem("player_red");
});
document.getElementById("btn-duplicate").addEventListener("click", () => {
  if (state.selectedId) duplicateItem(state.selectedId);
});
document.getElementById("btn-delete").addEventListener("click", () => {
  if (state.selectedId) deleteItem(state.selectedId);
});
document.getElementById("btn-clear").addEventListener("click", () => {
  state.items = [];
  state.selectedId = null;
  commit();
});

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([toJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "board-annotations.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(toJson());
  } catch (err) {
    console.warn("Clipboard copy failed", err);
  }
});

document.getElementById("btn-import").addEventListener("click", () => {
  fileImport.click();
});

fileImport.addEventListener("change", async () => {
  const file = fileImport.files && fileImport.files[0];
  fileImport.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    applyData(data);
    commit();
  } catch (err) {
    alert("Invalid JSON");
    console.warn(err);
  }
});

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

window.addEventListener("keydown", (event) => {
  if (isTypingTarget(event.target)) return;
  const item = selectedItem();
  if (!item) return;

  const key = event.key;
  const shift = event.shiftKey;
  const move = shift ? 10 : 1;
  const rotate = shift ? 5 : 1;

  if (key === "ArrowLeft") {
    event.preventDefault();
    item.x = clamp(item.x - move, 0, BOARD_WIDTH);
  } else if (key === "ArrowRight") {
    event.preventDefault();
    item.x = clamp(item.x + move, 0, BOARD_WIDTH);
  } else if (key === "ArrowUp") {
    event.preventDefault();
    item.y = clamp(item.y - move, 0, BOARD_HEIGHT);
  } else if (key === "ArrowDown") {
    event.preventDefault();
    item.y = clamp(item.y + move, 0, BOARD_HEIGHT);
  } else if (key === "q" || key === "Q") {
    event.preventDefault();
    item.rotation -= rotate;
  } else if (key === "e" || key === "E") {
    event.preventDefault();
    item.rotation += rotate;
  } else if (key === "Delete" || key === "Backspace") {
    event.preventDefault();
    deleteItem(item.id);
    return;
  } else if ((event.ctrlKey || event.metaKey) && (key === "d" || key === "D")) {
    event.preventDefault();
    duplicateItem(item.id);
    return;
  } else {
    return;
  }
  commit();
});

new ResizeObserver(fitBoard).observe(stageEl);
fitBoard();
load();
render();

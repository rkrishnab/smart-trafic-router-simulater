
/* ---------- Grid graph setup ---------- */
const ROWS = 6, COLS = 8;
const canvas = document.getElementById('grid');
const ctx = canvas.getContext('2d');
const PAD = 50;
const cellW = (canvas.width - PAD * 2) / (COLS - 1);
const cellH = (canvas.height - PAD * 2) / (ROWS - 1);

const nodeId = (r, c) => r * COLS + c;
const nodePos = (r, c) => ({ x: PAD + c * cellW, y: PAD + r * cellH });

let nodes = [];
let edges = []; // {a, b, weight, blocked}
let edgeMap = new Map(); // "a-b" -> edge

function edgeKey(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }

function buildGrid() {
  nodes = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      nodes.push({ id: nodeId(r, c), r, c, ...nodePos(r, c), signal: 'idle' });
    }
  }
  edges = [];
  edgeMap.clear();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = nodeId(r, c);
      if (c < COLS - 1) addEdge(a, nodeId(r, c + 1));
      if (r < ROWS - 1) addEdge(a, nodeId(r + 1, c));
    }
  }
}

function addEdge(a, b) {
  const weight = 2 + Math.floor(Math.random() * 8); // travel time in minutes, 2..9
  const e = { a, b, weight, blocked: false, remainingMin: null };
  edges.push(e);
  edgeMap.set(edgeKey(a, b), e);
}

// Simulated pace: 1 real second = 1 simulated minute of clearance time.
function randomClearMinutes() { return 8 + Math.floor(Math.random() * 13); } // 8..20 min

const SOURCE = nodeId(0, 0);
const DEST = nodeId(ROWS - 1, COLS - 1);

/* ---------- Dijkstra ---------- */
function dijkstraFrom(startId) {
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  const visited = new Array(nodes.length).fill(false);
  dist[startId] = 0;

  const adj = new Map();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    if (e.blocked) return;
    adj.get(e.a).push({ to: e.b, w: e.weight });
    adj.get(e.b).push({ to: e.a, w: e.weight });
  });

  for (let i = 0; i < nodes.length; i++) {
    let u = -1, best = Infinity;
    for (let n = 0; n < nodes.length; n++) {
      if (!visited[n] && dist[n] < best) { best = dist[n]; u = n; }
    }
    if (u === -1) break;
    visited[u] = true;
    for (const { to, w } of adj.get(u)) {
      if (dist[u] + w < dist[to]) {
        dist[to] = dist[u] + w;
        prev[to] = u;
      }
    }
  }
  return { dist, prev };
}

function pathFrom(startId) {
  const { dist, prev } = dijkstraFrom(startId);
  if (dist[DEST] === Infinity) return { path: [], total: Infinity };
  const path = [];
  let cur = DEST;
  while (cur !== -1) { path.unshift(cur); cur = prev[cur]; }
  return { path, total: dist[DEST] };
}

function shortestPath() { return pathFrom(SOURCE); }

/* ---------- State ---------- */
let current = { path: [], total: Infinity };
let previousTotal = Infinity;
let dashOffset = 0;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let mode = 'standard'; // 'standard' | 'emergency'
let dispatchActive = false;
let dispatchPath = [];
let vehiclePos = null; // {x, y} while transiting
let dispatchFinished = false;
let dispatchSegStart = [];
let dispatchStartTime = 0;
let dispatchTotalMs = 0;
let dispatchBaselineMin = 0;
let dispatchSegIdx = 0;
let dispatchLoggedNodes = new Set();
let currentYieldEdges = new Set();
let animating = false;

const TARGET_TRIP_MS = 7000; // any route animates in roughly this long, regardless of length
let dispatchMsPerMin = 300;
const GREEN_LEAD_MS = 500; // signal turns green this long before the vehicle arrives
const GREEN_TAIL_MS = 350; // and stays green this long after it passes

/* ---------- Rendering ---------- */
function pathEdgeSet(path) {
  const s = new Set();
  for (let i = 0; i < path.length - 1; i++) s.add(edgeKey(path[i], path[i + 1]));
  return s;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const onPath = pathEdgeSet(current.path);
  const onCorridor = mode === 'emergency' ? pathEdgeSet(dispatchPath) : new Set();

  // roads
  edges.forEach(e => {
    const na = nodes[e.a], nb = nodes[e.b];
    const key = edgeKey(e.a, e.b);
    ctx.beginPath();
    ctx.moveTo(na.x, na.y);
    ctx.lineTo(nb.x, nb.y);

    if (e.blocked) {
      ctx.strokeStyle = getVar('--road-blocked');
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 3;
    } else if (onCorridor.has(key)) {
      ctx.strokeStyle = getVar('--corridor');
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = reduceMotion ? 0 : -dashOffset;
      ctx.lineWidth = 5;
    } else if (mode === 'standard' && onPath.has(key)) {
      ctx.strokeStyle = getVar('--path');
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = reduceMotion ? 0 : -dashOffset;
      ctx.lineWidth = 5;
    } else if (mode === 'emergency' && currentYieldEdges.has(key)) {
      ctx.strokeStyle = getVar('--yield');
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = getVar('--road');
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // weight label
    const mx = (na.x + nb.x) / 2, my = (na.y + nb.y) / 2;
    ctx.fillStyle = e.blocked ? getVar('--road-blocked') : getVar('--text-dim');
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(e.weight + 'm', mx, my - 4);
  });

  // nodes
  nodes.forEach(n => {
    let r = 5, fill = '#3a4757';
    if (n.id === SOURCE) { r = 8; fill = getVar('--source'); }
    if (n.id === DEST) { r = 8; fill = getVar('--dest'); }
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    // signal preemption ring
    if (mode === 'emergency' && n.signal === 'green') {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = getVar('--source');
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  // S / D labels
  ctx.font = 'bold 11px Space Grotesk, sans-serif';
  ctx.fillStyle = getVar('--source');
  ctx.fillText('S', nodes[SOURCE].x, nodes[SOURCE].y - 14);
  ctx.fillStyle = getVar('--dest');
  ctx.fillText('D', nodes[DEST].x, nodes[DEST].y - 14);

  // emergency vehicle marker
  if (mode === 'emergency' && vehiclePos) {
    ctx.beginPath();
    ctx.arc(vehiclePos.x, vehiclePos.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = getVar('--corridor');
    ctx.fill();
    ctx.beginPath();
    ctx.arc(vehiclePos.x, vehiclePos.y, 11, 0, Math.PI * 2);
    ctx.strokeStyle = getVar('--corridor');
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function getVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function animate(now) {
  animating = true;
  if (!reduceMotion) dashOffset = (dashOffset + 0.6) % 18;
  if (dispatchActive) updateVehicle(now || performance.now());
  draw();
  if (!reduceMotion || dispatchActive) {
    requestAnimationFrame(animate);
  } else {
    animating = false;
  }
}
function ensureAnimating() { if (!animating) requestAnimationFrame(animate); }

/* ---------- UI wiring ---------- */
const etaValue = document.getElementById('eta-value');
const etaDelta = document.getElementById('eta-delta');
const pathValue = document.getElementById('path-value');
const blockedCount = document.getElementById('blocked-count');
const eventLog = document.getElementById('event-log');
const clearingList = document.getElementById('clearing-list');
const btnDispatch = document.getElementById('btn-dispatch');
const dispatchBlock = document.getElementById('dispatch-block');
const dispatchStatus = document.getElementById('dispatch-status');
const dispatchSaved = document.getElementById('dispatch-saved');
const modeStandardBtn = document.getElementById('mode-standard');
const modeEmergencyBtn = document.getElementById('mode-emergency');

function logEvent(text, cls) {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  eventLog.appendChild(li);
  while (eventLog.children.length > 30) eventLog.removeChild(eventLog.firstChild);
}

function refreshConsole() {
  const { path, total } = current;
  etaValue.innerHTML = (total === Infinity ? 'N/A' : total) + ' <span class="unit">min</span>';
  pathValue.textContent = path.length ? path.map(id => `${nodes[id].r},${nodes[id].c}`).join(' → ') : 'No route available';
  blockedCount.textContent = edges.filter(e => e.blocked).length;

  if (previousTotal !== total) {
    if (total === Infinity) logEvent('ROUTE LOST — destination unreachable', 'warn');
    else if (total > previousTotal) logEvent(`REROUTED — ETA +${total - previousTotal} min`, 'warn');
    else if (previousTotal !== current.total) logEvent(`REROUTED — ETA ${total} min`, 'ok');
    etaDelta.textContent = previousTotal !== Infinity && total !== Infinity
      ? (total > previousTotal ? `+${total - previousTotal} min vs last route` : 'route improved')
      : '';
    previousTotal = total;
  }
  renderClearingList();
}

function renderClearingList() {
  const pending = edges.filter(e => e.blocked && e.remainingMin != null);
  if (!pending.length) {
    clearingList.innerHTML = '<li class="empty">No active closures</li>';
    return;
  }
  clearingList.innerHTML = pending
    .map(e => `<li>(${nodes[e.a].r},${nodes[e.a].c})–(${nodes[e.b].r},${nodes[e.b].c}) <span class="count">clears in ${e.remainingMin}m</span></li>`)
    .join('');
}

// Ticks every simulated minute (1 real second) — counts closures down and
// auto-reopens them, since real congestion doesn't stay blocked forever.
setInterval(() => {
  let changed = false;
  edges.forEach(e => {
    if (e.blocked && e.remainingMin != null) {
      e.remainingMin -= 1;
      if (e.remainingMin <= 0) {
        e.blocked = false;
        e.remainingMin = null;
        logEvent(`AUTO-CLEARED — road (${nodes[e.a].r},${nodes[e.a].c})–(${nodes[e.b].r},${nodes[e.b].c}) reopened`, 'ok');
        changed = true;
      }
    }
  });
  if (changed) recompute();
  else renderClearingList();
  if (dispatchActive) updateDispatchPanel(performance.now() - dispatchStartTime);
}, 1000);

function recompute() {
  current = shortestPath();
  refreshConsole();
  draw();
}

/* ---------- Emergency dispatch ---------- */
function buildSegTimings(path, elapsedOffsetMs) {
  const segStart = [elapsedOffsetMs];
  for (let i = 0; i < path.length - 1; i++) {
    const e = edgeMap.get(edgeKey(path[i], path[i + 1]));
    segStart.push(segStart[i] + e.weight * dispatchMsPerMin);
  }
  return segStart;
}

function startDispatch() {
  if (dispatchActive) return;
  const result = shortestPath();
  if (!result.path.length) {
    logEvent('DISPATCH FAILED — no clear corridor to destination', 'warn');
    return;
  }
  dispatchPath = result.path;
  dispatchBaselineMin = result.total;
  dispatchMsPerMin = Math.max(150, Math.min(500, TARGET_TRIP_MS / Math.max(1, dispatchBaselineMin)));
  dispatchSegStart = buildSegTimings(dispatchPath, 0);
  dispatchTotalMs = dispatchSegStart[dispatchSegStart.length - 1];
  dispatchStartTime = performance.now();
  dispatchSegIdx = 0;
  dispatchLoggedNodes = new Set();
  dispatchFinished = false;
  dispatchActive = true;
  nodes.forEach(n => { n.signal = 'idle'; });
  currentYieldEdges = new Set();
  vehiclePos = { x: nodes[dispatchPath[0]].x, y: nodes[dispatchPath[0]].y };
  logEvent(`EMERGENCY DISPATCHED — priority corridor locked, ETA ${dispatchBaselineMin} min`, 'ok');
  updateDispatchPanel(0);
  btnDispatch.disabled = true;
  ensureAnimating();
}

function updateVehicle(now) {
  if (!dispatchActive || dispatchFinished) return;
  const elapsed = now - dispatchStartTime;

  if (elapsed >= dispatchTotalMs) {
    const lastId = dispatchPath[dispatchPath.length - 1];
    vehiclePos = { x: nodes[lastId].x, y: nodes[lastId].y };
    finishDispatch();
    return;
  }

  let i = dispatchSegIdx;
  while (i < dispatchSegStart.length - 2 && elapsed >= dispatchSegStart[i + 1]) i++;
  dispatchSegIdx = i;

  const remainingBlocked = dispatchPath.slice(i).some((id, idx, arr) => {
    if (idx === arr.length - 1) return false;
    return edgeMap.get(edgeKey(arr[idx], arr[idx + 1])).blocked;
  });
  if (remainingBlocked) {
    rerouteDispatch(dispatchPath[i], elapsed);
    return;
  }

  const segA = dispatchPath[i], segB = dispatchPath[i + 1];
  const segDur = dispatchSegStart[i + 1] - dispatchSegStart[i];
  const t = segDur > 0 ? (elapsed - dispatchSegStart[i]) / segDur : 1;
  const na = nodes[segA], nb = nodes[segB];
  vehiclePos = { x: na.x + (nb.x - na.x) * t, y: na.y + (nb.y - na.y) * t };

  updateSignals(elapsed);
  updateDispatchPanel(elapsed);
}

function rerouteDispatch(fromNodeId, elapsedAtReroute) {
  const result = pathFrom(fromNodeId);
  const label = `(${nodes[fromNodeId].r},${nodes[fromNodeId].c})`;
  if (!result.path.length) {
    logEvent(`DISPATCH STALLED — corridor blocked, no route from ${label}`, 'warn');
    dispatchActive = false;
    btnDispatch.disabled = false;
    return;
  }
  dispatchPath = result.path;
  dispatchSegStart = buildSegTimings(dispatchPath, elapsedAtReroute);
  dispatchTotalMs = dispatchSegStart[dispatchSegStart.length - 1];
  dispatchSegIdx = 0;
  logEvent(`REROUTED EN ROUTE — corridor blocked, new path from ${label}`, 'warn');
}

function updateSignals(elapsed) {
  nodes.forEach(n => { n.signal = 'idle'; });
  const corridorEdges = pathEdgeSet(dispatchPath);
  const yieldEdges = new Set();
  dispatchPath.forEach((id, idx) => {
    const arrival = dispatchSegStart[idx];
    if (elapsed >= arrival - GREEN_LEAD_MS && elapsed <= arrival + GREEN_TAIL_MS) {
      nodes[id].signal = 'green';
      const crossRoads = edges.filter(e => (e.a === id || e.b === id) && !corridorEdges.has(edgeKey(e.a, e.b)));
      crossRoads.forEach(e => yieldEdges.add(edgeKey(e.a, e.b)));
      if (!dispatchLoggedNodes.has(id)) {
        dispatchLoggedNodes.add(id);
        logEvent(`SIGNAL SYNC — (${nodes[id].r},${nodes[id].c}) green-waved for corridor`, 'ok');
        if (crossRoads.length) {
          logEvent(`CORRIDOR CLEARED — ${crossRoads.length} cross-road(s) yielding at (${nodes[id].r},${nodes[id].c})`, null);
        }
      }
    }
  });
  currentYieldEdges = yieldEdges;
}

function finishDispatch() {
  dispatchFinished = true;
  dispatchActive = false;
  btnDispatch.disabled = false;
  const savedMin = Math.max(1, Math.round(dispatchBaselineMin * 0.18));
  logEvent(`EMERGENCY ARRIVED — ${dispatchBaselineMin} min transit, ~${savedMin} min saved vs signal-timed route`, 'ok');
  updateDispatchPanel(dispatchTotalMs);
  nodes.forEach(n => { n.signal = 'idle'; });
  currentYieldEdges = new Set();
  setTimeout(() => {
    if (dispatchFinished) {
      dispatchPath = [];
      vehiclePos = null;
      dispatchFinished = false;
      updateDispatchPanel(0);
      draw();
    }
  }, 3000);
}

function updateDispatchPanel(elapsed) {
  if (dispatchActive) {
    const remainMin = Math.max(0, Math.ceil((dispatchTotalMs - elapsed) / dispatchMsPerMin));
    dispatchStatus.textContent = `EN ROUTE — ${remainMin} min to destination`;
    dispatchStatus.className = 'mono-line warn';
    dispatchSaved.textContent = '';
  } else if (dispatchFinished) {
    dispatchStatus.textContent = 'ARRIVED';
    dispatchStatus.className = 'mono-line ok';
    dispatchSaved.textContent = `~${Math.max(1, Math.round(dispatchBaselineMin * 0.18))} min saved vs standard signals`;
  } else {
    dispatchStatus.textContent = 'Idle';
    dispatchStatus.className = 'mono-line';
    dispatchSaved.textContent = '';
  }
}

function setMode(next) {
  mode = next;
  modeStandardBtn.classList.toggle('active', mode === 'standard');
  modeEmergencyBtn.classList.toggle('active', mode === 'emergency');
  dispatchBlock.classList.toggle('visible', mode === 'emergency');
  draw();
}

modeStandardBtn.addEventListener('click', () => setMode('standard'));
modeEmergencyBtn.addEventListener('click', () => setMode('emergency'));
btnDispatch.addEventListener('click', startDispatch);

canvas.addEventListener('click', (evt) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (evt.clientX - rect.left) * scaleX;
  const y = (evt.clientY - rect.top) * scaleY;

  let closest = null, closestDist = 14; // px hit-tolerance
  edges.forEach(e => {
    const na = nodes[e.a], nb = nodes[e.b];
    const d = pointToSegmentDist(x, y, na.x, na.y, nb.x, nb.y);
    if (d < closestDist) { closestDist = d; closest = e; }
  });

  if (closest) {
    closest.blocked = !closest.blocked;
    const label = `(${nodes[closest.a].r},${nodes[closest.a].c})–(${nodes[closest.b].r},${nodes[closest.b].c})`;
    if (closest.blocked) {
      closest.remainingMin = randomClearMinutes();
      logEvent(`CLOSED road ${label} — est. clear in ${closest.remainingMin}m`, 'warn');
    } else {
      closest.remainingMin = null;
      logEvent(`REOPENED road ${label} (manual)`, 'ok');
    }
    recompute();
  }
});

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

document.getElementById('btn-randomize').addEventListener('click', () => {
  edges.forEach(e => { e.weight = 2 + Math.floor(Math.random() * 8); });
  logEvent('Traffic conditions randomized', null);
  recompute();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  edges.forEach(e => { e.blocked = false; e.remainingMin = null; });
  logEvent('All closures cleared', 'ok');
  recompute();
});

/* ---------- Init ---------- */
buildGrid();
current = shortestPath();
previousTotal = current.total;
logEvent('System online. Route computed.', 'ok');
refreshConsole();
draw();
requestAnimationFrame(animate);

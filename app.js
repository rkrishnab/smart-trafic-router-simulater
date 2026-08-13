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
      nodes.push({ id: nodeId(r, c), r, c, ...nodePos(r, c) });
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
  const weight = 2 + Math.floor(Math.random() * 8); // 2..9
  const e = { a, b, weight, blocked: false };
  edges.push(e);
  edgeMap.set(edgeKey(a, b), e);
}

const SOURCE = nodeId(0, 0);
const DEST = nodeId(ROWS - 1, COLS - 1);

/* ---------- Dijkstra ---------- */
function shortestPath() {
  const dist = new Array(nodes.length).fill(Infinity);
  const prev = new Array(nodes.length).fill(-1);
  const visited = new Array(nodes.length).fill(false);
  dist[SOURCE] = 0;

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

  if (dist[DEST] === Infinity) return { path: [], total: Infinity };
  const path = [];
  let cur = DEST;
  while (cur !== -1) { path.unshift(cur); cur = prev[cur]; }
  return { path, total: dist[DEST] };
}

/* ---------- State ---------- */
let current = { path: [], total: Infinity };
let previousTotal = Infinity;
let dashOffset = 0;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Rendering ---------- */
function pathEdgeSet(path) {
  const s = new Set();
  for (let i = 0; i < path.length - 1; i++) s.add(edgeKey(path[i], path[i + 1]));
  return s;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const onPath = pathEdgeSet(current.path);

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
    } else if (onPath.has(key)) {
      ctx.strokeStyle = getVar('--path');
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = reduceMotion ? 0 : -dashOffset;
      ctx.lineWidth = 5;
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
    ctx.fillText(e.weight, mx, my - 4);
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
  });

  // S / D labels
  ctx.font = 'bold 11px Space Grotesk, sans-serif';
  ctx.fillStyle = getVar('--source');
  ctx.fillText('S', nodes[SOURCE].x, nodes[SOURCE].y - 14);
  ctx.fillStyle = getVar('--dest');
  ctx.fillText('D', nodes[DEST].x, nodes[DEST].y - 14);
}

function getVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function animate() {
  if (!reduceMotion) {
    dashOffset = (dashOffset + 0.6) % 18;
    draw();
    requestAnimationFrame(animate);
  }
}

/* ---------- UI wiring ---------- */
const etaValue = document.getElementById('eta-value');
const etaDelta = document.getElementById('eta-delta');
const pathValue = document.getElementById('path-value');
const blockedCount = document.getElementById('blocked-count');
const eventLog = document.getElementById('event-log');

function logEvent(text, cls) {
  const li = document.createElement('li');
  li.textContent = text;
  if (cls) li.className = cls;
  eventLog.appendChild(li);
  while (eventLog.children.length > 30) eventLog.removeChild(eventLog.firstChild);
}

function refreshConsole() {
  const { path, total } = current;
  etaValue.innerHTML = (total === Infinity ? 'N/A' : total) + ' <span class="unit">units</span>';
  pathValue.textContent = path.length ? path.map(id => `${nodes[id].r},${nodes[id].c}`).join(' → ') : 'No route available';
  blockedCount.textContent = edges.filter(e => e.blocked).length;

  if (previousTotal !== total) {
    if (total === Infinity) logEvent('ROUTE LOST — destination unreachable', 'warn');
    else if (total > previousTotal) logEvent(`REROUTED — ETA +${total - previousTotal}`, 'warn');
    else if (previousTotal !== current.total) logEvent(`REROUTED — ETA ${total}`, 'ok');
    etaDelta.textContent = previousTotal !== Infinity && total !== Infinity
      ? (total > previousTotal ? `+${total - previousTotal} vs last route` : 'route improved')
      : '';
    previousTotal = total;
  }
}

function recompute() {
  current = shortestPath();
  refreshConsole();
  draw();
}

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
    logEvent(
      `${closest.blocked ? 'CLOSED' : 'REOPENED'} road (${nodes[closest.a].r},${nodes[closest.a].c})–(${nodes[closest.b].r},${nodes[closest.b].c})`,
      closest.blocked ? 'warn' : 'ok'
    );
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
  edges.forEach(e => { e.blocked = false; });
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
if (!reduceMotion) requestAnimationFrame(animate);

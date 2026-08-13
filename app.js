/**
 * Smart Traffic Reroute & Emergency Simulator
 * Mid-transit localized diversion & progress-aware ETA calculation
 */

const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const COLS = 5;
const ROWS = 4;
const PADDING = 60;
const SPACING_X = (canvas.width - PADDING * 2) / (COLS - 1);
const SPACING_Y = (canvas.height - PADDING * 2) / (ROWS - 1);

let nodes = [];
let edges = [];
let vehicle = null;
let rerouteCount = 0;
let isEmergency = false;

// --- GRAPH SETUP ---
function buildGraph() {
  nodes = [];
  edges = [];
  
  let id = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      nodes.push({ id, x: PADDING + c * SPACING_X, y: PADDING + r * SPACING_Y, row: r, col: c });
      id++;
    }
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let u = r * COLS + c;
      if (c < COLS - 1) edges.push({ u, v: r * COLS + (c + 1), weight: 1.0, blocked: false });
      if (r < ROWS - 1) edges.push({ u, v: (r + 1) * COLS + c, weight: 1.0, blocked: false });
    }
  }
}

function getEdge(u, v) {
  return edges.find(e => (e.u === u && e.v === v) || (e.u === v && e.v === u));
}

// --- DIJKSTRA SHORTEST PATH ---
function runDijkstra(startNodeId, targetNodeId) {
  let dist = {};
  let prev = {};
  let unvisited = new Set();

  nodes.forEach(n => {
    dist[n.id] = Infinity;
    prev[n.id] = null;
    unvisited.add(n.id);
  });

  dist[startNodeId] = 0;

  while (unvisited.size > 0) {
    let current = null;
    let minDist = Infinity;
    unvisited.forEach(id => {
      if (dist[id] < minDist) {
        minDist = dist[id];
        current = id;
      }
    });

    if (current === null || current === targetNodeId) break;
    unvisited.delete(current);

    edges.forEach(e => {
      if (e.blocked) return;
      let neighbor = null;
      if (e.u === current) neighbor = e.v;
      if (e.v === current) neighbor = e.u;

      if (neighbor !== null && unvisited.has(neighbor)) {
        let alt = dist[current] + e.weight;
        if (alt < dist[neighbor]) {
          dist[neighbor] = alt;
          prev[neighbor] = current;
        }
      }
    });
  }

  let path = [];
  let curr = targetNodeId;
  while (curr !== null) {
    path.unshift(curr);
    curr = prev[curr];
  }

  return (path.length > 0 && path[0] === startNodeId) ? path : null;
}

// --- VEHICLE & REROUTE ENGINE ---
function initVehicle() {
  const startId = 0;
  const targetId = nodes.length - 1;
  const path = runDijkstra(startId, targetId);

  vehicle = {
    path: path,
    pathIndex: 0,
    progress: 0, 
    speed: 0.008,
    targetId: targetId
  };
  rerouteCount = 0;
  isEmergency = false;
  updateUI();
  logEvent("Simulation started. Initial Route: " + path.join(" → "));
}

/**
 * FIXED: Localized Diversion Engine
 * Keeps already traversed nodes locked, diverts strictly from the next reachable intersection.
 */
function handleRoadBlockage(blockedEdge) {
  if (!vehicle || !vehicle.path || vehicle.pathIndex >= vehicle.path.length - 1) return;

  // Check if the blocked edge is on the vehicle's remaining path
  let blockedIndexInPath = -1;
  for (let i = vehicle.pathIndex; i < vehicle.path.length - 1; i++) {
    const u = vehicle.path[i];
    const v = vehicle.path[i + 1];
    if ((blockedEdge.u === u && blockedEdge.v === v) || (blockedEdge.u === v && blockedEdge.v === u)) {
      blockedIndexInPath = i;
      break;
    }
  }

  // If the blockage doesn't affect the active route, do nothing
  if (blockedIndexInPath === -1) return;

  logEvent(`⚠️ Road Blockage detected ahead between Node ${blockedEdge.u} ↔ Node ${blockedEdge.v}`);

  // Determine diversion anchor node:
  // If the current segment itself is blocked, divert from the node the vehicle is actively heading TOWARD.
  // Otherwise, divert from the start of the blocked segment.
  const diversionStartNode = vehicle.path[vehicle.pathIndex + 1];

  // Run Dijkstra ONLY from the diversion anchor to destination
  const detourPath = runDijkstra(diversionStartNode, vehicle.targetId);

  if (detourPath) {
    // Lock the already traveled part up to diversionStartNode
    const lockedPart = vehicle.path.slice(0, vehicle.pathIndex + 2);
    
    // Stitch locked nodes + new detour (excluding duplicate start node of detour)
    vehicle.path = lockedPart.concat(detourPath.slice(1));
    rerouteCount++;
    logEvent(`⚡ Diverted locally from Node ${diversionStartNode}! New path: ${vehicle.path.slice(vehicle.pathIndex).join(" → ")}`);
  } else {
    logEvent(`🚨 CRITICAL: No alternate path exists from Node ${diversionStartNode}! Vehicle stalled.`);
    vehicle.path = null;
  }

  updateUI();
}

// --- ETA CALCULATION ---
function calculateRemainingETA() {
  if (!vehicle || !vehicle.path) return "N/A";
  
  let remainingWeight = 0;
  const u = vehicle.path[vehicle.pathIndex];
  const v = vehicle.path[vehicle.pathIndex + 1];
  const currentEdge = getEdge(u, v);
  
  if (currentEdge) {
    remainingWeight += (1 - vehicle.progress) * currentEdge.weight;
  }

  for (let i = vehicle.pathIndex + 1; i < vehicle.path.length - 1; i++) {
    let edge = getEdge(vehicle.path[i], vehicle.path[i + 1]);
    if (edge) remainingWeight += edge.weight;
  }

  const baseSpeed = isEmergency ? vehicle.speed * 2 : vehicle.speed;
  const seconds = (remainingWeight / (baseSpeed * 60)).toFixed(1);
  return `${seconds} s`;
}

// --- RENDER LOOP ---
function update() {
  if (vehicle && vehicle.path && vehicle.pathIndex < vehicle.path.length - 1) {
    const activeSpeed = isEmergency ? vehicle.speed * 2 : vehicle.speed;
    vehicle.progress += activeSpeed;

    if (vehicle.progress >= 1) {
      vehicle.progress = 0;
      vehicle.pathIndex++;

      if (vehicle.pathIndex >= vehicle.path.length - 1) {
        logEvent("🎉 Destination reached!");
      }
    }
    document.getElementById('etaText').innerText = calculateRemainingETA();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw Roads
  edges.forEach(e => {
    const n1 = nodes[e.u];
    const n2 = nodes[e.v];
    ctx.beginPath();
    ctx.moveTo(n1.x, n1.y);
    ctx.lineTo(n2.x, n2.y);
    ctx.lineWidth = 6;
    ctx.strokeStyle = e.blocked ? '#ef4444' : '#334155';
    ctx.stroke();
  });

  // Highlight Current Path
  if (vehicle && vehicle.path) {
    ctx.beginPath();
    for (let i = vehicle.pathIndex; i < vehicle.path.length - 1; i++) {
      const n1 = nodes[vehicle.path[i]];
      const n2 = nodes[vehicle.path[i + 1]];
      ctx.moveTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = isEmergency ? '#f59e0b' : '#38bdf8';
    ctx.stroke();
  }

  // Draw Intersections
  nodes.forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = (n.id === 0) ? '#22c55e' : (n.id === nodes.length - 1) ? '#e11d48' : '#64748b';
    ctx.fill();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`N${n.id}`, n.x - 6, n.y - 12);
  });

  // Draw Vehicle
  if (vehicle && vehicle.path && vehicle.pathIndex < vehicle.path.length - 1) {
    const u = nodes[vehicle.path[vehicle.pathIndex]];
    const v = nodes[vehicle.path[vehicle.pathIndex + 1]];

    const currentX = u.x + (v.x - u.x) * vehicle.progress;
    const currentY = u.y + (v.y - u.y) * vehicle.progress;

    ctx.beginPath();
    ctx.arc(currentX, currentY, isEmergency ? 10 : 8, 0, Math.PI * 2);
    ctx.fillStyle = isEmergency ? '#ef4444' : '#38bdf8';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// --- CLICK INTERACTION ---
canvas.addEventListener('click', (evt) => {
  const rect = canvas.getBoundingClientRect();
  const clickX = evt.clientX - rect.left;
  const clickY = evt.clientY - rect.top;

  edges.forEach(e => {
    const n1 = nodes[e.u];
    const n2 = nodes[e.v];
    const distToSegment = distToSegmentSquared({ x: clickX, y: clickY }, n1, n2);

    if (distToSegment < 100) {
      e.blocked = !e.blocked;
      logEvent(`🚧 Road (Node ${e.u} ↔ Node ${e.v}) ${e.blocked ? 'BLOCKED' : 'UNBLOCKED'}`);
      
      if (e.blocked) {
        handleRoadBlockage(e);
      }
    }
  });
});

document.getElementById('btnDispatchEmergency').addEventListener('click', () => {
  isEmergency = !isEmergency;
  logEvent(isEmergency ? "🚨 Emergency Green-Wave Activated!" : "ℹ️ Normal Mode Restored.");
  updateUI();
});

document.getElementById('btnReset').addEventListener('click', () => {
  buildGraph();
  initVehicle();
});

function updateUI() {
  document.getElementById('statusText').innerText = isEmergency ? "🚨 EMERGENCY PRIORITY" : "In Transit";
  document.getElementById('rerouteCountText').innerText = `${rerouteCount} times`;
  if (vehicle && vehicle.path && vehicle.pathIndex < vehicle.path.length - 1) {
    document.getElementById('currentPosText').innerText = `Node ${vehicle.path[vehicle.pathIndex]} → Node ${vehicle.path[vehicle.pathIndex + 1]}`;
  }
}

function logEvent(msg) {
  const logContainer = document.getElementById('eventLog');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerText = `[${new Date().toLocaleTimeString().split(' ')[0]}] ${msg}`;
  logContainer.prepend(entry);
}

function distToSegmentSquared(p, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}

buildGraph();
initVehicle();
gameLoop();

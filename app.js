/**
 * Smart Traffic Reroute & Emergency Simulator
 * Features mid-transit dynamic diversion (Dijkstra) & real-time ETA recalculation.
 */

const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// --- GRID & GRAPH CONFIGURATION ---
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

// --- INITIALIZE GRAPH NODES & EDGES ---
function buildGraph() {
  nodes = [];
  edges = [];
  
  // Create grid nodes
  let id = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      nodes.push({ id, x: PADDING + c * SPACING_X, y: PADDING + r * SPACING_Y, row: r, col: c });
      id++;
    }
  }

  // Create horizontal and vertical edges
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let u = r * COLS + c;
      if (c < COLS - 1) { // Right neighbor
        let v = r * COLS + (c + 1);
        edges.push({ u, v, weight: 1.0, blocked: false });
      }
      if (r < ROWS - 1) { // Bottom neighbor
        let v = (r + 1) * COLS + c;
        edges.push({ u, v, weight: 1.0, blocked: false });
      }
    }
  }
}

// Helper: Get Edge between two node IDs
function getEdge(u, v) {
  return edges.find(e => (e.u === u && e.v === v) || (e.u === v && e.v === u));
}

// --- DIJKSTRA SHORTEST PATH ALGORITHM ---
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

    // Find valid neighbors
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

  // Reconstruct path
  let path = [];
  let curr = targetNodeId;
  while (curr !== null) {
    path.unshift(curr);
    curr = prev[curr];
  }

  return (path.length > 1 && path[0] === startNodeId) ? path : null;
}

// --- VEHICLE INITIALIZATION & REROUTING LOGIC ---
function initVehicle() {
  const startId = 0;
  const targetId = nodes.length - 1;
  const path = runDijkstra(startId, targetId);

  vehicle = {
    path: path,
    pathIndex: 0,
    progress: 0, // 0 to 1 along current segment
    speed: 0.008, // Base speed factor per frame
    targetId: targetId
  };
  rerouteCount = 0;
  isEmergency = false;
  updateUI();
  logEvent("Simulation started. Route: Node 0 → Node " + targetId);
}

// Core Requirement: Mid-Transit Diversion calculation
function triggerReroute(reason) {
  if (!vehicle || vehicle.pathIndex >= vehicle.path.length - 1) return;

  // The vehicle must divert starting from the NEXT reachable node on its current path
  const currentDiversionNode = vehicle.path[vehicle.pathIndex + 1];
  
  // Find path from the current node forward to destination
  const newPath = runDijkstra(currentDiversionNode, vehicle.targetId);

  if (newPath) {
    // Retain path up to current diversion point and append new computed route
    const traversedPart = vehicle.path.slice(0, vehicle.pathIndex + 1);
    vehicle.path = traversedPart.concat(newPath);
    rerouteCount++;
    logEvent(`⚡ Diverted at Node ${currentDiversionNode}! Reason: ${reason}`);
  } else {
    logEvent(`❌ Path blocked from Node ${currentDiversionNode}! Destination unreachable.`);
    vehicle.path = null; // Stalled
  }
  updateUI();
}

// Calculate remaining trip duration (ETA)
function calculateRemainingETA() {
  if (!vehicle || !vehicle.path) return "N/A";
  
  let remainingWeight = 0;
  // Remaining portion of current edge
  const u = vehicle.path[vehicle.pathIndex];
  const v = vehicle.path[vehicle.pathIndex + 1];
  const currentEdge = getEdge(u, v);
  if (currentEdge) {
    remainingWeight += (1 - vehicle.progress) * currentEdge.weight;
  }

  // Rest of edges in path
  for (let i = vehicle.pathIndex + 1; i < vehicle.path.length - 1; i++) {
    let edge = getEdge(vehicle.path[i], vehicle.path[i + 1]);
    if (edge) remainingWeight += edge.weight;
  }

  // Convert weight units to seconds (scaled for demo visualization)
  const baseSpeed = isEmergency ? vehicle.speed * 2 : vehicle.speed;
  const seconds = (remainingWeight / (baseSpeed * 60)).toFixed(1);
  return `${seconds} s`;
}

// --- RENDER & ANIMATION LOOP ---
function update() {
  if (vehicle && vehicle.path && vehicle.pathIndex < vehicle.path.length - 1) {
    const activeSpeed = isEmergency ? vehicle.speed * 2 : vehicle.speed;
    vehicle.progress += activeSpeed;

    if (vehicle.progress >= 1) {
      vehicle.progress = 0;
      vehicle.pathIndex++;

      if (vehicle.pathIndex >= vehicle.path.length - 1) {
        logEvent("🎉 Vehicle reached destination!");
      }
    }
    document.getElementById('etaText').innerText = calculateRemainingETA();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw Edges (Roads)
  edges.forEach(e => {
    const n1 = nodes[e.u];
    const n2 = nodes[e.v];

    ctx.beginPath();
    ctx.moveTo(n1.x, n1.y);
    ctx.lineTo(n2.x, n2.y);
    ctx.lineWidth = 6;
    ctx.strokeStyle = e.blocked ? '#ef4444' : '#334155'; // Red if blocked
    ctx.stroke();
  });

  // 2. Highlight Planned Route
  if (vehicle && vehicle.path) {
    ctx.beginPath();
    for (let i = 0; i < vehicle.path.length - 1; i++) {
      const n1 = nodes[vehicle.path[i]];
      const n2 = nodes[vehicle.path[i + 1]];
      ctx.moveTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = isEmergency ? '#f59e0b' : '#38bdf8'; // Amber for emergency, Blue for standard
    ctx.stroke();
  }

  // 3. Draw Nodes (Intersections)
  nodes.forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = (n.id === 0) ? '#22c55e' : (n.id === nodes.length - 1) ? '#e11d48' : '#64748b';
    ctx.fill();

    // Node labels
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`N${n.id}`, n.x - 6, n.y - 12);
  });

  // 4. Draw Vehicle
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

// --- INTERACTIVITY & EVENT HANDLERS ---
canvas.addEventListener('click', (evt) => {
  const rect = canvas.getBoundingClientRect();
  const clickX = evt.clientX - rect.left;
  const clickY = evt.clientY - rect.top;

  // Toggle nearest road segment on click
  edges.forEach(e => {
    const n1 = nodes[e.u];
    const n2 = nodes[e.v];
    const distToSegment = distToSegmentSquared({ x: clickX, y: clickY }, n1, n2);

    if (distToSegment < 100) { // Click tolerance threshold
      e.blocked = !e.blocked;
      logEvent(`🚧 Road (Node ${e.u} ↔ Node ${e.v}) ${e.blocked ? 'BLOCKED' : 'UNBLOCKED'}`);
      
      // Re-evaluate path from vehicle's current location if road ahead was blocked
      triggerReroute("Road Closure Event");
    }
  });
});

document.getElementById('btnDispatchEmergency').addEventListener('click', () => {
  isEmergency = !isEmergency;
  if (isEmergency) {
    logEvent("🚨 Emergency Mode Activated! Green-wave priority cleared.");
    triggerReroute("Emergency Dispatch Protocol");
  } else {
    logEvent("ℹ️ Returned to normal transit mode.");
  }
  updateUI();
});

document.getElementById('btnReset').addEventListener('click', () => {
  buildGraph();
  initVehicle();
});

function updateUI() {
  document.getElementById('statusText').innerText = isEmergency ? "🚨 EMERGENCY PRIORITY" : "In Transit (Normal)";
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

// Helper: Distance squared from point to line segment
function distToSegmentSquared(p, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}

// --- INIT ---
buildGraph();
initVehicle();
gameLoop();

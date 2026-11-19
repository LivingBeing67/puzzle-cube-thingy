(() => {
  'use strict';

  // ---------- Constants & helpers ----------
  const PALETTE = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff',
    '#9a6324', '#fffac8', '#800000', '#aaffc3',
  ];
  const STORAGE_KEY = 'puzzle-cube-thingy:v1';
  const MIN_SIZE = 2;
  const MAX_SIZE = 8;
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  const $ = (id) => document.getElementById(id);
  const key = (x, y, z) => `${x},${y},${z}`;
  const parseKey = (k) => k.split(',').map(Number);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const inBounds = (x, y, z, n) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n;
  const randomColor = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');

  // ---------- State ----------
  function freshState(size) {
    return {
      size,
      pieces: [{ id: 1, name: 'Piece 1', color: PALETTE[0] }],
      cells: {},      // "x,y,z" -> piece id
      nextId: 2,
      active: 1,
    };
  }

  // Validate anything loaded from storage or an imported file.
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const size = Number(raw.size);
    if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) return null;
    if (!Array.isArray(raw.pieces)) return null;

    const pieces = [];
    const ids = new Set();
    for (const p of raw.pieces) {
      const id = Number(p && p.id);
      if (!Number.isInteger(id) || id < 1 || ids.has(id)) continue;
      ids.add(id);
      const color = /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : PALETTE[pieces.length % PALETTE.length];
      pieces.push({ id, name: String(p.name ?? `Piece ${id}`).slice(0, 40), color });
    }

    const cells = {};
    if (raw.cells && typeof raw.cells === 'object') {
      for (const [k, v] of Object.entries(raw.cells)) {
        const c = parseKey(k);
        const pid = Number(v);
        if (c.length === 3 && c.every(Number.isInteger) && inBounds(c[0], c[1], c[2], size) && ids.has(pid)) {
          cells[key(c[0], c[1], c[2])] = pid;
        }
      }
    }

    if (!pieces.length) pieces.push({ id: 1, name: 'Piece 1', color: PALETTE[0] });
    const nextId = Math.max(...pieces.map((p) => p.id)) + 1;
    const active = pieces.some((p) => p.id === Number(raw.active)) ? Number(raw.active) : pieces[0].id;
    return { size, pieces, cells, nextId, active };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  let state = load() || freshState(3);

  // View-only state (not part of undo history)
  let layer = 0;
  let explode = 0;
  let solo = false;
  let slice = false;

  const pieceById = (id) => state.pieces.find((p) => p.id === id);

  // Per-piece cell count, connectivity and centroid (in centred coordinates).
  function computeStats() {
    const byPiece = new Map(state.pieces.map((p) => [p.id, []]));
    for (const [k, pid] of Object.entries(state.cells)) {
      const list = byPiece.get(pid);
      if (list) list.push(k);
    }
    const h = (state.size - 1) / 2;
    const stats = new Map();
    for (const [pid, keys] of byPiece) {
      let connected = true;
      if (keys.length > 1) {
        const set = new Set(keys);
        const seen = new Set([keys[0]]);
        const queue = [keys[0]];
        while (queue.length) {
          const [x, y, z] = parseKey(queue.pop());
          for (const [dx, dy, dz] of DIRS) {
            const nk = key(x + dx, y + dy, z + dz);
            if (set.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
          }
        }
        connected = seen.size === keys.length;
      }
      let cx = 0, cy = 0, cz = 0;
      for (const k of keys) {
        const [x, y, z] = parseKey(k);
        cx += x; cy += y; cz += z;
      }
      const len = keys.length || 1;
      const centroid = keys.length ? [cx / len - h, cy / len - h, cz / len - h] : [0, 0, 0];
      stats.set(pid, { count: keys.length, connected, centroid });
    }
    return stats;
  }

  // ---------- Undo / redo ----------
  const undoStack = [];
  const redoStack = [];
  const snapshot = () => JSON.stringify(state);

  function pushHistory(before) {
    if (before === null || before === snapshot()) return false;
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    return true;
  }

  function commit(fn) {
    const before = snapshot();
    fn();
    pushHistory(before);
    refresh();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    state = JSON.parse(undoStack.pop());
    refresh();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    state = JSON.parse(redoStack.pop());
    refresh();
  }

  // ---------- DOM refs ----------
  const sizeSelect = $('size');
  const pieceList = $('pieceList');
  const layerGrid = $('layerGrid');
  const layerLabel = $('layerLabel');
  const statusEl = $('status');
  const viewport = $('viewport');

  for (let n = MIN_SIZE; n <= MAX_SIZE; n++) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = `${n} × ${n} × ${n}`;
    sizeSelect.appendChild(opt);
  }

  // ---------- Three.js scene ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x14161c);
  viewport.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(6, 10, 8);
  scene.add(sun);

  const boxGeo = new THREE.BoxGeometry(0.94, 0.94, 0.94);
  const edgeGeo = new THREE.EdgesGeometry(boxGeo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
  const materials = new Map();
  function materialFor(color) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
    return materials.get(color);
  }

  const voxelGroup = new THREE.Group();
  const helperGroup = new THREE.Group();
  scene.add(voxelGroup, helperGroup);
  let pickables = [];
  let layerGuide = null;

  const ghost = new THREE.Mesh(
    boxGeo,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }),
  );
  ghost.visible = false;
  scene.add(ghost);

  // Helpers own their geometry and materials, so they can be freed outright.
  function disposeTree(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }

  function buildHelpers() {
    for (const child of [...helperGroup.children]) {
      helperGroup.remove(child);
      disposeTree(child);
    }
    const n = state.size;

    const bounds = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(n, n, n)),
      new THREE.LineBasicMaterial({ color: 0x5a6070 }),
    );
    helperGroup.add(bounds);

    const axes = new THREE.AxesHelper(1.2);
    axes.position.set(-n / 2, -n / 2, -n / 2);
    helperGroup.add(axes);

    layerGuide = new THREE.Group();
    const grid = new THREE.GridHelper(n, n, 0x4f8cff, 0x4f8cff);
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    const planeGeo = new THREE.PlaneGeometry(n, n);
    planeGeo.rotateX(-Math.PI / 2);
    const plane = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
      color: 0x4f8cff, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide,
    }));
    layerGuide.add(grid, plane);
    helperGroup.add(layerGuide);
  }

  function rebuildScene() {
    for (const child of [...voxelGroup.children]) voxelGroup.remove(child);
    pickables = [];
    const n = state.size;
    const h = (n - 1) / 2;
    const stats = computeStats();
    const spread = explode * 1.6;

    for (const [k, pid] of Object.entries(state.cells)) {
      const piece = pieceById(pid);
      if (!piece) continue;
      const [x, y, z] = parseKey(k);
      if (slice && y > layer) continue;
      if (solo && pid !== state.active) continue;
      const c = stats.get(pid).centroid;
      const mesh = new THREE.Mesh(boxGeo, materialFor(piece.color));
      mesh.position.set(x - h + c[0] * spread, y - h + c[1] * spread, z - h + c[2] * spread);
      mesh.userData = { k, pid };
      mesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
      voxelGroup.add(mesh);
      pickables.push(mesh);
    }

    if (layerGuide) {
      layerGuide.position.y = layer - n / 2;
      layerGuide.visible = explode === 0;
    }
  }

  // ---------- Camera orbit ----------
  // theta: angle around the vertical axis (0 = looking from +z / Front)
  // phi:   angle down from straight above (0 = Top, π = Bottom)
  const HOME = { theta: Math.PI / 4, phi: 1.0 };
  const PHI_MIN = 0.001;
  const PHI_MAX = Math.PI - 0.001;
  const QUARTER = Math.PI / 2;
  let theta, phi, radius;
  let anim = null;       // active camera tween
  let spinning = false;  // auto-spin toggle

  function resetView() {
    anim = null;
    theta = HOME.theta;
    phi = HOME.phi;
    radius = state.size * 3.2;
    updateCamera();
  }

  function updateCamera() {
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.cos(theta),
    );
    camera.position.copy(dir).multiplyScalar(radius);
    camera.lookAt(0, 0, 0);
    cubeCamera.position.copy(dir).multiplyScalar(3.4);
    cubeCamera.lookAt(0, 0, 0);
  }

  // Smoothly move the camera to a new angle, taking the short way round.
  function animateTo(toTheta, toPhi) {
    const dTheta = ((((toTheta - theta) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    anim = {
      fromTheta: theta, fromPhi: phi,
      dTheta, dPhi: clamp(toPhi, PHI_MIN, PHI_MAX) - phi,
      start: performance.now(), duration: 450,
    };
  }

  function stepAnimation(now) {
    if (!anim) return;
    const t = Math.min(1, (now - anim.start) / anim.duration);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    theta = anim.fromTheta + anim.dTheta * e;
    phi = anim.fromPhi + anim.dPhi * e;
    if (t === 1) anim = null;
    updateCamera();
  }

  const snapQuarter = (a) => Math.round(a / QUARTER) * QUARTER;

  // Look at the model from the direction of vector v (from the centre outwards).
  function viewFrom(v) {
    const d = new THREE.Vector3(v[0], v[1], v[2]).normalize();
    const toPhi = Math.acos(clamp(d.y, -1, 1));
    const toTheta = Math.abs(d.x) < 1e-6 && Math.abs(d.z) < 1e-6 ? snapQuarter(theta) : Math.atan2(d.x, d.z);
    animateTo(toTheta, toPhi);
  }

  function setSpinning(on) {
    spinning = on;
    const btn = $('spin');
    btn.setAttribute('aria-pressed', String(on));
    btn.textContent = on ? '❚❚ Stop' : '▶ Spin';
  }

  // ---------- View cube ----------
  const cubeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  cubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  cubeRenderer.setSize(120, 120);
  $('viewcubeHost').appendChild(cubeRenderer.domElement);
  const cubeCanvas = cubeRenderer.domElement;

  const cubeScene = new THREE.Scene();
  const cubeCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);

  function labelTexture(text) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#2a2f3d';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#5a6070';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 124, 124);
    g.fillStyle = '#e8eaf0';
    g.font = 'bold 26px system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const viewCube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK']
      .map((t) => new THREE.MeshBasicMaterial({ map: labelTexture(t) })),
  );
  cubeScene.add(viewCube);

  // Little axis stubs from the cube's back-left-bottom corner, matching the main view.
  const cubeAxes = new THREE.AxesHelper(1.25);
  cubeAxes.position.set(-0.5, -0.5, -0.5);
  cubeScene.add(cubeAxes);

  const cubeHighlight = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  cubeHighlight.visible = false;
  cubeScene.add(cubeHighlight);

  // Which face / edge / corner region is under the pointer, as a direction like [1, 0, 1].
  function pickCubeRegion(e) {
    const r = cubeCanvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cubeCamera);
    const hit = raycaster.intersectObject(viewCube, false)[0];
    if (!hit) return null;
    const p = hit.point;
    return [p.x, p.y, p.z].map((v) => (Math.abs(v) > 0.3 ? Math.sign(v) : 0));
  }

  function showCubeHighlight(region) {
    cubeHighlight.visible = !!region;
    cubeCanvas.classList.toggle('pointing', !!region);
    if (!region) return;
    // Region sits on the surface: thin along the axes it points to, wide along the others.
    cubeHighlight.scale.set(...region.map((d) => (d ? 0.22 : 0.62)));
    cubeHighlight.position.set(...region.map((d) => d * 0.4));
  }

  let cubeDrag = null;
  cubeCanvas.addEventListener('pointerdown', (e) => {
    cubeDrag = { x: e.clientX, y: e.clientY, moved: false };
    cubeCanvas.setPointerCapture(e.pointerId);
  });
  cubeCanvas.addEventListener('pointermove', (e) => {
    if (!cubeDrag) { showCubeHighlight(pickCubeRegion(e)); return; }
    const dx = e.clientX - cubeDrag.x;
    const dy = e.clientY - cubeDrag.y;
    if (!cubeDrag.moved && Math.hypot(dx, dy) > 3) cubeDrag.moved = true;
    if (cubeDrag.moved) {
      anim = null;
      theta -= dx * 0.012;
      phi = clamp(phi - dy * 0.012, PHI_MIN, PHI_MAX);
      cubeDrag.x = e.clientX;
      cubeDrag.y = e.clientY;
      showCubeHighlight(null);
      updateCamera();
    }
  });
  cubeCanvas.addEventListener('pointerup', (e) => {
    if (cubeDrag && !cubeDrag.moved) {
      const region = pickCubeRegion(e);
      if (region) viewFrom(region);
    }
    cubeDrag = null;
  });
  cubeCanvas.addEventListener('pointercancel', () => { cubeDrag = null; });
  cubeCanvas.addEventListener('pointerleave', () => { if (!cubeDrag) showCubeHighlight(null); });

  function resize() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);

  let lastFrame = performance.now();
  function loop(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (anim) {
      stepAnimation(now);
    } else if (spinning && !drag && !cubeDrag) {
      theta -= dt * 0.0006;
      updateCamera();
    }
    renderer.render(scene, camera);
    cubeRenderer.render(cubeScene, cubeCamera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- 3D picking ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // Returns { hitKey, pid } when over a cube, and { add: [x,y,z] } for where a click would place one.
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);

    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit) {
      const [x, y, z] = parseKey(hit.object.userData.k);
      const nrm = hit.face.normal;
      return {
        hitKey: hit.object.userData.k,
        pid: hit.object.userData.pid,
        add: [x + Math.round(nrm.x), y + Math.round(nrm.y), z + Math.round(nrm.z)],
      };
    }

    // Nothing hit: place on the current layer's floor.
    const n = state.size;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(layer - n / 2));
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, p)) {
      const x = Math.floor(p.x + n / 2);
      const z = Math.floor(p.z + n / 2);
      if (inBounds(x, layer, z, n)) return { add: [x, layer, z] };
    }
    return null;
  }

  const canPlace = (c) => c && inBounds(c[0], c[1], c[2], state.size) && !(key(c[0], c[1], c[2]) in state.cells);

  function handleCanvasClick(e, remove) {
    const t = pick(e);
    if (!t) return;
    if (e.altKey || explode > 0) {
      if (t.pid) setActive(t.pid);
      return;
    }
    if (remove) {
      if (t.hitKey) commit(() => { delete state.cells[t.hitKey]; });
      return;
    }
    if (canPlace(t.add)) {
      commit(() => { state.cells[key(...t.add)] = state.active; });
    }
  }

  function updateGhost(e) {
    ghost.visible = false;
    if (!e || explode > 0 || e.shiftKey || e.altKey) return;
    const t = pick(e);
    if (!t || !canPlace(t.add)) return;
    const h = (state.size - 1) / 2;
    ghost.position.set(t.add[0] - h, t.add[1] - h, t.add[2] - h);
    ghost.material.color.set(pieceById(state.active).color);
    ghost.visible = true;
  }

  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { updateGhost(e); return; }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) {
      anim = null;
      theta -= dx * 0.008;
      phi = clamp(phi - dy * 0.008, PHI_MIN, PHI_MAX);
      drag.x = e.clientX;
      drag.y = e.clientY;
      ghost.visible = false;
      updateCamera();
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && !drag.moved) {
      handleCanvasClick(e, e.shiftKey || drag.button === 2);
      updateGhost(e);
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { if (!drag) ghost.visible = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = clamp(radius * Math.exp(e.deltaY * 0.001), state.size * 1.2, state.size * 10);
    updateCamera();
  }, { passive: false });

  // ---------- Pieces panel ----------
  let colorBefore = null;

  function setActive(id) {
    if (!pieceById(id)) return;
    state.active = id;
    save();
    for (const li of pieceList.children) li.classList.toggle('active', Number(li.dataset.id) === id);
    renderLayer();
    rebuildScene();
  }

  function addPiece() {
    commit(() => {
      const id = state.nextId++;
      const used = new Set(state.pieces.map((p) => p.color.toLowerCase()));
      const color = PALETTE.find((c) => !used.has(c)) || randomColor();
      state.pieces.push({ id, name: `Piece ${id}`, color });
      state.active = id;
    });
  }

  function deletePiece(id) {
    if (state.pieces.length <= 1) return;
    const p = pieceById(id);
    const count = Object.values(state.cells).filter((v) => v === id).length;
    if (count && !confirm(`Delete "${p.name}" and its ${count} cube${count === 1 ? '' : 's'}?`)) return;
    commit(() => {
      state.pieces = state.pieces.filter((x) => x.id !== id);
      for (const [k, v] of Object.entries(state.cells)) if (v === id) delete state.cells[k];
      if (state.active === id) state.active = state.pieces[0].id;
    });
  }

  function renderPieces() {
    const stats = computeStats();
    pieceList.textContent = '';
    for (const p of state.pieces) {
      const s = stats.get(p.id);
      const li = document.createElement('li');
      li.className = 'piece' + (p.id === state.active ? ' active' : '');
      li.dataset.id = p.id;

      const color = document.createElement('input');
      color.type = 'color';
      color.value = p.color;
      color.title = 'Piece colour';
      color.addEventListener('input', () => {
        if (colorBefore === null) colorBefore = snapshot();
        p.color = color.value;
        save();
        renderLayer();
        rebuildScene();
      });
      color.addEventListener('change', () => {
        pushHistory(colorBefore);
        colorBefore = null;
        refresh();
      });

      const name = document.createElement('input');
      name.type = 'text';
      name.value = p.name;
      name.maxLength = 40;
      name.setAttribute('aria-label', 'Piece name');
      name.addEventListener('focus', () => setActive(p.id));
      name.addEventListener('change', () => {
        const v = name.value.trim() || `Piece ${p.id}`;
        commit(() => { pieceById(p.id).name = v; });
      });
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });

      const meta = document.createElement('span');
      meta.className = 'piece-meta' + (s.count && !s.connected ? ' warn' : '');
      meta.textContent = `${s.count} cube${s.count === 1 ? '' : 's'}${s.count && !s.connected ? ' ⚠' : ''}`;
      if (s.count && !s.connected) meta.title = 'This piece is split into disconnected parts';

      const del = document.createElement('button');
      del.className = 'delete';
      del.textContent = '×';
      del.title = 'Delete piece';
      del.disabled = state.pieces.length <= 1;
      del.addEventListener('click', () => deletePiece(p.id));

      li.append(color, name, meta, del);
      li.addEventListener('click', (e) => {
        if (!e.target.closest('input, button')) setActive(p.id);
      });
      pieceList.appendChild(li);
    }
  }

  // ---------- Layer editor ----------
  function setLayer(l) {
    layer = clamp(l, 0, state.size - 1);
    renderLayer();
    rebuildScene();
  }

  function renderLayer() {
    const n = state.size;
    layerGrid.style.setProperty('--n', n);
    layerGrid.textContent = '';
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.x = x;
        cell.dataset.z = z;
        const pid = state.cells[key(x, layer, z)];
        const p = pid && pieceById(pid);
        if (p) {
          cell.style.background = p.color;
          cell.classList.add('filled');
          if (pid === state.active) cell.classList.add('is-active');
          cell.title = p.name;
        } else if (layer > 0) {
          const below = pieceById(state.cells[key(x, layer - 1, z)]);
          if (below) {
            cell.classList.add('has-below');
            cell.style.setProperty('--below', below.color);
          }
        }
        layerGrid.appendChild(cell);
      }
    }
    layerLabel.textContent = `${layer + 1} / ${n}`;
    $('layerDown').disabled = layer === 0;
    $('layerUp').disabled = layer === n - 1;
  }

  let paintMode = null;
  let strokeBefore = null;

  function applyPaint(cellEl) {
    const k = key(Number(cellEl.dataset.x), layer, Number(cellEl.dataset.z));
    if (paintMode === 'erase') {
      if (!(k in state.cells)) return;
      delete state.cells[k];
    } else {
      if (state.cells[k] === state.active) return;
      state.cells[k] = state.active;
    }
    renderLayer();
    rebuildScene();
  }

  function endStroke() {
    if (!paintMode) return;
    paintMode = null;
    pushHistory(strokeBefore);
    strokeBefore = null;
    refresh();
  }

  layerGrid.addEventListener('contextmenu', (e) => e.preventDefault());
  layerGrid.addEventListener('pointerdown', (e) => {
    const cellEl = e.target.closest('.cell');
    if (!cellEl) return;
    e.preventDefault();
    const k = key(Number(cellEl.dataset.x), layer, Number(cellEl.dataset.z));
    paintMode = e.button === 2 || state.cells[k] === state.active ? 'erase' : 'paint';
    strokeBefore = snapshot();
    layerGrid.setPointerCapture(e.pointerId);
    applyPaint(cellEl);
  });
  layerGrid.addEventListener('pointermove', (e) => {
    if (!paintMode) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = el && el.closest && el.closest('#layerGrid .cell');
    if (cellEl) applyPaint(cellEl);
  });
  // Listen on window: the cell under the pointer is re-rendered mid-stroke, so its own
  // pointerup may never bubble up to the grid.
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);

  // ---------- Status ----------
  function renderStatus() {
    const n = state.size;
    const total = n ** 3;
    const filled = Object.keys(state.cells).length;
    const stats = computeStats();
    const issues = [];
    if (filled < total) issues.push(`${total - filled} empty cell${total - filled === 1 ? '' : 's'}`);
    for (const p of state.pieces) {
      const s = stats.get(p.id);
      if (!s.count) issues.push(`${p.name} has no cubes`);
      else if (!s.connected) issues.push(`${p.name} is split into separate parts`);
    }

    statusEl.textContent = '';
    const line = document.createElement('div');
    line.className = 'status-line';
    line.textContent = `${filled} / ${total} cells filled · ${state.pieces.length} piece${state.pieces.length === 1 ? '' : 's'}`;

    const bar = document.createElement('div');
    bar.className = 'progress' + (issues.length ? '' : ' done');
    const fill = document.createElement('div');
    fill.style.width = `${(filled / total) * 100}%`;
    bar.appendChild(fill);

    statusEl.append(bar, line);
    if (issues.length) {
      const ul = document.createElement('ul');
      ul.className = 'issues';
      for (const msg of issues) {
        const li = document.createElement('li');
        li.textContent = msg;
        ul.appendChild(li);
      }
      statusEl.appendChild(ul);
    } else {
      const ok = document.createElement('p');
      ok.className = 'ok';
      ok.textContent = '✓ Every cell is filled and every piece is one connected shape.';
      statusEl.appendChild(ok);
    }
  }

  // ---------- Refresh ----------
  let builtSize = 0;
  function refresh() {
    if (!pieceById(state.active)) state.active = state.pieces[0].id;
    layer = clamp(layer, 0, state.size - 1);
    if (builtSize !== state.size) {
      builtSize = state.size;
      sizeSelect.value = state.size;
      buildHelpers();
      resetView();
    }
    save();
    renderPieces();
    renderLayer();
    renderStatus();
    rebuildScene();
    $('undo').disabled = !undoStack.length;
    $('redo').disabled = !redoStack.length;
  }

  // ---------- Toolbar & controls ----------
  sizeSelect.addEventListener('change', () => {
    const n = Number(sizeSelect.value);
    const outside = Object.keys(state.cells).filter((k) => !inBounds(...parseKey(k), n)).length;
    if (outside && !confirm(`Shrinking to ${n}×${n}×${n} removes ${outside} cube${outside === 1 ? '' : 's'}. Continue?`)) {
      sizeSelect.value = state.size;
      return;
    }
    commit(() => {
      state.size = n;
      for (const k of Object.keys(state.cells)) if (!inBounds(...parseKey(k), n)) delete state.cells[k];
    });
  });

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('addPiece').addEventListener('click', addPiece);
  $('layerDown').addEventListener('click', () => setLayer(layer - 1));
  $('layerUp').addEventListener('click', () => setLayer(layer + 1));

  $('fillLayer').addEventListener('click', () => commit(() => {
    for (let x = 0; x < state.size; x++) {
      for (let z = 0; z < state.size; z++) {
        const k = key(x, layer, z);
        if (!(k in state.cells)) state.cells[k] = state.active;
      }
    }
  }));

  $('clearLayer').addEventListener('click', () => commit(() => {
    for (const k of Object.keys(state.cells)) if (parseKey(k)[1] === layer) delete state.cells[k];
  }));

  $('clearAll').addEventListener('click', () => {
    if (!Object.keys(state.cells).length) return;
    if (confirm('Remove every cube? (You can undo this.)')) commit(() => { state.cells = {}; });
  });

  $('export').addEventListener('click', () => {
    const data = JSON.stringify({ app: 'puzzle-cube-thingy', version: 1, ...state }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a');
    const n = state.size;
    a.href = url;
    a.download = `puzzle-${n}x${n}x${n}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('import').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let next = null;
    try { next = sanitize(JSON.parse(await file.text())); } catch { next = null; }
    if (!next) { alert("That file doesn't look like a Puzzle Cube Thingy design."); return; }
    commit(() => { state = next; });
  });

  $('explode').addEventListener('input', (e) => {
    explode = Number(e.target.value);
    ghost.visible = false;
    rebuildScene();
  });
  $('solo').addEventListener('change', (e) => { solo = e.target.checked; rebuildScene(); });
  $('slice').addEventListener('change', (e) => { slice = e.target.checked; rebuildScene(); });
  $('homeView').addEventListener('click', () => animateTo(HOME.theta, HOME.phi));
  // Rotate by exactly 90° from wherever the camera is heading (so repeated clicks chain).
  function rotateQuarter(dir) {
    const baseTheta = anim ? anim.fromTheta + anim.dTheta : theta;
    const basePhi = anim ? anim.fromPhi + anim.dPhi : phi;
    animateTo(baseTheta + dir * QUARTER, basePhi);
  }
  $('rotLeft').addEventListener('click', () => rotateQuarter(1));
  $('rotRight').addEventListener('click', () => rotateQuarter(-1));
  $('spin').addEventListener('click', () => setSpinning(!spinning));

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (e.key === ']' || e.key === 'PageUp') { e.preventDefault(); setLayer(layer + 1); }
    else if (e.key === '[' || e.key === 'PageDown') { e.preventDefault(); setLayer(layer - 1); }
    else if (k === 'n') addPiece();
    else if (/^[1-9]$/.test(e.key)) {
      const p = state.pieces[Number(e.key) - 1];
      if (p) setActive(p.id);
    }
  });

  // ---------- Announcements ----------
  // announcement.json is updated by ./announce.sh and deployed with the site.
  // Each announcement shows once per visitor, for ANNOUNCE_SECONDS, while it's
  // still inside its showUntil window.
  const ANNOUNCE_SECONDS = 10;
  const POLL_MS = 10000;
  const SEEN_KEY = 'puzzle-cube-thingy:seen-announcements';
  const announceEl = $('announcement');
  const announceText = $('announcementText');
  const shownThisSession = new Set();
  let announceTimer = null;

  function seenIds() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || []; } catch { return []; }
  }
  function markSeen(id) {
    shownThisSession.add(id);
    try {
      const ids = seenIds().filter((x) => x !== id);
      ids.push(id);
      localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-20)));
    } catch { /* storage unavailable */ }
  }

  // ----- Announcement sounds -----
  // Only files in sounds/ can be played. Browsers block audio until the visitor has
  // clicked or typed on the page, so if playback is refused we show a 🔊 button and
  // also play on the visitor's next click or key press while the banner is up.
  const SOUND_RE = /^sounds\/[a-z0-9_-]+\.(mp3|ogg|wav)$/i;
  const soundBtn = $('announcementSound');
  let pendingAudio = null;

  function playPending() {
    if (!pendingAudio) return;
    const audio = pendingAudio;
    pendingAudio = null;
    soundBtn.hidden = true;
    audio.play().catch(() => {});
  }

  function playAnnouncementSound(src) {
    pendingAudio = null;
    soundBtn.hidden = true;
    if (!SOUND_RE.test(src)) return;
    const audio = new Audio(src);
    audio.play().catch(() => {
      pendingAudio = audio;
      soundBtn.hidden = false;
    });
  }

  soundBtn.addEventListener('click', playPending);
  window.addEventListener('pointerdown', playPending, true);
  window.addEventListener('keydown', playPending, true);

  // ----- Announcement images -----
  // Only files in images/ can be shown. The image is loaded first, then pops up
  // full screen once for SCARE_MS and fades out. Click to dismiss early.
  const IMAGE_RE = /^images\/[a-z0-9_-]+\.(jpe?g|png|gif|webp)$/i;
  const SCARE_MS = 1500;
  const scareEl = $('scare');
  const scareImg = $('scareImg');
  let scareTimer = null;

  function hideScare() {
    clearTimeout(scareTimer);
    if (scareEl.hidden || scareEl.classList.contains('leaving')) return;
    scareEl.classList.add('leaving');
    setTimeout(() => {
      scareEl.hidden = true;
      scareEl.classList.remove('leaving');
    }, 350);
  }

  // ----- YouTube player -----
  // A small, always-visible player in the corner (YouTube requires embeds to be
  // visible and at least 200px tall). It plays once and removes itself when the
  // video ends. Browsers only allow sound after the visitor has interacted with
  // the page, so if they haven't, it starts muted and restarts from the beginning
  // with sound on their first click or key press.
  const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const YT_FALLBACK_MS = 15 * 60 * 1000; // safety net in case the "ended" event never arrives
  let ytFrame = null;
  let ytMuted = false;
  let ytTimer = null;

  function ytCommand(func, args = []) {
    if (ytFrame && ytFrame.contentWindow) {
      ytFrame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    }
  }

  function removeYouTube() {
    clearTimeout(ytTimer);
    if (ytFrame) ytFrame.parentElement.remove();
    ytFrame = null;
    ytMuted = false;
  }

  function showYouTube(id) {
    if (!YT_ID_RE.test(id)) return;
    removeYouTube();
    const canPlaySound = !!(navigator.userActivation && navigator.userActivation.hasBeenActive);
    ytMuted = !canPlaySound;
    // No controls and no keyboard shortcuts: it can't be paused or muted from the player.
    const params = new URLSearchParams({
      autoplay: '1', mute: ytMuted ? '1' : '0', enablejsapi: '1',
      controls: '0', disablekb: '1', fs: '0',
      playsinline: '1', rel: '0', origin: location.origin,
    });
    const wrap = document.createElement('div');
    wrap.className = 'yt-player';
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${id}?${params}`;
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.title = 'YouTube video player';
    // Ask the player to send us state changes, so we know when it ends.
    frame.addEventListener('load', () => {
      frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'pct', channel: 'widget' }), '*');
    });
    wrap.appendChild(frame);
    document.body.appendChild(wrap);
    ytFrame = frame;
    ytTimer = setTimeout(removeYouTube, YT_FALLBACK_MS);
  }

  window.addEventListener('message', (e) => {
    if (!ytFrame || e.source !== ytFrame.contentWindow) return;
    let d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!d) return;
    const state = d.event === 'onStateChange' ? d.info
      : d.event === 'infoDelivery' && d.info && typeof d.info.playerState === 'number' ? d.info.playerState
        : null;
    if (state === 0) { removeYouTube(); return; } // 0 = ended
    // Once it's playing with sound, keep it that way: undo any mute or volume change.
    const info = d.event === 'infoDelivery' ? d.info : null;
    if (info && !ytMuted && (info.muted === true || (typeof info.volume === 'number' && info.volume < 100))) {
      ytCommand('unMute');
      ytCommand('setVolume', [100]);
    }
    if (!ytMuted && state === 2) ytCommand('playVideo'); // 2 = paused
  });

  function ytUnmuteOnGesture() {
    if (!ytFrame || !ytMuted) return;
    ytMuted = false;
    ytCommand('seekTo', [0, true]);
    ytCommand('unMute');
    ytCommand('setVolume', [100]);
    ytCommand('playVideo');
  }
  window.addEventListener('pointerdown', ytUnmuteOnGesture, true);
  window.addEventListener('keydown', ytUnmuteOnGesture, true);

  async function loadImage(src, img = scareImg) {
    if (!IMAGE_RE.test(src)) return false;
    try {
      img.src = src;
      await img.decode();
      return true;
    } catch {
      return false;
    }
  }

  // ----- Visitor: slides in, spins, says a line, leaves -----
  const VISITOR_MS = 6000;
  const visitorEl = $('visitor');
  const visitorImg = $('visitorImg');
  const visitorBubble = $('visitorBubble');
  const visitorTimers = [];

  // Speak with the browser's built-in voice, low and slow. Browsers may refuse
  // until the visitor has interacted with the page; the speech bubble covers that.
  // If the browser refuses ("not-allowed": no click/key press yet), the line is
  // kept and spoken on the visitor's next click or key press within 2 minutes.
  const SPEECH_WAIT_MS = 120000;
  let pendingSpeech = null;

  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 0.1; // evil: as low and slow as browsers allow
      u.rate = 0.75;
      u.onerror = (e) => {
        if (e.error === 'not-allowed') pendingSpeech = { text, until: Date.now() + SPEECH_WAIT_MS };
      };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech unavailable */ }
  }

  function speakPending() {
    if (!pendingSpeech) return;
    const { text, until } = pendingSpeech;
    pendingSpeech = null;
    if (Date.now() < until) speak(text);
  }
  window.addEventListener('pointerdown', speakPending, true);
  window.addEventListener('keydown', speakPending, true);

  function showVisitor(say) {
    visitorTimers.splice(0).forEach(clearTimeout);
    visitorBubble.textContent = say;
    visitorEl.style.setProperty('--visitor-ms', `${VISITOR_MS}ms`);
    visitorEl.classList.remove('run');
    visitorEl.hidden = false;
    void visitorEl.offsetWidth; // restart the animation
    visitorEl.classList.add('run');
    if (say) visitorTimers.push(setTimeout(() => speak(say), VISITOR_MS * 0.36));
    visitorTimers.push(setTimeout(() => {
      visitorEl.hidden = true;
      visitorEl.classList.remove('run');
    }, VISITOR_MS));
  }

  function showScare() {
    scareEl.classList.remove('leaving');
    scareEl.hidden = false;
    clearTimeout(scareTimer);
    scareTimer = setTimeout(hideScare, SCARE_MS);
  }

  scareEl.addEventListener('click', hideScare);

  function hideAnnouncement() {
    clearTimeout(announceTimer);
    pendingAudio = null;
    if (announceEl.hidden) return;
    announceEl.classList.add('leaving');
    setTimeout(() => {
      announceEl.hidden = true;
      announceEl.classList.remove('leaving');
    }, 300);
  }

  function showAnnouncement(message) {
    pendingAudio = null;
    soundBtn.hidden = true;
    announceText.textContent = message;
    announceEl.style.setProperty('--announce-seconds', `${ANNOUNCE_SECONDS}s`);
    announceEl.classList.remove('leaving');
    announceEl.hidden = false;
    // Restart the countdown bar animation.
    const bar = announceEl.querySelector('.announcement-timer');
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(hideAnnouncement, ANNOUNCE_SECONDS * 1000);
  }

  // Announcements this visitor had already seen before this page load.
  const seenBeforeLoad = new Set(seenIds());

  // Show one announcement if it's valid, in its time window, and not seen yet.
  async function maybeShow(a, onPageOpen) {
    if (!a || !a.id) return;
    const message = typeof a.message === 'string' ? a.message.trim().slice(0, 280) : '';
    const say = typeof a.say === 'string' ? a.say.trim().slice(0, 140) : '';
    const spoken = typeof a.speak === 'string' ? a.speak.trim().slice(0, 200) : '';
    const youtube = typeof a.youtube === 'string' && YT_ID_RE.test(a.youtube) ? a.youtube : '';
    if (!message && !spoken && !youtube && typeof a.visitor !== 'string') return;
    if (!(Date.parse(a.showUntil) > Date.now())) return;
    if (a.onOpenOnly === true && !onPageOpen) return;
    if (shownThisSession.has(a.id) || seenIds().includes(a.id)) return;
    markSeen(a.id);
    // Load images before showing anything, so everything lands together.
    const hasImage = typeof a.image === 'string' && await loadImage(a.image);
    const hasVisitor = typeof a.visitor === 'string' && await loadImage(a.visitor, visitorImg);
    if (message) showAnnouncement(message);
    if (hasImage) showScare();
    if (hasVisitor) showVisitor(say);
    if (typeof a.sound === 'string') playAnnouncementSound(a.sound);
    if (spoken) speak(spoken);
    if (youtube) showYouTube(youtube);
  }

  // onPageOpen is true only for the check made when the page first loads.
  // Announcements posted with --on-open are only shown on that first check.
  //
  // An announcement can carry a followUp: it's shown when the page is opened by
  // someone who had already seen the main announcement before this load
  // (e.g. main: "Everyone reload the page!" → followUp: a surprise on reload).
  async function checkAnnouncement(onPageOpen = false) {
    if (location.protocol === 'file:') return; // only works when served from a website
    try {
      const res = await fetch(`announcement.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const a = await res.json();
      if (!a || typeof a !== 'object') return;
      const f = a.followUp;
      if (onPageOpen && f && typeof f === 'object' && seenBeforeLoad.has(a.id)) {
        await maybeShow({ ...f, showUntil: a.showUntil, onOpenOnly: false }, true);
      } else {
        await maybeShow(a, onPageOpen);
      }
    } catch { /* offline or bad file: ignore */ }
  }

  $('announcementClose').addEventListener('click', hideAnnouncement);
  checkAnnouncement(true);
  setInterval(() => { if (!document.hidden) checkAnnouncement(); }, POLL_MS);
  // Browsers slow down timers in background tabs, so check right away on return.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkAnnouncement(); });
  window.addEventListener('focus', () => checkAnnouncement());

  refresh();
  resize();
})();

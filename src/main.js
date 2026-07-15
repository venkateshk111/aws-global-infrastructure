import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  REGIONS, BACKBONE, EDGE_LOCATIONS, LOCAL_ZONES, WAVELENGTH_ZONES,
  DIRECT_CONNECT, AZ_SITES, CORE_SERVICES, BIG_REGION_SERVICES, regionBlurb,
} from './data.js';

const R = 1; // globe radius
const canvas = document.getElementById('globe');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080f);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
camera.position.set(0, 0.6, 2.6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.25;
controls.maxDistance = 5;
controls.rotateSpeed = 0.5;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.25;
canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; });

function latLngToVec3(lat, lng, r = R) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lng + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

// ---------- theme palettes (3D scene side; CSS side lives in style.css) ----------
const THEME3D = {
  dark: {
    bg: 0x05080f, ocean: '#0a1526', land: '#1c2c47',
    stroke: 'rgba(120,160,220,0.35)', grat: 'rgba(80,110,160,0.10)',
    blending: THREE.AdditiveBlending, lineColor: 0x4d7fff, lineOpacity: 0.28,
    pulseColor: 0x9db8ff, stars: true,
  },
  light: {
    bg: 0xdde7f3, ocean: '#c4d7ea', land: '#f4f6fa',
    stroke: 'rgba(70,100,150,0.55)', grat: 'rgba(60,90,140,0.14)',
    blending: THREE.NormalBlending, lineColor: 0x2f5fd0, lineOpacity: 0.5,
    pulseColor: 0x2f55c8, stars: false,
  },
};
let themeMode = 'dark';

// ---------- Globe surface: landmasses drawn from GeoJSON onto an equirectangular canvas ----------
let geoDataPromise;
async function buildGlobeTexture(p) {
  geoDataPromise ??= fetch(`${import.meta.env.BASE_URL}world-ind.json`).then((r) => r.json());
  const geo = await geoDataPromise;
  const W = 4096, H = 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = p.ocean;
  ctx.fillRect(0, 0, W, H);
  // faint graticule
  ctx.strokeStyle = p.grat;
  ctx.lineWidth = 1;
  for (let lng = -180; lng <= 180; lng += 15) {
    const x = (lng + 180) / 360 * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = (90 - lat) / 180 * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  const drawRing = (ring) => {
    ctx.beginPath();
    ring.forEach(([lng, lat], i) => {
      const x = (lng + 180) / 360 * W;
      const y = (90 - lat) / 180 * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  ctx.fillStyle = p.land;
  ctx.strokeStyle = p.stroke;
  ctx.lineWidth = 1.5;
  for (const f of geo.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') g.coordinates.forEach(drawRing);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((p2) => p2.forEach(drawRing));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// atmosphere glow (view-dependent fresnel on a slightly larger back-facing sphere)
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(R * 1.08, 64, 64),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: `
      varying vec3 vNormal;
      void main() { vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vNormal;
      void main() {
        float i = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, -1.0)), 3.5);
        gl_FragColor = vec4(0.25, 0.5, 1.0, 1.0) * i;
      }`,
  }),
);
scene.add(atmosphere);

// star field
let stars;
{
  const n = 1500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(20 + Math.random() * 30);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({
    color: 0x8899bb, size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.7,
  }));
  scene.add(stars);
}

// ---------- glowing marker sprite ----------
function glowSprite() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}
const spriteTex = glowSprite();

const LAYER_STYLE = {
  regions:       { color: 0xff9900, size: 0.055 },
  azs:           { color: 0xffd280, size: 0.02 },
  edge:          { color: 0x00d1ff, size: 0.022 },
  localzones:    { color: 0x7fff9e, size: 0.026 },
  wavelength:    { color: 0xc77dff, size: 0.026 },
  directconnect: { color: 0xff5d8f, size: 0.026 },
};

const layers = {}; // name -> { points, meta[] }
function makeLayer(name, items, toMeta) {
  const meta = items.map(toMeta);
  const pos = new Float32Array(meta.length * 3);
  meta.forEach((m, i) => pos.set([m.pos.x, m.pos.y, m.pos.z], i * 3));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const st = LAYER_STYLE[name];
  const points = new THREE.Points(g, new THREE.PointsMaterial({
    color: st.color, size: st.size, map: spriteTex,
    transparent: true, depthWrite: false, sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  }));
  points.renderOrder = 2;
  scene.add(points);
  layers[name] = { points, meta };
}

const regionPos = Object.fromEntries(REGIONS.map((r) => [r.code, latLngToVec3(r.lat, r.lng, R * 1.008)]));

makeLayer('regions', REGIONS, (r) => ({
  pos: regionPos[r.code], type: 'Region', name: r.name, code: r.code,
  country: r.country, detail: `${r.azs} Availability Zones · launched ${r.launched}`, region: r,
}));

// AZ-count badges floating beside each region marker
const badgeTexCache = {};
function badgeTexture(n) {
  if (badgeTexCache[n]) return badgeTexCache[n];
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.beginPath(); ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(13,20,36,0.92)'; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#ff9900'; ctx.stroke();
  ctx.font = '700 30px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffb84d'; ctx.fillText(String(n), 32, 34);
  const tex = new THREE.CanvasTexture(c);
  badgeTexCache[n] = tex;
  return tex;
}
const badgeGroup = new THREE.Group();
for (const r of REGIONS) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: badgeTexture(r.azs), transparent: true, depthWrite: false,
  }));
  sp.scale.setScalar(0.034);
  sp.position.copy(regionPos[r.code]).normalize().multiplyScalar(R * 1.052);
  badgeGroup.add(sp);
}
scene.add(badgeGroup);

// AZ dots at verified on-land coordinates near each region (see AZ_SITES in data.js)
const azItems = [];
for (const r of REGIONS) {
  const sites = AZ_SITES[r.code];
  for (let i = 0; i < r.azs; i++) {
    const [lat, lng] = sites[i];
    azItems.push({
      pos: latLngToVec3(lat, lng, R * 1.012), type: 'Availability Zone',
      name: `${r.name} AZ`, code: `${r.code}${String.fromCharCode(97 + i)}`,
      country: r.country, detail: `One of ${r.azs} AZs in ${r.name}`,
    });
  }
}
makeLayer('azs', azItems, (m) => m);

makeLayer('edge', EDGE_LOCATIONS, (e) => ({
  pos: latLngToVec3(e.lat, e.lng, R * 1.006), type: 'Edge Location', name: e.city,
  code: 'CloudFront PoP', country: e.country,
  detail: 'Caches content close to users for CloudFront, Route 53 and AWS Shield',
}));

makeLayer('localzones', LOCAL_ZONES, (z) => ({
  pos: latLngToVec3(z.lat, z.lng, R * 1.006), type: 'Local Zone', name: z.city,
  code: `parent: ${z.parent}`, country: z.country,
  detail: 'Single-digit-millisecond compute/storage extension of its parent region', parent: z.parent,
}));

makeLayer('wavelength', WAVELENGTH_ZONES, (w) => ({
  pos: latLngToVec3(w.lat, w.lng, R * 1.006), type: 'Wavelength Zone', name: `${w.city} (${w.carrier})`,
  code: `parent: ${w.parent}`, country: w.country,
  detail: `AWS compute embedded in ${w.carrier}'s 5G network for ultra-low-latency mobile apps`, parent: w.parent,
}));

makeLayer('directconnect', DIRECT_CONNECT, (d) => ({
  pos: latLngToVec3(d.lat, d.lng, R * 1.006), type: 'Direct Connect', name: d.name,
  code: `home region: ${d.region}`, country: d.country,
  detail: 'Dedicated private fiber connection from customer networks into AWS', parent: d.region,
}));

// ---------- backbone arcs + flowing pulses ----------
function arcCurve(a, b, lift = 0.35) {
  const dist = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5).normalize()
    .multiplyScalar(R * (1 + lift * dist * 0.5));
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

const backboneGroup = new THREE.Group();
const backboneCurves = [];
for (const [ca, cb] of BACKBONE) {
  const curve = arcCurve(regionPos[ca], regionPos[cb]);
  backboneCurves.push(curve);
  const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
  backboneGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({
    color: 0x4d7fff, transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })));
}
scene.add(backboneGroup);

// generic pulse system: a pool of glowing dots travelling along curves
function makePulseSystem(capacity, color, size) {
  const pos = new Float32Array(capacity * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({
    color, size, map: spriteTex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  pts.renderOrder = 3;
  scene.add(pts);
  const pulses = Array.from({ length: capacity }, () => ({ curve: null, t: 0, speed: 0 }));
  return {
    pts, pulses,
    update(dt, curves) {
      const attr = g.attributes.position;
      for (let i = 0; i < capacity; i++) {
        const p = pulses[i];
        if (!p.curve || p.t >= 1) {
          if (!curves.length) { attr.setXYZ(i, 0, 0, 0); continue; }
          p.curve = curves[Math.floor(Math.random() * curves.length)];
          p.t = Math.random() * 0.2;
          p.speed = 0.25 + Math.random() * 0.3;
        }
        p.t += dt * p.speed;
        const v = p.curve.getPoint(Math.min(p.t, 1));
        attr.setXYZ(i, v.x, v.y, v.z);
      }
      attr.needsUpdate = true;
    },
    reset() { pulses.forEach((p) => { p.curve = null; }); },
  };
}

const backbonePulses = makePulseSystem(70, 0x9db8ff, 0.02);

// ---------- traffic simulation (stretch goal) ----------
const nearestRegion = (lat, lng) => {
  const p = latLngToVec3(lat, lng);
  let best = null, bd = Infinity;
  for (const r of REGIONS) {
    if (r.china || r.govcloud || r.sovereign) continue;
    const d = regionPos[r.code].distanceTo(p);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
};

const SIMS = {
  cloudfront: {
    color: 0x00d1ff,
    curves: EDGE_LOCATIONS.map((e) => arcCurve(
      regionPos[nearestRegion(e.lat, e.lng).code], latLngToVec3(e.lat, e.lng, R * 1.006), 0.25)),
  },
  s3crr: {
    color: 0x7fff9e,
    curves: [
      ['us-east-1', 'us-west-2'], ['us-east-1', 'eu-west-1'], ['eu-west-1', 'ap-southeast-1'],
      ['ap-northeast-1', 'us-west-2'], ['us-east-1', 'sa-east-1'], ['eu-central-1', 'ap-south-1'],
    ].map(([a, b]) => arcCurve(regionPos[a], regionPos[b], 0.5)),
  },
  dx: {
    color: 0xff5d8f,
    curves: DIRECT_CONNECT.filter((d) => regionPos[d.region]).map((d) =>
      arcCurve(latLngToVec3(d.lat, d.lng, R * 1.006), regionPos[d.region], 0.2)),
  },
  multiregion: {
    color: 0xffc46b,
    curves: [
      ['us-east-1', 'eu-west-1'], ['eu-west-1', 'ap-southeast-1'], ['ap-southeast-1', 'us-east-1'],
      ['us-east-1', 'us-west-2'], ['ap-southeast-1', 'ap-northeast-1'],
    ].map(([a, b]) => arcCurve(regionPos[a], regionPos[b], 0.5)),
  },
};
const simPulses = makePulseSystem(120, 0xffffff, 0.024);
const simArcs = new THREE.Group();
scene.add(simArcs);
let activeSim = null;

document.getElementById('sim').addEventListener('change', (e) => {
  activeSim = e.target.value === 'off' ? null : SIMS[e.target.value];
  simArcs.clear();
  simPulses.reset();
  if (activeSim) {
    simPulses.pts.material.color.setHex(activeSim.color);
    for (const c of activeSim.curves) {
      const g = new THREE.BufferGeometry().setFromPoints(c.getPoints(48));
      simArcs.add(new THREE.Line(g, new THREE.LineBasicMaterial({
        color: activeSim.color, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })));
    }
  }
  simPulses.pts.visible = !!activeSim;
});
simPulses.pts.visible = false;

// mobile: layers panel collapses into a toggleable drawer
document.getElementById('controls-toggle').addEventListener('click', () => {
  document.getElementById('controls').classList.toggle('open');
});

// ---------- layer toggles ----------
document.querySelectorAll('#controls input[data-layer]').forEach((cb) => {
  cb.addEventListener('change', () => {
    const l = cb.dataset.layer;
    if (l === 'backbone') {
      backboneGroup.visible = cb.checked;
      backbonePulses.pts.visible = cb.checked;
    } else {
      layers[l].points.visible = cb.checked;
      if (l === 'azs') badgeGroup.visible = cb.checked;
    }
  });
});

// ---------- hover tooltip + click panel ----------
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.018;
const pointer = new THREE.Vector2(-2, -2);
const tooltip = document.getElementById('tooltip');
let hovered = null;

const TYPE_COLORS = {
  'Region': '#ff9900', 'Availability Zone': '#ffd280', 'Edge Location': '#00d1ff',
  'Local Zone': '#7fff9e', 'Wavelength Zone': '#c77dff', 'Direct Connect': '#ff5d8f',
};
const TYPE_COLORS_LIGHT = {
  'Region': '#b36b00', 'Availability Zone': '#8a6116', 'Edge Location': '#00708a',
  'Local Zone': '#1e7a3a', 'Wavelength Zone': '#7a3fa8', 'Direct Connect': '#b3234f',
};

canvas.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  tooltip.style.left = `${e.clientX + 14}px`;
  tooltip.style.top = `${e.clientY + 14}px`;
});

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const camDir = camera.position.clone().normalize();
  let best = null;
  for (const [name, layer] of Object.entries(layers)) {
    if (!layer.points.visible) continue;
    for (const hit of raycaster.intersectObject(layer.points)) {
      // ignore markers on the far side of the globe
      if (hit.point.clone().normalize().dot(camDir) < 0.25) continue;
      if (!best || hit.distanceToRay < best.hit.distanceToRay) {
        best = { hit, meta: layer.meta[hit.index], layer: name };
      }
    }
  }
  return best;
}

function updateHover() {
  const p = pick();
  hovered = p;
  canvas.style.cursor = p ? 'pointer' : 'grab';
  if (!p) { tooltip.hidden = true; return; }
  const m = p.meta;
  tooltip.hidden = false;
  tooltip.innerHTML = `
    <div class="tt-type" style="color:${(themeMode === 'light' ? TYPE_COLORS_LIGHT : TYPE_COLORS)[m.type]}">${m.type}</div>
    <div class="tt-name">${m.name}</div>
    <div class="tt-sub">${m.code} · ${m.country}</div>
    <div class="tt-sub">${m.detail}</div>`;
}

const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
document.getElementById('panel-close').addEventListener('click', () => { panel.hidden = true; });

// info-icon tooltip: opens above its heading; flips below only when the visible
// panel area has no room above (e.g. the Region header at the very top)
const panelTip = document.createElement('div');
panelTip.id = 'panel-tip';
panelTip.hidden = true;
panel.appendChild(panelTip);
function showInfoTip(icon) {
  const head = icon.closest('h2, h4');
  panelTip.textContent = icon.dataset.tip;
  panelTip.style.left = `${head.offsetLeft}px`;
  panelTip.style.width = `${head.offsetWidth - 20}px`;
  panelTip.hidden = false;
  const above = head.offsetTop - panelTip.offsetHeight - 4;
  panelTip.style.top = above >= panel.scrollTop + 6
    ? `${above}px`
    : `${head.offsetTop + head.offsetHeight + 4}px`;
}
panelBody.addEventListener('mouseover', (e) => { const i = e.target.closest('.info'); if (i) showInfoTip(i); });
panelBody.addEventListener('mouseout', (e) => { if (e.target.closest('.info')) panelTip.hidden = true; });
panelBody.addEventListener('focusin', (e) => { const i = e.target.closest('.info'); if (i) showInfoTip(i); });
panelBody.addEventListener('focusout', (e) => { if (e.target.closest('.info')) panelTip.hidden = true; });

const SECTION_TIPS = {
  region: 'A Region is a physical cluster of AWS data centers in one geographic area, made up of multiple isolated Availability Zones. You choose a region to control where your apps and data live.',
  az: 'Isolated data center clusters within the region, each with independent power, cooling and networking. Spreading an app across AZs lets it survive a single-facility failure.',
  lz: 'Extensions of the region that place compute and storage in large metro areas closer to end users, for single-digit-millisecond latency.',
  wl: "AWS infrastructure embedded inside a telecom carrier's 5G network, so mobile traffic reaches AWS compute without leaving the carrier's network.",
  dx: 'Colocation sites where customers plug their own networks into AWS over dedicated private fiber instead of the public internet.',
  edge: 'CloudFront points of presence that cache content close to viewers. Listed here are the PoPs geographically nearest to this region.',
};
const sect = (title, tipKey) =>
  `<h4>${title}<span class="info" tabindex="0" data-tip="${SECTION_TIPS[tipKey]}">&#9432;</span></h4>`;

function openRegionPanel(r) {
  panelTip.hidden = true;
  const azList = Array.from({ length: r.azs }, (_, i) =>
    `<li><span class="az-code">${r.code}${String.fromCharCode(97 + i)}</span><span class="li-sub">independent power, cooling &amp; network</span></li>`).join('');
  const lz = LOCAL_ZONES.filter((z) => z.parent === r.code);
  const wl = WAVELENGTH_ZONES.filter((z) => z.parent === r.code);
  const dx = DIRECT_CONNECT.filter((d) => d.region === r.code);
  const rp = latLngToVec3(r.lat, r.lng);
  const edges = EDGE_LOCATIONS
    .map((e) => ({ ...e, d: latLngToVec3(e.lat, e.lng).distanceTo(rp) }))
    .sort((a, b) => a.d - b.d).slice(0, 5);
  const li = (arr, f) => arr.length
    ? `<ul>${arr.map((x) => `<li>${f(x)}</li>`).join('')}</ul>`
    : '<div style="color:var(--muted);font-size:12px">None directly attached</div>';
  const services = r.govcloud || r.china || r.sovereign ? CORE_SERVICES : [...CORE_SERVICES, ...BIG_REGION_SERVICES];
  panelBody.innerHTML = `
    <h2>${r.name}<span class="info" tabindex="0" data-tip="${SECTION_TIPS.region}">&#9432;</span></h2>
    <div class="region-code">${r.code}</div>
    <div class="meta">${r.city}, ${r.country} · launched ${r.launched} · ${r.geo}</div>
    <div class="blurb">${regionBlurb(r)}</div>
    ${sect(`Availability Zones (${r.azs})`, 'az')}<ul>${azList}</ul>
    <h4>Supported services (selection)</h4>
    <div class="chips">${services.map((s) => `<span class="chip">${s}</span>`).join('')}</div>
    ${sect(`Local Zones (${lz.length})`, 'lz')}${li(lz, (z) => `${z.city}, ${z.country}`)}
    ${sect(`Wavelength Zones (${wl.length})`, 'wl')}${li(wl, (z) => `${z.city} — ${z.carrier}`)}
    ${sect(`Direct Connect locations (${dx.length})`, 'dx')}${li(dx, (d) => `${d.name}`)}
    ${sect(`Nearest Edge Locations (${edges.length})`, 'edge')}${li(edges, (e) => `${e.city}, ${e.country}`)}`;
  panel.hidden = false;
}

let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  if (hovered && hovered.layer === 'regions') { openRegionPanel(hovered.meta.region); return; }
  // AZ markers sit close to their region marker and can win the hover pick;
  // raycast the regions layer directly so region clicks always work
  if (!layers.regions.points.visible) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const camDir = camera.position.clone().normalize();
  for (const hit of raycaster.intersectObject(layers.regions.points)) {
    if (hit.point.clone().normalize().dot(camDir) < 0.25) continue;
    openRegionPanel(layers.regions.meta[hit.index].region);
    return;
  }
});

// ---------- stats ----------
document.getElementById('stats').textContent =
  `${REGIONS.length} Regions · ${azItems.length} AZs · ${LOCAL_ZONES.length} Local Zones · ` +
  `${WAVELENGTH_ZONES.length} Wavelength Zones · 750+ CloudFront PoPs (${EDGE_LOCATIONS.length} metros shown) · ${DIRECT_CONNECT.length}+ Direct Connect`;

// ---------- boot ----------
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let hoverTick = 0;

let globeMesh;
const globeTextures = {};
buildGlobeTexture(THEME3D.dark).then((tex) => {
  globeTextures.dark = tex;
  globeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 96),
    new THREE.MeshBasicMaterial({ map: globeTextures[themeMode] || tex }),
  );
  scene.add(globeMesh);
});

// ---------- dark/light theme toggle ----------
async function applyTheme(mode) {
  themeMode = mode;
  const t = THEME3D[mode];
  document.body.classList.toggle('light', mode === 'light');
  document.getElementById('theme-toggle').textContent = mode === 'light' ? '☾' : '☀';
  scene.background = new THREE.Color(t.bg);
  stars.visible = t.stars;
  for (const l of Object.values(layers)) {
    l.points.material.blending = t.blending;
    l.points.material.needsUpdate = true;
  }
  for (const line of backboneGroup.children) {
    line.material.blending = t.blending;
    line.material.color.setHex(t.lineColor);
    line.material.opacity = t.lineOpacity;
    line.material.needsUpdate = true;
  }
  backbonePulses.pts.material.blending = t.blending;
  backbonePulses.pts.material.color.setHex(t.pulseColor);
  backbonePulses.pts.material.needsUpdate = true;
  simPulses.pts.material.blending = t.blending;
  simPulses.pts.material.needsUpdate = true;
  for (const line of simArcs.children) {
    line.material.blending = t.blending;
    line.material.needsUpdate = true;
  }
  globeTextures[mode] ??= await buildGlobeTexture(t);
  if (globeMesh && themeMode === mode) {
    globeMesh.material.map = globeTextures[mode];
    globeMesh.material.needsUpdate = true;
  }
}
document.getElementById('theme-toggle').addEventListener('click', () => {
  applyTheme(themeMode === 'dark' ? 'light' : 'dark');
});

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  controls.update();
  if (backboneGroup.visible) backbonePulses.update(dt, backboneCurves);
  if (activeSim) simPulses.update(dt, activeSim.curves);
  // gentle glow pulse on region markers
  layers.regions.points.material.size = LAYER_STYLE.regions.size * (1 + 0.12 * Math.sin(clock.elapsedTime * 2.2));
  if ((hoverTick = (hoverTick + 1) % 3) === 0) updateHover();
  renderer.render(scene, camera);
}
animate();

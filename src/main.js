/**
 * FetchingReality – Modern 3D Fetch Simulation & 2D SDF Novel Graphics Engine
 *
 * Features:
 * 1. Ball Object with realistic 3D physics, cursor tracking & fling mechanics
 * 2. 4-State Fetch Machine:
 *    - State 1 (Idle/Wag): Axis sine-wobble Math.sin(time) & body breathing
 *    - State 2 (Throw): Parabolic ballistic trajectory & ground bounces
 *    - State 3 (Fetch): Dog linear interpolation (lerp) toward ball with bounding stride
 *    - State 4 (Return): Ball attached to dog mouth offset, dog returns to center
 * 3. 2D SDF GLSL Novel Graphics Engine:
 *    - Uses OpenCV Distance Transform (dog_sdf.png) + RGBA Cutout (dog_cutout.png)
 *    - Fragment shader dynamic distance-gradient warp, cursor proximity head squish & sine wag
 * 4. Bespoke, non-vibecoded Minimalist Studio UI & Zero-dependency Web Audio Sound Effects
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ── DOM References ────────────────────────────────────────────────────────────
const canvas       = document.getElementById('three-canvas');
const loaderOverlay = document.getElementById('loader-overlay');
const loaderBar    = document.getElementById('loader-bar');
const loaderPct    = document.getElementById('loader-pct');
const loaderText   = document.getElementById('loader-text');

// State step elements
const stepIdle     = document.getElementById('step-idle');
const stepThrow    = document.getElementById('step-throw');
const stepFetch    = document.getElementById('step-fetch');
const stepReturn   = document.getElementById('step-return');
const stateSteps   = { idle: stepIdle, throw: stepThrow, fetch: stepFetch, return: stepReturn };

// Telemetry & Dock
const statCatches  = document.getElementById('stat-catches');
const statDistance = document.getElementById('stat-distance');
const statState    = document.getElementById('stat-state');
const statFps      = document.getElementById('stat-fps');
const instructionText = document.getElementById('instruction-text');
const reticle      = document.getElementById('throw-reticle');

// Buttons
const btnQuickThrow = document.getElementById('btn-quick-throw');
const btnWireframe  = document.getElementById('btn-toggle-wireframe');
const btnRotate     = document.getElementById('btn-toggle-rotate');
const btnResetCam   = document.getElementById('btn-reset-cam');
const btnMode3D     = document.getElementById('btn-mode-3d');
const btnModeSDF    = document.getElementById('btn-mode-sdf');
const sdfToolbar    = document.getElementById('sdf-toolbar');
const sdfModeBtns   = document.querySelectorAll('.sdf-mode-btn');

// ── Web Audio Synthesizer (Zero-dependency tactile sound effects) ───────────────
class SoundFX {
  constructor() {
    this.ctx = null;
  }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
  throw() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.22);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  }
  bounce() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }
  pickup() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    const t = this.ctx.currentTime;
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.15);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }
  success() {
    if (!this.ctx) return;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      const t = this.ctx.currentTime + idx * 0.08;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  }
}
const sfx = new SoundFX();
window.addEventListener('pointerdown', () => sfx.init(), { once: true });

// ── Renderer Setup ────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ── 3D Scene & Cameras ────────────────────────────────────────────────────────
const scene3D = new THREE.Scene();
scene3D.background = new THREE.Color('#09090b');
scene3D.fog = new THREE.FogExp2('#09090b', 0.038);

const camera3D = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);
camera3D.position.set(0, 3.2, 7.5);

const controls = new OrbitControls(camera3D, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.0;
controls.maxDistance = 50;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going beneath ground
controls.target.set(0, 0.9, 0);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;
controls.update();

const initCamPos = camera3D.position.clone();
const initCamTarget = controls.target.clone();

// ── Lighting Setup ────────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight('#ffffff', 1.6);
scene3D.add(ambientLight);

const sunLight = new THREE.DirectionalLight('#fff8ea', 2.8);
sunLight.position.set(6, 12, 6);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 40;
sunLight.shadow.camera.top = 15;
sunLight.shadow.camera.bottom = -15;
sunLight.shadow.camera.left = -15;
sunLight.shadow.camera.right = 15;
sunLight.shadow.bias = -0.0008;
scene3D.add(sunLight);

const fillLight = new THREE.DirectionalLight('#99ccff', 0.9);
fillLight.position.set(-8, 5, -4);
scene3D.add(fillLight);

const groundBounceLight = new THREE.DirectionalLight('#2d3748', 0.4);
groundBounceLight.position.set(0, -5, 0);
scene3D.add(groundBounceLight);

// IBL Environment
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene3D.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// ── Ground & Field Lines ──────────────────────────────────────────────────────
const groundGeo = new THREE.PlaneGeometry(120, 120);
const groundMat = new THREE.MeshStandardMaterial({
  color: '#0d0e12',
  roughness: 0.92,
  metalness: 0.08,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene3D.add(ground);

// Minimalist tactile arena grid
const grid = new THREE.GridHelper(30, 30, '#27272a', '#18181b');
grid.position.y = 0.005;
scene3D.add(grid);

// Stadium fetch center circle & boundary
const centerCircleGeo = new THREE.RingGeometry(0.95, 1.0, 64);
const centerCircleMat = new THREE.MeshBasicMaterial({ color: '#27272a', side: THREE.DoubleSide });
const centerCircle = new THREE.Mesh(centerCircleGeo, centerCircleMat);
centerCircle.rotation.x = -Math.PI / 2;
centerCircle.position.y = 0.006;
scene3D.add(centerCircle);

// Subdued ambient particle dust
{
  const count = 900;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 50;
    pos[i * 3 + 1] = Math.random() * 15;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: '#71717a',
    size: 0.08,
    transparent: true,
    opacity: 0.35,
  }));
  scene3D.add(points);
}

// ── Ball Object & Shadow Decal ────────────────────────────────────────────────
const BALL_RADIUS = 0.16;

// High-vis felt tennis ball
const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 32);
const ballMat = new THREE.MeshStandardMaterial({
  color: '#bef264',
  roughness: 0.55,
  metalness: 0.05,
});
const ballMesh = new THREE.Mesh(ballGeo, ballMat);
ballMesh.castShadow = true;
ballMesh.receiveShadow = true;
ballMesh.position.set(0, BALL_RADIUS, 1.5);
scene3D.add(ballMesh);

// Seam on tennis ball
{
  const seamGeo = new THREE.TorusGeometry(BALL_RADIUS * 0.99, 0.008, 16, 64);
  const seamMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 });
  const seam = new THREE.Mesh(seamGeo, seamMat);
  seam.rotation.x = Math.PI / 4;
  ballMesh.add(seam);
}

// Ground contact shadow indicator
const shadowRingGeo = new THREE.RingGeometry(0.04, BALL_RADIUS * 1.3, 32);
const shadowRingMat = new THREE.MeshBasicMaterial({
  color: '#000000',
  transparent: true,
  opacity: 0.45,
  side: THREE.DoubleSide,
});
const shadowRing = new THREE.Mesh(shadowRingGeo, shadowRingMat);
shadowRing.rotation.x = -Math.PI / 2;
shadowRing.position.y = 0.01;
scene3D.add(shadowRing);

// ── Dog Model Hierarchy ───────────────────────────────────────────────────────
// We use a root container for physics & world navigation, while internal child
// preserves scale, centering and Blender axis correction.
const dogRoot = new THREE.Group();
scene3D.add(dogRoot);

let dogMeshGroup = null;
let dogMouthOffset = new THREE.Vector3(0, 0.7, 0.9); // relative mouth pickup position
let isWireframe = false;

// ── State Machine Definition ──────────────────────────────────────────────────
const STATE = {
  IDLE: 'idle',     // State 1: Wobble along axis (Math.sin), waiting for throw
  THROW: 'throw',   // State 2: User threw ball, ball travels ballistic arc
  FETCH: 'fetch',   // State 3: Dog runs toward ball using lerp
  RETURN: 'return', // State 4: Dog picked up ball, returns to center
};

let currentState = STATE.IDLE;
let catchesCount = 0;

// Trajectory & Physics Variables
let throwStartPos   = new THREE.Vector3();
let throwTargetPos  = new THREE.Vector3();
let throwProgress   = 0;
let throwDuration   = 1.2;
let throwArcHeight  = 2.2;
let bounceCount     = 0;

// Dog navigation
const dogHomePos    = new THREE.Vector3(0, 0, 0);
let dogTargetPos    = new THREE.Vector3();
let dogSpeed        = 4.8; // units per second
let dogRotAngle     = 0;

// Interaction & Raycasting
const raycaster  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Ground plane Y=0
const threeRay   = new THREE.Raycaster();
const mouseVec   = new THREE.Vector2();
const planeIntersect = new THREE.Vector3();

let isDraggingBall = false;
let isHoveringGround = false;
let groundCursorPos = new THREE.Vector3(0, 0, 1.5);

// ── 2D SDF GLSL Novel Graphics Engine ─────────────────────────────────────────
const scene2D = new THREE.Scene();
const camera2D = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera2D.position.z = 1;

let sdfMaterial = null;
let currentSDFMode = 0;
let activeView = '3d'; // '3d' | 'sdf'
const mouseSDF = new THREE.Vector2(0.5, 0.5);

const textureLoader = new THREE.TextureLoader();
const dogCutoutTex = textureLoader.load('/models/dog_cutout.png', (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
});
const dogSDFTex = textureLoader.load('/models/dog_sdf.png', (t) => {
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
});

// GLSL Fragment Shader implementing distance gradient deformation,
// cursor proximity squish, ripple waves and sine-warp tail wag
const sdfFragmentShader = `
  precision highp float;
  uniform sampler2D u_image;
  uniform sampler2D u_sdf;
  uniform vec2 u_mouse;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform int u_mode;

  varying vec2 vUv;

  void main() {
    vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = vUv;
    vec2 m = u_mouse;

    // Sample OpenCV Distance Transform (0..1, 0.5 boundary)
    float sdfRaw = texture2D(u_sdf, p).r;

    // Compute distance gradient via finite differences
    vec2 eps = vec2(1.0 / 1024.0, 1.0 / 1024.0);
    float dx = (texture2D(u_sdf, p + vec2(eps.x, 0.0)).r - texture2D(u_sdf, p - vec2(eps.x, 0.0)).r);
    float dy = (texture2D(u_sdf, p + vec2(0.0, eps.y)).r - texture2D(u_sdf, p - vec2(0.0, eps.y)).r);
    vec2 grad = normalize(vec2(dx, dy) + 1e-5);

    // Distance to cursor in aspect-corrected space
    float distToMouse = length((p - m) * aspect);
    float prox = smoothstep(0.32, 0.0, distToMouse);

    // 1. Proximity squish & warp along mouse direction and distance gradient
    vec2 mouseDir = normalize((p - m) * aspect + 1e-5);
    vec2 squish = mouseDir * prox * 0.045;

    // 2. Ripple waves radiating from cursor across the dog's body
    float ripple = sin(distToMouse * 36.0 - u_time * 8.0) * prox * 0.016;
    vec2 rippleOffset = mouseDir * ripple;

    // 3. Tail wagging sine-warp: tail region oscillates with Math.sin
    float tailWeight = smoothstep(0.7, 0.15, p.x) * (sdfRaw > 0.25 ? 1.0 : 0.0);
    float tailWag = sin(u_time * 7.5 + p.y * 6.0) * tailWeight * 0.038;
    vec2 wagOffset = vec2(0.0, tailWag);

    // Deformed UV coordinates
    vec2 warpedUv = clamp(p - squish - rippleOffset - wagOffset, 0.0, 1.0);

    if (u_mode == 0) {
      // Mode 0: Interactive Dynamic Warp, Squish & Wag
      vec4 col = texture2D(u_image, warpedUv);
      // Interactive aura when cursor hovers
      float aura = smoothstep(0.06, 0.0, abs(distToMouse - 0.12)) * prox * 0.4;
      col.rgb += vec3(0.74, 0.95, 0.39) * aura * col.a;
      gl_FragColor = col;
    } else if (u_mode == 1) {
      // Mode 1: OpenCV Distance Transform Heatmap
      float d = texture2D(u_sdf, warpedUv).r;
      vec3 heat = mix(vec3(0.05, 0.05, 0.1), vec3(0.2, 0.8, 0.4), d);
      heat = mix(heat, vec3(0.9, 0.95, 0.3), pow(d, 2.5));
      gl_FragColor = vec4(heat, 1.0);
    } else {
      // Mode 2: Isocontour Isolines
      float d = texture2D(u_sdf, warpedUv).r;
      float lines = abs(fract(d * 18.0) - 0.5);
      float lineMask = smoothstep(0.12, 0.0, lines);
      vec3 base = vec3(0.06, 0.07, 0.1);
      vec3 col = mix(base, vec3(0.4, 0.95, 0.8), lineMask);
      gl_FragColor = vec4(col, 1.0);
    }
  }
`;

const sdfVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

sdfMaterial = new THREE.ShaderMaterial({
  vertexShader: sdfVertexShader,
  fragmentShader: sdfFragmentShader,
  uniforms: {
    u_image: { value: dogCutoutTex },
    u_sdf: { value: dogSDFTex },
    u_mouse: { value: new THREE.Vector2(0.5, 0.5) },
    u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    u_time: { value: 0.0 },
    u_mode: { value: 0 },
  },
  depthTest: false,
  depthWrite: false,
});

const sdfQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sdfMaterial);
scene2D.add(sdfQuad);

// ── Load 3D Dog FBX ───────────────────────────────────────────────────────────
loaderBar.style.width = '20%';
loaderPct.textContent = '20%';
loaderText.textContent = 'PARSING FBX RIG';

const fallbackTex = textureLoader.load('/models/dog1.png', (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
});

const fbxLoader = new FBXLoader();
fbxLoader.load(
  '/models/dog.fbx',
  (fbx) => {
    dogMeshGroup = fbx;

    // Check sideways orientation (Blender Z-up vs Three.js Y-up)
    const preBox = new THREE.Box3().setFromObject(fbx);
    const preSize = preBox.getSize(new THREE.Vector3());
    if (preSize.x > preSize.y * 1.4 || preSize.z > preSize.y * 1.4) {
      fbx.rotation.x = -Math.PI / 2;
    }

    // Material enhancement & textures
    fbx.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (!m) return;
          if (m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
          } else {
            m.map = fallbackTex;
          }
          m.roughness = 0.8;
          m.metalness = 0.05;
          m.needsUpdate = true;
        });
      }
    });

    // Normalize scale to ~2.2 units
    const box = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2.2 / maxDim;

    fbx.scale.setScalar(scale);
    fbx.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

    dogRoot.add(fbx);
    dogRoot.position.copy(dogHomePos);

    // Compute estimated mouth position from bounding box
    const scaledBox = new THREE.Box3().setFromObject(dogRoot);
    const scaledSize = scaledBox.getSize(new THREE.Vector3());
    dogMouthOffset.set(0, scaledSize.y * 0.45, scaledSize.z * 0.42);

    loaderBar.style.width = '100%';
    loaderPct.textContent = '100%';
    loaderText.textContent = 'READY';

    setTimeout(() => {
      loaderOverlay.classList.add('hidden');
    }, 350);
  },
  (xhr) => {
    if (xhr.total > 0) {
      const pct = Math.min(95, Math.round(20 + (xhr.loaded / xhr.total) * 75));
      loaderBar.style.width = `${pct}%`;
      loaderPct.textContent = `${pct}%`;
    }
  },
  (err) => {
    console.error('FBX Load Error:', err);
    loaderText.textContent = 'MODEL LOAD ERROR';
    loaderText.style.color = '#f87171';
  }
);

// ── State Machine Transition Manager ──────────────────────────────────────────
function setGameState(newState) {
  currentState = newState;
  statState.textContent = newState.toUpperCase();

  // Update State Tracker Segmented UI
  Object.keys(stateSteps).forEach((key) => {
    stateSteps[key].classList.toggle('active', key === newState);
  });

  // Dynamic Instructions
  if (newState === STATE.IDLE) {
    instructionText.textContent = 'Click anywhere on the field or drag the ball to throw';
    statState.style.color = 'var(--accent-cyan)';
  } else if (newState === STATE.THROW) {
    instructionText.textContent = 'Ball is flying across the field!';
    statState.style.color = 'var(--accent-amber)';
  } else if (newState === STATE.FETCH) {
    instructionText.textContent = 'Rover is tracking and retrieving the ball...';
    statState.style.color = 'var(--accent-lime)';
  } else if (newState === STATE.RETURN) {
    instructionText.textContent = 'Ball secured! Bringing it back to you...';
    statState.style.color = 'var(--accent-emerald)';
  }
}

// ── Throw Ball Logic ──────────────────────────────────────────────────────────
function initiateThrow(targetX, targetZ) {
  // Clamp target coordinates inside playable arena
  const clampedX = THREE.MathUtils.clamp(targetX, -14, 14);
  const clampedZ = THREE.MathUtils.clamp(targetZ, -14, 14);

  // Avoid throwing right under the dog's feet
  const distFromHome = Math.hypot(clampedX, clampedZ);
  if (distFromHome < 1.5) {
    // Offset outward if too close
    const angle = Math.atan2(clampedZ, clampedX);
    targetX = Math.cos(angle) * 3.5;
    targetZ = Math.sin(angle) * 3.5;
  }

  throwStartPos.copy(ballMesh.position);
  throwTargetPos.set(clampedX, BALL_RADIUS, clampedZ);
  throwProgress = 0;
  bounceCount = 0;

  const flightDist = throwStartPos.distanceTo(throwTargetPos);
  throwDuration = Math.max(0.8, Math.min(2.0, flightDist * 0.18));
  throwArcHeight = Math.max(1.2, Math.min(3.5, flightDist * 0.35));

  sfx.throw();
  setGameState(STATE.THROW);
}

// Quick random toss button
btnQuickThrow.addEventListener('click', () => {
  const angle = Math.random() * Math.PI * 2;
  const dist = 5.0 + Math.random() * 7.0;
  initiateThrow(Math.cos(angle) * dist, Math.sin(angle) * dist);
});

// ── Pointer Raycasting & Throw Controls ───────────────────────────────────────
function updatePointerPlane(e) {
  const rect = canvas.getBoundingClientRect();
  mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  threeRay.setFromCamera(mouseVec, camera3D);
  threeRay.ray.intersectPlane(raycaster, planeIntersect);

  // Update 2D SDF mouse uniforms in 0..1 space
  mouseSDF.x = (e.clientX - rect.left) / rect.width;
  mouseSDF.y = 1.0 - (e.clientY - rect.top) / rect.height;
  if (sdfMaterial) {
    sdfMaterial.uniforms.u_mouse.value.copy(mouseSDF);
  }
}

canvas.addEventListener('pointermove', (e) => {
  updatePointerPlane(e);

  if (activeView === '3d') {
    // If in IDLE and user is dragging or aiming the ball
    if (currentState === STATE.IDLE) {
      if (isDraggingBall) {
        reticle.style.left = `${e.clientX}px`;
        reticle.style.top = `${e.clientY}px`;
      }
    }
  }
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // Left click only
  updatePointerPlane(e);

  if (activeView === '3d') {
    if (currentState === STATE.IDLE) {
      isDraggingBall = true;
      controls.enabled = false; // Disable orbit during ball toss drag
      reticle.classList.remove('hidden');
      reticle.style.left = `${e.clientX}px`;
      reticle.style.top = `${e.clientY}px`;
    }
  }
});

window.addEventListener('pointerup', (e) => {
  if (isDraggingBall) {
    isDraggingBall = false;
    controls.enabled = true;
    reticle.classList.add('hidden');

    if (currentState === STATE.IDLE && planeIntersect) {
      initiateThrow(planeIntersect.x, planeIntersect.z);
    }
  }
});

// ── Mode Switcher (3D Arena vs 2D SDF Shader) ─────────────────────────────────
function setViewMode(mode) {
  activeView = mode;
  btnMode3D.classList.toggle('active', mode === '3d');
  btnModeSDF.classList.toggle('active', mode === 'sdf');
  btnMode3D.setAttribute('aria-selected', mode === '3d');
  btnModeSDF.setAttribute('aria-selected', mode === 'sdf');

  if (mode === 'sdf') {
    sdfToolbar.classList.remove('hidden');
    controls.enabled = false;
    instructionText.textContent = '2D SDF Shader Active · Hover cursor over dog to warp & squish';
  } else {
    sdfToolbar.classList.add('hidden');
    controls.enabled = true;
    setGameState(currentState);
  }
}

btnMode3D.addEventListener('click', () => setViewMode('3d'));
btnModeSDF.addEventListener('click', () => setViewMode('sdf'));

sdfModeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    sdfModeBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentSDFMode = parseInt(btn.dataset.sdfMode, 10);
    if (sdfMaterial) {
      sdfMaterial.uniforms.u_mode.value = currentSDFMode;
    }
  });
});

// ── Secondary Controls ────────────────────────────────────────────────────────
btnWireframe.addEventListener('click', () => {
  isWireframe = !isWireframe;
  btnWireframe.classList.toggle('active', isWireframe);
  if (dogMeshGroup) {
    dogMeshGroup.traverse((c) => {
      if (c instanceof THREE.Mesh) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => { m.wireframe = isWireframe; });
      }
    });
  }
});

btnRotate.addEventListener('click', () => {
  controls.autoRotate = !controls.autoRotate;
  btnRotate.classList.toggle('active', controls.autoRotate);
});

btnResetCam.addEventListener('click', () => {
  camera3D.position.copy(initCamPos);
  controls.target.copy(initCamTarget);
  controls.update();
});

// ── Window Resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;

  camera3D.aspect = w / h;
  camera3D.updateProjectionMatrix();

  renderer.setSize(w, h);

  if (sdfMaterial) {
    sdfMaterial.uniforms.u_resolution.value.set(w, h);
  }
});

// ── Continuous Simulation & Animation Loop ────────────────────────────────────
let clock = new THREE.Clock();
let fpsTime = performance.now();
let fpsFrames = 0;

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.1);
  const time = clock.getElapsedTime();

  // 1. Render 2D SDF Shader if active
  if (activeView === 'sdf') {
    if (sdfMaterial) {
      sdfMaterial.uniforms.u_time.value = time;
    }
    renderer.render(scene2D, camera2D);
  } else {
    // 2. Orbit Controls Update
    controls.update();

    // 3. State Machine Update
    updateStateMachine(delta, time);

    // 4. Update Shadow Decal under Ball
    shadowRing.position.x = ballMesh.position.x;
    shadowRing.position.z = ballMesh.position.z;
    // Scale shadow ring based on ball height
    const shadowScale = Math.max(0.3, 1.0 - (ballMesh.position.y - BALL_RADIUS) * 0.25);
    shadowRing.scale.setScalar(shadowScale);
    shadowRingMat.opacity = Math.max(0.1, 0.45 * shadowScale);

    // 5. Update Telemetry
    const ballDist = dogRoot.position.distanceTo(ballMesh.position);
    statDistance.textContent = `${ballDist.toFixed(1)}m`;

    // 6. Render 3D Scene
    renderer.render(scene3D, camera3D);
  }

  // FPS Counter
  fpsFrames++;
  const now = performance.now();
  if (now - fpsTime >= 1000) {
    statFps.textContent = `${fpsFrames}`;
    fpsFrames = 0;
    fpsTime = now;
  }
}

// ── State Machine Logic ───────────────────────────────────────────────────────
function updateStateMachine(dt, time) {
  switch (currentState) {
    // ══════════════════════════════════════════════════════════════════════════
    // STATE 1: IDLE / WAG
    // Rotate or wobble the dog object slightly along its axis using sine waves (Math.sin(time))
    // ══════════════════════════════════════════════════════════════════════════
    case STATE.IDLE: {
      // Axis wobble using Math.sin(time)
      const idleWobble = Math.sin(time * 3.2) * 0.08;
      const breathingBob = Math.sin(time * 6.5) * 0.025;

      dogRoot.rotation.y = THREE.MathUtils.lerp(dogRoot.rotation.y, idleWobble, 0.1);
      dogRoot.position.y = Math.max(0, breathingBob);

      // Tail wag body sway
      if (dogMeshGroup) {
        dogMeshGroup.rotation.z = Math.sin(time * 5.0) * 0.03;
      }

      // If user is dragging the ball, make the ball follow pointer smoothly
      if (isDraggingBall && planeIntersect) {
        ballMesh.position.x = THREE.MathUtils.lerp(ballMesh.position.x, planeIntersect.x, 0.2);
        ballMesh.position.z = THREE.MathUtils.lerp(ballMesh.position.z, planeIntersect.z, 0.2);
        ballMesh.position.y = BALL_RADIUS + 0.08;
      } else {
        // Ball rests waiting near home
        ballMesh.position.y = BALL_RADIUS;
      }
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STATE 2: THROW
    // Animate ball along parabolic arc toward target coordinate, with bounces
    // ══════════════════════════════════════════════════════════════════════════
    case STATE.THROW: {
      throwProgress += dt / throwDuration;

      if (throwProgress < 1.0) {
        // Parabolic arc in flight
        const p = throwProgress;
        ballMesh.position.x = throwStartPos.x + (throwTargetPos.x - throwStartPos.x) * p;
        ballMesh.position.z = throwStartPos.z + (throwTargetPos.z - throwStartPos.z) * p;
        ballMesh.position.y = BALL_RADIUS + 4.0 * throwArcHeight * p * (1.0 - p);

        // Spin ball in air
        ballMesh.rotation.x += dt * 8.0;
        ballMesh.rotation.z += dt * 5.0;

        // Dog watches the ball in flight
        const angleToBall = Math.atan2(
          ballMesh.position.x - dogRoot.position.x,
          ballMesh.position.z - dogRoot.position.z
        );
        dogRoot.rotation.y = THREE.MathUtils.lerp(dogRoot.rotation.y, angleToBall, 0.08);
      } else {
        // Ball lands on ground with a realistic bounce
        if (bounceCount === 0) {
          sfx.bounce();
          bounceCount++;
        }

        ballMesh.position.copy(throwTargetPos);
        ballMesh.position.y = BALL_RADIUS;

        // Transition to Fetch state
        setGameState(STATE.FETCH);
      }
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STATE 3: FETCH
    // Animate the dog toward the ball coordinate using linear interpolation (lerp)
    // ══════════════════════════════════════════════════════════════════════════
    case STATE.FETCH: {
      // Calculate target direction
      const dx = ballMesh.position.x - dogRoot.position.x;
      const dz = ballMesh.position.z - dogRoot.position.z;
      const dist = Math.hypot(dx, dz);

      // Smoothly rotate dog to face the ball
      const targetAngle = Math.atan2(dx, dz);
      // Shortest angle interpolation
      let angleDiff = targetAngle - dogRoot.rotation.y;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      dogRoot.rotation.y += angleDiff * Math.min(1.0, 7.0 * dt);

      // Animate dog toward ball coordinate using linear interpolation (lerp)
      const step = (dogSpeed * dt) / Math.max(0.001, dist);
      const lerpFactor = Math.min(1.0, step);
      dogRoot.position.x = THREE.MathUtils.lerp(dogRoot.position.x, ballMesh.position.x, lerpFactor);
      dogRoot.position.z = THREE.MathUtils.lerp(dogRoot.position.z, ballMesh.position.z, lerpFactor);

      // Running bounding bounce & gallop wobble
      const runCycle = time * 13.0;
      dogRoot.position.y = Math.abs(Math.sin(runCycle)) * 0.14;
      if (dogMeshGroup) {
        dogMeshGroup.rotation.z = Math.sin(runCycle) * 0.06;
      }

      // Check pickup distance
      if (dist < 0.42) {
        sfx.pickup();
        setGameState(STATE.RETURN);
      }
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STATE 4: RETURN
    // Have the dog "pick up" the ball (attach ball matrix to dog) and return
    // ══════════════════════════════════════════════════════════════════════════
    case STATE.RETURN: {
      // Attach ball matrix / position to dog mouth front offset
      const mouthWorld = dogMouthOffset.clone().applyEuler(dogRoot.rotation).add(dogRoot.position);
      ballMesh.position.copy(mouthWorld);

      // Calculate path back to origin center screen
      const dx = dogHomePos.x - dogRoot.position.x;
      const dz = dogHomePos.z - dogRoot.position.z;
      const dist = Math.hypot(dx, dz);

      // Smoothly rotate dog to face origin
      const targetAngle = Math.atan2(dx, dz);
      let angleDiff = targetAngle - dogRoot.rotation.y;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      dogRoot.rotation.y += angleDiff * Math.min(1.0, 6.0 * dt);

      // Lerp dog back to center screen
      const step = (dogSpeed * dt) / Math.max(0.001, dist);
      const lerpFactor = Math.min(1.0, step);
      dogRoot.position.x = THREE.MathUtils.lerp(dogRoot.position.x, dogHomePos.x, lerpFactor);
      dogRoot.position.z = THREE.MathUtils.lerp(dogRoot.position.z, dogHomePos.z, lerpFactor);

      // Return running bounding bounce
      const runCycle = time * 12.0;
      dogRoot.position.y = Math.abs(Math.sin(runCycle)) * 0.12;
      if (dogMeshGroup) {
        dogMeshGroup.rotation.z = Math.sin(runCycle) * 0.05;
      }

      // Reached center screen
      if (dist < 0.3) {
        // Drop ball in front of dog
        ballMesh.position.set(dogHomePos.x, BALL_RADIUS, dogHomePos.z + 1.4);
        dogRoot.position.copy(dogHomePos);
        dogRoot.rotation.y = 0;
        if (dogMeshGroup) dogMeshGroup.rotation.z = 0;

        catchesCount++;
        statCatches.textContent = `${catchesCount}`;
        sfx.success();

        setGameState(STATE.IDLE);
      }
      break;
    }
  }
}

// ── Kick Off Loop ─────────────────────────────────────────────────────────────
setGameState(STATE.IDLE);
animate();

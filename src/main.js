/**
 * FetchingReality – Modern 3D Fetch Simulation & 2D SDF Novel Graphics Engine
 *
 * Features:
 * 1. Animated Dog 3D Model (animated_dog.glb / dog_animation.glb):
 *    - 'Howl' Animation: Triggers when the user clicks on the dog's tail (or clicks Howl button)
 *    - 'Bite' Animation: Plays when the dog retrieves the ball, with the ball locking to the dog's mouth
 *    - 'Walk' Animation: Plays whenever the dog is walking/running (Fetch & Return states)
 *    - 'Idle' Animation: Preserves gentle procedural axis wobble Math.sin(time) & body breathing
 * 2. Ball Object with realistic 3D physics, cursor tracking & fling mechanics
 * 3. 4-State Fetch Machine:
 *    - State 1 (Idle/Wag): Axis sine-wobble Math.sin(time) & body breathing
 *    - State 2 (Throw): Parabolic ballistic trajectory & ground bounces
 *    - State 3 (Fetch): Dog walks toward ball using lerp with skeletal Walk animation
 *    - State 4 (Return): Ball attached to dog mouth bone, dog walks back to center
 * 4. 2D SDF GLSL Novel Graphics Engine:
 *    - OpenCV Distance Transform (dog_sdf.png) + RGBA Cutout (dog_cutout.png)
 *    - Fragment shader dynamic distance-gradient warp, cursor proximity head squish & sine wag
 * 5. Bespoke Studio UI & Zero-dependency Web Audio Sound Effects (including Howl audio)
 */

import * as THREE from 'three';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
const btnHowl       = document.getElementById('btn-howl');
const btnWireframe  = document.getElementById('btn-toggle-wireframe');
const btnRotate     = document.getElementById('btn-toggle-rotate');
const btnResetCam   = document.getElementById('btn-reset-cam');
const btnEnableCam  = document.getElementById('btn-enable-camera');
const btnMode3D     = document.getElementById('btn-mode-3d');
const btnModeSDF    = document.getElementById('btn-mode-sdf');
const sdfToolbar    = document.getElementById('sdf-toolbar');
const sdfModeBtns   = document.querySelectorAll('.sdf-mode-btn');
const handVideo     = document.getElementById('hand-video');
const handTrackingOverlay = document.getElementById('hand-tracking-overlay');

const handTracking = {
  x: 0.5,
  y: 0.5,
  active: false,
  confidence: 0,
};

let handLandmarker = null;
let handTrackingLoopActive = false;

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
  howl() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    // Melodic canine howl: pitch sweep up then gradual taper down
    osc.frequency.setValueAtTime(270, t);
    osc.frequency.exponentialRampToValueAtTime(540, t + 0.5);
    osc.frequency.setValueAtTime(540, t + 1.2);
    osc.frequency.exponentialRampToValueAtTime(290, t + 2.3);

    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
    gain.gain.setValueAtTime(0.18, t + 1.3);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.3);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 2.3);
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

async function initHandTracking() {
  if (handLandmarker || handTrackingLoopActive) {
    return;
  }

  const isSecureContext = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  if (!navigator.mediaDevices?.getUserMedia || !isSecureContext) {
    instructionText.textContent = 'Camera access requires a real browser tab on localhost/https. Open this page in Chrome or Edge, not an embedded preview.';
    return;
  }

  try {
    handTrackingLoopActive = true;

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
    );

    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 1,
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });

    handVideo.srcObject = stream;
    handVideo.onloadedmetadata = () => {
      handVideo.play().catch(() => {});
      handTrackingOverlay.classList.remove('hidden');
    };

    const detectHands = () => {
      if (!handLandmarker || !handVideo.videoWidth || !handVideo.videoHeight) {
        requestAnimationFrame(detectHands);
        return;
      }

      const result = handLandmarker.detectForVideo(handVideo, performance.now());
      const firstHand = result.landmarks?.[0];

      if (firstHand) {
        const indexTip = firstHand[8];
        handTracking.x = THREE.MathUtils.clamp(indexTip.x, 0, 1);
        handTracking.y = THREE.MathUtils.clamp(indexTip.y, 0, 1);
        handTracking.active = true;
        handTracking.confidence = result.handedness?.[0]?.[0]?.score ?? 0.9;
      } else {
        handTracking.active = false;
      }

      requestAnimationFrame(detectHands);
    };

    requestAnimationFrame(detectHands);
  } catch (error) {
    console.warn('Hand tracking unavailable:', error);
    const message = error?.name === 'NotAllowedError'
      ? 'Camera permission was blocked. Open the site in a normal Chrome/Edge tab and allow camera access.'
      : error?.name === 'NotFoundError'
        ? 'No webcam was found. Plug one in or select a working camera in Chrome settings.'
        : 'Camera startup failed. Open this page in a normal browser tab over localhost and allow access.';

    instructionText.textContent = message;
    handTracking.active = false;
    handTrackingLoopActive = false;
  }
}

async function enableHandTracking() {
  if (!handTrackingLoopActive) {
    instructionText.textContent = 'Allow camera access, then move your hand in front of the webcam.';
    await initHandTracking();
  }
}

btnEnableCam?.addEventListener('click', () => {
  enableHandTracking();
});

window.addEventListener('pointerdown', () => {
  if (!handTrackingLoopActive) {
    enableHandTracking();
  }
}, { once: true });

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

// ── Dog Model Hierarchy & Animation Rig ───────────────────────────────────────
const dogRoot = new THREE.Group();
scene3D.add(dogRoot);

let dogMeshGroup = null;
let dogSkinnedMesh = null;
let mixer = null;
const actions = { bite: null, howl: null, walk: null };
let currentActiveAction = null;
let isHowling = false;

// Bones
let mouthBone = null;  // Chin / Nose for ball positioning & biting
let tailBone = null;   // Tail_Tip / Tail_Base for tail-click raycast detection
let tailBaseBone = null;

let isWireframe = false;

// ── State Machine Definition ──────────────────────────────────────────────────
const STATE = {
  IDLE: 'idle',     // State 1: Wobble along axis (Math.sin), waiting for throw
  THROW: 'throw',   // State 2: User threw ball, ball travels ballistic arc
  FETCH: 'fetch',   // State 3: Dog runs toward ball using lerp + Walk animation
  RETURN: 'return', // State 4: Dog picked up ball (Bite animation), returns to center
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
let dogSpeed        = 4.5; // units per second

// Interaction & Raycasting
const raycasterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Ground plane Y=0
const threeRay       = new THREE.Raycaster();
const mouseVec       = new THREE.Vector2();
const planeIntersect = new THREE.Vector3();

let isDraggingBall = false;
let pointerDownPos = new THREE.Vector2();
let pointerDownTime = 0;

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

// GLSL Fragment Shader implementing distance gradient deformation
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

    // 3. Tail wagging sine-warp
    float tailWeight = smoothstep(0.7, 0.15, p.x) * (sdfRaw > 0.25 ? 1.0 : 0.0);
    float tailWag = sin(u_time * 7.5 + p.y * 6.0) * tailWeight * 0.038;
    vec2 wagOffset = vec2(0.0, tailWag);

    vec2 warpedUv = clamp(p - squish - rippleOffset - wagOffset, 0.0, 1.0);

    if (u_mode == 0) {
      vec4 col = texture2D(u_image, warpedUv);
      float aura = smoothstep(0.06, 0.0, abs(distToMouse - 0.12)) * prox * 0.4;
      col.rgb += vec3(0.74, 0.95, 0.39) * aura * col.a;
      gl_FragColor = col;
    } else if (u_mode == 1) {
      float d = texture2D(u_sdf, warpedUv).r;
      vec3 heat = mix(vec3(0.05, 0.05, 0.1), vec3(0.2, 0.8, 0.4), d);
      heat = mix(heat, vec3(0.9, 0.95, 0.3), pow(d, 2.5));
      gl_FragColor = vec4(heat, 1.0);
    } else {
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

// ── Dog Fur Texture Setup ─────────────────────────────────────────────────────
const dogTexture = textureLoader.load('/models/dog1.png', (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = true; // Essential: Blender UV coordinate layout requires flipY=true (99.5% accuracy)
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;

  if (dogMeshGroup) {
    dogMeshGroup.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          m.map = t;
          m.color.set('#ffffff');
          m.needsUpdate = true;
        });
      }
    });
  }
});

// ── Load Animated 3D Dog Model (GLTF) ─────────────────────────────────────────
loaderBar.style.width = '20%';
loaderPct.textContent = '20%';
loaderText.textContent = 'LOADING ANIMATED MODEL';

const gltfLoader = new GLTFLoader();
const modelUrl = '/models/animated_dog.glb';

gltfLoader.load(
  modelUrl,
  (gltf) => {
    dogMeshGroup = gltf.scene;

    // Set up material with dog1.png texture
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.isSkinnedMesh) {
          dogSkinnedMesh = child;
        }

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (!m) return;
          m.map = dogTexture;
          m.color.set('#ffffff'); // Reset blue tint from GLB so texture displays natural fur colors
          m.roughness = 0.75;
          m.metalness = 0.0;
          m.needsUpdate = true;
        });
      }
    });

    // Locate essential bones for interaction & animation
    mouthBone    = gltf.scene.getObjectByName('Chin') || gltf.scene.getObjectByName('Chin_Tip') || gltf.scene.getObjectByName('Nose') || gltf.scene.getObjectByName('Head');
    tailBone     = gltf.scene.getObjectByName('Tail_Tip') || gltf.scene.getObjectByName('Tail_End');
    tailBaseBone = gltf.scene.getObjectByName('Tail_Base') || gltf.scene.getObjectByName('Tail_Mid');

    // Scale and place on ground
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2.2 / maxDim;

    gltf.scene.scale.setScalar(scale);
    // Sit base directly on Y=0
    gltf.scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);

    dogRoot.add(gltf.scene);
    dogRoot.position.copy(dogHomePos);

    // ── Setup Animation Mixer & Actions ─────────────────────────────────────
    mixer = new THREE.AnimationMixer(gltf.scene);

    gltf.animations.forEach((clip) => {
      const lower = clip.name.toLowerCase();
      if (lower.includes('walk')) {
        actions.walk = mixer.clipAction(clip);
        actions.walk.setLoop(THREE.LoopRepeat);
      } else if (lower.includes('bite')) {
        actions.bite = mixer.clipAction(clip);
        actions.bite.setLoop(THREE.LoopOnce);
        actions.bite.clampWhenFinished = false;
      } else if (lower.includes('howl')) {
        actions.howl = mixer.clipAction(clip);
        actions.howl.setLoop(THREE.LoopOnce);
        actions.howl.clampWhenFinished = false;
      }
    });

    // Listen for animation finished events (for Howl & Bite)
    mixer.addEventListener('finished', (e) => {
      if (e.action === actions.howl) {
        isHowling = false;
        if (currentState === STATE.IDLE) {
          instructionText.textContent = 'Click anywhere on the field or drag the ball to throw';
        }
      }
    });

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
    console.error('GLTF Load Error:', err);
    loaderText.textContent = 'MODEL LOAD ERROR';
    loaderText.style.color = '#f87171';
  }
);

// ── Trigger Howl Animation ────────────────────────────────────────────────────
function triggerHowl() {
  if (!actions.howl || isHowling) return;
  isHowling = true;

  // Fade out walk if walking
  if (actions.walk) actions.walk.fadeOut(0.2);

  // Play Howl animation
  actions.howl.reset();
  actions.howl.fadeIn(0.2);
  actions.howl.play();

  // Play audio howl effect
  sfx.howl();

  instructionText.textContent = '🐺 Awoooo! Rover is howling at the moon!';
}

btnHowl.addEventListener('click', () => {
  triggerHowl();
});

// ── State Machine Transition Manager ──────────────────────────────────────────
function setGameState(newState) {
  currentState = newState;
  statState.textContent = newState.toUpperCase();

  // Update State Tracker Segmented UI
  Object.keys(stateSteps).forEach((key) => {
    stateSteps[key].classList.toggle('active', key === newState);
  });

  // Dynamic Instructions & Animation Transitions
  if (newState === STATE.IDLE) {
    instructionText.textContent = 'Click anywhere on the field to throw · Or click Rover’s tail to howl!';
    statState.style.color = 'var(--accent-cyan)';
    // Fade out walk animation
    if (actions.walk) actions.walk.fadeOut(0.25);
  } else if (newState === STATE.THROW) {
    instructionText.textContent = 'Ball is flying across the field!';
    statState.style.color = 'var(--accent-amber)';
    if (actions.walk) actions.walk.fadeOut(0.2);
  } else if (newState === STATE.FETCH) {
    instructionText.textContent = 'Rover is running to retrieve the ball...';
    statState.style.color = 'var(--accent-lime)';
    // Start Walk animation
    if (actions.walk) {
      actions.walk.reset();
      actions.walk.fadeIn(0.2);
      actions.walk.play();
    }
  } else if (newState === STATE.RETURN) {
    instructionText.textContent = 'Ball secured! Bringing it back to you...';
    statState.style.color = 'var(--accent-emerald)';
    // Keep Walk animation active
    if (actions.walk && !actions.walk.isRunning()) {
      actions.walk.reset();
      actions.walk.fadeIn(0.15);
      actions.walk.play();
    }
  }
}

// ── Throw Ball Logic ──────────────────────────────────────────────────────────
function initiateThrow(targetX, targetZ) {
  if (isHowling) return;

  const clampedX = THREE.MathUtils.clamp(targetX, -14, 14);
  const clampedZ = THREE.MathUtils.clamp(targetZ, -14, 14);

  // Avoid throwing right under the dog's feet
  const distFromHome = Math.hypot(clampedX, clampedZ);
  if (distFromHome < 1.5) {
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

btnQuickThrow.addEventListener('click', () => {
  const angle = Math.random() * Math.PI * 2;
  const dist = 5.0 + Math.random() * 7.0;
  initiateThrow(Math.cos(angle) * dist, Math.sin(angle) * dist);
});

// ── Pointer Raycasting & Tail-Click Detection ──────────────────────────────────
function updatePointerRay(e) {
  const rect = canvas.getBoundingClientRect();
  mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  threeRay.setFromCamera(mouseVec, camera3D);
  threeRay.ray.intersectPlane(raycasterPlane, planeIntersect);

  // Update 2D SDF mouse uniforms
  mouseSDF.x = (e.clientX - rect.left) / rect.width;
  mouseSDF.y = 1.0 - (e.clientY - rect.top) / rect.height;
  if (sdfMaterial) {
    sdfMaterial.uniforms.u_mouse.value.copy(mouseSDF);
  }
}

// Check if ray hits the tail area of the dog
function isClickOnTail(e) {
  if (!dogRoot || !tailBone) return false;
  threeRay.setFromCamera(mouseVec, camera3D);

  const intersects = threeRay.intersectObject(dogRoot, true);
  if (intersects.length > 0) {
    const hitPoint = intersects[0].point;
    const tailWorld = new THREE.Vector3();
    tailBone.getWorldPosition(tailWorld);

    // Distance to tail tip or base
    const distToTail = hitPoint.distanceTo(tailWorld);
    if (distToTail < 0.95) return true;

    // Also check rear of dog in local coordinates
    const localHit = dogRoot.worldToLocal(hitPoint.clone());
    if (localHit.z < -0.4) return true;
  }
  return false;
}

canvas.addEventListener('pointermove', (e) => {
  updatePointerPlane(e);

  if (activeView === '3d' && currentState === STATE.IDLE) {
    if (isDraggingBall) {
      reticle.style.left = `${e.clientX}px`;
      reticle.style.top = `${e.clientY}px`;
    } else {
      // Hover hint for tail
      if (isClickOnTail(e)) {
        canvas.style.cursor = 'pointer';
        instructionText.textContent = '🐾 Click Rover’s tail to make him howl!';
      } else {
        canvas.style.cursor = 'default';
        if (!isHowling) {
          instructionText.textContent = 'Click anywhere on the field to throw · Or click Rover’s tail to howl!';
        }
      }
    }
  }
});

function updatePointerPlane(e) {
  updatePointerRay(e);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // Left click only
  updatePointerPlane(e);

  pointerDownPos.set(e.clientX, e.clientY);
  pointerDownTime = performance.now();

  if (activeView === '3d' && currentState === STATE.IDLE) {
    // If clicked on tail, trigger Howl immediately
    if (isClickOnTail(e)) {
      triggerHowl();
      return;
    }

    isDraggingBall = true;
    controls.enabled = false;
    reticle.classList.remove('hidden');
    reticle.style.left = `${e.clientX}px`;
    reticle.style.top = `${e.clientY}px`;
  }
});

window.addEventListener('pointerup', (e) => {
  if (isDraggingBall) {
    isDraggingBall = false;
    controls.enabled = true;
    reticle.classList.add('hidden');

    const dragDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);

    if (currentState === STATE.IDLE && planeIntersect) {
      // If user barely moved cursor and clicked the tail, it was already handled or check tail
      if (dragDist < 8 && isClickOnTail(e)) {
        triggerHowl();
        return;
      }
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
      if (c.isMesh) {
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

  // 1. Update Skeletal Animation Mixer
  if (mixer) {
    mixer.update(delta);
  }

  // 2. Render 2D SDF Shader if active
  if (activeView === 'sdf') {
    if (sdfMaterial) {
      sdfMaterial.uniforms.u_time.value = time;
    }
    renderer.render(scene2D, camera2D);
  } else {
    // 3. Orbit Controls Update
    controls.update();

    // 4. State Machine Update
    updateStateMachine(delta, time);

    // 5. Update Shadow Decal under Ball
    shadowRing.position.x = ballMesh.position.x;
    shadowRing.position.z = ballMesh.position.z;
    const shadowScale = Math.max(0.3, 1.0 - (ballMesh.position.y - BALL_RADIUS) * 0.25);
    shadowRing.scale.setScalar(shadowScale);
    shadowRingMat.opacity = Math.max(0.1, 0.45 * shadowScale);

    // 6. Update Telemetry
    const ballDist = dogRoot.position.distanceTo(ballMesh.position);
    statDistance.textContent = `${ballDist.toFixed(1)}m`;

    // 7. Render 3D Scene
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

// ── Helper to Get Live Mouth Position in World Coordinates ────────────────────
const tempMouthPos = new THREE.Vector3();
function getLiveMouthWorldPos() {
  if (mouthBone) {
    mouthBone.getWorldPosition(tempMouthPos);
    // Slight forward/down adjustment so ball is nestled comfortably in the jaws
    const forward = new THREE.Vector3(0, -0.05, 0.18).applyEuler(dogRoot.rotation);
    return tempMouthPos.add(forward);
  }
  return dogRoot.position.clone().add(new THREE.Vector3(0, 0.6, 0.8).applyEuler(dogRoot.rotation));
}

// ── State Machine Logic ───────────────────────────────────────────────────────
function updateStateMachine(dt, time) {
  switch (currentState) {
    // ══════════════════════════════════════════════════════════════════════════
    // STATE 1: IDLE / WAG
    // Rotate or wobble the dog object slightly along its axis using sine waves (Math.sin(time))
    // ══════════════════════════════════════════════════════════════════════════
    case STATE.IDLE: {
      if (!isHowling) {
        // Natural subtle body breathing & axis wobble
        const idleWobble = Math.sin(time * 3.2) * 0.08;
        const breathingBob = Math.sin(time * 6.5) * 0.02;
        const handYaw = handTracking.active ? (handTracking.x - 0.5) * 1.8 : 0;
        const handPitch = handTracking.active ? (0.5 - handTracking.y) * 1.2 : 0;

        dogRoot.rotation.y = THREE.MathUtils.lerp(
          dogRoot.rotation.y,
          idleWobble + handYaw,
          handTracking.active ? 0.16 : 0.1
        );
        dogRoot.position.y = Math.max(0, breathingBob);

        // Body tilt sway with camera-driven head pitch tracking
        if (dogMeshGroup) {
          const bodySway = Math.sin(time * 5.0) * 0.025;
          const headTilt = bodySway - handPitch;
          dogMeshGroup.rotation.z = THREE.MathUtils.lerp(dogMeshGroup.rotation.z, bodySway, 0.1);
          dogMeshGroup.rotation.x = THREE.MathUtils.lerp(dogMeshGroup.rotation.x, headTilt, handTracking.active ? 0.14 : 0.08);
        }
      } else {
        dogRoot.position.y = 0;
        if (dogMeshGroup) {
          dogMeshGroup.rotation.x = THREE.MathUtils.lerp(dogMeshGroup.rotation.x, 0, 0.12);
          dogMeshGroup.rotation.z = 0;
        }
      }

      // Ball dragging interaction
      if (isDraggingBall && planeIntersect) {
        ballMesh.position.x = THREE.MathUtils.lerp(ballMesh.position.x, planeIntersect.x, 0.2);
        ballMesh.position.z = THREE.MathUtils.lerp(ballMesh.position.z, planeIntersect.z, 0.2);
        ballMesh.position.y = BALL_RADIUS + 0.08;
      } else {
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
        const p = throwProgress;
        ballMesh.position.x = throwStartPos.x + (throwTargetPos.x - throwStartPos.x) * p;
        ballMesh.position.z = throwStartPos.z + (throwTargetPos.z - throwStartPos.z) * p;
        ballMesh.position.y = BALL_RADIUS + 4.0 * throwArcHeight * p * (1.0 - p);

        // Spin ball in air
        ballMesh.rotation.x += dt * 8.0;
        ballMesh.rotation.z += dt * 5.0;

        // Dog tracks the ball in flight
        const angleToBall = Math.atan2(
          ballMesh.position.x - dogRoot.position.x,
          ballMesh.position.z - dogRoot.position.z
        );
        dogRoot.rotation.y = THREE.MathUtils.lerp(dogRoot.rotation.y, angleToBall, 0.08);
      } else {
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
    // Plays Walk animation while moving, and Bite animation when retrieving the ball
    // ══════════════════════════════════════════════════════════════════════════
    case STATE.FETCH: {
      // Calculate target direction
      const dx = ballMesh.position.x - dogRoot.position.x;
      const dz = ballMesh.position.z - dogRoot.position.z;
      const dist = Math.hypot(dx, dz);

      // Smoothly rotate dog to face the ball
      const targetAngle = Math.atan2(dx, dz);
      let angleDiff = targetAngle - dogRoot.rotation.y;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      dogRoot.rotation.y += angleDiff * Math.min(1.0, 7.0 * dt);

      // Linear interpolation (lerp) toward ball
      const step = (dogSpeed * dt) / Math.max(0.001, dist);
      const lerpFactor = Math.min(1.0, step);
      dogRoot.position.x = THREE.MathUtils.lerp(dogRoot.position.x, ballMesh.position.x, lerpFactor);
      dogRoot.position.z = THREE.MathUtils.lerp(dogRoot.position.z, ballMesh.position.z, lerpFactor);

      // Ensure Walk animation is active
      if (actions.walk && !actions.walk.isRunning()) {
        actions.walk.reset();
        actions.walk.fadeIn(0.2);
        actions.walk.play();
      }

      // Check arrival at ball coordinate
      if (dist < 0.5) {
        // Trigger Biting Animation & attach ball to mouth
        if (actions.bite) {
          if (actions.walk) actions.walk.fadeOut(0.1);
          actions.bite.reset();
          actions.bite.fadeIn(0.1);
          actions.bite.play();
        }

        sfx.pickup();

        // Snap ball to mouth position
        const mouthPos = getLiveMouthWorldPos();
        ballMesh.position.copy(mouthPos);

        setGameState(STATE.RETURN);
      }
      break;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // STATE 4: RETURN
    // Ball attaches to dog's mouth bone, dog walks back to center screen
    // ══════════════════════════════════════════════════════════════════════════
    case STATE.RETURN: {
      // Keep ball attached to dog's live mouth bone position
      const mouthPos = getLiveMouthWorldPos();
      ballMesh.position.copy(mouthPos);

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

      // Ensure Walk animation is active while returning
      if (actions.walk && !actions.walk.isRunning()) {
        actions.walk.reset();
        actions.walk.fadeIn(0.15);
        actions.walk.play();
      }

      // Reached center screen
      if (dist < 0.35) {
        // Drop ball in front of dog on the ground
        ballMesh.position.set(dogHomePos.x, BALL_RADIUS, dogHomePos.z + 1.4);
        dogRoot.position.copy(dogHomePos);
        dogRoot.rotation.y = 0;
        if (dogMeshGroup) dogMeshGroup.rotation.z = 0;

        catchesCount++;
        statCatches.textContent = `${catchesCount}`;
        sfx.success();

        // Fade out walk animation
        if (actions.walk) actions.walk.fadeOut(0.25);

        setGameState(STATE.IDLE);
      }
      break;
    }
  }
}

// ── Kick Off Loop ─────────────────────────────────────────────────────────────
setGameState(STATE.IDLE);
animate();

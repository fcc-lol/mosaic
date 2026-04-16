import React, { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash, faCameraRotate, faCloudArrowUp, faXmark } from '@fortawesome/free-solid-svg-icons';

const INITIAL = {
  m: 3, n: 4, conv: 0.8, sprd: 0.8,
};

// All rendering happens on a square canvas at this pixel size.
const CANVAS_SIZE = 600;

// Locked particle/render params (no longer user-controllable).
const GRID    = 5;
const PS      = 1.4;
const BOOST   = 1.8;
const PARTOP  = 1.0;

// Maximum amount each param can swing upward when audio is at full level
const MOD_RANGE = {
  m: 7, n: 6, conv: 0.4, sprd: 0.4,
  turingScale: 6, turingWaves: 5,
};

// ── value arrays for matrix controllers ──────────────────────────────────
const M_VALUES      = Array.from({ length: 10 }, (_, i) => i + 1);
const N_VALUES      = Array.from({ length: 10 }, (_, i) => i + 1);
const SETTLE_VALUES = Array.from({ length: 21 }, (_, i) => +(i / 20).toFixed(2));

const TURING_INITIAL = { scale: 4, waves: 5 };
const SCALE_VALUES   = Array.from({ length: 10 }, (_, i) => i + 1);  // 1–10
const WAVES_VALUES   = Array.from({ length: 10 }, (_, i) => i + 2);  // 2–11

// ── Turing pattern: precomputed random wave directions ──────────────────
// 48 cosine waves with random orientations + phases create a band-limited
// random field whose zero-crossings form organic labyrinthine patterns
// (matching real reaction-diffusion morphology).
const TURING_N = 48;
const TURING_SEED = [];
for (let i = 0; i < TURING_N; i++) {
  // Deterministic pseudo-random via sine hash (no external PRNG needed).
  const h1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const h2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
  TURING_SEED.push({
    angle: ((h1 % 1 + 1) % 1) * Math.PI * 2,
    phase: ((h2 % 1 + 1) % 1) * Math.PI * 2,
  });
}

// ── MatrixController ──────────────────────────────────────────────────────
function MatrixController({ xValues, yValues, xVal, yVal, onSelect }) {
  const cols = xValues.length;
  const rows = yValues.length;
  const CELL = 20, PAD = 6;
  const vw   = cols * CELL + PAD * 2;
  const vh   = rows * CELL + PAD * 2;
  const selX = Math.max(0, xValues.findIndex(v => Math.abs(v - xVal) < 1e-9));
  const selY = Math.max(0, yValues.findIndex(v => Math.abs(v - yVal) < 1e-9));
  const sig  = (Math.max(cols, rows) - 1) * 0.35;
  const svgRef = React.useRef(null);
  const onSelectRef = React.useRef(onSelect);
  React.useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const coordsToCell = (el, clientX, clientY) => {
    const rect = el.getBoundingClientRect();
    const sx = (clientX - rect.left) * vw / rect.width - PAD;
    const sy = (clientY - rect.top) * vh / rect.height - PAD;
    return [
      Math.max(0, Math.min(cols - 1, Math.floor(sx / CELL))),
      Math.max(0, Math.min(rows - 1, Math.floor(sy / CELL))),
    ];
  };

  const fireSelect = (el, clientX, clientY) => {
    const [xi, yi] = coordsToCell(el, clientX, clientY);
    onSelectRef.current(xValues[xi], yValues[yi]);
  };

  // Attach touch listeners as non-passive so preventDefault works (prevents scroll).
  React.useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onStart = e => { e.preventDefault(); const t = e.targetTouches[0]; fireSelect(el, t.clientX, t.clientY); };
    const onMove  = e => { e.preventDefault(); const t = e.targetTouches[0]; fireSelect(el, t.clientX, t.clientY); };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); };
  }, [xValues, yValues]);  // re-bind if value arrays change

  const dots = [];
  for (let yi = 0; yi < rows; yi++) {
    for (let xi = 0; xi < cols; xi++) {
      const dx = xi - selX, dy = yi - selY;
      const t  = Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
      dots.push(
        <circle
          key={`${xi},${yi}`}
          cx={PAD + xi * CELL + CELL / 2}
          cy={PAD + yi * CELL + CELL / 2}
          r={1.5 + 4.5 * t}
          fill="var(--accent)"
          fillOpacity={0.1 + 0.9 * t}
        />
      );
    }
  }

  return (
    <svg
      ref={svgRef}
      className="matrix-svg"
      viewBox={`0 0 ${vw} ${vh}`}
      width="100%"
      onClick={e => fireSelect(e.currentTarget, e.clientX, e.clientY)}
      onMouseMove={e => { if (e.buttons) fireSelect(e.currentTarget, e.clientX, e.clientY); }}
    >
      {dots}
    </svg>
  );
}

export default function ChladniParticleGhost() {
  const ptCanvasRef      = useRef(null);
  const canvasWrapRef    = useRef(null);
  const statusRef        = useRef(null);
  const videoRef         = useRef(null);
  const cameraTmpRef     = useRef(null);
  const bgCanvasRef      = useRef(null); // tiny downsampled frame blurred as app bg
  const audioDataRef     = useRef(null); // cached Uint8Array for analyser reads

  // All animation-loop mutable state — never causes re-renders.
  const s = useRef({
    particles: [], dsW: 0, dsH: 0,
    animId: null, startTime: null,
    srcPixels: null,
    cameraMode: false, cameraStream: null,
    facingMode: 'environment',
    captured: false,
    micMode: false, analyser: null, audioStream: null, audioCtx: null,
    audioLevel: 0, micSensitivity: 3.0,
    micMod: Object.fromEntries(Object.keys(MOD_RANGE).map(k => [k, false])),
    patternMode: 'chladni',
    turingScale: TURING_INITIAL.scale,
    turingWaves: TURING_INITIAL.waves,
    ...INITIAL,
  });

  // React state only for UI that affects render
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isMicActive,    setIsMicActive]    = useState(false);
  const [micModParams,   setMicModParams]   = useState(new Set());
  const [facingMode,     setFacingMode]     = useState('environment');
  const [isCaptured,     setIsCaptured]     = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLayoutReady(true), 500); return () => clearTimeout(t); }, []);
  const [mVal,           setMVal]           = useState(INITIAL.m);
  const [nVal,           setNVal]           = useState(INITIAL.n);
  const [convVal,        setConvVal]        = useState(INITIAL.conv);
  const [sprdVal,        setSprdVal]        = useState(INITIAL.sprd);
  const [waveModActive,  setWaveModActive]  = useState(false);
  const [patternMode,    setPatternMode]    = useState('chladni');
  const [scaleVal,       setScaleVal]       = useState(TURING_INITIAL.scale);
  const [wavesVal,       setWavesVal]       = useState(TURING_INITIAL.waves);
  const dispRefs = useRef({});

  const setDisp = useCallback((id, text) => {
    if (dispRefs.current[id]) dispRefs.current[id].textContent = text;
  }, []);

  // ── particles ────────────────────────────────────────────────────────────

  const sampleParticles = useCallback(() => {
    const { srcPixels, dsW: W, dsH: H } = s.current;
    if (!srcPixels) return;
    const particles = [];
    for (let y = 0; y < H; y += GRID) {
      for (let x = 0; x < W; x += GRID) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = 0; dy < GRID && y + dy < H; dy++)
          for (let dx = 0; dx < GRID && x + dx < W; dx++) {
            const i = ((y + dy) * W + (x + dx)) * 4;
            r += srcPixels[i]; g += srcPixels[i + 1]; b += srcPixels[i + 2]; count++;
          }
        const cx = x + GRID / 2, cy = y + GRID / 2;
        // jitter ∈ [-1, 1] — fixed per-particle spread along the nodal-line normal.
        // jitter2 ∈ [-1, 1] — independent spread along the nodal-line tangent,
        // adding randomness in the along-line direction for a more natural scatter.
        const jitter  = Math.random() * 2 - 1;
        const jitter2 = Math.random() * 2 - 1;
        particles.push({ ox: cx, oy: cy, x: cx, y: cy, jitter, jitter2, r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) });
      }
    }
    s.current.particles = particles;
  }, []);

  // Refresh particle colors in-place from current srcPixels (used in camera mode)
  const refreshParticleColors = useCallback(() => {
    const { srcPixels, dsW: W, dsH: H, particles } = s.current;
    if (!srcPixels) return;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = Math.floor(p.ox - GRID / 2), py = Math.floor(p.oy - GRID / 2);
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = 0; dy < GRID && py + dy < H; dy++)
        for (let dx = 0; dx < GRID && px + dx < W; dx++) {
          const idx = ((py + dy) * W + (px + dx)) * 4;
          r += srcPixels[idx]; g += srcPixels[idx + 1]; b += srcPixels[idx + 2]; count++;
        }
      if (count > 0) { p.r = Math.round(r / count); p.g = Math.round(g / count); p.b = Math.round(b / count); }
    }
  }, []);

  // ── animation loop ───────────────────────────────────────────────────────

  const chladni = (x, y, m, n, W, H) => {
    const px = x / W, py = y / H;
    return Math.cos(n * Math.PI * px) * Math.cos(m * Math.PI * py)
         - Math.cos(m * Math.PI * px) * Math.cos(n * Math.PI * py);
  };

  const frame = useCallback((ts) => {
    const st = s.current;

    // ── audio level ────────────────────────────────────────────────────────
    if (st.micMode && st.analyser && audioDataRef.current) {
      st.analyser.getByteTimeDomainData(audioDataRef.current);
      let sum = 0;
      const buf = audioDataRef.current;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] / 128) - 1; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length) * 4; // scale up for sensitivity
      st.audioLevel = st.audioLevel * 0.75 + Math.min(1, rms * st.micSensitivity) * 0.25;
    }

    // ── get effective param values (base + audio modulation) ───────────────
    const p = (key) => {
      const base = st[key];
      return (st.micMode && st.micMod[key])
        ? Math.min(base + st.audioLevel * MOD_RANGE[key], base + MOD_RANGE[key])
        : base;
    };

    const { dsW: W, dsH: H, particles } = st;
    const isTuring = st.patternMode === 'turing';
    const p1 = isTuring ? p('turingScale') : p('m');
    const p2 = isTuring ? p('turingWaves') : p('n');
    const conv   = Math.max(0, Math.min(1, p('conv')));
    const spread = 4 + Math.max(0, Math.min(1, p('sprd'))) * 24;
    // Save the exact effective values used this frame so captureImage can bake them precisely.
    st.lastEffective = isTuring
      ? { turingScale: p1, turingWaves: p2, conv: p('conv'), sprd: p('sprd') }
      : { m: p1, n: p2, conv: p('conv'), sprd: p('sprd') };

    const ptX = ptCanvasRef.current?.getContext('2d');
    if (!ptX) return;
    const gs = 3;

    // ── camera: pull new frame from video (center-cropped, mirrored if front) ─────
    if (st.cameraMode && !st.captured) {
      const video = videoRef.current;
      const tmp   = cameraTmpRef.current;
      if (video && tmp && video.readyState >= 2 && video.videoWidth > 0) {
        const vw = video.videoWidth, vh = video.videoHeight;
        const sSize = Math.min(vw, vh);
        const sx = (vw - sSize) / 2;
        const sy = (vh - sSize) / 2;
        const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });
        tmpCtx.save();
        if (st.facingMode === 'user') {
          // Mirror only for front-facing camera (selfie view).
          tmpCtx.translate(W, 0);
          tmpCtx.scale(-1, 1);
        }
        tmpCtx.drawImage(video, sx, sy, sSize, sSize, 0, 0, W, H);
        tmpCtx.restore();
        const imageData = tmpCtx.getImageData(0, 0, W, H);
        st.srcPixels   = imageData.data;
        refreshParticleColors();
        // Feed a tiny downsampled copy to the blurred background canvas so
        // the whole app feels reactive to what the camera is seeing.
        const bgC = bgCanvasRef.current;
        if (bgC) bgC.getContext('2d').drawImage(tmp, 0, 0, bgC.width, bgC.height);
      }
    }

    ptX.clearRect(0, 0, W, H);

    // Draw blurry camera bg into particle canvas so export matches preview
    const bgC = bgCanvasRef.current;
    if (bgC) {
      ptX.save();
      ptX.imageSmoothingEnabled = true;
      ptX.imageSmoothingQuality = 'high';
      ptX.globalAlpha = 0.45;
      const pad = W * 0.05;
      ptX.drawImage(bgC, -pad, -pad, W + pad * 2, H + pad * 2);
      ptX.restore();
    }

    // Newton flow toward the nearest nodal line of chladni(x,y,m,n).
    // Each frame is a fresh "drop the sand": every grain restarts at its
    // origin and runs a few iterations of x ← x − (z·∇z)/|∇z|² toward z=0.
    // `conv` then lerps each grain between its origin (0 = loose cloud
    // showing the source image) and the fully snapped target (1 = tight
    // bands). Each grain is then pushed along the nodal-line normal by
    // `spread * jitter` for band thickness, and finally nudged every
    // frame by a fresh random `wiggle` so the bands shimmer like sand.
    // Fabric-curtain gather: particles displace toward nodal lines via a
    // smooth, topology-preserving tanh mapping.  Unlike Newton iteration
    // (which snaps grains to lines and leaves gaps), this keeps every region
    // of the canvas covered — the "sheet" bunches at the lines but never
    // tears, so you always see image colour at every point.
    const K = 2.2; // gather sharpness — higher → tighter bunching at lines
    const tK = Math.tanh(K); // precompute normaliser

    // Build Turing direction table once per frame — 48 waves with random
    // orientations produce organic labyrinthine zero-crossings.  The `waves`
    // param controls anisotropy: low → stripes, high → isotropic labyrinth.
    let turingDirs;
    if (isTuring) {
      const nGroups = Math.round(p2);
      const k = p1 * 2 * Math.PI / Math.min(W, H);
      turingDirs = new Array(TURING_N);
      for (let j = 0; j < TURING_N; j++) {
        let angle = TURING_SEED[j].angle;
        // Snap toward nearest of nGroups directions for stripe effect;
        // snap fades to zero as nGroups increases → isotropic labyrinth.
        const groupSize = (2 * Math.PI) / nGroups;
        const nearest = Math.round(angle / groupSize) * groupSize;
        const snap = Math.max(0, 1 - (nGroups - 2) / 9);
        angle = angle + (nearest - angle) * snap;
        turingDirs[j] = {
          kx: k * Math.cos(angle),
          ky: k * Math.sin(angle),
          ph: TURING_SEED[j].phase,
        };
      }
    }

    for (let i = 0; i < particles.length; i++) {
      const part = particles[i];

      // Compute field value z and gradient at the particle's HOME position.
      // Turing mode uses analytical gradient (cos+sin per wave, ~2.5× faster
      // than 5 finite-difference field evaluations).  Chladni keeps finite
      // differences since its closed-form gradient isn't worth the complexity.
      let z, rawGx, rawGy;
      if (isTuring) {
        let fVal = 0, dfx = 0, dfy = 0;
        for (let j = 0; j < TURING_N; j++) {
          const d = turingDirs[j];
          const arg = d.kx * part.ox + d.ky * part.oy + d.ph;
          fVal += Math.cos(arg);
          const sn = Math.sin(arg);
          dfx -= d.kx * sn;
          dfy -= d.ky * sn;
        }
        const sc = 2 / TURING_N;
        z = fVal * sc;
        rawGx = dfx * sc;
        rawGy = dfy * sc;
      } else {
        z = chladni(part.ox, part.oy, p1, p2, W, H);
        const zr = chladni(part.ox + gs, part.oy, p1, p2, W, H);
        const zl = chladni(part.ox - gs, part.oy, p1, p2, W, H);
        const zd = chladni(part.ox, part.oy + gs, p1, p2, W, H);
        const zu = chladni(part.ox, part.oy - gs, p1, p2, W, H);
        rawGx = (zr - zl) / (2 * gs);
        rawGy = (zd - zu) / (2 * gs);
      }
      const gLen = Math.sqrt(rawGx * rawGx + rawGy * rawGy) + 1e-9;
      const nx = rawGx / gLen, ny = rawGy / gLen; // unit normal (∇z direction)
      const tx = -ny,          ty =  nx;           // unit tangent (along nodal line)

      // tanh gather: maps Chladni value z ∈ [-2,2] (approx) → displacement
      // ∈ (-spread, +spread)*conv, monotonically.  Monotone ⟹ no fold-overs.
      const zn          = z * 0.5;                          // normalise to ≈[-1,1]
      const gatherFrac  = Math.tanh(zn * K) / tK;           // ∈ (-1, 1)
      const displacement = gatherFrac * spread * conv;

      let x = part.ox - nx * displacement;
      let y = part.oy - ny * displacement;

      // Thin fabric body at the gather line — small normal jitter gives the
      // gathered crease some physical thickness without hiding image detail.
      x += nx * spread * 0.12 * part.jitter  * conv;
      y += ny * spread * 0.12 * part.jitter  * conv;

      // Animated drape flutter along the gather lines.  A slow spatial wave
      // makes the curtain ripple gently so the fabric reads as alive.
      const phase   = ts * 0.0007;
      const waveAmp = 2.5 * conv;
      x += tx * (Math.sin(part.ox * 0.038 + part.oy * 0.018 + phase)       * waveAmp
               + Math.sin(part.ox * 0.019 + part.oy * 0.041 + phase * 0.7) * waveAmp * 0.5);
      y += ty * (Math.sin(part.ox * 0.018 + part.oy * 0.038 + phase * 1.1) * waveAmp
               + Math.sin(part.ox * 0.041 + part.oy * 0.019 + phase * 0.8) * waveAmp * 0.5);

      part.x = x; part.y = y;

      // Particles at the gather lines (z≈0) are denser (many stacked) so
      // we drop alpha slightly there; between lines particles are sparser but
      // more opaque so the image still reads through.
      const nearLine = Math.exp(-zn * zn * 5) * conv;         // 1 at line, 0 far
      const radius   = Math.max(0.5, PS + nearLine * 0.5);
      const alpha    = Math.min(1, (0.5 + (1 - nearLine) * 0.25) * PARTOP);
      const br = Math.min(255, Math.round(part.r * BOOST));
      const bg = Math.min(255, Math.round(part.g * BOOST));
      const bb = Math.min(255, Math.round(part.b * BOOST));
      ptX.beginPath();
      ptX.arc(x, y, radius, 0, Math.PI * 2);
      ptX.fillStyle = `rgba(${br},${bg},${bb},${alpha.toFixed(2)})`;
      ptX.fill();
    }
    st.animId = requestAnimationFrame(frame);
  }, [refreshParticleColors]);

  const startAnim = useCallback(() => {
    const st = s.current;
    if (st.animId) cancelAnimationFrame(st.animId);
    st.startTime = null;
    st.animId = requestAnimationFrame(frame);
  }, [frame]);

  // ── canvas/source setup ──────────────────────────────────────────────────

  const setupCanvas = useCallback((w, h) => {
    s.current.dsW = w; s.current.dsH = h;
    const ptC = ptCanvasRef.current;
    ptC.width = w;
    ptC.height = h;
    // The canvas is always square — let CSS (aspect-ratio) handle responsive
    // sizing so the feed doesn't stretch on narrow viewports.
  }, []);

  // ── camera ───────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    const st = s.current;
    if (st.cameraStream) { st.cameraStream.getTracks().forEach(t => t.stop()); st.cameraStream = null; }
    st.cameraMode = false;
    st.captured   = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (st.animId) { cancelAnimationFrame(st.animId); st.animId = null; }
    const ptX = ptCanvasRef.current?.getContext('2d');
    if (ptX && ptCanvasRef.current) ptX.clearRect(0, 0, ptCanvasRef.current.width, ptCanvasRef.current.height);
    const bgC = bgCanvasRef.current;
    if (bgC) bgC.getContext('2d').clearRect(0, 0, bgC.width, bgC.height);
    st.particles = []; st.srcPixels = null;
    if (statusRef.current) statusRef.current.textContent = '';
    setIsCameraActive(false);
    setIsCaptured(false);
  }, []);

  const startCamera = useCallback(async (requestedFacing) => {
    try {
      const facing = requestedFacing || s.current.facingMode || 'environment';
      const videoConstraints = {
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: { ideal: facing },
      };
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      s.current.cameraStream = stream;
      s.current.cameraMode   = true;
      s.current.facingMode   = facing;
      s.current.captured     = false;
      setFacingMode(facing);
      setIsCameraActive(true);
      setIsCaptured(false);
      const video = videoRef.current;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        // Canvas is always square. The frame loop center-crops (and mirrors if front).
        if (!cameraTmpRef.current) cameraTmpRef.current = document.createElement('canvas');
        cameraTmpRef.current.width  = CANVAS_SIZE;
        cameraTmpRef.current.height = CANVAS_SIZE;
        setupCanvas(CANVAS_SIZE, CANVAS_SIZE);
        video.addEventListener('playing', () => {
          // seed with one frame so particles sample from real colors
          const vw = video.videoWidth, vh = video.videoHeight;
          const sSize = Math.min(vw, vh);
          const sx = (vw - sSize) / 2;
          const sy = (vh - sSize) / 2;
          const tmpCtx = cameraTmpRef.current.getContext('2d', { willReadFrequently: true });
          tmpCtx.save();
          if (s.current.facingMode === 'user') {
            tmpCtx.translate(CANVAS_SIZE, 0);
            tmpCtx.scale(-1, 1);
          }
          tmpCtx.drawImage(video, sx, sy, sSize, sSize, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
          tmpCtx.restore();
          const imageData = tmpCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          s.current.srcPixels   = imageData.data;
          sampleParticles(); startAnim();
        }, { once: true });
      };
    } catch {
      if (statusRef.current) statusRef.current.textContent = 'Camera access denied';
    }
  }, [setupCanvas, sampleParticles, startAnim]);

  const toggleFacingMode = useCallback(async () => {
    const st = s.current;
    const next = st.facingMode === 'user' ? 'environment' : 'user';
    // Stop the existing stream without tearing down the canvas/particles so
    // the swap feels seamless.
    if (st.cameraStream) { st.cameraStream.getTracks().forEach(t => t.stop()); st.cameraStream = null; }
    st.captured = false;
    setIsCaptured(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width:  { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: next },
        },
      });
      st.cameraStream = stream;
      st.facingMode   = next;
      setFacingMode(next);
      const video = videoRef.current;
      video.srcObject = stream;
      video.play();
    } catch {
      if (statusRef.current) statusRef.current.textContent = 'Camera access denied';
    }
  }, []);

  // ── capture / clear / save ──────────────────────────────────────────────

  const captureImage = useCallback(() => {
    const st = s.current;
    // Bake the exact param values from the last rendered frame so the animation
    // stays at precisely what the user saw when they pressed Capture.
    if (st.lastEffective) {
      if (st.patternMode === 'turing') {
        st.turingScale = st.lastEffective.turingScale;
        st.turingWaves = st.lastEffective.turingWaves;
      } else {
        st.m = st.lastEffective.m;
        st.n = st.lastEffective.n;
      }
      st.conv = st.lastEffective.conv;
      st.sprd = st.lastEffective.sprd;
    }
    st.micModBeforeCapture = { ...st.micMod };
    st.waveModBeforeCapture = null;
    setWaveModActive(prev => { st.waveModBeforeCapture = prev; return false; });
    Object.keys(MOD_RANGE).forEach(k => { st.micMod[k] = false; });
    st.captured = true;
    setIsCaptured(true);
    if (st.patternMode === 'turing') {
      setScaleVal(st.turingScale);
      setWavesVal(st.turingWaves);
    } else {
      setMVal(st.m);
      setNVal(st.n);
    }
    setConvVal(st.conv);
    setSprdVal(st.sprd);
  }, []);

  const modKeysForMode = () =>
    s.current.patternMode === 'turing'
      ? ['turingScale', 'turingWaves', 'conv', 'sprd']
      : ['m', 'n', 'conv', 'sprd'];

  const restoreMic = useCallback(() => {
    if (s.current.micMode) {
      Object.keys(MOD_RANGE).forEach(k => { s.current.micMod[k] = false; });
      modKeysForMode().forEach(k => { s.current.micMod[k] = true; });
      setWaveModActive(true);
    }
  }, []);

  const clearCapture = useCallback(() => {
    const st = s.current;
    st.captured = false;
    setIsCaptured(false);
    if (st.waveModBeforeCapture) {
      Object.assign(st.micMod, st.micModBeforeCapture);
      setWaveModActive(true);
    }
  }, []);

  const getFlattenedBlob = useCallback(() => {
    const pt = ptCanvasRef.current;
    if (!pt) return Promise.resolve(null);
    // bg is already composited into the particle canvas each frame.
    const out = document.createElement('canvas');
    out.width  = pt.width;
    out.height = pt.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(pt, 0, 0);
    return new Promise((resolve) => out.toBlob(resolve, 'image/jpeg', 0.95));
  }, []);

  const savePhoto = useCallback(async () => {
    const blob = await getFlattenedBlob();
    if (!blob) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = s.current.patternMode === 'turing' ? 'turing' : 'chladni';
    const file = new File([blob], `${prefix}-${ts}.jpg`, { type: 'image/jpeg' });
    if (navigator.maxTouchPoints > 1 && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    s.current.captured = false;
    setIsCaptured(false);
    if (s.current.waveModBeforeCapture) {
      Object.assign(s.current.micMod, s.current.micModBeforeCapture);
      setWaveModActive(true);
    }
  }, [getFlattenedBlob]);

  const cloudApi = window.location.hostname === 'localhost'
    ? 'http://localhost:3127' : 'https://cloud.leo.gd';
  const cloudApp = window.location.hostname === 'localhost'
    ? 'http://localhost:5176' : 'https://cloud.leo.gd';

  const postToCloud = useCallback(async () => {
    // Open the window immediately to preserve the user gesture context,
    // then navigate it after the upload completes.
    const win = window.open('', '_blank');
    const blob = await getFlattenedBlob();
    if (!blob) { if (win) win.close(); return; }
    const form = new FormData();
    form.append('image', blob, 'mosaic.jpg');
    try {
      const res = await fetch(`${cloudApi}/api/prefill-media`, {
        method: 'POST',
        body: form,
      });
      const { filename } = await res.json();
      const url = `${cloudApp}/?compose=${filename}&source=mosaic`;
      if (win) win.location = url;
      else window.location = url;
    } catch (e) {
      console.warn('Post to Cloud failed:', e);
      if (win) win.close();
    }
  }, [getFlattenedBlob]);

  // ── microphone ───────────────────────────────────────────────────────────

  const stopMic = useCallback(() => {
    const st = s.current;
    if (st.audioStream) { st.audioStream.getTracks().forEach(t => t.stop()); st.audioStream = null; }
    if (st.audioCtx)    { st.audioCtx.close(); st.audioCtx = null; }
    st.analyser = null; st.micMode = false; st.audioLevel = 0;
    setIsMicActive(false);
  }, []);

  const startMic = useCallback(async () => {
    try {
      const stream  = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const ctx     = new AudioContext();
      const source  = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioDataRef.current       = new Uint8Array(analyser.frequencyBinCount);
      s.current.audioStream      = stream;
      s.current.analyser         = analyser;
      s.current.audioCtx         = ctx;
      s.current.micMode          = true;
      setIsMicActive(true);
    } catch {
      if (statusRef.current) statusRef.current.textContent = 'Microphone access denied';
    }
  }, []);

  // Combined start/stop: camera always runs together with the mic so both
  // indicators mirror the same session.
  const startCameraAndMic = useCallback(async (facing) => {
    await startCamera(facing || s.current.facingMode || 'environment');
  }, [startCamera]);

  const stopCameraAndMic = useCallback(() => {
    stopCamera();
    if (s.current.micMode) stopMic();
  }, [stopCamera, stopMic]);

  const toggleMicParam = useCallback((key) => {
    s.current.micMod[key] = !s.current.micMod[key];
    setMicModParams(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleWaveMod = useCallback(async () => {
    if (!s.current.micMode) await startMic();
    setWaveModActive(prev => {
      const next = !prev;
      Object.keys(MOD_RANGE).forEach(k => { s.current.micMod[k] = false; });
      if (next) modKeysForMode().forEach(k => { s.current.micMod[k] = true; });
      return next;
    });
  }, [startMic]);

  const switchPatternMode = useCallback((mode) => {
    s.current.patternMode = mode;
    setPatternMode(mode);
    // Re-route mic modulation to the new mode's parameters only if
    // modulation is currently active (not just mic hardware).
    setWaveModActive(prev => {
      Object.keys(MOD_RANGE).forEach(k => { s.current.micMod[k] = false; });
      if (prev) {
        const keys = mode === 'turing'
          ? ['turingScale', 'turingWaves', 'conv', 'sprd']
          : ['m', 'n', 'conv', 'sprd'];
        keys.forEach(k => { s.current.micMod[k] = true; });
      }
      return prev;
    });
  }, []);

  // ── auto-start camera on mount ────────────────────────────────────────────

  useEffect(() => {
    startCameraAndMic('environment');
  }, []);

  // ── cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraTmpRef.current) cameraTmpRef.current = document.createElement('canvas');
    return () => {
      if (s.current.animId)     cancelAnimationFrame(s.current.animId);
      if (s.current.cameraStream) s.current.cameraStream.getTracks().forEach(t => t.stop());
      if (s.current.audioStream)  s.current.audioStream.getTracks().forEach(t => t.stop());
      if (s.current.audioCtx)     s.current.audioCtx.close();
    };
  }, []);

  // ── slider/event helpers ─────────────────────────────────────────────────

  const makeSliderHandler = (key, fmt) => (e) => {
    const val = +e.target.value;
    s.current[key] = val;
    setDisp(key + 'v', fmt(val));
  };

  const dispRef = (id) => (el) => { dispRefs.current[id] = el; };

  // ── Slider component ─────────────────────────────────────────────────────

  const Slider = ({ id, min, max, step, def, fmt, label, modKey }) => (
    <div className="ctrl">
      <label>{label}<span className="label-sep"> – </span><span className="val" ref={dispRef(id + 'v')}>{fmt(def)}</span></label>
      <input
        type="range" id={id + '-slider'}
        min={min} max={max} step={step} defaultValue={def}
        onChange={makeSliderHandler(id, fmt)}
      />
      {modKey && (
        <label className="mod-wrap" title="Modulate with mic">
          <svg className="mod-mic" width="14" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <line x1="12" y1="18" x2="12" y2="22" />
          </svg>
          <input
            type="checkbox"
            className="mod-check"
            checked={micModParams.has(modKey)}
            disabled={!isMicActive}
            onChange={() => toggleMicParam(modKey)}
          />
        </label>
      )}
    </div>
  );

  // ── control markup (rendered under the canvas) ──

  const renderControls = () => (
    <>
      {/* ── pattern mode selector ── */}
      <div className="mode-selector-row">
        <button
          className={`mode-btn${patternMode === 'chladni' ? ' active' : ''}`}
          onClick={() => switchPatternMode('chladni')}
          title="Chladni pattern"
          aria-label="Chladni pattern"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="12" y1="3" x2="12" y2="21"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <path d="M4 4Q12 8.5 20 4"/>
            <path d="M4 20Q12 15.5 20 20"/>
            <path d="M4 4Q8.5 12 4 20"/>
            <path d="M20 4Q15.5 12 20 20"/>
          </svg>
        </button>
        <button
          className={`mode-btn${patternMode === 'turing' ? ' active' : ''}`}
          onClick={() => switchPatternMode('turing')}
          title="Turing pattern"
          aria-label="Turing pattern"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <circle cx="5.5" cy="5" r="2"/>
            <circle cx="15" cy="4" r="1.8"/>
            <circle cx="20" cy="11" r="1.6"/>
            <circle cx="10.5" cy="11.5" r="2.4"/>
            <circle cx="3.5" cy="14" r="1.4"/>
            <circle cx="17" cy="18.5" r="2"/>
            <circle cx="7" cy="20" r="1.8"/>
            <circle cx="21" cy="20" r="1.2"/>
          </svg>
        </button>
      </div>

      <div className="matrices-row">
        {patternMode === 'chladni' ? (
          <MatrixController
            xValues={M_VALUES} yValues={N_VALUES}
            xVal={mVal} yVal={nVal}
            onSelect={(m, n) => { s.current.m = m; s.current.n = n; setMVal(m); setNVal(n); }}
          />
        ) : (
          <MatrixController
            xValues={SCALE_VALUES} yValues={WAVES_VALUES}
            xVal={scaleVal} yVal={wavesVal}
            onSelect={(scale, waves) => { s.current.turingScale = scale; s.current.turingWaves = waves; setScaleVal(scale); setWavesVal(waves); }}
          />
        )}
        <MatrixController
          xValues={SETTLE_VALUES} yValues={SETTLE_VALUES}
          xVal={sprdVal} yVal={convVal}
          onSelect={(sprd, conv) => { s.current.sprd = sprd; s.current.conv = conv; setSprdVal(sprd); setConvVal(conv); }}
        />
      </div>

      <LayoutGroup>
        <div className="action-row">
          <AnimatePresence mode="popLayout" initial={false}>
            {isCaptured ? (
              <motion.button
                key="clear"
                layout
                className="chunk-btn clear-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                onClick={clearCapture}
              >
                Clear
              </motion.button>
            ) : (
              <motion.button
                key="mic"
                layout
                className={'icon-btn mic-toggle' + (waveModActive ? ' mic-on active' : '')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                onClick={toggleWaveMod}
              >
                <FontAwesomeIcon icon={waveModActive ? faMicrophone : faMicrophoneSlash} style={{ fontSize: 18 }} />
              </motion.button>
            )}
          </AnimatePresence>

          <motion.button
            layout
            className="chunk-btn primary main-action"
            onClick={isCaptured ? savePhoto : captureImage}
            transition={{ type: 'spring', damping: 26, stiffness: 280 }}
          >
            {isCaptured ? 'Save' : 'Capture'}
          </motion.button>

          <AnimatePresence mode="popLayout" initial={false}>
            {isCaptured ? (
              <motion.button
                key="post-cloud"
                layout
                className="chunk-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                onClick={postToCloud}
              >
                Post to Cloud
              </motion.button>
            ) : (
              <motion.button
                key="swap"
                layout
                className="icon-btn swap-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                onClick={toggleFacingMode}
                title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
              >
                <FontAwesomeIcon icon={faCameraRotate} style={{ fontSize: 18 }} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </>
  );

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400&family=DM+Sans:wght@300;400;500&display=swap');
        :root {
          --bg: #0c0c0c; --surface: #161616;
          --border: rgba(255,255,255,0.08); --border-strong: rgba(255,255,255,0.15);
          --text-primary: #e8e6e0; --text-secondary: #888780; --text-tertiary: #4a4845;
          --accent: #c8c0a8;
          --font-mono: 'DM Mono','Fira Mono',monospace;
          --font-sans: 'DM Sans',system-ui,sans-serif;
          --radius: 8px; --radius-lg: 12px;
        }
        html, body, #root { height: 100%; background: var(--bg); }
        /* Downsampled, heavily blurred camera feed sitting over the black
           body background — tints the whole app in response to what the
           camera sees. */
        #bg-canvas {
          position: fixed;
          top: -5%; left: -5%;
          width: 110%; height: 110%;
          opacity: 0.2;
          filter: blur(60px);
          pointer-events: none;
          z-index: 0;
          display: block;
        }
        .chladni-root {
          color: var(--text-primary); font-family: var(--font-sans); font-size: 14px;
          height: 100dvh; min-height: 0; display: flex; flex-direction: column;
          max-width: 640px; margin: 0 auto;
          background: transparent;
          position: relative; z-index: 1;
        }
        #canvas-area {
          position: relative; flex: 1 1 0; min-height: 0;
          display: flex; align-items: center; justify-content: center;
          padding: 24px; overflow: visible;
        }
        #canvas-wrap {
          position: relative; border-radius: 16px; overflow: hidden;
          background: #000; display: block;
          border: none;
          aspect-ratio: 1 / 1;
          height: 100%; width: auto;
          max-width: 100%; max-height: 100%;
          box-shadow: 0 24px 80px rgba(0,0,0,0.7);
        }
        #controls {
          flex-shrink: 0;
          padding: 0 24px 24px;
          display: flex; flex-direction: column; justify-content: center;
        }
        #canvas-wrap canvas  { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; }
        #canvas-wrap::after {
          content: ''; position: absolute; inset: 0;
          border-radius: 16px;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1);
          pointer-events: none; z-index: 1;
        }
        #c-particles { position: relative; }
        .section { padding: 22px 0; border-bottom: 0.5px solid var(--border); }
        .section:first-child { padding-top: 4px; }
        .section:last-child  { border-bottom: none; }
        .section-title {
          font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary);
          text-transform: uppercase; letter-spacing: .12em; margin-bottom: 16px;
        }
        .ctrl { display: flex; align-items: center; gap: 14px; margin: 18px 0; }
        .ctrl label { flex-shrink: 0; color: var(--text-primary); font-size: 14px; }
        .label-sep { color: var(--text-tertiary); }
        .ctrl input[type=range] {
          flex: 1; min-width: 0; -webkit-appearance: none; height: 6px;
          background: rgba(255,255,255,0.18); border-radius: 3px; outline: none;
          cursor: pointer;
        }
        .ctrl input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 26px; height: 26px;
          border-radius: 50%; background: var(--accent); cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.5);
          transition: transform .1s;
        }
        .ctrl input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.08); }
        .ctrl input[type=range]::-moz-range-thumb {
          width: 26px; height: 26px; border: none;
          border-radius: 50%; background: var(--accent); cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        }
        .ctrl .val { font-family: var(--font-mono); font-size: 14px; color: var(--text-secondary); }
        .mod-check {
          flex-shrink: 0; -webkit-appearance: none; appearance: none;
          width: 24px; height: 24px; margin: 0; padding: 0;
          background: transparent; border: 1px solid rgba(255,255,255,0.35);
          border-radius: 6px; cursor: pointer; position: relative;
          transition: background .15s, border-color .15s, opacity .15s;
        }
        .mod-check:hover:not(:disabled) { border-color: rgba(255,255,255,0.6); }
        .mod-check:checked {
          background: var(--accent); border-color: var(--accent);
        }
        .mod-check:checked::after {
          content: ''; position: absolute;
          left: 8px; top: 3px; width: 6px; height: 12px;
          border: solid #0c0c0c; border-width: 0 3px 3px 0;
          transform: rotate(45deg);
        }
        .mod-check:disabled { opacity: 0.5; cursor: not-allowed; }
        .mod-wrap {
          display: inline-flex; align-items: center; gap: 7px;
          flex-shrink: 0; cursor: pointer;
          color: var(--text-tertiary);
          transition: color .15s;
        }
        .mod-wrap:hover { color: var(--text-secondary); }
        .mod-mic { display: block; opacity: 0.75; }

        /* Source area: main action + optional swap/clear + indicators */
        .action-row  { display: flex; align-items: stretch; gap: 10px; width: 100%; }
        .chunk-btn {
          display: flex; align-items: center; justify-content: center;
          flex: 1 1 0;
          min-width: 0;
          font-family: var(--font-sans);
          font-size: 15px;
          font-weight: 500;
          padding: 18px 18px;
          min-height: 56px;
          background: rgba(255,255,255,0.06);
          border: 0.5px solid var(--border-strong);
          border-radius: 16px;
          color: var(--text-primary);
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
          transition: background .15s, border-color .15s;
        }
        .chunk-btn:hover  { background: rgba(255,255,255,0.1); }
        .chunk-btn:active { background: rgba(255,255,255,0.14); }
        .chunk-btn.primary {
          background: var(--accent);
          color: #0c0c0c;
          border-color: var(--accent);
        }
        .chunk-btn.primary:hover  { background: #d8d0b8; }
        .chunk-btn.primary:active { background: #b8b098; }
        .clear-btn {
          color: #f0b0a0;
          border-color: rgba(240,176,160,0.35);
          background: rgba(240,120,100,0.06);
        }
        .clear-btn:hover { background: rgba(240,120,100,0.12); }
        .icon-btn {
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          width: 56px; height: 56px;
          padding: 0;
          background: rgba(255,255,255,0.06);
          border: 0.5px solid var(--border-strong);
          border-radius: 16px;
          color: var(--text-primary);
          cursor: pointer;
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
          transition: background .15s, border-color .15s, color .15s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.1); color: var(--accent); }
        .icon-btn svg   { flex-shrink: 0; }
        .mic-toggle { color: var(--accent); }
        .mic-toggle.mic-on { color: #d97a5a; }
        .mic-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
        .swap-btn { color: var(--accent); }

        /* Indicators row — camera indicator only, aligned under capture button */
        .indicators-row { display: flex; gap: 8px; width: 100%; }
        .indicator {
          display: flex; align-items: center; gap: 8px;
          flex: 1 1 0;
          font-family: var(--font-mono); font-size: 10px;
          letter-spacing: 0.04em;
          padding: 8px;
          background: transparent;
          border: none;
          border-radius: 8px;
          color: var(--text-tertiary);
          transition: color .2s, background .2s;
        }
        .indicator .dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: currentColor; flex-shrink: 0;
        }
        .indicator.active {
          color: var(--accent);
        }
        .indicator.active .dot {
          background: #d97a5a;
          box-shadow: 0 0 6px rgba(217,122,90,0.55);
        }
        .indicator-btn {
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.04em;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .indicator-btn:hover { background: rgba(255,255,255,0.04); color: var(--text-secondary); }
        .indicator-btn.active:hover { color: var(--accent); background: rgba(200,192,168,0.06); }
        #status { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); margin-top: 8px; }

        /* Mobile: canvas fills the full viewport width (staying square), and
           the controls live in their own card below that scrolls with the
           page. Labels stack on top of sliders so the thumb can breathe. */
        @media (max-width: 640px) {
          html, body, #root { height: 100%; overflow: hidden; }
          .chladni-root {
            max-width: none;
            height: 100dvh;
            min-height: 0;
            overflow: hidden;
          }
          #canvas-area {
            flex: 0 0 auto;
            padding: 24px 24px 12px;
            width: 100%;
            overflow: visible;
          }
          #canvas-wrap {
            width: 100%;
            height: auto;
            max-width: none;
            max-height: 50dvh;
            border-radius: 16px;
            aspect-ratio: 1 / 1;
          }
          #controls {
            flex: 1 1 0;
            min-height: 0;
            overflow-y: auto;
            padding: 14px 24px 16px;
            background: transparent;
            position: relative;
            z-index: 1;
          }
          .section:first-child { padding-top: 4px; }
          .section { padding: 18px 0; }
          .ctrl {
            display: grid;
            grid-template-columns: 1fr auto;
            grid-template-areas:
              "label label"
              "slider mod";
            align-items: center;
            column-gap: 12px;
            row-gap: 10px;
            margin: 18px 0;
          }
          .ctrl > label   { grid-area: label; width: auto; font-size: 15px; }
          .ctrl input[type=range] {
            grid-area: slider;
            height: 8px; border-radius: 4px;
          }
          .ctrl input[type=range]::-webkit-slider-thumb {
            width: 30px; height: 30px;
          }
          .ctrl input[type=range]::-moz-range-thumb {
            width: 30px; height: 30px;
          }
          .ctrl .mod-wrap { grid-area: mod; font-size: 0; }
        }
        /* Pattern mode selector */
        .mode-selector-row {
          display: flex; gap: 8px; margin-bottom: 10px;
        }
        .mode-btn {
          display: flex; align-items: center; justify-content: center;
          width: 44px; height: 44px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          color: var(--text-tertiary);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: background .15s, border-color .15s, color .15s;
        }
        .mode-btn:hover { background: rgba(255,255,255,0.08); color: var(--text-secondary); }
        .mode-btn.active {
          background: rgba(200,192,168,0.12);
          border-color: rgba(200,192,168,0.35);
          color: var(--accent);
        }
        /* Matrix controllers */
        .matrices-row { display: flex; gap: 10px; margin-bottom: 10px; }
        .matrix-svg {
          display: block; border-radius: 16px;
          background: rgba(255,255,255,0.04);
          border: 0.5px solid rgba(255,255,255,0.08);
          cursor: crosshair;
          -webkit-tap-highlight-color: transparent;
          touch-action: none;
        }
        .wave-mod-row { display: flex; justify-content: center; margin-top: 8px; margin-bottom: 2px; }
        .mic-mod-btn {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em;
          color: var(--text-tertiary);
          background: transparent;
          border: 1px solid var(--border-strong);
          border-radius: 8px;
          padding: 8px 12px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
          transition: color .15s, border-color .15s;
        }
        .mic-mod-btn:hover:not(:disabled) { color: var(--text-secondary); }
        .mic-mod-btn.active { color: var(--accent); border-color: rgba(200,192,168,0.35); }
        .mic-mod-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>

      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />

      <canvas id="bg-canvas" ref={bgCanvasRef} width={24} height={24} />

      <div className="chladni-root">
        <div id="canvas-area">
          <div id="canvas-wrap" ref={canvasWrapRef}>
            <canvas id="c-particles"  ref={ptCanvasRef} />
          </div>
        </div>

        <div id="controls">{renderControls()}</div>
      </div>
    </>
  );
}

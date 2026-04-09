import React, { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';

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
};

// ── value arrays for matrix controllers ──────────────────────────────────
const M_VALUES      = Array.from({ length: 10 }, (_, i) => i + 1);
const N_VALUES      = Array.from({ length: 10 }, (_, i) => i + 1);
const SETTLE_VALUES = Array.from({ length: 21 }, (_, i) => +(i / 20).toFixed(2));

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
    onSelect(xValues[xi], yValues[yi]);
  };

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
          fill="white"
          fillOpacity={0.1 + 0.9 * t}
        />
      );
    }
  }

  return (
    <svg
      className="matrix-svg"
      viewBox={`0 0 ${vw} ${vh}`}
      width="100%"
      onClick={e => fireSelect(e.currentTarget, e.clientX, e.clientY)}
      onMouseMove={e => { if (e.buttons) fireSelect(e.currentTarget, e.clientX, e.clientY); }}
      onTouchStart={e => { e.preventDefault(); const t = e.touches[0]; fireSelect(e.currentTarget, t.clientX, t.clientY); }}
      onTouchMove={e => { e.preventDefault(); const t = e.touches[0]; fireSelect(e.currentTarget, t.clientX, t.clientY); }}
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
    ...INITIAL,
  });

  // React state only for UI that affects render
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isMicActive,    setIsMicActive]    = useState(false);
  const [micModParams,   setMicModParams]   = useState(new Set());
  const [facingMode,     setFacingMode]     = useState('environment');
  const [isCaptured,     setIsCaptured]     = useState(false);
  const [mVal,           setMVal]           = useState(INITIAL.m);
  const [nVal,           setNVal]           = useState(INITIAL.n);
  const [convVal,        setConvVal]        = useState(INITIAL.conv);
  const [sprdVal,        setSprdVal]        = useState(INITIAL.sprd);
  const [waveModActive,  setWaveModActive]  = useState(false);
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
    const m = p('m'), n = p('n');
    const conv   = Math.max(0, Math.min(1, p('conv')));
    const spread = 4 + Math.max(0, Math.min(1, p('sprd'))) * 24;

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
        const tmpCtx = tmp.getContext('2d');
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

    // Newton flow toward the nearest nodal line of chladni(x,y,m,n).
    // Each frame is a fresh "drop the sand": every grain restarts at its
    // origin and runs a few iterations of x ← x − (z·∇z)/|∇z|² toward z=0.
    // `conv` then lerps each grain between its origin (0 = loose cloud
    // showing the source image) and the fully snapped target (1 = tight
    // bands). Each grain is then pushed along the nodal-line normal by
    // `spread * jitter` for band thickness, and finally nudged every
    // frame by a fresh random `wiggle` so the bands shimmer like sand.
    const ITERS = 5;
    const stepScale = 0.7;

    for (let i = 0; i < particles.length; i++) {
      const part = particles[i];
      let x = part.ox, y = part.oy;
      let gx = 0, gy = 0;
      for (let k = 0; k < ITERS; k++) {
        const z  = chladni(x,      y,      m, n, W, H);
        const zr = chladni(x + gs, y,      m, n, W, H);
        const zl = chladni(x - gs, y,      m, n, W, H);
        const zd = chladni(x,      y + gs, m, n, W, H);
        const zu = chladni(x,      y - gs, m, n, W, H);
        gx = (zr - zl) / (2 * gs);
        gy = (zd - zu) / (2 * gs);
        const g2 = gx * gx + gy * gy + 1e-9;
        x -= (z * gx / g2) * stepScale;
        y -= (z * gy / g2) * stepScale;
      }
      // Lerp from origin toward the snapped target by `conv`.
      x = part.ox + (x - part.ox) * conv;
      y = part.oy + (y - part.oy) * conv;
      // Spread along the (normalized) gradient — perpendicular to the
      // nodal line — using each grain's stable jitter, scaled by conv so
      // the spread fades in alongside the convergence.
      const gLen = Math.sqrt(gx * gx + gy * gy) + 1e-9;
      const nxg = gx / gLen, nyg = gy / gLen;
      x += nxg * spread * part.jitter * conv;
      y += nyg * spread * part.jitter * conv;
      // Additional spread along the nodal-line tangent for richer random
      // displacement within the settle — independent of the normal spread.
      const txg = -nyg, tyg = nxg;
      x += txg * spread * 0.4 * part.jitter2 * conv;
      y += tyg * spread * 0.4 * part.jitter2 * conv;
      part.x = x; part.y = y;

      // Particles nearer the nodal-line center (|jitter| ≈ 0) render
      // slightly larger; edge particles are smaller.
      const centeredness = (1 - Math.abs(part.jitter)) * conv;
      const radius = Math.max(0.4, PS + centeredness * 0.55);
      const alpha  = Math.min(1, 0.75 * PARTOP);
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
          const tmpCtx = cameraTmpRef.current.getContext('2d');
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
    // Freeze the current camera frame as the Chladni source. The animation loop
    // keeps running over the frozen background.
    s.current.captured = true;
    setIsCaptured(true);
  }, []);

  const clearCapture = useCallback(() => {
    s.current.captured = false;
    setIsCaptured(false);
  }, []);

  const savePhoto = useCallback(() => {
    const pt = ptCanvasRef.current;
    if (!pt) return;
    // Particles are now the only layer; flatten onto a black background.
    const out = document.createElement('canvas');
    out.width  = pt.width;
    out.height = pt.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(pt, 0, 0);
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `chladni-${ts}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  }, []);

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
    if (!s.current.micMode) await startMic();
  }, [startCamera, startMic]);

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

  const toggleWaveMod = useCallback(() => {
    setWaveModActive(prev => {
      const next = !prev;
      ['m', 'n', 'conv', 'sprd'].forEach(k => { s.current.micMod[k] = next; });
      return next;
    });
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
      <div className="matrices-row">
        <MatrixController
          xValues={M_VALUES} yValues={N_VALUES}
          xVal={mVal} yVal={nVal}
          onSelect={(m, n) => { s.current.m = m; s.current.n = n; setMVal(m); setNVal(n); }}
        />
        <MatrixController
          xValues={SETTLE_VALUES} yValues={SETTLE_VALUES}
          xVal={sprdVal} yVal={convVal}
          onSelect={(sprd, conv) => { s.current.sprd = sprd; s.current.conv = conv; setSprdVal(sprd); setConvVal(conv); }}
        />
      </div>

      <div className="camera-block">
        <div className="camera-main">
          <LayoutGroup>
            <div className="action-row">
              <AnimatePresence mode="popLayout">
                {isCaptured && (
                  <motion.button
                    key="clear"
                    layout
                    className="chunk-btn clear-btn"
                    initial={{ opacity: 0, flexGrow: 0, paddingLeft: 0, paddingRight: 0 }}
                    animate={{ opacity: 1, flexGrow: 1, paddingLeft: 18, paddingRight: 18 }}
                    exit={{ opacity: 0, flexGrow: 0, paddingLeft: 0, paddingRight: 0 }}
                    transition={{ type: 'spring', damping: 26, stiffness: 280 }}
                    onClick={clearCapture}
                  >
                    Clear
                  </motion.button>
                )}
              </AnimatePresence>

              <motion.button
                layout
                className="chunk-btn primary main-action"
                onClick={
                  !isCameraActive
                    ? () => startCameraAndMic(s.current.facingMode || 'environment')
                    : (isCaptured ? savePhoto : captureImage)
                }
                transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              >
                {!isCameraActive ? 'Start camera' : (isCaptured ? 'Save' : 'Capture')}
              </motion.button>
            </div>
          </LayoutGroup>

        </div>

        <div className="camera-side">
          <AnimatePresence>
            {isCameraActive && !isCaptured && (
              <motion.button
                key="swap"
                className="icon-btn swap-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={toggleFacingMode}
                title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                aria-label="swap camera"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 2l4 4-4 4" />
                  <path d="M3 12V10a4 4 0 0 1 4-4h14" />
                  <path d="M7 22l-4-4 4-4" />
                  <path d="M21 12v2a4 4 0 0 1-4 4H3" />
                </svg>
              </motion.button>
            )}
          </AnimatePresence>

          <button
            className={'icon-btn mic-toggle' + (waveModActive ? ' active' : '')}
            disabled={!isMicActive}
            onClick={toggleWaveMod}
            title="Modulate wave params with mic"
            aria-label="Modulate wave params with mic"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="22" />
            </svg>
          </button>
        </div>
      </div>
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
          padding: 16px; overflow: hidden;
        }
        #canvas-wrap {
          position: relative; border-radius: var(--radius-lg); overflow: hidden;
          background: #000; display: block;
          aspect-ratio: 1 / 1;
          height: 100%; width: auto;
          max-width: 100%; max-height: 100%;
          border: 0.5px solid var(--border);
        }
        #controls {
          flex-shrink: 0;
          padding: 0 24px 24px;
          display: flex; flex-direction: column;
        }
        #canvas-wrap canvas  { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; }
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
        .source-grid { display: flex; flex-direction: column; gap: 12px; width: 100%; }
        .camera-block { display: flex; align-items: flex-start; gap: 10px; width: 100%; }
        .camera-main { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
        .camera-side { flex-shrink: 0; width: 48px; display: flex; flex-direction: column; gap: 8px; }
        .action-row  { display: flex; align-items: stretch; gap: 10px; width: 100%; }
        .chunk-btn {
          display: flex; align-items: center; justify-content: center;
          flex: 1 1 0;
          min-width: 0;
          font-family: var(--font-sans);
          font-size: 15px;
          font-weight: 500;
          padding: 14px 18px;
          min-height: 48px;
          background: rgba(255,255,255,0.06);
          border: 0.5px solid var(--border-strong);
          border-radius: 12px;
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
          height: 48px;
          padding: 0;
          background: rgba(255,255,255,0.06);
          border: 0.5px solid var(--border-strong);
          border-radius: 12px;
          color: var(--text-primary);
          cursor: pointer;
          overflow: hidden;
          -webkit-tap-highlight-color: transparent;
          transition: background .15s, border-color .15s, color .15s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.1); color: var(--accent); }
        .icon-btn svg   { flex-shrink: 0; }
        .mic-toggle { background: transparent; }
        .mic-toggle:hover:not(:disabled) { background: rgba(255,255,255,0.06); }
        .mic-toggle.active { color: var(--accent); }
        .mic-toggle:disabled { opacity: 0.3; cursor: not-allowed; }

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
            padding: 0;
            width: 100vw;
            aspect-ratio: 1 / 1;
            max-height: 50dvh;
            overflow: hidden;
          }
          #canvas-wrap {
            width: 100%;
            height: 100%;
            max-width: none;
            max-height: none;
            border-radius: 0;
            border: none;
            aspect-ratio: 1 / 1;
          }
          #controls {
            flex: 1 1 0;
            min-height: 0;
            overflow-y: auto;
            padding: 14px 20px 16px;
            /* Slightly translucent so the blurred camera bg shows through. */
            background: rgba(22, 22, 22, 0.78);
            border-top-left-radius: var(--radius-lg);
            border-top-right-radius: var(--radius-lg);
            border-top: 0.5px solid var(--border);
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
        /* Matrix controllers */
        .matrices-row { display: flex; gap: 14px; margin-bottom: 10px; }
        .matrix-svg {
          display: block; border-radius: 10px;
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

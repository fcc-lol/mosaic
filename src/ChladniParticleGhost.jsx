import React, { useRef, useEffect, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const INITIAL = {
  m: 3, n: 4, str: 30, thresh: 0.12,
  ps: 1.4, amp: 0.55, spd: 0.7, wscale: 2.2, boost: 1.4, partop: 1.0,
  imgop: 0.25, desat: 0.6, dark: 0.5, grid: 5,
};

// All rendering happens on a square canvas at this pixel size.
const CANVAS_SIZE = 600;

// Maximum amount each param can swing upward when audio is at full level
const MOD_RANGE = {
  m: 7, n: 6, str: 50, thresh: 0.28,
  ps: 2.6, amp: 1.45, spd: 2.3, wscale: 3.8, boost: 1.6, partop: 0.9,
};

export default function ChladniParticleGhost() {
  const bgCanvasRef   = useRef(null);
  const ptCanvasRef   = useRef(null);
  const canvasWrapRef = useRef(null);
  const dropZoneRef   = useRef(null);
  const statusRef     = useRef(null);
  const videoRef      = useRef(null);
  const cameraTmpRef  = useRef(null);
  const audioDataRef  = useRef(null); // cached Uint8Array for analyser reads

  // All animation-loop mutable state — never causes re-renders.
  const s = useRef({
    particles: [], dsW: 0, dsH: 0,
    animId: null, startTime: null,
    srcPixels: null, bgImageData: null,
    cameraMode: false, cameraStream: null,
    micMode: false, analyser: null, audioStream: null, audioCtx: null,
    audioLevel: 0, micSensitivity: 1.0,
    micMod: Object.fromEntries(Object.keys(MOD_RANGE).map(k => [k, false])),
    ...INITIAL,
  });

  // React state only for UI that affects render
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isMicActive,    setIsMicActive]    = useState(false);
  const [micModParams,   setMicModParams]   = useState(new Set());
  const [isMobile,       setIsMobile]       = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 820px)').matches
  );
  const [sheetOpen,      setSheetOpen]      = useState(false);
  const dispRefs = useRef({});

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Lock background scroll while sheet is open
  useEffect(() => {
    if (sheetOpen) {
      document.body.classList.add('sheet-locked');
      return () => document.body.classList.remove('sheet-locked');
    }
  }, [sheetOpen]);

  const setDisp = useCallback((id, text) => {
    if (dispRefs.current[id]) dispRefs.current[id].textContent = text;
  }, []);

  // ── background layer ─────────────────────────────────────────────────────

  const drawBg = useCallback(() => {
    const { bgImageData, dsW: W, dsH: H, desat, dark, imgop } = s.current;
    if (!bgImageData) return;
    const bgX = bgCanvasRef.current.getContext('2d');
    const src = bgImageData.data;
    const out = bgX.createImageData(W, H);
    const dst = out.data;
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i], g = src[i + 1], b = src[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      dst[i]     = Math.round((r + (lum - r) * desat) * (1 - dark));
      dst[i + 1] = Math.round((g + (lum - g) * desat) * (1 - dark));
      dst[i + 2] = Math.round((b + (lum - b) * desat) * (1 - dark));
      dst[i + 3] = Math.round(imgop * 255);
    }
    bgX.clearRect(0, 0, W, H);
    bgX.putImageData(out, 0, 0);
  }, []);

  // ── particles ────────────────────────────────────────────────────────────

  const sampleParticles = useCallback(() => {
    const { srcPixels, dsW: W, dsH: H, grid } = s.current;
    if (!srcPixels) return;
    const particles = [];
    for (let y = 0; y < H; y += grid) {
      for (let x = 0; x < W; x += grid) {
        let r = 0, g = 0, b = 0, count = 0;
        for (let dy = 0; dy < grid && y + dy < H; dy++)
          for (let dx = 0; dx < grid && x + dx < W; dx++) {
            const i = ((y + dy) * W + (x + dx)) * 4;
            r += srcPixels[i]; g += srcPixels[i + 1]; b += srcPixels[i + 2]; count++;
          }
        particles.push({ ox: x + grid / 2, oy: y + grid / 2, r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) });
      }
    }
    s.current.particles = particles;
    if (statusRef.current) statusRef.current.textContent = particles.length.toLocaleString() + ' particles';
  }, []);

  // Refresh particle colors in-place from current srcPixels (used in camera mode)
  const refreshParticleColors = useCallback(() => {
    const { srcPixels, dsW: W, dsH: H, grid, particles } = s.current;
    if (!srcPixels) return;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = Math.floor(p.ox - grid / 2), py = Math.floor(p.oy - grid / 2);
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = 0; dy < grid && py + dy < H; dy++)
        for (let dx = 0; dx < grid && px + dx < W; dx++) {
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
    if (!st.startTime) st.startTime = ts;
    const t = (ts - st.startTime) / 1000;

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
    const m = p('m'), n = p('n'), str = p('str'), thresh = p('thresh');
    const ps = p('ps'), amp = p('amp'), spd = p('spd'), wscale = p('wscale');
    const boost = p('boost'), partop = p('partop');

    const ptX = ptCanvasRef.current?.getContext('2d');
    if (!ptX) return;
    const gs = 3;

    // ── camera: pull new frame from video (center-cropped + mirrored) ─────
    if (st.cameraMode) {
      const video = videoRef.current;
      const tmp   = cameraTmpRef.current;
      if (video && tmp && video.readyState >= 2 && video.videoWidth > 0) {
        const vw = video.videoWidth, vh = video.videoHeight;
        const sSize = Math.min(vw, vh);
        const sx = (vw - sSize) / 2;
        const sy = (vh - sSize) / 2;
        const tmpCtx = tmp.getContext('2d');
        tmpCtx.save();
        tmpCtx.translate(W, 0);
        tmpCtx.scale(-1, 1);
        tmpCtx.drawImage(video, sx, sy, sSize, sSize, 0, 0, W, H);
        tmpCtx.restore();
        const imageData = tmpCtx.getImageData(0, 0, W, H);
        st.srcPixels   = imageData.data;
        st.bgImageData = imageData;
        refreshParticleColors();
        drawBg();
      }
    }

    ptX.clearRect(0, 0, W, H);

    for (let i = 0; i < particles.length; i++) {
      const part = particles[i];
      const x = part.ox, y = part.oy;
      const z  = chladni(x,      y,      m, n, W, H);
      const zr = chladni(x + gs, y,      m, n, W, H);
      const zl = chladni(x - gs, y,      m, n, W, H);
      const zd = chladni(x,      y + gs, m, n, W, H);
      const zu = chladni(x,      y - gs, m, n, W, H);
      let gx = (zr - zl) / (2 * gs), gy = (zd - zu) / (2 * gs);
      const gLen = Math.sqrt(gx * gx + gy * gy) + 1e-9;
      gx /= gLen; gy /= gLen;
      const nx = x + z * str * gx;
      const ny = y + z * str * gy;
      const absZ = Math.abs(z);
      if (absZ > thresh) continue;
      const proximity = 1 - absZ / thresh;
      const wave = Math.sin((nx / W) * Math.PI * 2 * wscale + t * spd * Math.PI * 2)
                 * Math.cos((ny / H) * Math.PI * 2 * wscale + t * spd * Math.PI * 1.3 + (nx / W) * 2.1);
      const radius = Math.max(0.2, ps * (0.5 + proximity * 0.5) + wave * amp * proximity);
      const alpha  = (0.45 + proximity * 0.55) * partop;
      const br = Math.min(255, Math.round(part.r * boost));
      const bg = Math.min(255, Math.round(part.g * boost));
      const bb = Math.min(255, Math.round(part.b * boost));
      ptX.beginPath();
      ptX.arc(nx, ny, radius, 0, Math.PI * 2);
      ptX.fillStyle = `rgba(${br},${bg},${bb},${alpha.toFixed(2)})`;
      ptX.fill();
    }
    st.animId = requestAnimationFrame(frame);
  }, [drawBg, refreshParticleColors]);

  const startAnim = useCallback(() => {
    const st = s.current;
    if (st.animId) cancelAnimationFrame(st.animId);
    st.startTime = null;
    st.animId = requestAnimationFrame(frame);
  }, [frame]);

  // ── canvas/source setup ──────────────────────────────────────────────────

  const setupCanvas = useCallback((w, h) => {
    s.current.dsW = w; s.current.dsH = h;
    const bgC = bgCanvasRef.current, ptC = ptCanvasRef.current;
    bgC.width = ptC.width = w;
    bgC.height = ptC.height = h;
    // The canvas is always square — let CSS (aspect-ratio) handle responsive
    // sizing so the feed doesn't stretch on narrow viewports.
    canvasWrapRef.current.classList.add('visible');
    if (dropZoneRef.current) dropZoneRef.current.style.display = 'none';
  }, []);

  const loadFile = useCallback((file) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Center-crop the source image to a square, then scale to CANVAS_SIZE.
      const srcSize = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth  - srcSize) / 2;
      const sy = (img.naturalHeight - srcSize) / 2;
      setupCanvas(CANVAS_SIZE, CANVAS_SIZE);
      const tmp = document.createElement('canvas');
      tmp.width = CANVAS_SIZE; tmp.height = CANVAS_SIZE;
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      s.current.srcPixels   = tCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
      s.current.bgImageData = tCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      URL.revokeObjectURL(url);
      sampleParticles(); drawBg(); startAnim();
    };
    img.src = url;
  }, [setupCanvas, sampleParticles, drawBg, startAnim]);

  // ── camera ───────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    const st = s.current;
    if (st.cameraStream) { st.cameraStream.getTracks().forEach(t => t.stop()); st.cameraStream = null; }
    st.cameraMode = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (dropZoneRef.current) dropZoneRef.current.style.display = '';
    if (canvasWrapRef.current) canvasWrapRef.current.classList.remove('visible');
    if (st.animId) { cancelAnimationFrame(st.animId); st.animId = null; }
    st.particles = []; st.srcPixels = null; st.bgImageData = null;
    if (statusRef.current) statusRef.current.textContent = '';
    setIsCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      // Prefer the back-facing camera on mobile; desktop will just ignore this hint.
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const videoConstraints = {
        width:  { ideal: 1280 },
        height: { ideal: 720 },
        ...(isMobile ? { facingMode: { ideal: 'environment' } } : {}),
      };
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      s.current.cameraStream = stream;
      s.current.cameraMode   = true;
      setIsCameraActive(true);
      const video = videoRef.current;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        // Canvas is always square. The frame loop center-crops and mirrors.
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
          tmpCtx.translate(CANVAS_SIZE, 0);
          tmpCtx.scale(-1, 1);
          tmpCtx.drawImage(video, sx, sy, sSize, sSize, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
          tmpCtx.restore();
          const imageData = tmpCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
          s.current.srcPixels   = imageData.data;
          s.current.bgImageData = imageData;
          sampleParticles(); drawBg(); startAnim();
        }, { once: true });
      };
    } catch {
      if (statusRef.current) statusRef.current.textContent = 'Camera access denied';
    }
  }, [setupCanvas, sampleParticles, drawBg, startAnim]);

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

  const toggleMicParam = useCallback((key) => {
    s.current.micMod[key] = !s.current.micMod[key];
    setMicModParams(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
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

  const handleDrop       = (e) => { e.preventDefault(); dropZoneRef.current?.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); };
  const handleDragOver   = (e) => { e.preventDefault(); dropZoneRef.current?.classList.add('drag'); };
  const handleDragLeave  = ()  => dropZoneRef.current?.classList.remove('drag');
  const handleFileChange = (e) => { const f = e.target.files[0]; if (f) loadFile(f); };

  const makeSliderHandler = (key, fmt, redraw) => (e) => {
    const val = +e.target.value;
    s.current[key] = val;
    setDisp(key + 'v', fmt(val));
    if (redraw) drawBg();
    if (key === 'grid') sampleParticles();
  };

  const preset = (mv, nv) => {
    s.current.m = mv; s.current.n = nv;
    setDisp('mv', mv); setDisp('nv', nv);
    document.getElementById('m-slider').value = mv;
    document.getElementById('n-slider').value = nv;
  };

  const dispRef = (id) => (el) => { dispRefs.current[id] = el; };

  // ── Slider component ─────────────────────────────────────────────────────

  const Slider = ({ id, min, max, step, def, fmt, redraw, label, modKey }) => (
    <div className="ctrl">
      <label>{label}</label>
      <input
        type="range" id={id + '-slider'}
        min={min} max={max} step={step} defaultValue={def}
        onChange={makeSliderHandler(id, fmt, redraw)}
      />
      <span className="val" ref={dispRef(id + 'v')}>{fmt(def)}</span>
      {modKey && (
        <input
          type="checkbox"
          className="mod-check"
          title="Modulate with mic"
          checked={micModParams.has(modKey)}
          disabled={!isMicActive}
          onChange={() => toggleMicParam(modKey)}
        />
      )}
    </div>
  );

  // ── shared control markup (rendered inline on desktop, inside sheet on mobile) ──

  const renderControls = () => (
    <>
      {/* Source */}
      <div className="section">
        <div className="section-title">Source</div>
        <button
          className={'source-btn' + (isMicActive ? ' active' : '')}
          onClick={isMicActive ? stopMic : startMic}
        >
          <span className="dot" />
          {isMicActive ? 'mic active — click to stop' : 'use microphone'}
        </button>
        {isMicActive && (
          <div className="sensitivity-row">
            <label>sensitivity</label>
            <input
              type="range" min={0.2} max={4} step={0.1} defaultValue={1}
              onChange={e => { s.current.micSensitivity = +e.target.value; }}
            />
          </div>
        )}
      </div>

      {/* Wave */}
      <div className="section">
        <div className="section-title">Wave</div>
        <Slider id="m"      label="Mode m"         min={1}    max={10}  step={1}    def={INITIAL.m}      fmt={v => v}               modKey="m" />
        <Slider id="n"      label="Mode n"         min={1}    max={10}  step={1}    def={INITIAL.n}      fmt={v => v}               modKey="n" />
        <Slider id="str"    label="Warp strength"  min={0}    max={80}  step={1}    def={INITIAL.str}    fmt={v => v}               modKey="str" />
        <Slider id="thresh" label="Node threshold" min={0.01} max={0.4} step={0.01} def={INITIAL.thresh} fmt={v => (+v).toFixed(2)} modKey="thresh" />
        <div className="presets">
          {[[2,3],[3,4],[3,5],[4,5],[5,7],[6,7],[7,9]].map(([mv,nv]) => (
            <button key={`${mv},${nv}`} onClick={() => preset(mv, nv)}>{mv},{nv}</button>
          ))}
        </div>
      </div>

      {/* Particles */}
      <div className="section">
        <div className="section-title">Particles</div>
        <Slider id="grid"   label="Grid size"        min={2}   max={12} step={1}    def={INITIAL.grid}   fmt={v => v + 'px'} />
        <Slider id="ps"     label="Base size"        min={0.5} max={4}  step={0.1}  def={INITIAL.ps}     fmt={v => (+v).toFixed(1)}        modKey="ps" />
        <Slider id="amp"    label="Anim amplitude"   min={0}   max={2}  step={0.05} def={INITIAL.amp}    fmt={v => (+v).toFixed(2)}        modKey="amp" />
        <Slider id="spd"    label="Anim speed"       min={0.1} max={3}  step={0.05} def={INITIAL.spd}    fmt={v => (+v).toFixed(2)}        modKey="spd" />
        <Slider id="wscale" label="Wave scale"       min={0.5} max={6}  step={0.1}  def={INITIAL.wscale} fmt={v => (+v).toFixed(1)}        modKey="wscale" />
        <Slider id="boost"  label="Brightness boost" min={1}   max={3}  step={0.05} def={INITIAL.boost}  fmt={v => (+v).toFixed(2) + 'x'} modKey="boost" />
        <Slider id="partop" label="Particle opacity" min={0.1} max={1}  step={0.01} def={INITIAL.partop} fmt={v => (+v).toFixed(2)}        modKey="partop" />
      </div>

      {/* Compositing */}
      <div className="section">
        <div className="section-title">Compositing</div>
        <Slider id="imgop" label="Image opacity" min={0} max={1} step={0.01} def={INITIAL.imgop} fmt={v => (+v).toFixed(2)} redraw />
        <Slider id="desat" label="Desaturate"    min={0} max={1} step={0.01} def={INITIAL.desat} fmt={v => (+v).toFixed(2)} redraw />
        <Slider id="dark"  label="Darken"        min={0} max={1} step={0.01} def={INITIAL.dark}  fmt={v => (+v).toFixed(2)} redraw />
      </div>

      <div id="status" ref={statusRef} />
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
        .chladni-root {
          color: var(--text-primary); font-family: var(--font-sans); font-size: 14px;
          min-height: 100vh; display: grid;
          grid-template-columns: 1fr 380px; grid-template-rows: auto 1fr;
          background: var(--bg);
        }
        .chladni-root header {
          grid-column: 1 / -1; padding: 20px 28px;
          border-bottom: 0.5px solid var(--border);
          display: flex; align-items: baseline; gap: 18px;
        }
        .chladni-root header h1 {
          font-family: var(--font-mono); font-size: 14px; font-weight: 400;
          color: var(--text-secondary); letter-spacing: .08em;
        }
        .chladni-root header span { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); }
        #canvas-area {
          position: relative; display: flex; align-items: center;
          justify-content: center; padding: 24px; overflow: hidden;
          min-height: 240px;
        }
        #drop-zone {
          width: 100%; max-width: 440px; padding: 28px 24px;
          border: 1px dashed var(--border-strong); border-radius: var(--radius-lg);
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 8px;
          transition: border-color .2s, background .2s;
        }
        #drop-zone:hover { border-color: rgba(255,255,255,0.25); }
        #drop-zone.drag  { border-color: rgba(255,255,255,0.25); background: rgba(255,255,255,0.02); }
        #drop-zone input { display: none; }
        .dz-options-row  { display: flex; align-items: stretch; width: 100%; }
        .dz-option {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          gap: 4px; cursor: pointer; padding: 12px 16px;
          border-radius: var(--radius); transition: background .15s;
        }
        .dz-option:hover        { background: rgba(255,255,255,0.04); }
        .dz-option .dz-title    { font-size: 13px; font-weight: 500; color: var(--text-primary); }
        .dz-option .dz-sub      { font-size: 10px; color: var(--text-secondary); }
        .dz-divider             { width: 1px; background: var(--border-strong); margin: 4px 0; }
        #stop-camera-btn {
          position: absolute; top: 36px; right: 36px; z-index: 10;
          font-family: var(--font-mono); font-size: 11px; padding: 4px 12px;
          background: rgba(12,12,12,0.85); border: 0.5px solid var(--border-strong);
          border-radius: 4px; color: var(--text-secondary); cursor: pointer;
          transition: color .15s, border-color .15s;
        }
        #stop-camera-btn:hover { color: var(--text-primary); border-color: rgba(255,255,255,0.3); }
        #canvas-wrap {
          position: relative; border-radius: var(--radius-lg); overflow: hidden;
          background: #000; display: none;
          width: 100%; max-width: 600px; aspect-ratio: 1 / 1;
          transition: max-width .35s cubic-bezier(.2,.8,.2,1);
        }
        #canvas-wrap.visible { display: block; }
        #canvas-wrap canvas  { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: block; }
        #c-bg { position: relative; }
        #sidebar {
          border-left: 0.5px solid var(--border); padding: 24px 24px;
          overflow-y: auto; display: flex; flex-direction: column; gap: 0;
        }
        .section { padding: 20px 0; border-bottom: 0.5px solid var(--border); }
        .section:first-child { padding-top: 4px; }
        .section:last-child  { border-bottom: none; }
        .section-title {
          font-family: var(--font-mono); font-size: 11px; color: var(--text-tertiary);
          text-transform: uppercase; letter-spacing: .12em; margin-bottom: 14px;
        }
        .ctrl { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
        .ctrl label { width: 120px; flex-shrink: 0; color: var(--text-secondary); font-size: 13px; }
        .ctrl input[type=range] {
          flex: 1; min-width: 0; -webkit-appearance: none; height: 3px;
          background: var(--border-strong); border-radius: 2px; outline: none;
          cursor: pointer;
        }
        .ctrl input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 16px; height: 16px;
          border-radius: 50%; background: var(--accent); cursor: pointer;
          transition: transform .1s;
        }
        .ctrl input[type=range]::-webkit-slider-thumb:hover { transform: scale(1.15); }
        .ctrl input[type=range]::-moz-range-thumb {
          width: 16px; height: 16px; border: none;
          border-radius: 50%; background: var(--accent); cursor: pointer;
        }
        .ctrl .val { width: 48px; text-align: right; font-family: var(--font-mono); font-size: 12px; color: var(--text-primary); }
        .mod-check {
          flex-shrink: 0; -webkit-appearance: none; appearance: none;
          width: 16px; height: 16px; margin: 0; padding: 0;
          background: transparent; border: 1px solid rgba(255,255,255,0.35);
          border-radius: 3px; cursor: pointer; position: relative;
          transition: background .15s, border-color .15s, opacity .15s;
        }
        .mod-check:hover:not(:disabled) { border-color: rgba(255,255,255,0.6); }
        .mod-check:checked {
          background: var(--accent); border-color: var(--accent);
        }
        .mod-check:checked::after {
          content: ''; position: absolute;
          left: 4px; top: 1px; width: 4px; height: 8px;
          border: solid #0c0c0c; border-width: 0 2px 2px 0;
          transform: rotate(45deg);
        }
        .mod-check:disabled { opacity: 0.5; cursor: not-allowed; }
        .presets { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .presets button {
          font-family: var(--font-mono); font-size: 12px; padding: 5px 11px;
          background: transparent; border: 0.5px solid var(--border-strong);
          border-radius: 4px; color: var(--text-secondary); cursor: pointer;
          transition: background .15s, color .15s;
        }
        .presets button:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
        .source-btn {
          display: flex; align-items: center; gap: 8px; width: 100%;
          font-family: var(--font-mono); font-size: 12px; padding: 10px 12px;
          background: transparent; border: 0.5px solid var(--border-strong);
          border-radius: 6px; color: var(--text-secondary); cursor: pointer;
          transition: background .15s, color .15s, border-color .15s;
        }
        .source-btn:hover  { background: rgba(255,255,255,0.04); color: var(--text-primary); }
        .source-btn.active { border-color: var(--accent); color: var(--accent); }
        .source-btn .dot   { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
        .sensitivity-row   { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
        .sensitivity-row label { font-size: 12px; color: var(--text-secondary); flex-shrink: 0; width: 80px; }
        .sensitivity-row input[type=range] {
          flex: 1; min-width: 0; -webkit-appearance: none; height: 3px;
          background: var(--border-strong); border-radius: 2px; outline: none; cursor: pointer;
        }
        .sensitivity-row input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 16px; height: 16px;
          border-radius: 50%; background: var(--accent); cursor: pointer;
        }
        #status { font-family: var(--font-mono); font-size: 12px; color: var(--text-tertiary); margin-top: 14px; min-height: 18px; }
        @media (max-width: 820px) {
          .chladni-root {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr;
            min-height: 100vh;
            transition: grid-template-rows .35s cubic-bezier(.2,.8,.2,1);
          }
          .chladni-root header { grid-column: 1; padding: 16px 20px; }
          #canvas-area {
            padding: 16px 16px 96px;
            min-height: 200px;
            transition: padding .35s cubic-bezier(.2,.8,.2,1),
                        max-height .35s cubic-bezier(.2,.8,.2,1);
          }
          .ctrl label { width: 108px; font-size: 12px; }
          .ctrl .val  { width: 42px; }
          .dz-options-row { flex-direction: column; }
          .dz-divider {
            width: 100%; height: 1px;
            margin: 4px 0;
          }
          /* When the mobile sheet is open, shrink the canvas area so the
             image is fully visible above the sheet (sheet = 60vh, canvas = 40vh). */
          .chladni-root.sheet-open #canvas-area {
            padding: 8px;
            max-height: 40vh;
          }
          .chladni-root.sheet-open #canvas-wrap {
            max-width: calc(40vh - 16px);
          }
          .chladni-root.sheet-open header {
            display: none;
          }
        }
        /* Lock background scroll while sheet is open */
        body.sheet-locked { overflow: hidden; touch-action: none; }

        /* Mobile controls sheet */
        .sheet-fab {
          position: fixed; right: 18px; bottom: 18px; z-index: 50;
          display: flex; align-items: center; gap: 10px;
          font-family: var(--font-mono); font-size: 12px;
          text-transform: uppercase; letter-spacing: .1em;
          padding: 12px 18px;
          background: rgba(12,12,12,0.92);
          border: 0.5px solid var(--border-strong);
          border-radius: 999px;
          color: var(--text-primary);
          cursor: pointer;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.35);
        }
        .sheet-fab:active { transform: scale(0.97); }
        .fab-icon {
          display: inline-flex; flex-direction: column; justify-content: center;
          gap: 3px; width: 14px; height: 14px;
        }
        .fab-icon span {
          display: block; height: 1.5px; width: 100%;
          background: currentColor; border-radius: 1px;
        }
        .mobile-sheet {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 61;
          height: 60vh;
          max-height: 60vh;
          background: var(--bg-primary, #0c0c0c);
          border-top: 0.5px solid var(--border-strong);
          border-top-left-radius: 20px;
          border-top-right-radius: 20px;
          box-shadow: 0 -12px 40px rgba(0,0,0,0.55);
          display: flex; flex-direction: column;
          touch-action: none;
          will-change: transform;
        }
        .sheet-handle-wrap {
          display: flex; justify-content: center; align-items: center;
          padding: 10px 0 6px;
          flex-shrink: 0;
          cursor: grab;
        }
        .sheet-handle-wrap:active { cursor: grabbing; }
        .sheet-handle {
          width: 44px; height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.28);
        }
        .sheet-body {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          padding: 4px 20px 32px;
          touch-action: pan-y;
        }
        .sheet-body .section:first-child { padding-top: 8px; }
      `}</style>

      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />

      <div className={`chladni-root${sheetOpen ? ' sheet-open' : ''}`}>
        <header>
          <h1>chladni_particle_ghost</h1>
          <span>image → particles → standing wave</span>
        </header>

        <div id="canvas-area" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div id="drop-zone" ref={dropZoneRef}>
            <input type="file" id="file-input" accept="image/*" onChange={handleFileChange} />
            <div className="dz-options-row">
              <div className="dz-option" onClick={() => document.getElementById('file-input').click()}>
                <div className="dz-title">Drop a photo</div>
                <div className="dz-sub">or click to browse</div>
              </div>
              <div className="dz-divider" />
              <div className="dz-option" onClick={startCamera}>
                <div className="dz-title">Use Camera</div>
                <div className="dz-sub">live video feed</div>
              </div>
            </div>
          </div>

          {isCameraActive && (
            <button id="stop-camera-btn" onClick={stopCamera}>stop camera</button>
          )}

          <div id="canvas-wrap" ref={canvasWrapRef}>
            <canvas id="c-bg"         ref={bgCanvasRef} />
            <canvas id="c-particles"  ref={ptCanvasRef} />
          </div>
        </div>

        {!isMobile && (
          <div id="sidebar">{renderControls()}</div>
        )}
      </div>

      {/* Mobile: floating button + draggable bottom sheet */}
      {isMobile && (
        <>
          {!sheetOpen && (
            <button className="sheet-fab" onClick={() => setSheetOpen(true)} aria-label="open controls">
              <span className="fab-icon">
                <span /><span /><span />
              </span>
              controls
            </button>
          )}

          <AnimatePresence>
            {sheetOpen && (
              <>
                <motion.div
                  key="sheet"
                  className="mobile-sheet"
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 32, stiffness: 340 }}
                  drag="y"
                  dragConstraints={{ top: 0, bottom: 0 }}
                  dragElastic={{ top: 0, bottom: 0.3 }}
                  onDragEnd={(_, info) => {
                    if (info.offset.y > 120 || info.velocity.y > 500) setSheetOpen(false);
                  }}
                >
                  <div className="sheet-handle-wrap">
                    <div className="sheet-handle" />
                  </div>
                  <div className="sheet-body">
                    {renderControls()}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}
    </>
  );
}

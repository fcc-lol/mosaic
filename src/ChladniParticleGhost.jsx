import React, { useRef, useEffect, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import styled from 'styled-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash, faCameraRotate } from '@fortawesome/free-solid-svg-icons';

import {
  CANVAS_SIZE, GRID, PS, BOOST, PARTOP, INITIAL, MOD_RANGE,
  M_VALUES, N_VALUES, SETTLE_VALUES,
  TURING_INITIAL, SCALE_VALUES, WAVES_VALUES,
  TURING_N, TURING_SEED,
} from './constants';
import { stopStream, averageGridColor, videoConstraints } from './utils';
import { ChunkButton, IconButton } from './styles/shared';
import MatrixController from './components/MatrixController';
import PatternModeSelector from './components/PatternModeSelector';
import CaptureOverlay from './components/CaptureOverlay';

// ── styled layout ───────────────────────────────────────────────────────────

const BgCanvas = styled.canvas`
  position: fixed;
  top: -5%; left: -5%;
  width: 110%; height: 110%;
  opacity: 0.2;
  filter: blur(60px);
  pointer-events: none;
  z-index: 0;
  display: block;
`;

const Root = styled.div`
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  height: 100dvh;
  min-height: 0;
  display: flex;
  flex-direction: column;
  max-width: 640px;
  margin: 0 auto;
  background: transparent;
  position: relative;
  z-index: 1;

  @media (max-width: 640px) {
    max-width: none;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
  }
`;

const CanvasArea = styled.div`
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: visible;
  max-height: 640px;

  @media (max-width: 640px) {
    flex: 0 0 auto;
    padding: 24px 24px 12px;
    width: 100%;
    overflow: visible;
  }
`;

const CanvasWrap = styled.div`
  position: relative;
  border-radius: 16px;
  overflow: hidden;
  background: #000;
  display: block;
  border: none;
  aspect-ratio: 1 / 1;
  height: 100%;
  width: auto;
  max-width: 100%;
  max-height: 100%;
  box-shadow: 0 24px 80px rgba(0,0,0,0.7);

  canvas {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    display: block;
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 16px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1);
    pointer-events: none;
    z-index: 1;
  }

  @media (max-width: 640px) {
    width: min(100%, 50dvh);
    height: auto;
    aspect-ratio: 1 / 1;
  }
`;

const ControlsWrapper = styled.div`
  flex-shrink: 0;
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  position: relative;

  @media (max-width: 640px) {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 24px 24px;
    background: transparent;
    position: relative;
    z-index: 1;
  }
`;

const ControlsInner = styled(motion.div)`
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  flex: 1 1 0;
  min-height: 0;
`;

const MatricesRow = styled.div`
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
`;

const ActionRow = styled.div`
  display: flex;
  align-items: stretch;
  gap: 10px;
  width: 100%;
`;

const MicButton = styled(IconButton)`
  color: var(--accent);
  ${p => p.$active && 'color: #d97a5a;'}
`;

const SwapButton = styled(IconButton)`
  color: var(--accent);
`;

const HiddenVideo = styled.video`
  display: none;
`;

// ── component ───────────────────────────────────────────────────────────────

export default function ChladniParticleGhost() {
  const ptCanvasRef = useRef(null);
  const videoRef = useRef(null);
  const cameraTmpRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const audioDataRef = useRef(null);

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
  const [isMicActive, setIsMicActive] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [isCaptured, setIsCaptured] = useState(false);
  const [mVal, setMVal] = useState(INITIAL.m);
  const [nVal, setNVal] = useState(INITIAL.n);
  const [convVal, setConvVal] = useState(INITIAL.conv);
  const [sprdVal, setSprdVal] = useState(INITIAL.sprd);
  const [waveModActive, setWaveModActive] = useState(false);
  const [patternMode, setPatternMode] = useState('chladni');
  const [scaleVal, setScaleVal] = useState(TURING_INITIAL.scale);
  const [wavesVal, setWavesVal] = useState(TURING_INITIAL.waves);

  // ── particles ─────────────────────────────────────────────────────────────

  const sampleParticles = useCallback(() => {
    const { srcPixels, dsW: W, dsH: H } = s.current;
    if (!srcPixels) return;
    const particles = [];
    for (let y = 0; y < H; y += GRID) {
      for (let x = 0; x < W; x += GRID) {
        const color = averageGridColor(srcPixels, x, y, W, H);
        if (!color) continue;
        const cx = x + GRID / 2, cy = y + GRID / 2;
        particles.push({
          ox: cx, oy: cy, x: cx, y: cy,
          jitter: Math.random() * 2 - 1,
          jitter2: Math.random() * 2 - 1,
          ...color,
        });
      }
    }
    s.current.particles = particles;
  }, []);

  const refreshParticleColors = useCallback(() => {
    const { srcPixels, dsW: W, dsH: H, particles } = s.current;
    if (!srcPixels) return;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = Math.floor(p.ox - GRID / 2), py = Math.floor(p.oy - GRID / 2);
      const color = averageGridColor(srcPixels, px, py, W, H);
      if (color) { p.r = color.r; p.g = color.g; p.b = color.b; }
    }
  }, []);

  // ── animation loop ────────────────────────────────────────────────────────

  const chladni = (x, y, m, n, W, H) => {
    const px = x / W, py = y / H;
    return Math.cos(n * Math.PI * px) * Math.cos(m * Math.PI * py)
      - Math.cos(m * Math.PI * px) * Math.cos(n * Math.PI * py);
  };

  const frame = useCallback((ts) => {
    const st = s.current;

    // ── audio level ─────────────────────────────────────────────────────────
    if (st.micMode && st.analyser && audioDataRef.current) {
      st.analyser.getByteTimeDomainData(audioDataRef.current);
      let sum = 0;
      const buf = audioDataRef.current;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] / 128) - 1; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length) * 4;
      st.audioLevel = st.audioLevel * 0.75 + Math.min(1, rms * st.micSensitivity) * 0.25;
    }

    // ── get effective param values (base + audio modulation) ────────────────
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
    const conv = Math.max(0, Math.min(1, p('conv')));
    const spread = 4 + Math.max(0, Math.min(1, p('sprd'))) * 24;
    st.lastEffective = isTuring
      ? { turingScale: p1, turingWaves: p2, conv: p('conv'), sprd: p('sprd') }
      : { m: p1, n: p2, conv: p('conv'), sprd: p('sprd') };

    const ptX = ptCanvasRef.current?.getContext('2d');
    if (!ptX) return;
    const gs = 3;

    // ── camera: pull new frame from video (center-cropped, mirrored if front)
    if (st.cameraMode && !st.captured) {
      const video = videoRef.current;
      const tmp = cameraTmpRef.current;
      if (video && tmp && video.readyState >= 2 && video.videoWidth > 0) {
        const vw = video.videoWidth, vh = video.videoHeight;
        const sSize = Math.min(vw, vh);
        const sx = (vw - sSize) / 2;
        const sy = (vh - sSize) / 2;
        const tmpCtx = tmp.getContext('2d', { willReadFrequently: true });
        tmpCtx.save();
        if (st.facingMode === 'user') {
          tmpCtx.translate(W, 0);
          tmpCtx.scale(-1, 1);
        }
        tmpCtx.drawImage(video, sx, sy, sSize, sSize, 0, 0, W, H);
        tmpCtx.restore();
        st.srcPixels = tmpCtx.getImageData(0, 0, W, H).data;
        refreshParticleColors();
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

    // Fabric-curtain gather: particles displace toward nodal lines via a
    // smooth, topology-preserving tanh mapping.
    const K = 2.2;
    const tK = Math.tanh(K);

    // Build Turing direction table once per frame
    let turingDirs;
    if (isTuring) {
      const nGroups = Math.round(p2);
      const k = p1 * 2 * Math.PI / Math.min(W, H);
      turingDirs = new Array(TURING_N);
      for (let j = 0; j < TURING_N; j++) {
        let angle = TURING_SEED[j].angle;
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
      const nx = rawGx / gLen, ny = rawGy / gLen;
      const tx = -ny, ty = nx;

      const zn = z * 0.5;
      const gatherFrac = Math.tanh(zn * K) / tK;
      const displacement = gatherFrac * spread * conv;

      let x = part.ox - nx * displacement;
      let y = part.oy - ny * displacement;

      x += nx * spread * 0.12 * part.jitter * conv;
      y += ny * spread * 0.12 * part.jitter * conv;

      const phase = ts * 0.0007;
      const waveAmp = 2.5 * conv;
      x += tx * (Math.sin(part.ox * 0.038 + part.oy * 0.018 + phase) * waveAmp
        + Math.sin(part.ox * 0.019 + part.oy * 0.041 + phase * 0.7) * waveAmp * 0.5);
      y += ty * (Math.sin(part.ox * 0.018 + part.oy * 0.038 + phase * 1.1) * waveAmp
        + Math.sin(part.ox * 0.041 + part.oy * 0.019 + phase * 0.8) * waveAmp * 0.5);

      part.x = x; part.y = y;

      const nearLine = Math.exp(-zn * zn * 5) * conv;
      const radius = Math.max(0.5, PS + nearLine * 0.5);
      const alpha = Math.min(1, (0.5 + (1 - nearLine) * 0.25) * PARTOP);
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

  // ── canvas/source setup ───────────────────────────────────────────────────

  const setupCanvas = useCallback((w, h) => {
    s.current.dsW = w; s.current.dsH = h;
    const ptC = ptCanvasRef.current;
    ptC.width = w;
    ptC.height = h;
  }, []);

  // ── camera ────────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    const st = s.current;
    st.cameraStream = stopStream(st.cameraStream);
    st.cameraMode = false;
    st.captured = false;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (st.animId) { cancelAnimationFrame(st.animId); st.animId = null; }
    const ptX = ptCanvasRef.current?.getContext('2d');
    if (ptX && ptCanvasRef.current) ptX.clearRect(0, 0, ptCanvasRef.current.width, ptCanvasRef.current.height);
    const bgC = bgCanvasRef.current;
    if (bgC) bgC.getContext('2d').clearRect(0, 0, bgC.width, bgC.height);
    st.particles = []; st.srcPixels = null;
    setIsCameraActive(false);
    setIsCaptured(false);
  }, []);

  const startCamera = useCallback(async (requestedFacing) => {
    try {
      const facing = requestedFacing || s.current.facingMode || 'environment';
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing) });
      s.current.cameraStream = stream;
      s.current.cameraMode = true;
      s.current.facingMode = facing;
      s.current.captured = false;
      setFacingMode(facing);
      setIsCameraActive(true);
      setIsCaptured(false);
      const video = videoRef.current;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        if (!cameraTmpRef.current) cameraTmpRef.current = document.createElement('canvas');
        cameraTmpRef.current.width = CANVAS_SIZE;
        cameraTmpRef.current.height = CANVAS_SIZE;
        setupCanvas(CANVAS_SIZE, CANVAS_SIZE);
        video.addEventListener('playing', () => {
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
          s.current.srcPixels = tmpCtx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE).data;
          sampleParticles(); startAnim();
        }, { once: true });
      };
    } catch {
      console.warn('Camera access denied');
    }
  }, [setupCanvas, sampleParticles, startAnim]);

  const toggleFacingMode = useCallback(async () => {
    const st = s.current;
    const next = st.facingMode === 'user' ? 'environment' : 'user';
    st.cameraStream = stopStream(st.cameraStream);
    st.captured = false;
    setIsCaptured(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(next) });
      st.cameraStream = stream;
      st.facingMode = next;
      setFacingMode(next);
      const video = videoRef.current;
      video.srcObject = stream;
      video.play();
    } catch {
      console.warn('Camera access denied');
    }
  }, []);

  // ── capture / clear / save ────────────────────────────────────────────────

  const modKeysForMode = () =>
    s.current.patternMode === 'turing'
      ? ['turingScale', 'turingWaves', 'conv', 'sprd']
      : ['m', 'n', 'conv', 'sprd'];

  const restoreMicMod = useCallback(() => {
    const st = s.current;
    if (st.waveModBeforeCapture) {
      Object.assign(st.micMod, st.micModBeforeCapture);
      setWaveModActive(true);
    }
  }, []);

  const captureImage = useCallback(() => {
    const st = s.current;
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

  const clearCapture = useCallback(() => {
    s.current.captured = false;
    setIsCaptured(false);
    restoreMicMod();
  }, [restoreMicMod]);

  const getFlattenedBlob = useCallback(() => {
    const pt = ptCanvasRef.current;
    if (!pt) return Promise.resolve(null);
    const out = document.createElement('canvas');
    out.width = pt.width;
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
      try { await navigator.share({ files: [file] }); return; } catch { }
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
    restoreMicMod();
  }, [getFlattenedBlob, restoreMicMod]);

  const cloudApi = window.location.hostname === 'localhost'
    ? 'http://localhost:3127' : 'https://cloud.leo.gd';
  const cloudApp = window.location.hostname === 'localhost'
    ? 'http://localhost:5173' : 'https://cloud.leo.gd';

  const postToCloud = useCallback(async () => {
    const win = window.open('about:blank', '_blank');
    const blob = await getFlattenedBlob();
    if (!blob) return;
    const form = new FormData();
    form.append('image', blob, 'mosaic.jpg');
    try {
      const res = await fetch(`${cloudApi}/api/prefill-media`, {
        method: 'POST',
        body: form,
      });
      const { filename } = await res.json();
      const pt = ptCanvasRef.current;
      const url = `${cloudApp}/?compose=${filename}&source=mosaic${pt ? `&width=${pt.width}&height=${pt.height}` : ''}`;
      if (win) win.location = url;
    } catch (e) {
      console.warn('Post to Cloud failed:', e);
    }
  }, [getFlattenedBlob]);

  // ── microphone ────────────────────────────────────────────────────────────

  const stopMic = useCallback(() => {
    const st = s.current;
    st.audioStream = stopStream(st.audioStream);
    if (st.audioCtx) { st.audioCtx.close(); st.audioCtx = null; }
    st.analyser = null; st.micMode = false; st.audioLevel = 0;
    setIsMicActive(false);
  }, []);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      s.current.audioStream = stream;
      s.current.analyser = analyser;
      s.current.audioCtx = ctx;
      s.current.micMode = true;
      setIsMicActive(true);
    } catch {
      console.warn('Microphone access denied');
    }
  }, []);

  const startCameraAndMic = useCallback(async (facing) => {
    await startCamera(facing || s.current.facingMode || 'environment');
  }, [startCamera]);

  const stopCameraAndMic = useCallback(() => {
    stopCamera();
    if (s.current.micMode) stopMic();
  }, [stopCamera, stopMic]);

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

  // ── lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    startCameraAndMic('environment');
  }, []);

  useEffect(() => {
    if (!cameraTmpRef.current) cameraTmpRef.current = document.createElement('canvas');
    return () => {
      if (s.current.animId) cancelAnimationFrame(s.current.animId);
      stopStream(s.current.cameraStream);
      stopStream(s.current.audioStream);
      if (s.current.audioCtx) s.current.audioCtx.close();
    };
  }, []);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <>
      <HiddenVideo ref={videoRef} playsInline muted />
      <BgCanvas ref={bgCanvasRef} width={24} height={24} />

      <Root>
        <CanvasArea>
          <CanvasWrap>
            <canvas ref={ptCanvasRef} />
          </CanvasWrap>
        </CanvasArea>

        <ControlsWrapper>
          <ControlsInner
            animate={{ opacity: isCaptured ? 0.25 : 1 }}
            transition={{ duration: 0.2 }}
            style={{ pointerEvents: isCaptured ? 'none' : 'auto' }}
          >
            <PatternModeSelector patternMode={patternMode} onSelect={switchPatternMode} />

            <MatricesRow>
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
                  onSelect={(sc, wv) => { s.current.turingScale = sc; s.current.turingWaves = wv; setScaleVal(sc); setWavesVal(wv); }}
                />
              )}
              <MatrixController
                xValues={SETTLE_VALUES} yValues={SETTLE_VALUES}
                xVal={sprdVal} yVal={convVal}
                onSelect={(sprd, conv) => { s.current.sprd = sprd; s.current.conv = conv; setSprdVal(sprd); setConvVal(conv); }}
              />
            </MatricesRow>

            <ActionRow>
              <MicButton $active={waveModActive} onClick={toggleWaveMod}>
                <FontAwesomeIcon icon={waveModActive ? faMicrophone : faMicrophoneSlash} style={{ fontSize: 18 }} />
              </MicButton>

              <ChunkButton $primary onClick={captureImage}>
                Capture
              </ChunkButton>

              <SwapButton
                onClick={toggleFacingMode}
                title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
              >
                <FontAwesomeIcon icon={faCameraRotate} style={{ fontSize: 18 }} />
              </SwapButton>
            </ActionRow>
          </ControlsInner>

          <CaptureOverlay
            visible={isCaptured}
            onSave={savePhoto}
            onPost={postToCloud}
            onClear={clearCapture}
          />
        </ControlsWrapper>
      </Root>
    </>
  );
}

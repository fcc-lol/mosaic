import React, { useRef, useEffect, useCallback } from 'react';

const INITIAL = {
  m: 3, n: 4, str: 30, thresh: 0.12,
  ps: 1.4, amp: 0.55, spd: 0.7, wscale: 2.2, boost: 1.4, partop: 1.0,
  imgop: 0.25, desat: 0.6, dark: 0.5, grid: 5,
};

export default function ChladniParticleGhost() {
  const bgCanvasRef = useRef(null);
  const ptCanvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const dropZoneRef = useRef(null);
  const statusRef = useRef(null);

  // All mutable state lives in a single ref so the animation frame always
  // reads the latest values without needing re-renders.
  const s = useRef({
    particles: [], dsW: 0, dsH: 0,
    animId: null, startTime: null,
    srcPixels: null, bgImageData: null,
    ...INITIAL,
  });

  // ── display value refs for label spans ──────────────────────────────────
  const dispRefs = useRef({});

  const setDisp = useCallback((id, text) => {
    if (dispRefs.current[id]) dispRefs.current[id].textContent = text;
  }, []);

  // ── core functions ───────────────────────────────────────────────────────

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

  const chladni = (x, y, m, n, W, H) => {
    const px = x / W, py = y / H;
    return Math.cos(n * Math.PI * px) * Math.cos(m * Math.PI * py)
         - Math.cos(m * Math.PI * px) * Math.cos(n * Math.PI * py);
  };

  const frame = useCallback((ts) => {
    const st = s.current;
    if (!st.startTime) st.startTime = ts;
    const t = (ts - st.startTime) / 1000;
    const { m, n, str, thresh, ps, amp, spd, wscale, boost, partop, dsW: W, dsH: H, particles } = st;
    const ptX = ptCanvasRef.current?.getContext('2d');
    if (!ptX) return;
    const gs = 3;

    ptX.clearRect(0, 0, W, H);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const x = p.ox, y = p.oy;
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
      const br = Math.min(255, Math.round(p.r * boost));
      const bg = Math.min(255, Math.round(p.g * boost));
      const bb = Math.min(255, Math.round(p.b * boost));
      ptX.beginPath();
      ptX.arc(nx, ny, radius, 0, Math.PI * 2);
      ptX.fillStyle = `rgba(${br},${bg},${bb},${alpha.toFixed(2)})`;
      ptX.fill();
    }
    st.animId = requestAnimationFrame(frame);
  }, []);

  const startAnim = useCallback(() => {
    const st = s.current;
    if (st.animId) cancelAnimationFrame(st.animId);
    st.startTime = null;
    st.animId = requestAnimationFrame(frame);
  }, [frame]);

  const loadFile = useCallback((file) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 800;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxDim || h > maxDim) { const sc = maxDim / Math.max(w, h); w = Math.round(w * sc); h = Math.round(h * sc); }
      s.current.dsW = w; s.current.dsH = h;

      const bgC = bgCanvasRef.current;
      const ptC = ptCanvasRef.current;
      bgC.width = ptC.width = w;
      bgC.height = ptC.height = h;

      const wrap = canvasWrapRef.current;
      wrap.style.width  = w + 'px';
      wrap.style.height = h + 'px';
      wrap.style.maxWidth = '100%';

      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      const tCtx = tmp.getContext('2d');
      tCtx.drawImage(img, 0, 0, w, h);
      s.current.srcPixels   = tCtx.getImageData(0, 0, w, h).data;
      s.current.bgImageData = tCtx.getImageData(0, 0, w, h);

      URL.revokeObjectURL(url);
      if (dropZoneRef.current) dropZoneRef.current.style.display = 'none';
      wrap.classList.add('visible');
      sampleParticles();
      drawBg();
      startAnim();
    };
    img.src = url;
  }, [sampleParticles, drawBg, startAnim]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (s.current.animId) cancelAnimationFrame(s.current.animId);
    };
  }, []);

  // ── event handlers ───────────────────────────────────────────────────────

  const handleDrop = (e) => { e.preventDefault(); dropZoneRef.current?.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); };
  const handleDragOver = (e) => { e.preventDefault(); dropZoneRef.current?.classList.add('drag'); };
  const handleDragLeave = () => dropZoneRef.current?.classList.remove('drag');
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
    // sync slider DOM values
    document.getElementById('m-slider').value = mv;
    document.getElementById('n-slider').value = nv;
  };

  // ── render ───────────────────────────────────────────────────────────────

  const dispRef = (id) => (el) => { dispRefs.current[id] = el; };

  const Slider = ({ id, min, max, step, def, fmt, redraw, label }) => (
    <div className="ctrl">
      <label>{label}</label>
      <input
        type="range" id={id + '-slider'}
        min={min} max={max} step={step} defaultValue={def}
        onChange={makeSliderHandler(id, fmt, redraw)}
      />
      <span className="val" ref={dispRef(id + 'v')}>{fmt(def)}</span>
    </div>
  );

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400&family=DM+Sans:wght@300;400;500&display=swap');
        :root {
          --bg: #0c0c0c;
          --surface: #161616;
          --border: rgba(255,255,255,0.08);
          --border-strong: rgba(255,255,255,0.15);
          --text-primary: #e8e6e0;
          --text-secondary: #888780;
          --text-tertiary: #4a4845;
          --accent: #c8c0a8;
          --font-mono: 'DM Mono', 'Fira Mono', monospace;
          --font-sans: 'DM Sans', system-ui, sans-serif;
          --radius: 8px;
          --radius-lg: 12px;
        }
        html, body, #root {
          height: 100%;
          background: var(--bg);
        }
        .chladni-root {
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-size: 13px;
          min-height: 100vh;
          display: grid;
          grid-template-columns: 1fr 300px;
          grid-template-rows: auto 1fr;
          background: var(--bg);
        }
        .chladni-root header {
          grid-column: 1 / -1;
          padding: 16px 24px;
          border-bottom: 0.5px solid var(--border);
          display: flex;
          align-items: baseline;
          gap: 16px;
        }
        .chladni-root header h1 {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 400;
          color: var(--text-secondary);
          letter-spacing: .08em;
        }
        .chladni-root header span {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-tertiary);
        }
        #canvas-area {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          overflow: hidden;
        }
        #drop-zone {
          position: absolute;
          inset: 24px;
          border: 1px dashed var(--border-strong);
          border-radius: var(--radius-lg);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: border-color .2s, background .2s;
          z-index: 2;
        }
        #drop-zone:hover, #drop-zone.drag {
          border-color: rgba(255,255,255,0.25);
          background: rgba(255,255,255,0.02);
        }
        #drop-zone input { display: none; }
        #drop-zone .dz-title { font-size: 15px; font-weight: 500; color: var(--text-primary); margin-bottom: 6px; }
        #drop-zone .dz-sub { font-size: 12px; color: var(--text-secondary); }
        #canvas-wrap {
          position: relative;
          border-radius: var(--radius-lg);
          overflow: hidden;
          background: #000;
          display: none;
          max-width: 100%;
        }
        #canvas-wrap.visible { display: block; }
        #canvas-wrap canvas {
          position: absolute;
          top: 0; left: 0;
          width: 100%; height: 100%;
          display: block;
        }
        #c-bg { position: relative; }
        #sidebar {
          border-left: 0.5px solid var(--border);
          padding: 20px 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .section {
          padding: 14px 0;
          border-bottom: 0.5px solid var(--border);
        }
        .section:last-child { border-bottom: none; }
        .section-title {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-tertiary);
          text-transform: uppercase;
          letter-spacing: .1em;
          margin-bottom: 10px;
        }
        .ctrl {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 8px 0;
        }
        .ctrl label {
          width: 118px;
          flex-shrink: 0;
          color: var(--text-secondary);
          font-size: 12px;
        }
        .ctrl input[type=range] {
          flex: 1;
          -webkit-appearance: none;
          height: 2px;
          background: var(--border-strong);
          border-radius: 2px;
          outline: none;
        }
        .ctrl input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px; height: 12px;
          border-radius: 50%;
          background: var(--accent);
          cursor: pointer;
        }
        .ctrl .val {
          width: 40px;
          text-align: right;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-primary);
        }
        .presets {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 4px;
        }
        .presets button {
          font-family: var(--font-mono);
          font-size: 11px;
          padding: 3px 9px;
          background: transparent;
          border: 0.5px solid var(--border-strong);
          border-radius: 4px;
          color: var(--text-secondary);
          cursor: pointer;
          transition: background .15s, color .15s;
        }
        .presets button:hover {
          background: rgba(255,255,255,0.05);
          color: var(--text-primary);
        }
        #status {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-tertiary);
          margin-top: 10px;
          min-height: 16px;
        }
        @media (max-width: 700px) {
          .chladni-root { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; }
          #sidebar { border-left: none; border-top: 0.5px solid var(--border); }
          .chladni-root header { grid-column: 1; }
        }
      `}</style>

      <div className="chladni-root">
        <header>
          <h1>chladni_particle_ghost</h1>
          <span>image → particles → standing wave</span>
        </header>

        <div id="canvas-area">
          <div
            id="drop-zone"
            ref={dropZoneRef}
            onClick={() => document.getElementById('file-input').click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input type="file" id="file-input" accept="image/*" onChange={handleFileChange} />
            <div className="dz-title">Drop a photo here</div>
            <div className="dz-sub">image shows through beneath the particles</div>
          </div>
          <div id="canvas-wrap" ref={canvasWrapRef}>
            <canvas id="c-bg" ref={bgCanvasRef} />
            <canvas id="c-particles" ref={ptCanvasRef} />
          </div>
        </div>

        <div id="sidebar">
          <div className="section">
            <div className="section-title">Wave</div>
            <Slider id="m"      label="Mode m"        min={1}    max={10}  step={1}    def={INITIAL.m}      fmt={v => v} />
            <Slider id="n"      label="Mode n"        min={1}    max={10}  step={1}    def={INITIAL.n}      fmt={v => v} />
            <Slider id="str"    label="Warp strength" min={0}    max={80}  step={1}    def={INITIAL.str}    fmt={v => v} />
            <Slider id="thresh" label="Node threshold" min={0.01} max={0.4} step={0.01} def={INITIAL.thresh} fmt={v => (+v).toFixed(2)} />
            <div className="presets">
              {[[2,3],[3,4],[3,5],[4,5],[5,7],[6,7],[7,9]].map(([mv,nv]) => (
                <button key={`${mv},${nv}`} onClick={() => preset(mv, nv)}>{mv},{nv}</button>
              ))}
            </div>
          </div>

          <div className="section">
            <div className="section-title">Particles</div>
            <Slider id="grid"   label="Grid size"       min={2}   max={12} step={1}    def={INITIAL.grid}   fmt={v => v + 'px'} />
            <Slider id="ps"     label="Base size"       min={0.5} max={4}  step={0.1}  def={INITIAL.ps}     fmt={v => (+v).toFixed(1)} />
            <Slider id="amp"    label="Anim amplitude"  min={0}   max={2}  step={0.05} def={INITIAL.amp}    fmt={v => (+v).toFixed(2)} />
            <Slider id="spd"    label="Anim speed"      min={0.1} max={3}  step={0.05} def={INITIAL.spd}    fmt={v => (+v).toFixed(2)} />
            <Slider id="wscale" label="Wave scale"      min={0.5} max={6}  step={0.1}  def={INITIAL.wscale} fmt={v => (+v).toFixed(1)} />
            <Slider id="boost"  label="Brightness boost" min={1}  max={3}  step={0.05} def={INITIAL.boost}  fmt={v => (+v).toFixed(2) + 'x'} />
            <Slider id="partop" label="Particle opacity" min={0.1} max={1} step={0.01} def={INITIAL.partop} fmt={v => (+v).toFixed(2)} />
          </div>

          <div className="section">
            <div className="section-title">Compositing</div>
            <Slider id="imgop" label="Image opacity" min={0} max={1} step={0.01} def={INITIAL.imgop} fmt={v => (+v).toFixed(2)} redraw />
            <Slider id="desat" label="Desaturate"    min={0} max={1} step={0.01} def={INITIAL.desat} fmt={v => (+v).toFixed(2)} redraw />
            <Slider id="dark"  label="Darken"        min={0} max={1} step={0.01} def={INITIAL.dark}  fmt={v => (+v).toFixed(2)} redraw />
          </div>

          <div id="status" ref={statusRef} />
        </div>
      </div>
    </>
  );
}

import React, { useRef, useEffect } from 'react';
import styled from 'styled-components';

const MatrixSvg = styled.svg`
  display: block;
  border-radius: 16px;
  background: rgba(255,255,255,0.04);
  border: 0.5px solid rgba(255,255,255,0.08);
  cursor: crosshair;
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
`;

const CELL = 20;
const PAD = 6;

export default function MatrixController({ xValues, yValues, xVal, yVal, onSelect }) {
  const cols = xValues.length;
  const rows = yValues.length;
  const vw = cols * CELL + PAD * 2;
  const vh = rows * CELL + PAD * 2;
  const selX = Math.max(0, xValues.findIndex(v => Math.abs(v - xVal) < 1e-9));
  const selY = Math.max(0, yValues.findIndex(v => Math.abs(v - yVal) < 1e-9));
  const sig = (Math.max(cols, rows) - 1) * 0.35;
  const svgRef = useRef(null);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

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
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onStart = e => { e.preventDefault(); const t = e.targetTouches[0]; fireSelect(el, t.clientX, t.clientY); };
    const onMove = e => { e.preventDefault(); const t = e.targetTouches[0]; fireSelect(el, t.clientX, t.clientY); };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); };
  }, [xValues, yValues]);

  const dots = [];
  for (let yi = 0; yi < rows; yi++) {
    for (let xi = 0; xi < cols; xi++) {
      const dx = xi - selX, dy = yi - selY;
      const t = Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
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
    <MatrixSvg
      ref={svgRef}
      viewBox={`0 0 ${vw} ${vh}`}
      width="100%"
      onClick={e => fireSelect(e.currentTarget, e.clientX, e.clientY)}
      onMouseMove={e => { if (e.buttons) fireSelect(e.currentTarget, e.clientX, e.clientY); }}
    >
      {dots}
    </MatrixSvg>
  );
}

import styled, { css } from 'styled-components';
import { motion } from 'framer-motion';

// ── ChunkButton variants ────────────────────────────────────────────────────

const primaryVariant = css`
  background: var(--accent);
  color: #0c0c0c;
  border-color: var(--accent);
  &:hover  { background: #d8d0b8; }
  &:active { background: #b8b098; }
`;

const postVariant = css`
  background: #2a2a2a;
  border-color: rgba(255,255,255,0.15);
  &:hover  { background: #323232; }
  &:active { background: #383838; }
`;

const clearVariant = css`
  color: #f0b0a0;
  border-color: rgba(240,176,160,0.35);
  background: #1e1312;
  &:hover { background: #261816; }
`;

export const ChunkButton = styled(motion.button)`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: 15px;
  font-weight: 500;
  padding: 18px;
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
  transition: background 0.15s, border-color 0.15s;

  &:hover  { background: rgba(255,255,255,0.1); }
  &:active { background: rgba(255,255,255,0.14); }

  ${p => p.$primary && primaryVariant}
  ${p => p.$post && postVariant}
  ${p => p.$clear && clearVariant}
`;

// ── IconButton ──────────────────────────────────────────────────────────────

export const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  padding: 0;
  background: rgba(255,255,255,0.06);
  border: 0.5px solid var(--border-strong);
  border-radius: 16px;
  color: var(--text-primary);
  cursor: pointer;
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, border-color 0.15s, color 0.15s;

  &:hover {
    background: rgba(255,255,255,0.1);
    color: var(--accent);
  }

  svg { flex-shrink: 0; }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

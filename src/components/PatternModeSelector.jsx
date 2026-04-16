import React from 'react';
import styled from 'styled-components';

const Row = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
`;

const ModeButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: ${p => p.$active ? 'rgba(200,192,168,0.12)' : 'rgba(255,255,255,0.04)'};
  border: 1px solid ${p => p.$active ? 'rgba(200,192,168,0.35)' : 'rgba(255,255,255,0.08)'};
  border-radius: 10px;
  color: ${p => p.$active ? 'var(--accent)' : 'var(--text-tertiary)'};
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, border-color 0.15s, color 0.15s;

  &:hover {
    background: rgba(255,255,255,0.08);
    color: var(--text-secondary);
  }
`;

const ChladniIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <path d="M4 4Q12 8.5 20 4" />
    <path d="M4 20Q12 15.5 20 20" />
    <path d="M4 4Q8.5 12 4 20" />
    <path d="M20 4Q15.5 12 20 20" />
  </svg>
);

const TuringIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <circle cx="5.5" cy="5" r="2" />
    <circle cx="15" cy="4" r="1.8" />
    <circle cx="20" cy="11" r="1.6" />
    <circle cx="10.5" cy="11.5" r="2.4" />
    <circle cx="3.5" cy="14" r="1.4" />
    <circle cx="17" cy="18.5" r="2" />
    <circle cx="7" cy="20" r="1.8" />
    <circle cx="21" cy="20" r="1.2" />
  </svg>
);

export default function PatternModeSelector({ patternMode, onSelect }) {
  return (
    <Row>
      <ModeButton
        $active={patternMode === 'chladni'}
        onClick={() => onSelect('chladni')}
        title="Chladni pattern"
        aria-label="Chladni pattern"
      >
        <ChladniIcon />
      </ModeButton>
      <ModeButton
        $active={patternMode === 'turing'}
        onClick={() => onSelect('turing')}
        title="Turing pattern"
        aria-label="Turing pattern"
      >
        <TuringIcon />
      </ModeButton>
    </Row>
  );
}

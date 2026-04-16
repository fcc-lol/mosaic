import { createGlobalStyle } from 'styled-components';

const GlobalStyles = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :root {
    --bg: #0c0c0c;
    --surface: #161616;
    --border: rgba(255,255,255,0.08);
    --border-strong: rgba(255,255,255,0.15);
    --text-primary: #e8e6e0;
    --text-secondary: #888780;
    --text-tertiary: #4a4845;
    --accent: #c8c0a8;
    --font-mono: 'DM Mono','Fira Mono',monospace;
    --font-sans: 'DM Sans',system-ui,sans-serif;
    --radius: 8px;
    --radius-lg: 12px;
  }

  html, body, #root {
    height: 100%;
    background: var(--bg);
  }

  @media (max-width: 640px) {
    html, body, #root {
      height: 100%;
      overflow: hidden;
    }
  }
`;

export default GlobalStyles;

// All rendering happens on a square canvas at this pixel size.
export const CANVAS_SIZE = 600;

// Locked particle/render params.
export const GRID = 5;
export const PS = 1.4;
export const BOOST = 1.8;
export const PARTOP = 1.0;

export const INITIAL = {
  m: 3, n: 4, conv: 0.8, sprd: 0.8,
};

// Maximum amount each param can swing upward when audio is at full level
export const MOD_RANGE = {
  m: 7, n: 6, conv: 0.4, sprd: 0.4,
  turingScale: 6, turingWaves: 5,
};

// Value arrays for matrix controllers
export const M_VALUES = Array.from({ length: 10 }, (_, i) => i + 1);
export const N_VALUES = Array.from({ length: 10 }, (_, i) => i + 1);
export const SETTLE_VALUES = Array.from({ length: 21 }, (_, i) => +(i / 20).toFixed(2));

export const TURING_INITIAL = { scale: 4, waves: 5 };
export const SCALE_VALUES = Array.from({ length: 10 }, (_, i) => i + 1);  // 1-10
export const WAVES_VALUES = Array.from({ length: 10 }, (_, i) => i + 2);  // 2-11

// Turing pattern: precomputed random wave directions.
// 48 cosine waves with random orientations + phases create a band-limited
// random field whose zero-crossings form organic labyrinthine patterns
// (matching real reaction-diffusion morphology).
export const TURING_N = 48;
export const TURING_SEED = [];
for (let i = 0; i < TURING_N; i++) {
  // Deterministic pseudo-random via sine hash (no external PRNG needed).
  const h1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  const h2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
  TURING_SEED.push({
    angle: ((h1 % 1 + 1) % 1) * Math.PI * 2,
    phase: ((h2 % 1 + 1) % 1) * Math.PI * 2,
  });
}

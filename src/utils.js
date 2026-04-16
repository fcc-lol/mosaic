import { GRID } from './constants';

/** Stop all tracks on a media stream and return null for easy assignment. */
export function stopStream(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
  return null;
}

/** Average RGB values in a GRID x GRID block starting at (px, py). */
export function averageGridColor(srcPixels, px, py, W, H) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let dy = 0; dy < GRID && py + dy < H; dy++) {
    for (let dx = 0; dx < GRID && px + dx < W; dx++) {
      const i = ((py + dy) * W + (px + dx)) * 4;
      r += srcPixels[i];
      g += srcPixels[i + 1];
      b += srcPixels[i + 2];
      count++;
    }
  }
  if (count === 0) return null;
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

/** Build video constraints for getUserMedia. */
export function videoConstraints(facing) {
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: { ideal: facing },
  };
}

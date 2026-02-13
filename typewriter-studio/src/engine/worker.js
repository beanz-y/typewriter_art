// src/engine/worker.js

const DEFAULT_RAMP = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ".split('');
const EDGE_CHARS = ['-', '|', '/', '\\', '(', ')', '[', ']', '{', '}', '<', '>', 'I', 'l', '1', '!', '?'];

let stopFlag = false;

function calculateDensityMap(charString, fontSize) {
  const chars = Array.from(new Set((charString || "").split('')));
  if (chars.length === 0) return DEFAULT_RAMP;

  const size = fontSize * 2;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const densityData = chars.map(char => {
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'black';
    ctx.fillText(char, size / 2, size / 2);
    
    const imgData = ctx.getImageData(0, 0, size, size).data;
    let blackPixels = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i] < 128) blackPixels++;
    }
    return { char, density: blackPixels };
  });

  densityData.sort((a, b) => b.density - a.density);
  return densityData.map(d => d.char);
}

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'STOP') {
    stopFlag = true;
    return;
  }

  if (type === 'START') {
    stopFlag = false;
    const { imageData, maskData, width, height, params } = payload;
    
    const scale = parseFloat(params.outputScale);
    const outW = Math.floor(width * scale);
    const outH = Math.floor(height * scale);

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, outW, outH);
    
    const fontSize = Math.floor(params.fontSize * scale);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const activeRamp = calculateDensityMap(params.characterSet, fontSize);
    const rampLen = activeRamp.length;

    const pixels = imageData.data;
    const grayData = new Float32Array(width * height);
    const gamma = params.gamma;
    
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i+1];
      const b = pixels[i+2];
      let lum = 0.299 * r + 0.587 * g + 0.114 * b;
      lum = 255 * Math.pow(lum / 255.0, 1.0 / gamma);
      grayData[i / 4] = lum;
    }

    const totalStrokes = params.totalStrokes;
    const updateInterval = 5000;
    let currentStroke = 0;

    // --- NEW: Chunked rendering function ---
    const renderChunk = async () => {
      // If STOP was clicked, send the final frame and exit immediately
      if (stopFlag) {
        const finalBitmap = await createImageBitmap(canvas);
        self.postMessage({ type: 'FINISHED', progress: currentStroke / totalStrokes, imageBitmap: finalBitmap }, [finalBitmap]);
        return;
      }

      // Calculate how many strokes to do in this "chunk"
      const chunkLimit = Math.min(currentStroke + updateInterval, totalStrokes);
      
      for (; currentStroke < chunkLimit; currentStroke++) {
        const rx = Math.random() * (width - 1);
        const ry = Math.random() * (height - 1);
        const ix = Math.floor(rx);
        const iy = Math.floor(ry);
        const idx = iy * width + ix;

        let maskMult = 1.0;
        if (maskData && maskData.data[(idx * 4) + 3] > 100) maskMult = 1.3;

        const pixelVal = grayData[idx];
        const darkness = (255.0 - pixelVal) / 255.0;
        let strikeProb = Math.pow(darkness, 2.2);
        strikeProb = Math.min(strikeProb, 0.85) * maskMult;

        if (Math.random() < strikeProb) {
          const wearFactor = 1.0 - (Math.random() * params.ribbonWear);
          const currentAlpha = (params.inkOpacity / 255) * wearFactor;
          
          const targetIndex = Math.floor((1.0 - darkness) * (rampLen - 1));
          const finalIndex = Math.max(0, Math.min(rampLen - 1, targetIndex + Math.floor(Math.random() * 3 - 1)));
          const char = activeRamp[finalIndex];

          const destX = rx * scale;
          const destY = ry * scale;
          
          ctx.save();
          ctx.translate(destX, destY);
          ctx.rotate((Math.random() * 10 - 5) * Math.PI / 180);
          
          const origR = pixels[idx * 4];
          const origG = pixels[idx * 4 + 1];
          const origB = pixels[idx * 4 + 2];
          
          ctx.fillStyle = `rgba(${origR}, ${origG}, ${origB}, ${currentAlpha})`;
          ctx.fillText(char, 0, 0);

          if (params.dirtyInk > 0 && Math.random() < (params.dirtyInk * 0.2)) {
            const ox = Math.random() * 2 - 1;
            const oy = Math.random() * 2 - 1;
            ctx.fillStyle = `rgba(${origR}, ${origG}, ${origB}, ${currentAlpha * 0.6})`;
            ctx.fillText(char, ox, oy);
          }
          ctx.restore();
        }
      }

      // Send the preview to the main thread
      const bitmap = await createImageBitmap(canvas);
      self.postMessage({ 
        type: 'PROGRESS', 
        progress: currentStroke / totalStrokes,
        imageBitmap: bitmap 
      }, [bitmap]);

      // If we haven't hit the total strokes, schedule the next chunk
      if (currentStroke < totalStrokes) {
        setTimeout(renderChunk, 0); 
      } else {
        // Send final finished signal
        const finalBitmap = await createImageBitmap(canvas);
        self.postMessage({ type: 'FINISHED', progress: 1.0, imageBitmap: finalBitmap }, [finalBitmap]);
      }
    };

    // Kick off the first chunk
    renderChunk();
  }
};
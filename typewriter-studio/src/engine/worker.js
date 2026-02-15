const DEFAULT_RAMP = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ".split('');

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
    const { imageData, sourceBitmap, maskData, width, height, params } = payload;
    
    const scale = parseFloat(params.outputScale);
    const outW = Math.floor(width * scale);
    const outH = Math.floor(height * scale);

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, outW, outH);

    let origMaskCanvas = null;
    if (maskData.original) {
      origMaskCanvas = new OffscreenCanvas(outW, outH);
      const oCtx = origMaskCanvas.getContext('2d');
      oCtx.drawImage(sourceBitmap, 0, 0, outW, outH);
      const origMaskBitmap = await createImageBitmap(maskData.original);
      oCtx.globalCompositeOperation = 'destination-in';
      oCtx.drawImage(origMaskBitmap, 0, 0, outW, outH);
    }

    const displayCanvas = new OffscreenCanvas(outW, outH);
    const displayCtx = displayCanvas.getContext('2d');
    
    const baseFontSize = Math.floor(params.fontSize * scale);
    const detailFontSize = Math.max(1, Math.floor(baseFontSize / 2));
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const baseRamp = calculateDensityMap(params.characterSet, baseFontSize);
    const detailRamp = calculateDensityMap(params.characterSet, detailFontSize);

    const pixels = imageData.data;
    const grayData = new Float32Array(width * height);
    const gamma = params.gamma;
    
    for (let i = 0; i < pixels.length; i += 4) {
      let lum = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
      lum = 255 * Math.pow(lum / 255.0, 1.0 / gamma);
      grayData[i / 4] = lum;
    }

    const totalStrokes = params.totalStrokes;
    const updateInterval = Math.max(5000, Math.floor(totalStrokes / 100));
    let currentStroke = 0;
    let activeFontSize = -1; 

    const renderChunk = async () => {
      const sendFrame = async (messageType) => {
        displayCtx.clearRect(0, 0, outW, outH);
        displayCtx.drawImage(canvas, 0, 0);
        if (origMaskCanvas) displayCtx.drawImage(origMaskCanvas, 0, 0);
        const bitmap = await createImageBitmap(displayCanvas);
        self.postMessage({ type: messageType, progress: currentStroke / totalStrokes, imageBitmap: bitmap }, [bitmap]);
      };

      if (stopFlag) {
        await sendFrame('FINISHED');
        return;
      }

      const chunkLimit = Math.min(currentStroke + updateInterval, totalStrokes);
      
      for (; currentStroke < chunkLimit; currentStroke++) {
        const rx = Math.random() * (width - 1);
        const ry = Math.random() * (height - 1);
        const ix = Math.floor(rx);
        const iy = Math.floor(ry);
        const idx = iy * width + ix;

        // READ MASKS AS FLOATS (0.0 to 1.0) for soft edges
        // Note: data[idx*4+3] is the Alpha channel.
        let densityAlpha = maskData.density ? maskData.density.data[(idx * 4) + 3] / 255.0 : 0;
        let detailAlpha = maskData.detail ? maskData.detail.data[(idx * 4) + 3] / 255.0 : 0;
        let colorAlpha = maskData.color ? maskData.color.data[(idx * 4) + 3] / 255.0 : 0;

        // DENSITY LOGIC: Linear Interpolation based on alpha
        // If alpha is 0.5 (feathered edge), we use a multiplier halfway between "Base" and "Boost".
        let maskMult = 1.0;
        if (maskData.density) {
          const boost = params.densityWeight;
          const suppress = 1.0 / params.densityWeight;
          // Lerp: suppress + (boost - suppress) * alpha
          maskMult = suppress + (boost - suppress) * densityAlpha;
        }

        const pixelVal = grayData[idx];
        const darkness = (255.0 - pixelVal) / 255.0;
        
        let strikeProb = Math.pow(darkness, 2.2);
        strikeProb = Math.min(strikeProb * maskMult, 1.0); 

        if (Math.random() < strikeProb) {
          
          // DETAIL LOGIC: Probabilistic switching
          // If alpha is 0.5, 50% chance to be "Detailed", 50% chance to be "Base".
          // This creates a dithered transition area.
          const isDetailStroke = Math.random() < detailAlpha;
          
          const currentRamp = isDetailStroke ? detailRamp : baseRamp;
          const rampLen = currentRamp.length;
          const targetFontSize = isDetailStroke ? detailFontSize : baseFontSize;

          if (targetFontSize !== activeFontSize) {
            ctx.font = `bold ${targetFontSize}px monospace`;
            activeFontSize = targetFontSize;
          }

          const wearFactor = 1.0 - (Math.random() * params.ribbonWear);
          const currentAlpha = (params.inkOpacity / 255) * wearFactor;

          const destX = rx * scale;
          const destY = ry * scale;

          const drawCount = isDetailStroke ? 3 : 1; 
          
          for(let d = 0; d < drawCount; d++) {
            let offsetX = d > 0 ? (Math.random() * targetFontSize - targetFontSize/2) : 0;
            let offsetY = d > 0 ? (Math.random() * targetFontSize - targetFontSize/2) : 0;

            const sampleRx = rx + (offsetX / scale);
            const sampleRy = ry + (offsetY / scale);
            
            if (sampleRx < 0 || sampleRx >= width || sampleRy < 0 || sampleRy >= height) continue;

            const sampleIdx = Math.floor(sampleRy) * width + Math.floor(sampleRx);
            const sampleVal = grayData[sampleIdx];
            const sampleDarkness = (255.0 - sampleVal) / 255.0;
            
            const targetIndex = Math.floor((1.0 - sampleDarkness) * (rampLen - 1));
            const finalIndex = Math.max(0, Math.min(rampLen - 1, targetIndex + Math.floor(Math.random() * 3 - 1)));
            const char = currentRamp[finalIndex];

            // COLOR LOGIC: Probabilistic switching
            // If alpha is 0.5, 50% chance to pick RGB color, 50% chance to use B&W.
            let useColor = params.colorMode === 'Color';
            if (params.colorMode === 'Masked Color') {
                useColor = Math.random() < colorAlpha;
            }
            
            if (useColor) {
               const r = pixels[sampleIdx * 4];
               const g = pixels[sampleIdx * 4 + 1];
               const b = pixels[sampleIdx * 4 + 2];
               ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${currentAlpha})`;
            } else {
               ctx.fillStyle = `rgba(${sampleVal}, ${sampleVal}, ${sampleVal}, ${currentAlpha})`;
            }

            ctx.save();
            ctx.translate(destX + offsetX, destY + offsetY);
            ctx.rotate((Math.random() * 10 - 5) * Math.PI / 180);
            ctx.fillText(char, 0, 0);

            if (params.dirtyInk > 0 && Math.random() < (params.dirtyInk * 0.2)) {
              const ox = Math.random() * 2 - 1;
              const oy = Math.random() * 2 - 1;
              ctx.fillStyle = ctx.fillStyle.replace(/[\d.]+\)$/, `${currentAlpha * 0.6})`);
              ctx.fillText(char, ox, oy);
            }
            ctx.restore();
          }
        }
      }

      if (currentStroke >= totalStrokes) {
        await sendFrame('FINISHED');
      } else {
        await sendFrame('PROGRESS');
        setTimeout(renderChunk, 0); 
      }
    };

    renderChunk();
  }
};
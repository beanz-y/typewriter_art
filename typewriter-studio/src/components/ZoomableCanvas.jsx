import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';

const getLayerTintRGB = (layer) => {
  switch(layer) {
    case 'density': return [255, 0, 0];
    case 'detail': return [0, 150, 255];
    case 'color': return [255, 200, 0];
    case 'original': return [0, 255, 100];
    default: return [255, 0, 0];
  }
};

export default function ZoomableCanvas({ image, isOriginal }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: -1000, y: -1000, show: false });
  
  // Track previous brush position for interpolation
  const [prevBrushPos, setPrevBrushPos] = useState(null);

  const store = useStore();

  useEffect(() => {
    if (isOriginal && image && containerRef.current) {
      const container = containerRef.current;
      const scaleX = container.clientWidth / image.width;
      const scaleY = container.clientHeight / image.height;
      const initialScale = Math.min(scaleX, scaleY, 1) * 0.9;
      const initialX = (container.clientWidth - (image.width * initialScale)) / 2;
      const initialY = (container.clientHeight - (image.height * initialScale)) / 2;
      store.setViewport({ scale: initialScale, x: initialX, y: initialY });
    }
  }, [image, isOriginal]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (image) {
      ctx.save();
      ctx.translate(store.viewport.x, store.viewport.y);
      ctx.scale(store.viewport.scale, store.viewport.scale);

      if (!isOriginal && store.outputScale) {
        const invScale = 1 / parseFloat(store.outputScale);
        ctx.scale(invScale, invScale);
      }

      ctx.drawImage(image, 0, 0);
      
      if (isOriginal && store.masksVisible) {
        ctx.globalAlpha = 0.4; 
        if (store.showAllMasks) {
          Object.values(store.masks).forEach(maskCanvas => {
            if (maskCanvas) ctx.drawImage(maskCanvas, 0, 0);
          });
        } else {
          const activeMask = store.masks[store.activeLayer];
          if (activeMask) ctx.drawImage(activeMask, 0, 0);
        }
        ctx.globalAlpha = 1.0; 
      }
      ctx.restore();
    }
  }, [image, store.viewport, isOriginal, store.masks, store.activeLayer, store.showAllMasks, store.masksVisible, store.outputScale]);

  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw, store.maskRevision]); 

  const getMousePosOnImage = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const imgX = (mouseX - store.viewport.x) / store.viewport.scale;
    const imgY = (mouseY - store.viewport.y) / store.viewport.scale;
    return { x: imgX, y: imgY, mouseX, mouseY };
  };

  const ensureMaskExists = () => {
    if (!store.masks[store.activeLayer]) {
      const newCanvas = document.createElement('canvas');
      newCanvas.width = image.width;
      newCanvas.height = image.height;
      store.updateMask(store.activeLayer, newCanvas);
      return newCanvas;
    }
    return store.masks[store.activeLayer];
  };

  // --- NEW HIGH-PERFORMANCE BRUSH ENGINE ---
  const paintOnMask = (currX, currY, erase = false) => {
    const maskCanvas = ensureMaskExists();
    const ctx = maskCanvas.getContext('2d');
    const radius = store.brushSize;
    const opacity = store.brushOpacity;
    const hardness = store.brushHardness;
    const rgb = getLayerTintRGB(store.activeLayer);

    // 1. Determine the bounding box of the stroke segment
    // We interpolate from the last known brush position to the current one
    const startX = prevBrushPos ? prevBrushPos.x : currX;
    const startY = prevBrushPos ? prevBrushPos.y : currY;

    // Calculate bounding box that covers both start and end circles
    const minX = Math.floor(Math.min(startX, currX) - radius - 1);
    const minY = Math.floor(Math.min(startY, currY) - radius - 1);
    const maxX = Math.ceil(Math.max(startX, currX) + radius + 1);
    const maxY = Math.ceil(Math.max(startY, currY) + radius + 1);

    // Clip to canvas bounds
    const sx = Math.max(0, minX);
    const sy = Math.max(0, minY);
    const ex = Math.min(maskCanvas.width, maxX);
    const ey = Math.min(maskCanvas.height, maxY);
    const w = ex - sx;
    const h = ey - sy;

    if (w <= 0 || h <= 0) return;

    // 2. Grab pixel data ONCE
    const imgData = ctx.getImageData(sx, sy, w, h);
    const data = imgData.data;

    // Pre-calculate math constants
    const radiusSq = radius * radius;
    const solidRadius = radius * hardness;
    const fadeWidth = radius - solidRadius;
    
    // Vector math for segment distance
    const dx = currX - startX;
    const dy = currY - startY;
    const lenSq = dx*dx + dy*dy;

    // 3. Iterate pixels
    for (let y = 0; y < h; y++) {
      const py = sy + y;
      for (let x = 0; x < w; x++) {
        const px = sx + x;
        const idx = (y * w + x) * 4;

        // Calculate shortest distance from Pixel(px,py) to LineSegment(Start->End)
        let t = 0;
        if (lenSq > 0) {
          t = ((px - startX) * dx + (py - startY) * dy) / lenSq;
          t = Math.max(0, Math.min(1, t));
        }
        
        // Closest point on the line
        const closeX = startX + t * dx;
        const closeY = startY + t * dy;
        
        // Distance squared
        const distSq = (px - closeX)**2 + (py - closeY)**2;

        if (distSq <= radiusSq) {
          const dist = Math.sqrt(distSq);
          
          // Calculate Brush Alpha Strength (0.0 to 1.0)
          let alphaFactor = 1.0;
          if (dist > solidRadius) {
             alphaFactor = 1.0 - ((dist - solidRadius) / fadeWidth);
          }
          // Scale by global brush opacity setting
          alphaFactor *= opacity;

          const targetAlpha = Math.floor(alphaFactor * 255);
          const currentAlpha = data[idx + 3];

          if (erase) {
            // Subtract brush alpha from current
            data[idx + 3] = Math.max(0, currentAlpha - targetAlpha);
          } else {
            // "MAX" Blending: Only increase opacity, never decrease or add
            if (targetAlpha > currentAlpha) {
               data[idx] = rgb[0];
               data[idx+1] = rgb[1];
               data[idx+2] = rgb[2];
               data[idx+3] = targetAlpha;
            }
          }
        }
      }
    }

    // 4. Write back ONCE
    ctx.putImageData(imgData, sx, sy);
    draw();
  };

  const handleWheel = (e) => {
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const pos = getMousePosOnImage(e.clientX, e.clientY);
    const newScale = Math.max(0.05, Math.min(store.viewport.scale * zoomFactor, 50));
    const newX = pos.mouseX - (pos.mouseX - store.viewport.x) * (newScale / store.viewport.scale);
    const newY = pos.mouseY - (pos.mouseY - store.viewport.y) * (newScale / store.viewport.scale);
    store.setViewport({ scale: newScale, x: newX, y: newY });
  };

  const handleMouseDown = (e) => {
    if (e.button === 2) e.preventDefault(); 
    if (e.button === 1 || store.isSpaceHeld || store.toolMode === 'view' || !isOriginal) {
      setIsDragging(true);
      setLastMouse({ x: e.clientX, y: e.clientY });
    } else if (store.toolMode === 'brush' && isOriginal && store.masksVisible) {
      store.saveHistoryState(); 
      const erase = e.button === 2; 
      if (erase) setIsErasing(true);
      else setIsPainting(true);
      
      const pos = getMousePosOnImage(e.clientX, e.clientY);
      setPrevBrushPos({ x: pos.x, y: pos.y }); // Initialize start of stroke
      paintOnMask(pos.x, pos.y, erase);
    }
  };

  const handleMouseMove = (e) => {
    const pos = getMousePosOnImage(e.clientX, e.clientY);
    setMousePos({ x: pos.mouseX, y: pos.mouseY, show: store.toolMode === 'brush' && !isDragging });
    
    if (isDragging) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      store.setViewport({ ...store.viewport, x: store.viewport.x + dx, y: store.viewport.y + dy });
      setLastMouse({ x: e.clientX, y: e.clientY });
    } else if ((isPainting || isErasing) && isOriginal && store.masksVisible) {
      paintOnMask(pos.x, pos.y, isErasing);
      setPrevBrushPos({ x: pos.x, y: pos.y }); // Update for next segment
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false); setIsPainting(false); setIsErasing(false);
    setPrevBrushPos(null);
    setMousePos(prev => ({ ...prev, show: false }));
  };

  const handleContextMenu = (e) => {
    if (store.toolMode === 'brush') e.preventDefault();
  };

  let cursorStyle = 'default';
  if (store.isSpaceHeld || store.toolMode === 'view') cursorStyle = 'grab';
  if (isDragging) cursorStyle = 'grabbing';
  if (!store.isSpaceHeld && store.toolMode === 'brush') cursorStyle = 'none'; 

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative overflow-hidden"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseLeave}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      <canvas ref={canvasRef} style={{ cursor: cursorStyle }} className="block w-full h-full" />
      
      {mousePos.show && isOriginal && store.masksVisible && (
        <div style={{
          position: 'absolute',
          left: mousePos.x,
          top: mousePos.y,
          width: store.brushSize * store.viewport.scale * 2,
          height: store.brushSize * store.viewport.scale * 2,
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          border: `2px solid ${isErasing ? '#ef4444' : '#3b82f6'}`,
          backgroundColor: isErasing ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
          pointerEvents: 'none',
          zIndex: 50,
          boxShadow: store.brushHardness < 0.8 
            ? '0 0 10px 2px rgba(255,255,255,0.3) inset, 0 0 2px 1px rgba(0,0,0,0.3)' 
            : '0 0 0 1px rgba(0,0,0,0.3) inset, 0 0 0 1px rgba(0,0,0,0.3)'
        }} />
      )}
    </div>
  );
}
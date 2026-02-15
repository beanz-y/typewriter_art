import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';

// HELPER: Defined at top level to ensure availability
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

  const paintOnMask = (x, y, erase = false) => {
    const maskCanvas = ensureMaskExists();
    const ctx = maskCanvas.getContext('2d');
    
    // SOFT BRUSH LOGIC
    // We use a Radial Gradient instead of a hard arc fill if hardness < 1.0
    const radius = store.brushSize;
    
    if (store.brushHardness < 0.99) {
        // Gradient Brush
        const grad = ctx.createRadialGradient(x, y, radius * store.brushHardness, x, y, radius);
        
        if (erase) {
            grad.addColorStop(0, 'rgba(0,0,0,1)'); // Core wipes completely
            grad.addColorStop(1, 'rgba(0,0,0,0)'); // Edge wipes nothing
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = grad;
        } else {
            const rgb = getLayerTintRGB(store.activeLayer);
            const colorStr = `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
            grad.addColorStop(0, `rgba(${colorStr}, 1)`); // Solid core
            grad.addColorStop(1, `rgba(${colorStr}, 0)`); // Fade to transparency
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = grad;
        }
        
        // Draw the gradient
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        
    } else {
        // Standard Hard Brush (Faster performance)
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        
        if (erase) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'rgba(0,0,0,1)';
        } else {
            const rgb = getLayerTintRGB(store.activeLayer);
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)`;
        }
        ctx.fill();
    }
    
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
    }
  };

  const handleMouseLeave = () => {
    setIsDragging(false); setIsPainting(false); setIsErasing(false);
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
          // Add a second, inner shadow to visualize feathering if softness is active
          boxShadow: store.brushHardness < 0.8 
            ? '0 0 10px 2px rgba(255,255,255,0.3) inset, 0 0 2px 1px rgba(0,0,0,0.3)' 
            : '0 0 0 1px rgba(0,0,0,0.3) inset, 0 0 0 1px rgba(0,0,0,0.3)'
        }} />
      )}
    </div>
  );
}
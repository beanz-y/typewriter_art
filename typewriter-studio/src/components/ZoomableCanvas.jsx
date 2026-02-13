import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore';

export default function ZoomableCanvas({ image, isOriginal }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });

const { viewport, setViewport, isSpaceHeld, toolMode, overlayCanvas } = useStore();

  // Initialize viewport to center and fit the image when loaded
  useEffect(() => {
    if (isOriginal && image && containerRef.current) {
      const container = containerRef.current;
      
      // Calculate a scale that fits the image nicely in the container (max 1x scale)
      const scaleX = container.clientWidth / image.width;
      const scaleY = container.clientHeight / image.height;
      const initialScale = Math.min(scaleX, scaleY, 1) * 0.9; // 90% fit

      // Center the scaled image using the viewport X and Y
      const initialX = (container.clientWidth - (image.width * initialScale)) / 2;
      const initialY = (container.clientHeight - (image.height * initialScale)) / 2;

      setViewport({ scale: initialScale, x: initialX, y: initialY });
    }
  }, [image, isOriginal, setViewport]);

  // Main draw loop
  // Main draw loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    
    // Match canvas internal resolution to DOM size to prevent blurring
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { outputScale, overlayCanvas } = useStore.getState();

    if (image) {
      ctx.save();
      
      // Apply pan and zoom
      ctx.translate(viewport.x, viewport.y);
      ctx.scale(viewport.scale, viewport.scale);

      // FIX: Align the render canvas back to 1x scale visually
      if (!isOriginal && outputScale) {
        const invScale = 1 / parseFloat(outputScale);
        ctx.scale(invScale, invScale);
      }

      // Draw exactly at 0,0 relative to the translated/scaled context
      ctx.drawImage(image, 0, 0);
      
      // Draw the AI Mask overlay if we are on the original canvas
      if (isOriginal && overlayCanvas) {
        ctx.drawImage(overlayCanvas, 0, 0);
      }
      
      ctx.restore();
    }
  }, [image, viewport, isOriginal]);

  // Redraw when viewport, image, or window size changes
  useEffect(() => {
    draw();
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [draw]);

  // Handle Zoom (Wheel)
  const handleWheel = (e) => {
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    
    // Get mouse coordinates relative to the canvas container
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Clamp the scale limits
    const newScale = Math.max(0.05, Math.min(viewport.scale * zoomFactor, 50));
    
    // Calculate the new X and Y to keep the image anchored to the mouse pointer
    const newX = mouseX - (mouseX - viewport.x) * (newScale / viewport.scale);
    const newY = mouseY - (mouseY - viewport.y) * (newScale / viewport.scale);

    setViewport({ scale: newScale, x: newX, y: newY });
  };

  // Handle Pan (Drag)
  const handleMouseDown = (e) => {
    // Allow panning with middle click, spacebar + left click, or when in 'view' mode
    if (e.button === 1 || isSpaceHeld || toolMode === 'view') {
      setIsDragging(true);
      setLastMouse({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      const dx = e.clientX - lastMouse.x;
      const dy = e.clientY - lastMouse.y;
      setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
      setLastMouse({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  // Determine cursor style
  let cursorStyle = 'default';
  if (isSpaceHeld || toolMode === 'view') cursorStyle = 'grab';
  if (isDragging) cursorStyle = 'grabbing';
  if (!isSpaceHeld && toolMode === 'brush') cursorStyle = 'none';

  return (
    <div 
      ref={containerRef}
      className="w-full h-full relative"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor: cursorStyle }}
        className="block w-full h-full"
      />
    </div>
  );
}
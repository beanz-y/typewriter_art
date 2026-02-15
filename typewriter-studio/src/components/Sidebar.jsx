// ... imports remain the same ...
import { useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { removeBackground } from '@imgly/background-removal';
import TypewriterWorker from '../engine/worker.js?worker';
import GIF from 'gif.js';
import { RefreshCw, Image as ImageIcon, Play, Square, Download, Film, Brush, Wand2, X, Loader2, Contrast, Eye, EyeOff, Layers, Undo2, Redo2, Info, Github, Settings2, Scissors, PauseCircle, PlayCircle, Crop, Check } from 'lucide-react';

const ControlSlider = ({ label, settingKey, min, max, step, tooltip }) => {
  const value = useStore((state) => state[settingKey]);
  const updateSetting = useStore((state) => state.updateSetting);
  return (
    <div className="mb-4" title={tooltip}>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-400">{value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => updateSetting(settingKey, parseFloat(e.target.value))}
        className="w-full accent-blue-500 bg-neutral-700 h-1.5 rounded-lg appearance-none cursor-pointer" />
    </div>
  );
};

// ... helpers (getLayerTint/RGB) remain the same ...
const getLayerTint = (layer) => {
  switch(layer) {
    case 'density': return 'rgba(255, 0, 0, 1)';
    case 'detail': return 'rgba(0, 150, 255, 1)';
    case 'color': return 'rgba(255, 200, 0, 1)';
    case 'original': return 'rgba(0, 255, 100, 1)';
    default: return 'rgba(255, 0, 0, 1)';
  }
};

const getLayerTintRGB = (layer) => {
  switch(layer) {
    case 'density': return [255, 0, 0];
    case 'detail': return [0, 150, 255];
    case 'color': return [255, 200, 0];
    case 'original': return [0, 255, 100];
    default: return [255, 0, 0];
  }
};

export default function Sidebar({ processImageFile }) {
  const [activeTab, setActiveTab] = useState('General');
  const [workerRef, setWorkerRef] = useState(null);
  
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showGifConfig, setShowGifConfig] = useState(false);
  
  const [gifDuration, setGifDuration] = useState(10); 
  const [gifTargetHeight, setGifTargetHeight] = useState(1080);
  const [gifFrameUsePct, setGifFrameUsePct] = useState(100);
  
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [previewIndex, setPreviewIndex] = useState(0);
  
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState(null); 
  const [dragStart, setDragStart] = useState(null);
  
  const previewCanvasRef = useRef(null);
  const store = useStore();

  useEffect(() => {
    if (!showGifConfig || !store.gifFrames.length) return;

    const frame = store.gifFrames[previewIndex];
    const canvas = previewCanvasRef.current;
    
    const displayFrame = isCropping ? store.gifFrames[0] : frame;

    if (displayFrame && canvas) {
      const ctx = canvas.getContext('2d');
      if (canvas.width !== displayFrame.canvas.width) {
          canvas.width = displayFrame.canvas.width;
          canvas.height = displayFrame.canvas.height;
      }
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(displayFrame.canvas, 0, 0);

      if (isCropping && cropRect) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        const x = (cropRect.x / 100) * canvas.width;
        const y = (cropRect.y / 100) * canvas.height;
        const w = (cropRect.w / 100) * canvas.width;
        const h = (cropRect.h / 100) * canvas.height;
        
        ctx.clearRect(x, y, w, h);
        ctx.drawImage(displayFrame.canvas, x, y, w, h, x, y, w, h);
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
    }

    if (!isPlaying || isCropping) return;

    const timeout = setTimeout(() => {
      setPreviewIndex(prev => {
        let next = prev + 1;
        const step = Math.round(100 / gifFrameUsePct);
        if (next % step !== 0) next += (step - (next % step));

        if (next > trimEnd) return trimStart;
        return next;
      });
    }, 100); 

    return () => clearTimeout(timeout);
  }, [showGifConfig, isPlaying, previewIndex, trimStart, trimEnd, gifFrameUsePct, store.gifFrames, isCropping, cropRect]);


  const handleGifClick = () => {
    const liveFrames = useStore.getState().gifFrames;
    if (liveFrames.length === 0 || store.isGeneratingGif) return;
    
    setTrimStart(0);
    setTrimEnd(liveFrames.length - 1);
    setPreviewIndex(0);
    setIsPlaying(true);
    setIsCropping(false);
    setCropRect(null); 
    setShowGifConfig(true);
  };

  const handleCropMouseDown = (e) => {
    if (!isCropping) return;
    const rect = previewCanvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setDragStart({ x, y });
    setCropRect({ x, y, w: 0, h: 0 });
  };

  const handleCropMouseMove = (e) => {
    if (!isCropping || !dragStart) return;
    const rect = previewCanvasRef.current.getBoundingClientRect();
    const currentX = ((e.clientX - rect.left) / rect.width) * 100;
    const currentY = ((e.clientY - rect.top) / rect.height) * 100;
    
    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    const w = Math.abs(currentX - dragStart.x);
    const h = Math.abs(currentY - dragStart.y);
    
    setCropRect({ x, y, w, h });
  };

  const handleCropMouseUp = () => {
    setDragStart(null);
  };

  const getEstimatedGifSize = () => {
    const frames = store.gifFrames;
    if (!frames.length) return "0.0";
    
    let w, h;
    let aspectRatio;
    
    // Size Estimation Logic
    if (cropRect && cropRect.w > 0) {
        // If cropping, output size = crop size (1:1)
        w = frames[0].canvas.width * (cropRect.w / 100);
        h = frames[0].canvas.height * (cropRect.h / 100);
    } else {
        // If not cropping, output size = scaled to target height
        aspectRatio = frames[0].canvas.width / frames[0].canvas.height;
        h = gifTargetHeight;
        w = h * aspectRatio;
    }

    const totalFramesInRange = Math.max(1, trimEnd - trimStart);
    const usedFrames = Math.ceil(totalFramesInRange * (gifFrameUsePct / 100));
    
    const estBytes = (w * h * usedFrames) * 0.9; 
    return (estBytes / 1024 / 1024).toFixed(1);
  };

  const startGifEncoding = async () => {
    setShowGifConfig(false);
    const allFrames = useStore.getState().gifFrames;
    store.setGeneratingGif(true);
    store.updateSetting('progress', 0); 

    let workerUrl = '/gif.worker.js';
    try {
      const response = await fetch('/gif.worker.js');
      if (response.ok) {
        const workerBlob = await response.blob();
        workerUrl = URL.createObjectURL(workerBlob);
      }
    } catch (e) { console.warn("Worker fetch failed:", e); }

    // --- DIMENSION CALCULATION ---
    let srcX = 0, srcY = 0, srcW = allFrames[0].canvas.width, srcH = allFrames[0].canvas.height;
    let finalW, finalH;

    if (cropRect && cropRect.w > 0) {
        // CROP MODE: 1:1 Native Resolution
        srcX = Math.floor((cropRect.x / 100) * srcW);
        srcY = Math.floor((cropRect.y / 100) * srcH);
        srcW = Math.floor((cropRect.w / 100) * srcW);
        srcH = Math.floor((cropRect.h / 100) * srcH);
        
        finalW = srcW;
        finalH = srcH;
    } else {
        // STANDARD MODE: Scale to Target Height
        const scale = gifTargetHeight / srcH;
        finalW = Math.floor(srcW * scale);
        finalH = gifTargetHeight;
    }

    const gif = new GIF({
      workers: 4, 
      quality: 20, 
      workerScript: workerUrl,
      width: finalW,
      height: finalH
    });

    const trimmedFrames = allFrames.slice(trimStart, trimEnd + 1);
    const step = Math.round(100 / gifFrameUsePct);
    const framesToEncode = trimmedFrames.filter((_, i) => i % step === 0 || i === trimmedFrames.length - 1);
    const activeFrames = Math.max(1, framesToEncode.length - 1);
    const finalPause = 3000; 
    let calculatedDelay = Math.max(40, (gifDuration * 1000) / activeFrames);

    framesToEncode.forEach((frame, index) => {
      const delay = index === framesToEncode.length - 1 ? finalPause : calculatedDelay;
      
      const tCanvas = document.createElement('canvas');
      tCanvas.width = finalW;
      tCanvas.height = finalH;
      const ctx = tCanvas.getContext('2d');
      
      // Draw cropped/scaled source -> destination
      ctx.drawImage(frame.canvas, srcX, srcY, srcW, srcH, 0, 0, finalW, finalH);
      
      gif.addFrame(tCanvas, { delay, copy: true });
    });

    gif.on('progress', (p) => {
      store.updateSetting('progress', p);
    });

    gif.on('finished', (blob) => {
      const link = document.createElement('a');
      link.download = `typewriter-timelapse-${Date.now()}.gif`;
      link.href = URL.createObjectURL(blob);
      link.click();
      
      store.setGeneratingGif(false);
      store.updateSetting('progress', 1.0);
      if (workerUrl.startsWith('blob:')) URL.revokeObjectURL(workerUrl);
    });

    gif.render();
  };

  // ... (handleSubjectIsolation, invertMask, clearMask, exportPNG, toggleRender unchanged) ...
  const handleSubjectIsolation = async () => {
    if (!store.originalImage || store.isProcessingBg) return;
    store.saveHistoryState(); 
    store.updateSetting('isProcessingBg', true);
    try {
      const blob = await removeBackground(store.originalImage.src);
      const url = URL.createObjectURL(blob);
      const maskImg = new Image();
      maskImg.onload = () => {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = maskImg.width;
        offCanvas.height = maskImg.height;
        const ctx = offCanvas.getContext('2d');
        ctx.drawImage(maskImg, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = getLayerTint(store.activeLayer);
        ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);
        store.updateMask(store.activeLayer, offCanvas);
        store.updateSetting('isProcessingBg', false);
      };
      maskImg.src = url;
    } catch (error) {
      console.error(error);
      store.updateSetting('isProcessingBg', false);
    }
  };

  const invertMask = () => {
    if (!store.originalImage) return;
    store.saveHistoryState(); 
    
    const currentMask = store.masks[store.activeLayer];
    const newCanvas = document.createElement('canvas');
    newCanvas.width = store.originalImage.width;
    newCanvas.height = store.originalImage.height;
    const ctx = newCanvas.getContext('2d');
    const rgb = getLayerTintRGB(store.activeLayer);
    
    if (currentMask) {
      ctx.drawImage(currentMask, 0, 0);
      const imgData = ctx.getImageData(0, 0, newCanvas.width, newCanvas.height);
      const data = imgData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        data[i] = rgb[0];
        data[i+1] = rgb[1];
        data[i+2] = rgb[2];
        data[i+3] = 255 - data[i+3]; 
      }
      ctx.putImageData(imgData, 0, 0);
    } else {
      ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 1)`;
      ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
    }
    store.updateMask(store.activeLayer, newCanvas);
  };

  const clearMask = () => {
    store.saveHistoryState(); 
    store.updateMask(store.activeLayer, null);
  };

  const exportPNG = () => {
    if (!store.renderedImage) return;
    const canvas = document.createElement('canvas');
    canvas.width = store.renderedImage.width;
    canvas.height = store.renderedImage.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(store.renderedImage, 0, 0);
    
    const link = document.createElement('a');
    link.download = `typewriter-art-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const toggleRender = () => { 
    if (store.isRendering) {
      if (workerRef) workerRef.postMessage({ type: 'STOP' });
      return;
    }
    if (!store.originalImage) return;
    
    useStore.getState().clearGifFrames();
    store.updateSetting('isRendering', true);
    store.updateSetting('progress', 0);

    setTimeout(async () => {
      const extractCanvas = document.createElement('canvas');
      extractCanvas.width = store.originalImage.width;
      extractCanvas.height = store.originalImage.height;
      const ctx = extractCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(store.originalImage, 0, 0);
      const imageData = ctx.getImageData(0, 0, extractCanvas.width, extractCanvas.height);

      const getMaskData = (layer) => {
        const mask = store.masks[layer];
        if (!mask) return null;
        const mCtx = mask.getContext('2d', { willReadFrequently: true });
        return mCtx.getImageData(0, 0, mask.width, mask.height);
      };

      const maskData = {
        density: getMaskData('density'),
        detail: getMaskData('detail'),
        color: getMaskData('color'),
        original: getMaskData('original')
      };

      const sourceBitmap = await createImageBitmap(store.originalImage);

      const worker = new TypewriterWorker();
      setWorkerRef(worker);

      worker.onmessage = (e) => {
        const { type, progress, imageBitmap } = e.data;
        
        if (type === 'PROGRESS' || type === 'FINISHED') {
          store.updateSetting('progress', progress);
          store.updateSetting('renderedImage', imageBitmap);

          const currentFrames = useStore.getState().gifFrames;
          const lastSavedProgress = currentFrames.length > 0 ? currentFrames[currentFrames.length - 1].progress : -1;
          const captureThreshold = 0.01; 

          if (progress - lastSavedProgress >= captureThreshold || type === 'FINISHED') {
            const MAX_GIF_HEIGHT = 1080;
            const MAX_GIF_PIXELS = 2000000; 
            let gifScale = 1;
            if (imageBitmap.height > MAX_GIF_HEIGHT) gifScale = MAX_GIF_HEIGHT / imageBitmap.height;
            const potentialW = imageBitmap.width * gifScale;
            const potentialH = imageBitmap.height * gifScale;
            if ((potentialW * potentialH) > MAX_GIF_PIXELS) gifScale = Math.sqrt(MAX_GIF_PIXELS / (imageBitmap.width * imageBitmap.height));
            const gifW = Math.floor(imageBitmap.width * gifScale);
            const gifH = Math.floor(imageBitmap.height * gifScale);
            const tCanvas = document.createElement('canvas');
            tCanvas.width = gifW; tCanvas.height = gifH;
            const tCtx = tCanvas.getContext('2d');
            tCtx.fillStyle = 'white'; tCtx.fillRect(0, 0, gifW, gifH);
            tCtx.drawImage(imageBitmap, 0, 0, gifW, gifH);
            useStore.getState().addGifFrame({ canvas: tCanvas, progress });
          }
        }
        
        if (type === 'FINISHED') {
          store.updateSetting('isRendering', false);
          setWorkerRef(null);
        }
      };

      worker.postMessage({
        type: 'START',
        payload: {
          imageData, sourceBitmap, maskData, width: extractCanvas.width, height: extractCanvas.height,
          params: {
            totalStrokes: store.totalStrokes, fontSize: store.fontSize, gamma: store.gamma,
            outputScale: store.outputScale, inkOpacity: store.inkOpacity, ribbonWear: store.ribbonWear,
            dirtyInk: store.dirtyInk, characterSet: store.characterSet, colorMode: store.colorMode,
            densityWeight: store.densityWeight
          }
        }
      });
    }, 50);
  };

  return (
    <div className="w-80 h-screen bg-neutral-800 flex flex-col shrink-0 border-r border-neutral-700 shadow-xl overflow-y-auto">
      <div className="p-4 flex justify-between items-center border-b border-neutral-700">
        <h1 className="text-lg font-bold tracking-wider text-neutral-100">TYPEWRITER STUDIO</h1>
        <div className="flex gap-1">
          <button onClick={() => setShowAboutModal(true)} className="p-2 bg-neutral-700 hover:bg-neutral-600 rounded-md transition-colors text-neutral-300" title="About & Privacy"><Info size={16} /></button>
          <button onClick={store.resetControls} className="p-2 bg-neutral-700 hover:bg-neutral-600 rounded-md transition-colors text-neutral-300"><RefreshCw size={16} /></button>
        </div>
      </div>

      <div className="flex p-2 gap-1 bg-neutral-800 border-b border-neutral-700">
        {['General', 'Physics', 'Palette'].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === tab ? 'bg-neutral-600 text-white' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'}`}>{tab}</button>
        ))}
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {activeTab === 'General' && (
          <div className="space-y-4">
            <ControlSlider label="Total Strokes" settingKey="totalStrokes" min={0} max={10000000} step={50000} />
            <ControlSlider label="Base Font Size" settingKey="fontSize" min={8} max={200} step={1} />
            <ControlSlider label="Density Focus" settingKey="densityWeight" min={1.0} max={10.0} step={0.5} />
            <ControlSlider label="Gamma" settingKey="gamma" min={0.5} max={3.0} step={0.1} />
            <div className="flex gap-2 mb-4">
              <div className="flex-1">
                <label className="text-xs text-neutral-300 block mb-1">Output Scale</label>
                <select value={store.outputScale} onChange={(e) => store.updateSetting('outputScale', e.target.value)} className="w-full bg-neutral-700 text-xs p-2 rounded focus:outline-none"><option value="1.0">1.0x</option><option value="2.0">2.0x</option><option value="3.0">3.0x</option></select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-neutral-300 block mb-1">Color Mode</label>
                <select value={store.colorMode} onChange={(e) => store.updateSetting('colorMode', e.target.value)} className="w-full bg-neutral-700 text-xs p-2 rounded focus:outline-none"><option value="Color">Color</option><option value="B&W">B&W</option><option value="Masked Color">Masked Color</option></select>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'Physics' && (
          <div className="space-y-4">
            <ControlSlider label="Ink Opacity" settingKey="inkOpacity" min={10} max={255} step={5} />
            <ControlSlider label="Edge Threshold" settingKey="edgeThreshold" min={0.05} max={0.5} step={0.01} />
            <div className="pt-2 pb-1 border-t border-neutral-700 text-xs text-neutral-500 text-center font-semibold">--- Simulation ---</div>
            <ControlSlider label="Ribbon Wear" settingKey="ribbonWear" min={0} max={1.0} step={0.05} />
            <ControlSlider label="Dirty Ink" settingKey="dirtyInk" min={0} max={1.0} step={0.05} />
          </div>
        )}
        {activeTab === 'Palette' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-neutral-300 block mb-1">Character Set</label>
              <textarea value={store.characterSet} onChange={(e) => store.updateSetting('characterSet', e.target.value)} className="w-full h-24 bg-neutral-700 text-xs p-2 rounded font-mono resize-none focus:outline-none" />
            </div>
          </div>
        )}

        <div className="mt-6 bg-neutral-900 p-3 rounded-lg border border-neutral-700">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-neutral-800">
            <div className="flex items-center text-xs text-neutral-400 font-bold uppercase tracking-wider">
              <Layers size={14} className="mr-2" /> Mask Layers
            </div>
            <div className="flex gap-1">
              <button onClick={store.undo} disabled={store.undoStack.length === 0} className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-30"><Undo2 size={14} /></button>
              <button onClick={store.redo} disabled={store.redoStack.length === 0} className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-700 disabled:opacity-30"><Redo2 size={14} /></button>
              <div className="w-px h-4 bg-neutral-700 my-auto mx-1"></div>
              <button onClick={store.toggleMasksVisible} className={`p-1 rounded ${store.masksVisible ? 'text-blue-400 hover:bg-neutral-700' : 'text-neutral-500 hover:bg-neutral-700'}`} title="Toggle Mask Visibility">{store.masksVisible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
              <button onClick={() => store.updateSetting('showAllMasks', !store.showAllMasks)} className={`text-[10px] font-bold px-1.5 rounded ${store.showAllMasks ? 'bg-neutral-600 text-white' : 'text-neutral-500 hover:bg-neutral-700'}`}>ALL</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 mb-3">
            {['density', 'detail', 'color', 'original'].map((layer) => (
              <button key={layer} onClick={() => store.updateSetting('activeLayer', layer)} className={`py-1 text-xs capitalize rounded transition-colors ${store.activeLayer === layer ? 'bg-neutral-600 text-white font-semibold' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}>{layer}</button>
            ))}
          </div>

          <div className="flex gap-1 mb-3">
            <button onClick={() => store.updateSetting('toolMode', store.toolMode === 'brush' ? 'view' : 'brush')} className={`flex-1 flex justify-center items-center py-1.5 rounded ${store.toolMode === 'brush' ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`} title="Brush Tool"><Brush size={14} /></button>
            <button onClick={handleSubjectIsolation} disabled={store.isProcessingBg || !store.originalImage} className={`flex-1 flex justify-center items-center py-1.5 rounded ${store.isProcessingBg ? 'bg-blue-600 opacity-70' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`} title="Isolate Subject (AI)">{store.isProcessingBg ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}</button>
            <button onClick={invertMask} className="flex-1 flex justify-center items-center py-1.5 rounded bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white" title="Invert Active Mask"><Contrast size={14} /></button>
            <button onClick={clearMask} className="flex-[0.5] flex justify-center items-center py-1.5 rounded bg-red-900/40 text-red-400 hover:bg-red-800 hover:text-white" title="Clear Active Mask"><X size={14} /></button>
          </div>
          <ControlSlider label="Brush Size" settingKey="brushSize" min={1} max={200} step={1} />
          <ControlSlider label="Brush Hardness" settingKey="brushHardness" min={0.0} max={1.0} step={0.1} tooltip="0 = Soft (Feathered), 1 = Hard Edge" />
          <ControlSlider label="Brush Opacity" settingKey="brushOpacity" min={0.1} max={1.0} step={0.1} tooltip="Max darkness per stroke. Prevents buildup." />
        </div>
      </div>

      <div className="p-4 border-t border-neutral-700 space-y-2 bg-neutral-800">
        <label className="w-full flex items-center justify-center py-2.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm font-medium transition-colors cursor-pointer">
          <ImageIcon size={16} className="mr-2" /> LOAD IMAGE
          <input type="file" accept="image/png, image/jpeg, image/jpg" className="hidden" onChange={(e) => processImageFile(e.target.files[0])} />
        </label>
        <button onClick={toggleRender} className={`w-full flex items-center justify-center py-2.5 rounded text-sm font-bold transition-colors ${store.isRendering ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-500 hover:bg-emerald-600 text-neutral-900'}`}>
          {store.isRendering ? <Square size={16} className="mr-2 fill-current" /> : <Play size={16} className="mr-2 fill-current" />}
          {store.isRendering ? 'STOP RENDER' : 'RENDER ART'}
        </button>
        <div className="flex gap-2 pt-2">
          <button onClick={exportPNG} disabled={!store.renderedImage} className="flex-1 flex items-center justify-center py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors"><Download size={14} className="mr-1" /> PNG</button>
          <button onClick={handleGifClick} disabled={store.gifFrames.length === 0 || store.isGeneratingGif} className="flex-1 flex items-center justify-center py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors" title="Export Timelapse GIF">
            {store.isGeneratingGif ? <><Loader2 size={14} className="mr-1 animate-spin" /> ENCODING...</> : <><Film size={14} className="mr-1" /> GIF</>}
          </button>
        </div>
        <div className="w-full h-1.5 bg-neutral-900 rounded-full mt-4 overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-200 ease-out" style={{ width: `${store.progress * 100}%` }}></div>
        </div>
      </div>

      {showAboutModal && (
        <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-lg shadow-2xl relative overflow-y-auto max-h-[90vh]">
                <button onClick={() => setShowAboutModal(false)} className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors"><X size={20} /></button>
                <h2 className="text-2xl font-bold mb-4 flex items-center gap-2"><span className="text-blue-500">◆</span> Typewriter Studio</h2>
                <div className="space-y-4 text-sm text-neutral-300 leading-relaxed">
                    <section><h3 className="text-white font-bold mb-1">Privacy Policy</h3><p>We respect your privacy. <strong>This application runs entirely on your device.</strong> When you "upload" an image, it is processed locally in your browser's memory. Your photos are never sent to a server.</p></section>
                    <section><h3 className="text-white font-bold mb-1">Terms of Service</h3><p>This application is provided "as is", without warranty of any kind. You retain full copyright and ownership of any images you generate.</p></section>
                    <section><h3 className="text-white font-bold mb-1">Open Source</h3><p>This project is open source and available under the AGPL-3.0 license.</p><a href="https://github.com/beanz-y/typewriter_art" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-2 text-blue-400 hover:text-white transition-colors"><Github size={16} /><span>View Source Code</span></a></section>
                    <section><h3 className="text-white font-bold mb-1">Software Credits</h3><p className="text-xs text-neutral-500">This application utilizes open source software:<br/>• <a href="https://github.com/imgly/background-removal-js" target="_blank" rel="noreferrer" className="underline hover:text-blue-400">@imgly/background-removal</a> (AGPL-3.0)<br/>• <a href="https://github.com/jnordberg/gif.js" target="_blank" rel="noreferrer" className="underline hover:text-blue-400">gif.js</a> (MIT License)<br/>• <a href="https://lucide.dev/license" target="_blank" rel="noreferrer" className="underline hover:text-blue-400">Lucide React</a> (ISC License)</p></section>
                </div>
                <div className="mt-6 pt-4 border-t border-neutral-800 text-center"><button onClick={() => setShowAboutModal(false)} className="px-6 py-2 bg-neutral-700 hover:bg-neutral-600 rounded text-white font-medium transition-colors">Close</button></div>
            </div>
        </div>
      )}

      {showGifConfig && (
        <div className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md shadow-2xl max-h-[95vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2"><Settings2 size={18} /> GIF Settings</h2>
                  <button onClick={() => setShowGifConfig(false)} className="text-neutral-500 hover:text-white"><X size={20} /></button>
                </div>

                <div className="space-y-6">
                  <div 
                    className="bg-black rounded-lg overflow-hidden border border-neutral-700 relative aspect-video flex items-center justify-center cursor-crosshair"
                    onMouseDown={handleCropMouseDown}
                    onMouseMove={handleCropMouseMove}
                    onMouseUp={handleCropMouseUp}
                    onMouseLeave={handleCropMouseUp}
                  >
                    <canvas ref={previewCanvasRef} className="max-w-full max-h-full object-contain pointer-events-none" />
                    <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] font-mono text-neutral-300 backdrop-blur-sm z-10">
                       {isCropping ? "Draw Crop Box" : `Frame: ${previewIndex}`}
                    </div>
                    {!isCropping && (
                        <button onClick={() => setIsPlaying(!isPlaying)} className="absolute bottom-2 right-2 p-2 bg-black/60 hover:bg-blue-600 rounded-full text-white transition-colors backdrop-blur-sm z-10">
                          {isPlaying ? <PauseCircle size={20} /> : <PlayCircle size={20} />}
                        </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        setIsCropping(!isCropping);
                        if (!isCropping) {
                            setIsPlaying(false);
                            setPreviewIndex(0);
                        } else {
                            setCropRect(null); 
                        }
                      }} 
                      className={`flex-1 flex items-center justify-center py-2 rounded text-xs font-bold transition-colors ${isCropping ? 'bg-red-900/50 text-red-400 border border-red-800' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
                    >
                      {isCropping ? <><X size={14} className="mr-1"/> Cancel Crop</> : <><Crop size={14} className="mr-1"/> Set Crop Region</>}
                    </button>
                    {isCropping && cropRect && (
                        <button 
                          onClick={() => {
                              setIsCropping(false);
                              setIsPlaying(true);
                          }}
                          className="flex-1 flex items-center justify-center py-2 bg-emerald-900/50 text-emerald-400 border border-emerald-800 rounded text-xs font-bold"
                        >
                          <Check size={14} className="mr-1"/> Confirm
                        </button>
                    )}
                  </div>

                  {!isCropping && (
                    <div className="bg-neutral-800 p-3 rounded-lg border border-neutral-700">
                      <div className="flex items-center gap-2 mb-3 text-white font-bold text-sm"><Scissors size={14} /> Trim Loop</div>
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="text-[10px] text-neutral-400 block mb-1">Start Frame</label>
                          <input type="range" min="0" max={store.gifFrames.length - 1} step="1" value={trimStart} onChange={(e) => { const val = parseInt(e.target.value); setTrimStart(val); if (val > trimEnd) setTrimEnd(val); setPreviewIndex(val); }} className="w-full accent-emerald-500 bg-neutral-700 h-1.5 rounded-lg appearance-none cursor-pointer" />
                          <div className="text-right text-[10px] text-emerald-400 font-mono mt-0.5">{trimStart}</div>
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-neutral-400 block mb-1">End Frame</label>
                          <input type="range" min="0" max={store.gifFrames.length - 1} step="1" value={trimEnd} onChange={(e) => { const val = parseInt(e.target.value); setTrimEnd(val); if (val < trimStart) setTrimStart(val); setPreviewIndex(val); }} className="w-full accent-red-500 bg-neutral-700 h-1.5 rounded-lg appearance-none cursor-pointer" />
                          <div className="text-right text-[10px] text-red-400 font-mono mt-0.5">{trimEnd}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isCropping && (
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-neutral-300">Target Duration</span><span className="text-blue-400 font-mono">{gifDuration}s</span></div>
                        <input type="range" min="2" max="60" step="1" value={gifDuration} onChange={(e) => setGifDuration(parseInt(e.target.value))} className="w-full accent-blue-500 bg-neutral-700 h-1.5 rounded-lg appearance-none cursor-pointer" />
                      </div>
                      
                      {/* SHOW TARGET HEIGHT SLIDER ONLY IF NOT CROPPING */}
                      {!cropRect && (
                        <div>
                          <div className="flex justify-between text-xs mb-1"><span className="text-neutral-300">Target Height (px)</span><span className="text-blue-400 font-mono">{gifTargetHeight}px</span></div>
                          <input type="range" min="360" max="2160" step="120" value={gifTargetHeight} onChange={(e) => setGifTargetHeight(parseInt(e.target.value))} className="w-full accent-blue-500 bg-neutral-700 h-1.5 rounded-lg appearance-none cursor-pointer" />
                          <p className="text-[10px] text-neutral-500 mt-1">Output will scale to be exactly this tall.</p>
                        </div>
                      )}
                      
                      {/* IF CROPPING, SHOW NATIVE RES INDICATOR */}
                      {cropRect && (
                        <div className="p-2 bg-blue-900/30 border border-blue-800 rounded text-xs text-blue-200">
                           <span className="font-bold">Crop Mode:</span> Using Native Resolution (1:1 Quality)
                        </div>
                      )}

                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="text-neutral-300">Frame Density</span><span className="text-blue-400 font-mono">{gifFrameUsePct}%</span></div>
                        <input type="range" min="25" max="100" step="25" value={gifFrameUsePct} onChange={(e) => setGifFrameUsePct(parseInt(e.target.value))} className="w-full accent-blue-500 bg-neutral-700 h-1.5 rounded-lg appearance-none cursor-pointer" />
                      </div>
                    </div>
                  )}
                  
                  {!isCropping && (
                    <div className="flex justify-between items-end border-t border-neutral-800 pt-4 pb-2">
                      <span className="text-xs text-neutral-400">Est. Size:</span>
                      <span className="text-sm font-bold text-white">~{getEstimatedGifSize()} MB</span>
                    </div>
                  )}

                  {!isCropping && (
                    <button onClick={startGifEncoding} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-bold text-sm transition-colors shadow-lg">
                      START ENCODING
                    </button>
                  )}
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { removeBackground } from '@imgly/background-removal';
import TypewriterWorker from '../engine/worker.js?worker';
import { RefreshCw, Image as ImageIcon, Play, Square, Download, Film, Brush, Wand2, X, Loader2, Contrast, Eye, EyeOff, Layers, Undo2, Redo2 } from 'lucide-react';

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

// FIX: Generate masks at 100% opacity
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
  const store = useStore();

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
        if (data[i + 3] > 5) { 
          data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0;
        } else {
          // FIX: Invert fills at 255 alpha (100% opaque)
          data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; 
        }
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

  const toggleRender = async () => { // <--- Note the added 'async'
    if (store.isRendering) {
      if (workerRef) workerRef.postMessage({ type: 'STOP' });
      return;
    }
    if (!store.originalImage) return;
    store.updateSetting('isRendering', true);
    store.updateSetting('progress', 0);

    const extractCanvas = document.createElement('canvas');
    extractCanvas.width = store.originalImage.width;
    extractCanvas.height = store.originalImage.height;
    const ctx = extractCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(store.originalImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, extractCanvas.width, extractCanvas.height);

    // Helper to extract pixel data from active masks
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

    // Pass the actual photo as a bitmap for ultra-fast rendering of the 'Original' mask
    const sourceBitmap = await createImageBitmap(store.originalImage);

    const worker = new TypewriterWorker();
    setWorkerRef(worker);

    worker.onmessage = (e) => {
      const { type, progress, imageBitmap } = e.data;
      if (type === 'PROGRESS' || type === 'FINISHED') {
        store.updateSetting('progress', progress);
        store.updateSetting('renderedImage', imageBitmap);
      }
      if (type === 'FINISHED') {
        store.updateSetting('isRendering', false);
        setWorkerRef(null);
      }
    };

    worker.postMessage({
      type: 'START',
      payload: {
        imageData,
        sourceBitmap,
        maskData,
        width: extractCanvas.width,
        height: extractCanvas.height,
        params: {
          totalStrokes: store.totalStrokes, fontSize: store.fontSize, gamma: store.gamma,
          outputScale: store.outputScale, inkOpacity: store.inkOpacity, ribbonWear: store.ribbonWear,
          dirtyInk: store.dirtyInk, characterSet: store.characterSet, colorMode: store.colorMode
        }
      }
    });
  };

  return (
    <div className="w-80 h-screen bg-neutral-800 flex flex-col shrink-0 border-r border-neutral-700 shadow-xl overflow-y-auto">
      <div className="p-4 flex justify-between items-center border-b border-neutral-700">
        <h1 className="text-lg font-bold tracking-wider text-neutral-100">TYPEWRITER STUDIO</h1>
        <button onClick={store.resetControls} className="p-2 bg-neutral-700 hover:bg-neutral-600 rounded-md transition-colors"><RefreshCw size={16} /></button>
      </div>

      <div className="flex p-2 gap-1 bg-neutral-800 border-b border-neutral-700">
        {['General', 'Physics', 'Palette'].map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === tab ? 'bg-neutral-600 text-white' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'}`}>{tab}</button>
        ))}
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {activeTab === 'General' && (
          <div className="space-y-4">
            <ControlSlider label="Total Strokes" settingKey="totalStrokes" min={10000} max={1000000} step={10000} />
            <ControlSlider label="Base Font Size" settingKey="fontSize" min={8} max={40} step={1} />
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
      </div>
    </div>
  );
}
import { useState } from 'react';
import { useStore } from '../store/useStore';
import { removeBackground } from '@imgly/background-removal';
import { RefreshCw, Image as ImageIcon, Play, Square, Download, Film, Brush, Wand2, X, Loader2 } from 'lucide-react';
import TypewriterWorker from '../engine/worker.js?worker';

// Reusable Slider Component
const ControlSlider = ({ label, settingKey, min, max, step, tooltip }) => {
  const value = useStore((state) => state[settingKey]);
  const updateSetting = useStore((state) => state.updateSetting);

  return (
    <div className="mb-4" title={tooltip}>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-400">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => updateSetting(settingKey, parseFloat(e.target.value))}
        className="w-full accent-blue-500 bg-neutral-700 h-1.5 rounded-lg appearance-none cursor-pointer"
      />
    </div>
  );
};

export default function Sidebar({ processImageFile }) {
  const [activeTab, setActiveTab] = useState('General');
  const store = useStore();
  const [workerRef, setWorkerRef] = useState(null);

  const handleCharPreset = (preset) => {
    store.updateSetting('characterSet', preset);
  };

  const handleSubjectIsolation = async () => {
    if (!store.originalImage || store.isProcessingBg) return;

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
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)'; 
        ctx.fillRect(0, 0, offCanvas.width, offCanvas.height);

        store.updateSetting('maskImage', maskImg);
        store.updateSetting('overlayCanvas', offCanvas);
        store.updateSetting('isProcessingBg', false);
      };
      maskImg.src = url;
    } catch (error) {
      console.error("Background Removal Error:", error);
      store.updateSetting('isProcessingBg', false);
      alert("Failed to process background. Check console for details.");
    }
  };

  const clearMask = () => {
    store.updateSetting('maskImage', null);
    store.updateSetting('overlayCanvas', null);
  };

  const toggleRender = () => {
    // If currently rendering, tell the worker to stop gracefully
    if (store.isRendering) {
      if (workerRef) workerRef.postMessage({ type: 'STOP' });
      // We don't set isRendering to false here; we wait for the worker to acknowledge and send the final frame!
      return;
    }

    if (!store.originalImage) return;

    store.updateSetting('isRendering', true);
    store.updateSetting('progress', 0);

    // 1. Create a temporary canvas to extract ImageData (pixels) from the HTMLImageElement
    const extractCanvas = document.createElement('canvas');
    extractCanvas.width = store.originalImage.width;
    extractCanvas.height = store.originalImage.height;
    const ctx = extractCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(store.originalImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, extractCanvas.width, extractCanvas.height);

    // 2. Extract Mask Data (if a subject was isolated)
    let maskData = null;
    if (store.overlayCanvas) {
      const mCtx = store.overlayCanvas.getContext('2d', { willReadFrequently: true });
      maskData = mCtx.getImageData(0, 0, extractCanvas.width, extractCanvas.height);
    }

    // 3. Initialize the Web Worker
    const worker = new TypewriterWorker();
    setWorkerRef(worker);

    // 4. Listen for updates from the Worker
    worker.onmessage = (e) => {
      const { type, progress, imageBitmap } = e.data;
      
      if (type === 'PROGRESS' || type === 'FINISHED') {
        store.updateSetting('progress', progress);
        store.updateSetting('renderedImage', imageBitmap); // Pass the frame to the canvas
      }
      
      if (type === 'FINISHED') {
        store.updateSetting('isRendering', false);
        setWorkerRef(null);
      }
    };

    // 5. Send data to start the engine
    worker.postMessage({
      type: 'START',
      payload: {
        imageData,
        maskData,
        width: extractCanvas.width,
        height: extractCanvas.height,
        params: {
          totalStrokes: store.totalStrokes,
          fontSize: store.fontSize,
          gamma: store.gamma,
          outputScale: store.outputScale,
          inkOpacity: store.inkOpacity,
          ribbonWear: store.ribbonWear,
          dirtyInk: store.dirtyInk,
          characterSet: store.characterSet
        }
      }
    });
  };

  return (
    <div className="w-80 h-screen bg-neutral-800 flex flex-col shrink-0 border-r border-neutral-700 shadow-xl overflow-y-auto">
      {/* Header */}
      <div className="p-4 flex justify-between items-center border-b border-neutral-700">
        <h1 className="text-lg font-bold tracking-wider text-neutral-100">TYPEWRITER STUDIO</h1>
        <button onClick={store.resetControls} className="p-2 bg-neutral-700 hover:bg-neutral-600 rounded-md transition-colors" title="Reset Controls">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex p-2 gap-1 bg-neutral-800 border-b border-neutral-700">
        {['General', 'Physics', 'Palette'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
              activeTab === tab ? 'bg-neutral-600 text-white' : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 p-4 overflow-y-auto">
        {activeTab === 'General' && (
          <div className="space-y-4">
            <ControlSlider label="Total Strokes" settingKey="totalStrokes" min={10000} max={1000000} step={10000} tooltip="Higher = denser image" />
            <ControlSlider label="Font Size" settingKey="fontSize" min={8} max={40} step={1} tooltip="Character size" />
            <ControlSlider label="Gamma" settingKey="gamma" min={0.5} max={3.0} step={0.1} tooltip="Contrast" />
            
            <div className="mb-4">
              <label className="text-xs text-neutral-300 block mb-1">Output Scale</label>
              <select 
                value={store.outputScale} 
                onChange={(e) => store.updateSetting('outputScale', e.target.value)}
                className="w-full bg-neutral-700 text-xs p-2 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="1.0">1.0x</option>
                <option value="2.0">2.0x</option>
                <option value="3.0">3.0x</option>
              </select>
            </div>
          </div>
        )}

        {activeTab === 'Physics' && (
          <div className="space-y-4">
            <ControlSlider label="Ink Opacity" settingKey="inkOpacity" min={10} max={255} step={5} tooltip="Base transparency" />
            <ControlSlider label="Edge Threshold" settingKey="edgeThreshold" min={0.05} max={0.5} step={0.01} tooltip="Line sensitivity" />
            <div className="pt-2 pb-1 border-t border-neutral-700 text-xs text-neutral-500 text-center font-semibold">--- Simulation ---</div>
            <ControlSlider label="Ribbon Wear" settingKey="ribbonWear" min={0} max={1.0} step={0.05} tooltip="0=New, 1=Dry" />
            <ControlSlider label="Dirty Ink" settingKey="dirtyInk" min={0} max={1.0} step={0.05} tooltip="Smudge probability" />
          </div>
        )}

        {activeTab === 'Palette' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-neutral-300 block mb-1">Character Set</label>
              <textarea 
                value={store.characterSet}
                onChange={(e) => store.updateSetting('characterSet', e.target.value)}
                className="w-full h-24 bg-neutral-700 text-xs p-2 rounded font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleCharPreset("$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ")} className="flex-1 bg-neutral-700 py-1 text-xs rounded hover:bg-neutral-600">All</button>
              <button onClick={() => handleCharPreset("01 ")} className="flex-1 bg-neutral-700 py-1 text-xs rounded hover:bg-neutral-600">Binary</button>
              <button onClick={() => handleCharPreset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ ")} className="flex-1 bg-neutral-700 py-1 text-xs rounded hover:bg-neutral-600">Alpha</button>
            </div>
          </div>
        )}

        {/* Tools Frame */}
        <div className="mt-6 bg-neutral-900 p-3 rounded-lg border border-neutral-700">
          <div className="flex gap-2 mb-3">
            <button 
              onClick={() => store.updateSetting('toolMode', store.toolMode === 'brush' ? 'view' : 'brush')}
              className={`flex-1 flex justify-center items-center py-1.5 rounded transition-colors ${store.toolMode === 'brush' ? 'bg-emerald-600' : 'bg-neutral-700 hover:bg-neutral-600'}`}
            >
              <Brush size={14} className="mr-1" /> <span className="text-xs">Brush</span>
            </button>

            {/* AI Background Removal Button */}
            <button 
              onClick={handleSubjectIsolation}
              disabled={store.isProcessingBg || !store.originalImage}
              className={`flex-1 flex justify-center items-center py-1.5 rounded transition-colors ${store.isProcessingBg ? 'bg-blue-600 opacity-70 cursor-wait' : 'bg-neutral-700 hover:bg-neutral-600'}`}
              title="Isolate Subject (AI)"
            >
              {store.isProcessingBg ? (
                <Loader2 size={14} className="mr-1 animate-spin" /> 
              ) : (
                <Wand2 size={14} className="mr-1" />
              )}
              <span className="text-xs">{store.isProcessingBg ? 'Processing...' : 'Subject'}</span>
            </button>

            {/* Clear Mask Button */}
            <button 
              onClick={clearMask}
              className="bg-red-900/50 hover:bg-red-800 text-red-200 px-3 rounded flex items-center justify-center transition-colors" 
              title="Clear Mask"
            >
              <X size={14} />
            </button>
          </div>
          <ControlSlider label="Brush Size" settingKey="brushSize" min={1} max={200} step={1} />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-neutral-700 space-y-2 bg-neutral-800">
        <label className="w-full flex items-center justify-center py-2.5 bg-neutral-700 hover:bg-neutral-600 rounded text-sm font-medium transition-colors cursor-pointer">
          <ImageIcon size={16} className="mr-2" /> LOAD IMAGE
          <input 
            type="file" 
            accept="image/png, image/jpeg, image/jpg" 
            className="hidden" 
            onChange={(e) => processImageFile(e.target.files[0])}
          />
        </label>
        <button 
          onClick={toggleRender}
          className={`w-full flex items-center justify-center py-2.5 rounded text-sm font-bold transition-colors ${store.isRendering ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-500 hover:bg-emerald-600 text-neutral-900'}`}
        >
          {store.isRendering ? <Square size={16} className="mr-2 fill-current" /> : <Play size={16} className="mr-2 fill-current" />}
          {store.isRendering ? 'STOP RENDER' : 'RENDER ART'}
        </button>
        
        <div className="flex gap-2 pt-2">
          <button className="flex-1 flex items-center justify-center py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors">
            <Download size={14} className="mr-1" /> PNG
          </button>
          <button className="flex-1 flex items-center justify-center py-2 bg-purple-600 hover:bg-purple-700 rounded text-sm transition-colors" title="Export Timelapse GIF">
            <Film size={14} className="mr-1" /> GIF
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-neutral-900 rounded-full mt-4 overflow-hidden">
          <div className="h-full bg-blue-500 transition-all duration-200 ease-out" style={{ width: `${store.progress * 100}%` }}></div>
        </div>
      </div>
    </div>
  );
}
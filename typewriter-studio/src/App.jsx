import { useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ZoomableCanvas from './components/ZoomableCanvas';
import { useStore } from './store/useStore';

function App() {
  const { updateSetting, originalImage, renderedImage } = useStore();

  // Handle Spacebar for panning
  useEffect(() => {
    const handleKeyDown = (e) => { if (e.code === 'Space') updateSetting('isSpaceHeld', true); };
    const handleKeyUp = (e) => { if (e.code === 'Space') updateSetting('isSpaceHeld', false); };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [updateSetting]);

  // Process File into an HTMLImageElement
  const processImageFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        updateSetting('originalImage', img);
        // Reset masks and previous render when a new image loads
        updateSetting('maskImage', null);
        updateSetting('overlayCanvas', null);
        updateSetting('renderedImage', null);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, [updateSetting]);

  // Handle Drag & Drop
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    processImageFile(file);
  };

  const handleDragOver = (e) => e.preventDefault();

  return (
    <div
      className="flex h-screen w-full bg-neutral-900 text-neutral-200 overflow-hidden font-sans"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <Sidebar processImageFile={processImageFile} />

      <div className="flex-1 flex flex-col p-4">
        <div className="flex justify-between px-4 mb-2">
          <span className="text-neutral-500 font-bold text-sm tracking-widest">ORIGINAL</span>
          <span className="text-neutral-500 font-bold text-sm tracking-widest">RENDER</span>
        </div>

        <div className="flex-1 flex gap-4 bg-[#141414] rounded-xl p-4 border border-neutral-800 shadow-inner overflow-hidden">

          {/* Left Canvas (Original) */}
          <div className="flex-1 border border-neutral-700 bg-neutral-800/50 rounded flex items-center justify-center relative overflow-hidden">
            {originalImage ? (
              <ZoomableCanvas image={originalImage} isOriginal={true} />
            ) : (
              <span className="text-neutral-600 select-none flex flex-col items-center pointer-events-none">
                <span className="text-3xl mb-2">+</span>
                Drag & Drop Image Here
              </span>
            )}
          </div>

          {/* Right Canvas (Render) */}
          <div className="flex-1 border border-neutral-800 bg-neutral-900 rounded flex items-center justify-center relative overflow-hidden">
            {renderedImage ? (
              <ZoomableCanvas image={renderedImage} isOriginal={false} />
            ) : (
              <span className="text-neutral-700 select-none pointer-events-none">
                Render Preview
              </span>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default App;
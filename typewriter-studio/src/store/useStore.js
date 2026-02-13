import { create } from 'zustand';

const DEFAULT_CHARS = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";

export const useStore = create((set) => ({
  // General Settings
  totalStrokes: 300000,
  fontSize: 14,
  gamma: 1.4,
  resolution: '2000',
  outputScale: '2.0',
  
  // Physics Settings
  inkOpacity: 140,
  edgeThreshold: 0.18,
  ribbonWear: 0.2,
  dirtyInk: 0.1,
  
  // Palette Settings
  characterSet: DEFAULT_CHARS,
  
  // Application State
  toolMode: 'view', 
  brushSize: 40,
  isRendering: false,
  progress: 0,

  // Image & Viewport State
  originalImage: null,
  renderedImage: null,
  viewport: { scale: 1, x: 0, y: 0 },
  isSpaceHeld: false,

  // --- NEW: Masking State ---
  maskImage: null, // Holds the raw isolated subject image
  overlayCanvas: null, // Pre-rendered red tint for UI performance
  isProcessingBg: false, // Loading state for the AI
  
  // Setters
  updateSetting: (key, value) => set({ [key]: value }),
  setViewport: (viewport) => set({ viewport }),
  
  resetControls: () => set({
    totalStrokes: 300000,
    fontSize: 14,
    gamma: 1.4,
    resolution: '2000',
    outputScale: '2.0',
    inkOpacity: 140,
    edgeThreshold: 0.18,
    ribbonWear: 0.2,
    dirtyInk: 0.1,
    characterSet: DEFAULT_CHARS,
    toolMode: 'view',
    brushSize: 40,
    viewport: { scale: 1, x: 0, y: 0 },
    maskImage: null,
    overlayCanvas: null
  })
}));
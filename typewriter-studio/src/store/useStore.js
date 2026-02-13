import { create } from 'zustand';

const DEFAULT_CHARS = "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";

export const useStore = create((set) => ({
  // General Settings
  totalStrokes: 300000,
  fontSize: 14,
  gamma: 1.4,
  resolution: '2000',
  outputScale: '2.0',
  colorMode: 'Color', 
  densityWeight: 5.0, // NEW: Controls the Density mask distribution
  
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

  // Masking State
  masks: { density: null, detail: null, color: null, original: null }, 
  activeLayer: 'density', 
  showAllMasks: false,
  isProcessingBg: false,

  // Visibility & History
  masksVisible: true, 
  undoStack: [],
  redoStack: [],
  maskRevision: 0,
  
  // Setters
  updateSetting: (key, value) => set({ [key]: value }),
  
  updateMask: (layer, canvas) => set((state) => ({ 
    masks: { ...state.masks, [layer]: canvas },
    maskRevision: state.maskRevision + 1
  })),
  
  setViewport: (viewport) => set({ viewport }),
  toggleMasksVisible: () => set((state) => ({ masksVisible: !state.masksVisible })),
  
  // History Management
  saveHistoryState: () => set((state) => {
    const activeCanvas = state.masks[state.activeLayer];
    let imageData = null;
    if (activeCanvas) {
      const ctx = activeCanvas.getContext('2d');
      imageData = ctx.getImageData(0, 0, activeCanvas.width, activeCanvas.height);
    }
    const newUndo = [...state.undoStack, { layer: state.activeLayer, data: imageData }].slice(-15);
    return { undoStack: newUndo, redoStack: [] }; 
  }),
  
  undo: () => set((state) => {
    if (state.undoStack.length === 0) return state;
    const lastState = state.undoStack[state.undoStack.length - 1];
    const newUndo = state.undoStack.slice(0, -1);
    
    const activeCanvas = state.masks[lastState.layer];
    let currentData = null;
    if (activeCanvas) {
      const ctx = activeCanvas.getContext('2d');
      currentData = ctx.getImageData(0, 0, activeCanvas.width, activeCanvas.height);
    }
    const newRedo = [...state.redoStack, { layer: lastState.layer, data: currentData }];
    
    let newMasks = { ...state.masks };
    if (lastState.data) {
      let targetCanvas = activeCanvas || document.createElement('canvas');
      targetCanvas.width = lastState.data.width;
      targetCanvas.height = lastState.data.height;
      targetCanvas.getContext('2d').putImageData(lastState.data, 0, 0);
      newMasks[lastState.layer] = targetCanvas;
    } else {
      newMasks[lastState.layer] = null;
    }
    
    return { undoStack: newUndo, redoStack: newRedo, masks: newMasks, maskRevision: state.maskRevision + 1 };
  }),

  redo: () => set((state) => {
    if (state.redoStack.length === 0) return state;
    const nextState = state.redoStack[state.redoStack.length - 1];
    const newRedo = state.redoStack.slice(0, -1);
    
    const activeCanvas = state.masks[nextState.layer];
    let currentData = null;
    if (activeCanvas) {
      const ctx = activeCanvas.getContext('2d');
      currentData = ctx.getImageData(0, 0, activeCanvas.width, activeCanvas.height);
    }
    const newUndo = [...state.undoStack, { layer: nextState.layer, data: currentData }];
    
    let newMasks = { ...state.masks };
    if (nextState.data) {
      let targetCanvas = activeCanvas || document.createElement('canvas');
      targetCanvas.width = nextState.data.width;
      targetCanvas.height = nextState.data.height;
      targetCanvas.getContext('2d').putImageData(nextState.data, 0, 0);
      newMasks[nextState.layer] = targetCanvas;
    } else {
      newMasks[nextState.layer] = null;
    }
    
    return { undoStack: newUndo, redoStack: newRedo, masks: newMasks, maskRevision: state.maskRevision + 1 };
  }),
  
  resetControls: () => set({
    totalStrokes: 300000, fontSize: 14, gamma: 1.4, resolution: '2000', outputScale: '2.0',
    colorMode: 'Color', densityWeight: 5.0, inkOpacity: 140, edgeThreshold: 0.18, ribbonWear: 0.2, dirtyInk: 0.1,
    characterSet: DEFAULT_CHARS, toolMode: 'view', brushSize: 40, viewport: { scale: 1, x: 0, y: 0 },
    masks: { density: null, detail: null, color: null, original: null },
    activeLayer: 'density', showAllMasks: false, masksVisible: true, undoStack: [], redoStack: [], maskRevision: 0
  })
}));
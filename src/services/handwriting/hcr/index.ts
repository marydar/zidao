export { HCR_LABELS, INPUT_SIZE, MODEL_NAME, OUTPUT_CLASSES, getHcrRunner, hcrStatus, prefetchHcr, setHcrRunner } from './model';
export type { HcrRunner, HcrStatus } from './model';
export { CANVAS_SIZE, CONTENT_SIZE, canvasToInput, normalizeGray, normalizeToCanvas } from './normalize';
export { RENDER_SIZE, STROKE_WIDTH_FRAC, renderStrokes } from './render';
export type { GrayImage } from './render';
export { recognizeHandwriting, setHcrDebug } from './recognize';
export type { RecognizeOptions, RecognizeReason, RecognizeResult, RecognizeSource } from './recognize';
export type { CharCandidate } from '../suggestions';

export type Phase = "idle" | "charging" | "coin" | "prethrow" | "throwing"
  | "ready" | "turning" | "drawing" | "ejecting" | "reveal" | "result" | "error";

export type PrizeKind = "gold" | "normal" | "none";
export type CapsuleColor = "gold" | "black" | "gray" | "blue" | "orange" | "green" | "red" | "purple";

export interface DrawResult {
  type: PrizeKind;
  color: CapsuleColor;
  title: string;
  store: string;
  expiry: string;
}

export interface SavedTicket extends DrawResult { obtained?: string; }

export interface CoinPointer {
  id: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  armed: boolean;
  maxDy: number;
}

export interface GachaState {
  phase: Phase;
  points: number;
  tickets: SavedTicket[];
  sound: boolean;
  volume: number;
  progress: number;
  coinPointer: CoinPointer | null;
  run: number;
  result: DrawResult | null;
  skip: boolean;
  refundDue: boolean;
  audioContext: AudioContext | null;
  master: GainNode | null;
  animations: Set<Animation>;
  request: AbortController | null;
  returnFocus: HTMLElement | null;
  lastTick: number;
  coinX: number;
  coinY: number;
  claimed: boolean;
  keyboardPull: boolean;
  autoTurning: boolean;
  coinPullDistance: number;
}

declare global {
  interface Window {
    SAKITO_DRAW_ENDPOINT?: string;
    webkitAudioContext?: typeof AudioContext;
  }
}

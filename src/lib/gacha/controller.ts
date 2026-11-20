import { CapsulePile } from "./capsule-pile";
import { getGachaElements } from "./elements";
import { preferences, readTickets, isRecord, isPrizeKind } from "./preferences";
import type { CapsuleColor, DrawResult, GachaState, Phase, PrizeKind } from "./types";

type FrameSource = Keyframe[] | (() => Keyframe[]);

// A controller owns one mounted React scene. Its cleanup also handles Strict Mode/HMR.
export function initializeGacha(): () => void {
  const TURN_DEGREES = 720;
  const ui = getGachaElements();
  function requireParent(element: HTMLElement): HTMLElement {
    const parent = element.parentElement;
    if (!parent) throw new Error("Missing gacha mount");
    return parent;
  }
  const handleMount = requireParent(ui.handle);
  const balance = requireParent(ui.pointsValue);
  const lifetime = new AbortController();
  let disposed = false;
  let autoTurnFrame = 0;

  function on<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget, type: K, handler: (event: GlobalEventHandlersEventMap[K]) => void
  ): void {
    target.addEventListener(type, handler as EventListener, { signal: lifetime.signal });
  }

  const savedSound = preferences.read("sound", true);
  const savedVolume = preferences.read("volume", 40);
  const state: GachaState = {
    phase: "idle", points: 120, tickets: readTickets(),
    sound: typeof savedSound === "boolean" ? savedSound : true,
    volume: typeof savedVolume === "number" ? savedVolume : 40,
    progress: 0, coinPointer: null, run: 0, result: null, skip: false,
    refundDue: false, audioContext: null, master: null, animations: new Set(), request: null,
    returnFocus: null, lastTick: 0, coinX: 0, coinY: 0, claimed: false,
    keyboardPull: false, autoTurning: false, coinPullDistance: 100
  };
  function saveTickets() { preferences.write("tickets", state.tickets); }
  saveTickets();
  // Points are session-only; every reload starts at 120 pt.
  preferences.remove("account");
  preferences.remove("points");
  preferences.remove("motion");
  const pile = new CapsulePile(ui.capsuleCanvas);
  let refillColor: CapsuleColor = "black";
  const palette: Record<CapsuleColor, string> = {
    gold: "#d4a944", black: "#242923", gray: "#969c98",
    blue: "#6194b5", orange: "#d28b45", green: "#639263", red: "#bd6953", purple: "#9680ac"
  };
  const templates: Record<PrizeKind, Omit<DrawResult, "expiry">> = {
    gold: { type: "gold", color: "gold", title: "KITランチ引換券", store: "ラテラ" },
    normal: { type: "normal", color: "black", title: "ドリンク券", store: "KITカフェテリア" },
    none: { type: "none", color: "gray", title: "+1 pt", store: "+1 pt" }
  };
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function toast(text: string) {
    clearTimeout(toastTimer); ui.toast.textContent = text; ui.toast.hidden = false;
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2600);
  }
  function say(text: string) { ui.statusText.textContent = text || "\u00a0"; }
  function phase(value: Phase) {
    state.phase = value; document.body.dataset.phase = value;
    ui.handle.disabled = true;
    ui.coinButton.disabled = !["idle", "error"].includes(value);
    ui.coinButton.hidden = !["idle", "error"].includes(value);
    ui.cancelCoinButton.hidden = !["charging", "coin"].includes(value);
    ui.coinSlot.disabled = value !== "coin";
    ui.settingsButton.disabled = ["charging", "prethrow", "throwing", "turning", "drawing", "ejecting", "reveal"].includes(value);
  }
  function points(change: number) {
    state.points = Math.max(0, state.points + change);
    ui.pointsValue.textContent = String(state.points);
    balance.classList.remove("spent");
    if (change) { void ui.pointsValue.offsetWidth; balance.classList.add("spent"); }
  }
  function vibrate(value: number | number[]) { if (navigator.vibrate) navigator.vibrate(value); }
  function audio() {
    if (!state.sound) return null;
    try {
      if (!state.audioContext || !state.master) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return null;
        state.audioContext = new Audio(); state.master = state.audioContext.createGain();
        state.master.connect(state.audioContext.destination);
      }
      if (!state.master) return null;
      state.master.gain.value = state.volume / 100 * .18;
      if (state.audioContext.state === "suspended") state.audioContext.resume().catch(() => { });
      return state.audioContext;
    } catch { return null; }
  }
  function tone(freq: number, duration = .1, offset = 0, type: OscillatorType = "triangle", power = .45) {
    const ctx = audio(); if (!ctx || !state.master) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + offset;
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(power, t + .008);
    gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(state.master); osc.start(t); osc.stop(t + duration + .03);
  }
  function sweep(from: number, to: number, duration: number, offset = 0, type: OscillatorType = "sine", power = .18) {
    const ctx = audio(); if (!ctx || !state.master) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + offset;
    osc.type = type; osc.frequency.setValueAtTime(from, t); osc.frequency.linearRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(power, t + .012);
    gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(state.master); osc.start(t); osc.stop(t + duration + .03);
  }
  function noise(duration: number, offset = 0, power = .14, filterType: BiquadFilterType = "lowpass", cutoff = 1800) {
    const ctx = audio(); if (!ctx || !state.master) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate), samples = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) samples[i] = (Math.random() * 2 - 1) * (1 - i / length * .34);
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain(), t = ctx.currentTime + offset;
    source.buffer = buffer; filter.type = filterType; filter.frequency.setValueAtTime(cutoff, t);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(power, t + .006);
    gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(state.master);
    source.start(t); source.stop(t + duration + .025);
  }
  function sound(name: "charge" | "converge" | "goldFill" | "burst" | "pull" | "tension" | "latch" | "toss" | "coin" | "metal" | "click" | "motor" | "roll" | "impact" | "eject" | "shake" | "open" | "rare" | "win" | "miss") {
    if (name === "charge") { sweep(90, 260, .48, 0, "sawtooth", .14); noise(.2, .02, .12, "lowpass", 460); }
    if (name === "converge") {
      for (let i = 0; i < 7; i += 1) tone(720 + i * 105, .15, i * .095, "sine", .22);
      noise(.7, 0, .08, "highpass", 1500);
    }
    if (name === "goldFill") {
      [392, 494, 587, 784, 988].forEach((freq, i) => tone(freq, .24, i * .28, "sine", .28));
      sweep(180, 540, 1.35, 0, "triangle", .08);
    }
    if (name === "burst") {
      noise(.38, 0, .2, "highpass", 2300); sweep(240, 1050, .42, 0, "sine", .2);
      [784, 1047, 1568].forEach((freq, i) => tone(freq, .32, .06 + i * .07, "sine", .35));
    }
    if (name === "pull") { sweep(310, 115, .18, 0, "triangle", .21); noise(.09, .03, .12, "lowpass", 900); }
    if (name === "tension") { sweep(220, 465, .2, 0, "triangle", .16); tone(620, .1, .12, "sine", .22); }
    if (name === "latch") { noise(.045, 0, .12, "highpass", 3200); tone(880, .1, .015, "square", .18); tone(1175, .16, .05, "sine", .3); }
    if (name === "toss") {
      noise(.28, 0, .2, "bandpass", 1750); sweep(240, 940, .28, 0, "sawtooth", .12);
      sweep(520, 160, .16, .01, "triangle", .18); tone(780, .08, .02, "sine", .16);
    }
    if (name === "coin" || name === "metal") {
      noise(.1, 0, .18, "highpass", 3400); tone(1420, .16, .01, "sine", .42);
      tone(930, .22, .055, "triangle", .25); tone(360, .11, .13, "square", .16);
    }
    if (name === "click") tone(175, .05, 0, "square", .2);
    if (name === "motor") {
      sweep(72, 112, 1.3, 0, "sawtooth", .09);
      for (let i = 0; i < 8; i += 1) { noise(.055, i * .15, i % 2 ? .14 : .2, "lowpass", 850); tone(i % 3 ? 132 : 96, .065, i * .15, "square", .18); }
    }
    if (name === "roll") {
      noise(.42, 0, .16, "lowpass", 1100);
      [0, .095, .2, .31].forEach((offset, i) => { tone(170 - i * 22, .08, offset, "square", .16); noise(.035, offset, .12, "bandpass", 2300); });
      sweep(210, 95, .42, 0, "triangle", .12);
    }
    if (name === "impact") { tone(80, .18, 0, "sine", .8); tone(400, .1, 0, "triangle", .2); }
    if (name === "eject") { noise(.16, 0, .2, "lowpass", 720); tone(230, .16, .02, "triangle", .38); tone(490, .1, .08, "square", .2); }
    if (name === "shake") { noise(.1, 0, .18, "bandpass", 1250); tone(240, .07, .01, "square", .18); noise(.055, .12, .1, "highpass", 2500); }
    if (name === "open") { noise(.22, 0, .2, "highpass", 2100); tone(500, .15, .02, "triangle", .28); tone(750, .27, .1, "sine", .24); tone(1000, .35, .22, "sine", .3); }
    if (name === "rare") { [0, 4, 7, 12].forEach((n, i) => tone(523 * Math.pow(2, n / 12), .45, i * .11, "sine", .45)); }
    if (name === "win") { [523, 659, 784].forEach((freq, i) => tone(freq, .24, i * .09, "triangle", .34)); }
    if (name === "miss") { sweep(330, 196, .36, 0, "triangle", .2); tone(147, .3, .13, "sine", .18); }
  }
  const cancelled = () => new DOMException("Sequence cancelled", "AbortError");
  function check(run: number) { if (run !== state.run || disposed) throw cancelled(); }
  async function wait(ms: number, run: number) {
    check(run);
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(cancelled()); };
      const timer = setTimeout(() => {
        lifetime.signal.removeEventListener("abort", abort);
        resolve();
      }, state.skip ? Math.min(40, ms) : ms);
      lifetime.signal.addEventListener("abort", abort, {once:true});
    });
    check(run);
  }
  async function animate(el: HTMLElement | SVGElement, frames: FrameSource, ms: number, run: number, easing = "cubic-bezier(.2,.8,.3,1)") {
    check(run);
    const getFrames = typeof frames === "function" ? frames : () => frames;
    const animation = el.animate(getFrames(), {duration:state.skip ? 1 : ms,easing,fill:"forwards"});
    const reframe = () => { if (animation.playState !== "finished") (animation.effect as KeyframeEffect | null)?.setKeyframes(getFrames()); };
    if (typeof frames === "function") on(window, "resize",reframe);
    state.animations.add(animation);
    try {
      await animation.finished; check(run);
      const final = getFrames().at(-1) ?? {};
      for (const [key,value] of Object.entries(final)) if (!["offset","easing","composite"].includes(key)) Object.assign(el.style, { [key]: String(value) });
    } catch (error) { if (run !== state.run) throw cancelled(); }
    finally { removeEventListener("resize",reframe); animation.cancel(); state.animations.delete(animation); }
  }
  function setTurn(progress: number) {
    const before = state.progress;
    state.progress = Math.max(0, Math.min(TURN_DEGREES, Math.round(progress * 1000) / 1000));
    ui.handle.style.setProperty("--rotation", state.progress + 90 + "deg");
    handleMount.style.setProperty("--crank-angle", state.progress - 18 + "deg");
    ui.turnProgress.style.strokeDashoffset = String(1 - state.progress / TURN_DEGREES);
    if (["ready", "turning"].includes(state.phase) && Math.abs(state.progress - before) > .001) pile.turnBy(state.progress - before);
    ui.handle.setAttribute("aria-label", "コイン投入後にレバーが自動で2回転します");
  }
  function coinCenter() {
    // Fixed layers and the normal layout share the usable width, excluding scrollbars.
    const viewport = ui.coinStage.getBoundingClientRect();
    return { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
  }
  function coinTransform(scale = 1, turn = 0, tilt = 0, pitch = 0, perspective = 900) {
    return "translate(-50%,-50%) perspective(" + perspective + "px) rotateX(" + pitch + "deg) rotateY(" + turn + "deg) rotateZ(" + tilt + "deg) scale(" + scale + ")";
  }
  function buildCoinEdge() {
    const radius = ui.coinToken.offsetWidth / 2, facets = 64;
    const edges = document.createDocumentFragment();
    for (let i = 0; i < facets; i++) {
      const angle = i / facets * Math.PI * 2, edge = document.createElement("i");
      Object.assign(edge.style, {
        left: radius + Math.cos(angle) * (radius - 1) + "px",
        top: radius + Math.sin(angle) * (radius - 1) + "px",
        width: 2 * Math.PI * radius / facets + .6 + "px",
        transform: "translate(-50%,-50%) rotateZ(" + (i / facets * 360 + 90) + "deg) rotateX(90deg)"
      });
      edges.append(edge);
    }
    ui.coinEdge.replaceChildren(edges);
  }
  function buildCoinEnergy() {
    const viewportDiagonal = Math.hypot(innerWidth, innerHeight);
    const beams = document.createDocumentFragment();
    // Static gradients are rasterized once. Only transform and opacity animate.
    for (let i = 0; i < 96; i++) {
      const distance = viewportDiagonal * (.62 + i % 5 * .1);
      const ray = document.createElement("span"), beam = document.createElement("i");
      ray.className = "energy-ray"; beam.className = "energy-beam";
      Object.assign(ray.style, {
        left: "50%", top: "50%",
        transform: "rotate(" + (i / 96 * 360) + "deg)"
      });
      beam.style.setProperty("--from", distance + "px");
      beam.style.setProperty("--mid", distance * .46 + "px");
      beam.style.setProperty("--drift", (i % 2 ? 1 : -1) * (38 + i % 5 * 10) + "px");
      beam.style.setProperty("--mid-drift", (i % 2 ? -1 : 1) * (18 + i % 4 * 7) + "px");
      beam.style.setProperty("--duration", (720 + i % 7 * 58) + "ms");
      beam.style.setProperty("--delay", (-i * 31) + "ms");
      beam.style.width = 150 + i % 7 * 34 + "px";
      beam.style.height = i % 12 === 0 ? "7px" : i % 4 === 0 ? "5px" : "3.5px";
      ray.append(beam); beams.append(ray);
    }
    ui.coinEnergy.replaceChildren(beams);
  }
  function coinPosition(x: number, y: number, scale = 1, tilt = 0) {
    state.coinX = x; state.coinY = y;
    Object.assign(ui.coinToken.style, { left: x + "px", top: y + "px", transform: coinTransform(scale, 0, tilt) });
  }
  function slotPoint() {
    const slit = ui.coinSlot.querySelector<HTMLElement>(".slot-slit");
    if (!slit) throw new Error("Missing coin slit");
    const r = slit.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * .55, width: r.width, height: r.height };
  }
  function goldMask(level: number) {
    return "inset(" + (100 - level) + "% 0 0 0)";
  }
  function slideBanner() {
    const banner = ui.gestureLabel.animate([{transform:"translateX(-105%)"},{transform:"translateX(0)"}], {duration:300,easing:"cubic-bezier(.2,.8,.2,1)"});
    state.animations.add(banner);
    banner.finished.catch(() => {}).finally(() => state.animations.delete(banner));
  }
  function aimCoin(armed: boolean) {
    const changed = ui.coinGesture.classList.contains("armed") !== armed;
    ui.coinGesture.classList.toggle("armed", armed);
    ui.gestureLabel.textContent = armed ? "はなせ！" : "下に引っ張れ！";
    ui.coinSlot.classList.toggle("is-near", armed);
    layoutPullArrow(armed);
    if (changed && !ui.coinGesture.hidden) slideBanner();
  }
  function layoutCoinGuide() {
    const center = coinCenter(), radius = ui.coinToken.offsetWidth / 2;
    // The tip is the final position of the coin's bottom edge, 24px above the viewport.
    state.coinPullDistance = Math.max(24, Math.floor(innerHeight - radius - 24 - center.y));
    layoutPullArrow(ui.coinGesture.classList.contains("armed"));
    ui.gestureLabel.style.top = Math.max(68, center.y - radius - 67) + "px";
  }
  function layoutPullArrow(armed: boolean) {
    const center = coinCenter(), radius = ui.coinToken.offsetWidth / 2;
    const bottom = ui.coinToken.getBoundingClientRect().top - 6;
    const length = armed ? Math.max(32,bottom-center.y) : Math.max(20,state.coinPullDistance-4);
    const top = armed ? bottom-length : center.y+radius+4;
    ui.pullArrow.setAttribute("viewBox","0 0 64 "+length);
    Object.assign(ui.pullArrow.style,{height:length+"px",left:center.x-32+"px",top:top+"px"});
    ui.pullArrow.dataset.distance = String(state.coinPullDistance);
    const shoulder = length - Math.min(29, length * .55);
    ui.pullArrowShape.setAttribute("d",
      "M28 3 H36 V" + (shoulder + 4) + " L48 " + (shoulder - 6) +
      " L52 " + (shoulder - 1) + " L32 " + (length - 3) +
      " L12 " + (shoulder - 1) + " L16 " + (shoulder - 6) + " L28 " + (shoulder + 4) + " Z");

  }
  function hideCoin() {
    ui.coinToken.hidden = true; ui.coinEnergy.hidden = true; ui.coinGesture.hidden = true;
    ui.coinToken.classList.remove("dragging", "pull-armed", "is-charged", "charge-flash", "flying");
    ui.coinEnergy.classList.remove("bursting", "converging");
    ui.coinStage.style.clipPath = "";
    ui.coinSlot.classList.remove("is-near"); ui.coinGesture.classList.remove("armed");
    document.body.classList.remove("dragging");
    document.body.style.overflow = "";
    state.coinPointer = null; state.keyboardPull = false;
  }
  async function spawnCoin() {
    if (!["idle", "error"].includes(state.phase)) return;
    if (state.points < 10) { say("あと " + (10 - state.points) + " pt"); toast("ポイントが足りません"); return; }
    const run = ++state.run;
    ui.settingsPanel.hidden = true; ui.settingsButton.setAttribute("aria-expanded", "false");
    phase("charging"); state.skip = false; state.keyboardPull = false;
    ui.coinToken.disabled = true; ui.coinToken.classList.remove("is-charged", "charge-flash");
    ui.coinToken.style.opacity = "1"; ui.coinStage.style.clipPath = "";
    ui.coinGold.style.clipPath = goldMask(0);
    const p = coinCenter(); coinPosition(p.x, p.y);
    ui.coinToken.hidden = false; buildCoinEdge(); buildCoinEnergy();
    ui.coinEnergy.hidden = false; ui.coinGesture.hidden = true;
    ui.coinEnergy.classList.remove("bursting", "converging");
    say(""); sound("charge");
    await animate(ui.coinToken, [
      { opacity: 0, transform: coinTransform(.8, -300) },
      { opacity: 1, transform: coinTransform(1, 0) }
    ], 500, run);
    ui.coinEnergy.classList.add("converging");
    sound("converge"); sound("goldFill");
    const filling = Array.from({ length: 21 }, (_, n) => ({
      clipPath: goldMask(n * 5), offset: n / 20
    }));
    await animate(ui.coinGold, filling, 1550, run, "linear");
    ui.coinGold.style.clipPath = goldMask(100);
    ui.coinEnergy.replaceChildren(); ui.coinEnergy.classList.remove("converging");
    ui.coinEnergy.classList.add("bursting"); ui.coinEnergy.hidden = false;
    ui.coinToken.classList.add("is-charged", "charge-flash"); sound("burst");
    await wait(740, run);
    ui.coinEnergy.hidden = true; ui.coinEnergy.classList.remove("bursting");
    phase("coin"); ui.coinToken.disabled = false; ui.coinGesture.hidden = false;
    layoutCoinGuide();
    aimCoin(false); slideBanner();
    ui.liveRegion.textContent = "コインが完成しました。矢印の長さだけ下へ引き、はなせの表示が出たら指を離してください。";
    ui.coinToken.focus({ preventScroll: true });
  }
  function cancelCoin() {
    if (!["charging", "coin"].includes(state.phase)) return;
    ++state.run; state.animations.forEach(a => a.cancel()); state.animations.clear();
    hideCoin(); phase("idle"); say(""); ui.coinButton.focus({ preventScroll: true });
  }
  async function throwCoin() {
    if (!["coin", "prethrow"].includes(state.phase)) return;
    const run = state.run, p = slotPoint(), fromX = state.coinX;
    let fromY = state.coinY;
    const captured = state.coinPointer;
    state.coinPointer = null; state.keyboardPull = false;
    if (captured) { try { ui.coinToken.releasePointerCapture(captured.id); } catch {} }
    ui.coinToken.disabled = true; ui.coinToken.classList.remove("dragging", "pull-armed", "charge-flash");
    ui.coinToken.classList.add("flying");
    ui.coinGesture.hidden = true; document.body.classList.remove("dragging");
    document.body.style.overflow = "hidden";
    // Changing phase synchronously latches this launch before pointerup/keyup can repeat it.
    phase("throwing"); say("");
    sound("toss"); vibrate([8, 18, 28]);
    try {
      const launchY = fromY - Math.min(18, innerHeight * .02);
      await animate(ui.coinToken, [
        { left: fromX + "px", top: fromY + "px", transform: ui.coinToken.style.transform, offset: 0 },
        { left: fromX + "px", top: fromY + 8 + "px", transform: coinTransform(.94, -10, 5, -8), offset: .32 },
        { left: fromX + "px", top: launchY + "px", transform: coinTransform(1.1, 22, -7, 24), offset: .72 },
        { left: fromX + "px", top: launchY + "px", transform: coinTransform(1.02, 0, 0, 12), offset: 1 }
      ], 150, run, "cubic-bezier(.18,.82,.24,1)");
      fromY = launchY; state.coinY = launchY;
      const entryScale = () => Math.min(.26,p.width * .9 / ui.coinToken.offsetWidth);
      const flightFrames = () => {
        Object.assign(p,slotPoint());
        const scale = entryScale(), apex = Math.max(38,Math.min(82,p.y-170)), flight = [];
        for (let i=0;i<=48;i++) {
          const t=i/48, up=t<.56, u=up?t/.56:(t-.56)/.44;
          const y=up?apex+(fromY-apex)*(1-u)**2:apex+(p.y-17-apex)*u**2;
          const x=fromX+(p.x-fromX)*t+Math.sin(Math.PI*t)*Math.min(36,innerWidth*.05);
          const turn=720*t;
          const pitch=12+68*Math.sin(Math.PI*t);
          const depthScale=1-(1-scale)*Math.pow(t,1.65);
          const shadow=(12+12*(1-t))+"px "+(10+14*(1-t))+"px 0 #10201655";
          flight.push({left:x+"px",top:y+"px",opacity:1,boxShadow:"0 "+shadow,transform:coinTransform(depthScale,turn,-24*Math.sin(Math.PI*t),pitch,540),offset:t});
        }
        return flight;
      };
      await animate(ui.coinToken,flightFrames,1300,run,"linear");
      // The slit lip masks the descending coin; size and opacity stay constant.
      await animate(ui.coinToken,() => {
        Object.assign(p,slotPoint());
        ui.coinStage.style.clipPath="inset(0 0 "+Math.max(0,innerHeight-p.y)+"px 0)";
        const scale=entryScale(),turn=720;
        return [
          {left:p.x+"px",top:(p.y-17)+"px",boxShadow:"0 3px 4px #10201666",transform:coinTransform(scale,turn,0,68,420)},
          {left:p.x+"px",top:(p.y+22)+"px",boxShadow:"0 1px 2px #10201655",transform:coinTransform(scale,turn,0,78,420)}
        ];
      },190,run,"cubic-bezier(.35,0,.8,.5)");
      sound("metal"); vibrate([12,25,18]);
      hideCoin(); state.refundDue = true; points(-10);
      phase("ready"); setTurn(0); say("");
      ui.liveRegion.textContent = "コインが入りました。レバーが自動で2回転します。";
      autoTurn().catch(() => {});
    } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error); }
  }
  async function assistedThrow() {
    if (state.phase !== "coin" || ui.coinToken.disabled || state.coinPointer) return;
    phase("prethrow"); ui.coinToken.disabled = true;
    const run = state.run, center = coinCenter();
    aimCoin(true); ui.coinGesture.hidden = true;
    await animate(ui.coinToken, [
      { left: state.coinX + "px", top: state.coinY + "px", transform: ui.coinToken.style.transform },
      { left: center.x + "px", top: center.y + state.coinPullDistance + "px", transform: coinTransform(1, 0, -6) }
    ], 280, run);
    state.coinX = center.x; state.coinY = center.y + state.coinPullDistance;
    await throwCoin();
  }
  on(ui.coinToken, "pointerdown", e => {
    if (state.phase !== "coin" || ui.coinToken.disabled || !e.isPrimary) return;
    e.preventDefault(); state.keyboardPull = false;
    state.coinPointer = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY,
      originX: state.coinX, originY: state.coinY,
      armed: false, maxDy: 0
    };
    ui.coinToken.setPointerCapture(e.pointerId); ui.coinToken.classList.add("dragging");
    ui.coinToken.style.setProperty("--pull-scale-x", "1");
    ui.coinToken.style.setProperty("--pull-scale-y", "1");
    ui.coinToken.style.setProperty("--pull-glow", "6px");
    sound("pull");
    document.body.classList.add("dragging");
  });
  on(ui.coinToken, "pointermove", e => {
    const pointer = state.coinPointer;
    if (!pointer || pointer.id !== e.pointerId) return;
    e.preventDefault();
    const dx = Math.max(-55, Math.min(55, e.clientX - pointer.startX));
    const rawDy = e.clientY - pointer.startY;
    const dy = Math.max(0, Math.min(state.coinPullDistance, rawDy));
    const previousMaxDy = pointer.maxDy;
    pointer.maxDy = Math.max(pointer.maxDy, rawDy);
    const tension = Math.min(1, dy / state.coinPullDistance);
    ui.coinToken.style.setProperty("--pull-scale-x", (1 + tension * .065).toFixed(3));
    ui.coinToken.style.setProperty("--pull-scale-y", (1 - tension * .1).toFixed(3));
    ui.coinToken.style.setProperty("--pull-glow", (6 + tension * 16).toFixed(1) + "px");
    if (previousMaxDy < state.coinPullDistance * .55 && pointer.maxDy >= state.coinPullDistance * .55) {
      sound("tension"); vibrate(7);
    }
    if (!pointer.armed && rawDy >= state.coinPullDistance - 2) {
      pointer.armed = true; ui.coinToken.classList.add("pull-armed");
      vibrate([8, 18, 24]); sound("latch"); ui.liveRegion.textContent = "はなせ！";
    }
    coinPosition(pointer.originX + dx * .4, pointer.originY + dy, 1 + tension * .045, dx * .08 - tension * 7);
    aimCoin(pointer.armed);
    if (pointer.armed && pointer.maxDy - rawDy >= 10) throwCoin().catch(() => {});

  });
  async function returnCoin(run: number) {
    ui.coinToken.disabled = true;
    const p = coinCenter();
    aimCoin(false);
    await animate(ui.coinToken, [
      { left: state.coinX + "px", top: state.coinY + "px", transform: ui.coinToken.style.transform },
      { left: p.x + "px", top: p.y + "px", transform: coinTransform(1) }
    ], 320, run);
    if (state.phase === "coin") { const center = coinCenter(); coinPosition(center.x,center.y); ui.coinToken.disabled = false; }
  }
  async function releaseCoin(e: PointerEvent, interrupted = false) {
    const pointer = state.coinPointer;
    if (!pointer || pointer.id !== e.pointerId) return;
    e.preventDefault();
    state.coinPointer = null; ui.coinToken.classList.remove("dragging", "pull-armed"); document.body.classList.remove("dragging");
    try { ui.coinToken.releasePointerCapture(e.pointerId); } catch {}
    if (!interrupted && pointer.armed) {
      await throwCoin();
    } else {
      await returnCoin(state.run);
    }
  }
  on(ui.coinToken, "pointerup", e => releaseCoin(e).catch(() => {}));
  on(ui.coinToken, "pointercancel", e => releaseCoin(e, true).catch(() => {}));
  on(ui.coinToken, "keydown", e => {
    if (state.phase !== "coin" || ui.coinToken.disabled) return;
    if (["Enter", " "].includes(e.key)) { e.preventDefault(); assistedThrow().catch(() => {}); }
    if (e.key === "ArrowDown") {
      e.preventDefault(); state.keyboardPull = true;
      const p = coinCenter(); coinPosition(p.x, p.y + state.coinPullDistance, 1, -6); aimCoin(true);
    }
  });
  on(ui.coinToken, "keyup", e => {
    if (e.key === "ArrowDown" && state.phase === "coin" && state.keyboardPull) { e.preventDefault(); throwCoin().catch(() => {}); }
  });
  on(ui.coinSlot, "click", e => {
    if (e.detail === 0) assistedThrow().catch(() => {});
  });
  on(ui.cancelCoinButton, "click", cancelCoin);
  on(ui.coinButton, "click", () => spawnCoin().catch(() => {}));
  function tickCrank() {
    if (performance.now() - state.lastTick > 190) {
      state.lastTick = performance.now(); sound("click"); vibrate(9);
      ui.machine.classList.remove("cranking"); void ui.machine.offsetWidth; ui.machine.classList.add("cranking");
    }
  }
  async function autoTurn() {
    if (!["ready", "turning"].includes(state.phase) || state.autoTurning) return;
    state.autoTurning = true;
    phase("turning"); const from = state.progress, run = state.run, start = performance.now();
    const duration = Math.max(900, 2250 * (TURN_DEGREES - from) / 360);
    await new Promise<void>(resolve => {
      function frame(now: number) {
        if (run !== state.run || disposed) { resolve(); return; }
        const p = Math.min(1, (now - start) / duration);
        const eased = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const ratchets = Math.ceil((TURN_DEGREES - from) / 90);
        const position = eased * ratchets;
        const detent = Math.floor(position);
        const withinDetent = position - detent;
        const stroke = withinDetent < .8 ? withinDetent / .8 : 1;
        const strokeEase = stroke * stroke * (3 - 2 * stroke);
        const stepped = p >= 1 ? 1 : (detent + strokeEase) / ratchets;
        setTurn(from + (TURN_DEGREES - from) * stepped); tickCrank();
        if (p < 1) (autoTurnFrame = requestAnimationFrame(frame)); else resolve();
      } (autoTurnFrame = requestAnimationFrame(frame));
    });
    state.autoTurning = false;
    if (run === state.run) finishTurn();
  }
  function normalizeResult(value: unknown): DrawResult {
    if (!isRecord(value) || !isPrizeKind(value.type)) throw new Error("Invalid draw result");
    const base = templates[value.type];
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
    return {
      ...base,
      title: typeof value.title === "string" ? value.title : base.title,
      store: typeof value.store === "string" ? value.store : base.store,
      expiry: typeof value.expiry === "string" && value.expiry ? value.expiry : expiry.toLocaleDateString("ja-JP")
    };
  }
  async function requestResult(run: number, capsuleColor: CapsuleColor): Promise<DrawResult> {
    if (window.SAKITO_DRAW_ENDPOINT) {
      const controller = new AbortController(); state.request = controller;
      const timeout = setTimeout(() => controller.abort(), 9000);
      try {
        const r = await fetch(window.SAKITO_DRAW_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cost: 10 }), signal: controller.signal });
        if (!r.ok) throw new Error("Draw unavailable");
        const result = normalizeResult(await r.json()); check(run); return result;
      } finally { clearTimeout(timeout); state.request = null; }
    }
    await wait(400, run);
    let type = ui.demoMode.value;
    if (type === "error") throw new Error("Simulated connection error");
    if (type === "random") {
      type = capsuleColor === "gold" ? "gold"
        : capsuleColor === "black" && Math.random() < .8 ? "normal" : "none";
    }
    return normalizeResult({ type });
  }
  function finishTurn() {
    if (!["ready", "turning"].includes(state.phase)) return;
    document.body.classList.remove("dragging"); setTurn(TURN_DEGREES);
    draw().catch(error => { if (!(error instanceof DOMException && error.name === "AbortError")) console.error(error); });
  }
  async function shakeMachine(run: number) {
    ui.machine.classList.remove("cranking");
    const sway = [
      [0, 0, 0], [.16, -.35, -.12], [.31, .55, .18],
      [.46, -.38, -.13], [.61, .24, .08], [.75, -.12, -.04],
      [.88, .05, .02], [1, 0, 0]
    ];
    vibrate([4, 90, 4]);
    try {
      await animate(ui.machine, sway.map(([offset, x, tilt]) => ({
        offset, transform: "translate3d(" + x + "px,0,0) rotate(" + tilt + "deg)"
      })), 760, run, "ease-in-out");
    } finally {
      ui.machine.style.removeProperty("transform");
    }
  }
  async function draw() {
    const run = ++state.run; state.skip = false; phase("drawing"); say(" "); pile.stopMix(); sound("motor");
    try {
      const capsuleColor = pile.peekNextColor();
      const [result] = await Promise.all([requestResult(run, capsuleColor), wait(1350, run), shakeMachine(run)]);
      state.result = result; pile.stopMix(); ui.machine.classList.remove("cranking"); say("");
      await wait(400, run);
      // The selected ball passes behind the cabinet. It is never drawn above the body.
      const ejectedColor = !window.SAKITO_DRAW_ENDPOINT && ui.demoMode.value === "random" ? capsuleColor : result.color;
      refillColor = pile.take(ejectedColor);
      await wait(360, run);
      await ejectAndReveal(result, run);
    } catch (error) {
      if (run !== state.run) return;
      pile.stopMix(); ui.machine.classList.remove("cranking"); hideReveal();
      if (state.refundDue) { state.refundDue = false; points(10); }
      phase("error"); say("つながりませんでした。もう一度"); toast("10 ptを戻しました");
    }
  }
  function setHero(x: number, y: number, size: number, rotation = 0) {
    Object.assign(ui.heroCapsule.style, { left: x + "px", top: y + "px", width: size + "px", height: size + "px", transform: "translate(-50%,-50%) rotate(" + rotation + "deg)" });
  }
  async function trembleCapsule(strength: number, duration: number, run: number, rotation = 360) {
    if (state.skip) { await wait(0, run); return; }
    // Both shell halves move together; every burst returns to the resting pose.
    const poses = [
      [0, 0, 0], [-.6, .1, -.5], [.8, -.2, .7], [-1, .1, -1],
      [1, -.15, 1], [-.85, 0, -.8], [.6, -.1, .6], [-.3, 0, -.3], [0, 0, 0]
    ];
    await animate(ui.heroCapsule, poses.map(([x, y, tilt]) => ({
      transform: "translate(-50%,-50%) translate(" + (x * strength) + "px," + (y * strength) + "px) rotate(" + (rotation + tilt * strength * .65) + "deg)"
    })), duration, run, "linear");
  }
  async function anticipateOpening(run: number, restingRotation: number) {
    await wait(150, run);
    for (const [strength, duration, pause] of [[2, 200, 180], [4, 260, 130], [7, 320, 100]]) {
      if (state.skip) break;
      sound("shake"); vibrate(8);
      await trembleCapsule(strength, duration, run, restingRotation);
      await wait(pause, run);
    }
    check(run);
  }
  function hideReveal() {
    state.animations.forEach(a => a.cancel()); state.animations.clear();
    ui.revealLayer.hidden = true; ui.revealLayer.classList.remove("focused", "opening-flash");
    ui.revealLayer.style.clipPath = ""; ui.heroCapsule.style.clipPath = ""; ui.heroCapsule.style.filter = "";
    ui.scene.removeAttribute("aria-busy");
    ui.revealLayer.setAttribute("aria-hidden", "true"); ui.heroCapsule.classList.remove("split");
    ui.revealWord.classList.remove("visible"); ui.outlet.classList.remove("is-open");
    document.body.style.overflow = "";
    ui.scene.inert = false;
  }
  async function ejectAndReveal(result: DrawResult, run: number) {
    phase("ejecting");
    document.body.style.overflow = "hidden";
    ui.scene.inert = true;
    const frame = ui.outlet.closest(".outlet-frame");
    const trayElement = frame?.querySelector(".outlet-tray");
    const plinthElement = ui.machine.querySelector(".machine-plinth");
    const rollDirection = Math.random() < .5 ? -1 : 1;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const geometry = () => {
      const hole = ui.outlet.getBoundingClientRect();
      const machine = ui.machine.getBoundingClientRect();
      const tray = trayElement?.getBoundingClientRect() || {
        left: hole.left - 3, right: hole.right + 3, top: hole.bottom + 2,
        bottom: hole.bottom + 10, width: hole.width + 6, height: 8
      };
      const plinth = plinthElement?.getBoundingClientRect() || machine;
      const size = Math.max(16, Math.min(42, hole.height * .84, hole.width * .35));
      const r = size / 2, safeLeft = r + 12, safeRight = innerWidth - r - 12;
      const floor = Math.min(innerHeight - r - 18, Math.max(plinth.bottom + r * .35, tray.bottom + size * .8));
      const edgeX = clamp(rollDirection > 0 ? tray.right + r * .16 : tray.left - r * .16, safeLeft, safeRight);
      const stepX = clamp(edgeX + rollDirection * size * .2, safeLeft, safeRight);
      const impactX = clamp(stepX + rollDirection * Math.min(size * .62, machine.width * .06), safeLeft, safeRight);
      const stopX = clamp(rollDirection > 0
        ? Math.min(impactX, machine.left + machine.width * .41)
        : Math.max(impactX, machine.right - machine.width * .41), safeLeft, safeRight);
      return {
        hole, tray, machine, size, r, floor, edgeX, stepX, impactX, stopX,
        trayFloor: tray.top + Math.min(2, tray.height * .16), safeLeft, safeRight
      };
    };
    type OutletGeometry = ReturnType<typeof geometry>;
    type PathPoint = (g: OutletGeometry) => { x: number; y: number };
    interface MoveOptions {
      duration?: number;
      rise?: (g: OutletGeometry) => number;
      ballistic?: boolean;
      fromScale?: number;
      mask?: boolean;
      dark?: boolean;
      easing?: string;
    }
    const pose = (x: number, y: number, size: number, rotation: number, extra: Keyframe = {}): Keyframe => ({
      left: x + "px", top: y + "px", width: size + "px", height: size + "px", opacity: 1,
      transform: "translate(-50%,-50%) rotate(" + rotation + "deg)", ...extra
    });
    const maskOpening = (g: OutletGeometry) => {
      const cut = (n: number) => Math.round(n * 10) / 10;
      const front = g.tray.top + g.tray.height * .42;
      ui.revealLayer.style.clipPath = 'path("M ' + cut(g.hole.left + 1) + ' ' + cut(g.hole.top + g.hole.height * .18) +
        ' H ' + cut(g.hole.right - 1) + ' V ' + cut(g.hole.bottom - 1) + ' H ' + cut(g.hole.left + 1) +
        ' Z M 0 ' + cut(front) + ' H ' + innerWidth + ' V ' + innerHeight + ' H 0 Z")';
    };

    // Points are functions of live geometry; animate() can rebuild the complete path on resize.
    let point: PathPoint = g => ({ x: g.hole.left + g.hole.width * .5, y: g.hole.top + g.hole.height * .46 });
    let rotation = Math.random() * 360;
    // y(t) = y0 + dy*t - A*t*(1-t) is a parabola. This A gives the requested
    // rise above the starting position even when the landing position is lower.
    const parabola = (dy: number, rise: number) => dy + 2 * rise + 2 * Math.sqrt(Math.max(0, rise * (rise + dy)));
    async function moveTo(nextPoint: PathPoint, options: MoveOptions = {}) {
      const fromPoint = point, startRotation = rotation;
      const first = geometry(), a = fromPoint(first), b = nextPoint(first);
      const rise = options.rise ? options.rise(first) : 0;
      const curve = options.ballistic ? parabola(b.y - a.y, rise) : 0;
      const duration = options.duration || Math.max(120, Math.round(Math.sqrt(Math.max(1, 2 * curve) / 2100) * 1000));
      let endRotation = startRotation;
      await animate(ui.heroCapsule, () => {
        const g = geometry(), from = fromPoint(g), to = nextPoint(g);
        if (options.mask) maskOpening(g);
        const riseNow = options.rise ? options.rise(g) : 0;
        const curveNow = options.ballistic ? parabola(to.y - from.y, riseNow) : 0;
        // The same horizontal travel produces the same rolling angle at each contact.
        endRotation = startRotation + (to.x - from.x) / g.r * 180 / Math.PI;
        const count = options.ballistic ? 24 : 12;
        return Array.from({ length: count + 1 }, (_, i) => {
          const t = i / count;
          const x = from.x + (to.x - from.x) * t;
          const y = from.y + (to.y - from.y) * t - curveNow * t * (1 - t);
          const size = g.size * ((options.fromScale ?? 1) + (1 - (options.fromScale ?? 1)) * t);
          const filter = options.dark ? "brightness(" + (.5 + .5 * t) + ")" : "brightness(1)";
          return pose(x, Math.min(y, innerHeight - size / 2 - 18), size,
            startRotation + (endRotation - startRotation) * t, { offset: t, filter });
        });
      }, duration, run, options.easing || "linear");
      point = nextPoint;
      rotation = endRotation;
    }

    let g = geometry(), p = point(g);
    ui.heroCapsule.style.setProperty("--capsule", palette[result.color] || palette.blue);
    ui.heroCapsule.classList.remove("split");
    Object.assign(ui.heroCapsule.style, { opacity: "1", filter: "brightness(.5)", clipPath: "none" });
    ui.revealLayer.classList.remove("focused");
    ui.revealLayer.hidden = false;
    ui.revealLayer.setAttribute("aria-hidden", "false");
    ui.revealWord.classList.remove("visible");
    maskOpening(g); setHero(p.x, p.y, g.size * .58, rotation);
    ui.outlet.classList.add("is-open");
    sound("eject"); vibrate([15, 35, 12]);
    await wait(200, run);
    // 1. Only the outlet's dark opening can reveal the ball while it is inside.
    await moveTo(g => ({ x: g.hole.left + g.hole.width * .38, y: g.hole.bottom - g.r - 2 }),
      { duration: 300, fromScale: .58, dark: true, mask: true, easing: "cubic-bezier(.35,0,.7,1)" });
    ui.revealLayer.style.clipPath = "none";

    // 2. One small hop clears the front lip, then the ball rolls along the tray.
    sound("roll");
    await moveTo(g => ({
      x: clamp(g.hole.left + g.hole.width * .5 + rollDirection * Math.min(g.tray.width * .16, g.size * .55), g.tray.left + g.r, g.tray.right - g.r),
      y: g.trayFloor - g.r
    }),
      { duration: 270, ballistic: true, rise: g => Math.min(8, g.size * .2) });
    sound("impact"); vibrate(7);
    sound("roll");
    await moveTo(g => ({ x: g.edgeX, y: g.trayFloor - g.r }),
      { duration: 390, easing: "cubic-bezier(.3,.2,.65,1)" });

    // 3. The rounded edge provides a second, lower contact. It gives a small
    // outward kick before gravity carries the ball down to the floor by the plinth.
    await moveTo(g => ({ x: g.stepX, y: Math.min(g.floor, g.tray.bottom - g.r * .05) }),
      { ballistic: true });
    sound("impact"); vibrate(5);
    await moveTo(g => ({ x: g.impactX, y: g.floor }),
      { ballistic: true, rise: g => Math.min(10, g.size * .28) });
    sound("impact"); vibrate(9);

    // 4. Contact changes the horizontal direction. Three short floor bounces
    // return underneath the machine, with successively lower heights and travel.
    // The final fraction is reserved for the short frictional roll to a stop.
    for (const [fraction, height] of [[.52, .6], [.83, .32], [.97, .14]]) {
      await moveTo(g => ({ x: g.impactX + (g.stopX - g.impactX) * fraction, y: g.floor }),
        { ballistic: true, rise: g => Math.min(20, g.size * height) });
      sound("click"); vibrate(fraction < .6 ? 7 : 4);
    }
    await moveTo(g => ({ x: g.stopX, y: g.floor }),
      { duration: 170, easing: "cubic-bezier(.15,.7,.3,1)" });
    await wait(100, run);

    // Preserve the current central enlargement, anticipation, split, and result.
    phase("reveal");
    ui.revealLayer.style.clipPath = "none";
    ui.heroCapsule.style.clipPath = "none";
    ui.revealLayer.classList.add("focused");
    ui.scene.setAttribute("aria-busy", "true");
    const restingPoint = point;
    const restingRotation = ((rotation % 360) + 360) % 360;
    const ticketFacing = [0, -7, 7][Math.floor(Math.random() * 3)];
    ui.revealedTicket.style.setProperty("--ticket-angle", ticketFacing - restingRotation + "deg");
    // This equivalent angle prevents a long reverse spin before the 360-degree resting pose.
    g = geometry(); p = restingPoint(g); setHero(p.x, p.y, g.size, restingRotation);
    await animate(ui.heroCapsule, () => {
      const g = geometry(), p = restingPoint(g), target = coinCenter(), large = Math.min(190, innerWidth * .4);
      return [
        pose(p.x, p.y, g.size, restingRotation),
        pose(target.x + 8, target.y - 18, large * 1.08, restingRotation + 22, { offset: .78 }),
        pose(target.x, target.y, large, restingRotation + 360)
      ];
    }, 650, run);
    sound("impact"); vibrate(result.type === "gold" ? [22, 35, 22] : 22);
    await anticipateOpening(run, restingRotation + 360);
    ui.revealName.textContent = result.type === "none" ? "+1 pt" : result.title;
    ui.revealedTicket?.classList.toggle("gold", result.type === "gold");
    ui.revealWord.textContent = result.type === "gold" ? "大当たり！" : result.type === "none" ? "はずれ" : "引換券を獲得";
    ui.revealLayer.classList.remove("opening-flash");
    void ui.revealLayer.offsetWidth;
    ui.revealLayer.classList.add("opening-flash");
    ui.heroCapsule.classList.add("split"); ui.revealWord.classList.add("visible");
    sound("open");
    sound(result.type === "gold" ? "rare" : result.type === "none" ? "miss" : "win");
    vibrate([14, 25, 14]);
    ui.liveRegion.textContent = result.title;
    await wait(4000, run);
    showResult(result);
  }
  function saveResult(result: DrawResult) {
    state.refundDue = false;
    if (result.type === "none") { points(1); state.claimed = true; }
    else {
      state.tickets.unshift({ ...result, obtained: new Date().toISOString() });
      state.tickets = state.tickets.slice(0, 100); saveTickets();
      ui.collectionCount.textContent = String(state.tickets.length);
    }
  }
  function showResult(result: DrawResult) {
    if (state.phase === "result") return;
    saveResult(result); hideReveal(); phase("result");
    ui.resultTitle.textContent = result.type === "none" ? "+1 pt" : result.title;
    ui.resultKind.textContent = result.type === "gold" ? "当たり" : result.type === "none" ? "はずれ" : "引換券";
    ui.resultStore.textContent = result.type === "none" ? "ポイントに加算しました" : result.store;
    ui.resultExpiry.textContent = result.type === "none" ? "次のガチャに使えます" : "有効期限 " + result.expiry;
    ui.resultTicket.classList.toggle("gold", result.type === "gold");
    state.returnFocus = ui.coinButton;
    ui.resultDialog.showModal();
  }
  function finishResult() {
    if (state.phase !== "result") return;
    ui.resultDialog.close(); state.result = null; state.skip = false; phase("idle"); setTurn(0); pile.refill(refillColor); say("");
    ui.coinButton.focus({ preventScroll: true });
  }
  on(ui.closeResultButton, "click", finishResult);
  on(ui.resultDialog, "cancel", e => { e.preventDefault(); finishResult(); });
  on(ui.againButton, "click", () => { finishResult(); spawnCoin().catch(() => { }); });
  on(ui.skipButton, "click", () => { state.skip = true; state.animations.forEach(a => { try { a.finish(); } catch { } }); });
  on(ui.settingsButton, "click", () => {
    const open = ui.settingsPanel.hidden; ui.settingsPanel.hidden = !open; ui.settingsButton.setAttribute("aria-expanded", String(open));
  });
  on(document, "pointerdown", e => {
    if (e.target instanceof Node && !ui.settingsPanel.hidden && !ui.settingsPanel.contains(e.target) && !ui.settingsButton.contains(e.target)) {
      ui.settingsPanel.hidden = true; ui.settingsButton.setAttribute("aria-expanded", "false");
    }
  });
  on(document, "keydown", e => {
    if (e.key !== "Escape") return;
    if (["charging", "coin"].includes(state.phase)) { cancelCoin(); return; }
    if (!ui.settingsPanel.hidden) { ui.settingsPanel.hidden = true; ui.settingsButton.setAttribute("aria-expanded", "false"); ui.settingsButton.focus(); }
  });
  ui.soundToggle.checked = state.sound;
  on(ui.soundToggle, "change", () => { state.sound = ui.soundToggle.checked; preferences.write("sound", state.sound); if (state.master) state.master.gain.value = state.sound ? state.volume / 100 * .18 : 0; if (state.sound) sound("click"); });
  ui.volume.value = String(state.volume);
  on(ui.volume, "input", () => { state.volume = Number(ui.volume.value); preferences.write("volume", state.volume); if (state.master) state.master.gain.value = state.sound ? state.volume / 100 * .18 : 0; });
  ui.collectionCount.textContent = String(state.tickets.length);
  on(ui.collectionButton, "click", () => {
    ui.settingsPanel.hidden = true; ui.settingsButton.setAttribute("aria-expanded", "false"); ui.collectionList.replaceChildren();
    if (!state.tickets.length) { const p = document.createElement("p"); p.textContent = "まだ引換券はありません。"; p.style.fontSize = "13px"; ui.collectionList.appendChild(p); }
    for (const ticket of state.tickets) {
      const row = document.createElement("article"); row.className = "saved-ticket";
      const title = document.createElement("strong"), store = document.createElement("p"), expiry = document.createElement("p");
      title.textContent = ticket.title; store.textContent = ticket.store; expiry.textContent = "有効期限 " + ticket.expiry;
      row.append(title, store, expiry); ui.collectionList.appendChild(row);
    }
    ui.collectionDialog.showModal();
  });
  on(ui.closeCollectionButton, "click", () => ui.collectionDialog.close());
  on(ui.collectionDialog, "close", () => ui.settingsButton.focus({ preventScroll: true }));
  if (new URLSearchParams(location.search).get("debug") === "1") ui.debugPanel.hidden = false;
  on(ui.resetButton, "click", () => {
    ++state.run; state.request?.abort(); pile.stopMix(); hideReveal(); hideCoin();
    ui.resultDialog.close(); ui.machine.classList.remove("cranking");
    state.points = 120; state.refundDue = false; state.tickets = []; saveTickets(); ui.collectionCount.textContent = "0";
    points(0); setTurn(0); phase("idle"); say(""); pile.refill(refillColor);
  });
  on(window, "resize", () => {
    if (["charging","coin"].includes(state.phase)) {
      if (state.coinPointer) { try { ui.coinToken.releasePointerCapture(state.coinPointer.id); } catch {} }
      state.coinPointer = null; state.keyboardPull = false;
      ui.coinToken.classList.remove("dragging"); document.body.classList.remove("dragging");
      const p = coinCenter(); coinPosition(p.x,p.y); buildCoinEdge();
      if (state.phase === "charging") buildCoinEnergy();
      if (state.phase === "coin") { layoutCoinGuide(); aimCoin(false); }
    }
    if (state.phase === "reveal") { const p = coinCenter(); setHero(p.x,p.y,Math.min(190,innerWidth*.4),360); }
  });

  points(0); phase("idle"); setTurn(0);

  return () => {
    if (disposed) return;
    disposed = true;
    ++state.run;
    lifetime.abort();
    state.request?.abort();
    if (state.coinPointer) { try { ui.coinToken.releasePointerCapture(state.coinPointer.id); } catch {} }
    cancelAnimationFrame(autoTurnFrame);
    clearTimeout(toastTimer);
    hideReveal();
    hideCoin();
    pile.destroy();
    ui.coinEnergy.replaceChildren();
    ui.coinEdge.replaceChildren();
    ui.resultDialog.close();
    ui.collectionDialog.close();
    ui.settingsPanel.hidden = true;
    ui.settingsButton.setAttribute("aria-expanded", "false");
    ui.toast.hidden = true;
    ui.machine.classList.remove("cranking");
    balance.classList.remove("spent");
    ui.coinGesture.getAnimations({subtree:true}).forEach(animation => animation.cancel());
    document.body.dataset.phase = "idle";
    document.body.classList.remove("dragging");
    document.body.style.overflow = "";
    say("");
    if (state.audioContext && state.audioContext.state !== "closed") void state.audioContext.close().catch(() => {});
  };
}

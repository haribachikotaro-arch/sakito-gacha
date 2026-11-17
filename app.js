(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const TURN_DEGREES = 360;
  const ui = Object.fromEntries([
    "pointsValue", "settingsButton", "settingsPanel", "soundToggle", "volume",
    "collectionButton", "collectionCount", "collectionDialog", "collectionList", "closeCollectionButton",
    "debugPanel", "demoMode", "resetButton", "machine", "glassCase", "capsuleCanvas", "coinSlot",
    "handle", "turnProgress", "outlet", "coinButton", "coinButtonLabel", "statusText", "cancelCoinButton",
    "coinToken", "coinGold", "coinSolid", "coinEdge", "coinStage", "coinEnergy", "coinGesture", "pullArrow", "pullArrowShape", "gestureLabel", "coinSpotlight", "revealLayer", "heroCapsule", "revealName", "revealWord", "skipButton",
    "resultDialog", "resultTicket", "resultTitle", "resultKind", "resultStore", "resultExpiry", "revealedTicket", "scene",
    "againButton", "closeResultButton", "toast", "liveRegion"
  ].map(id => [id, $(id)]));
  const preferences = {
    read(key, fallback) { try { return JSON.parse(localStorage.getItem("sakito-v3-" + key)) ?? fallback; } catch { return fallback; } },
    write(key, value) { try { localStorage.setItem("sakito-v3-" + key, JSON.stringify(value)); } catch { } },
    remove(key) { try { localStorage.removeItem("sakito-v3-" + key); } catch { } }
  };
  const savedTickets = preferences.read("tickets", preferences.read("account", {})?.tickets ?? []);
  const state = {
    phase: "idle", points: 120, tickets: savedTickets,
    sound: preferences.read("sound", true), volume: preferences.read("volume", 40),
    progress: 0, pointer: null, coinPointer: null, run: 0, result: null, skip: false,
    refundDue: false, audioContext: null, master: null, animations: new Set(), request: null,
    returnFocus: null, lastTick: 0, coinX: 0, coinY: 0, claimed: false,
    keyboardPull: false, autoTurning: false, coinPullDistance: 100
  };
  if (!Array.isArray(state.tickets)) state.tickets = [];
  state.tickets = state.tickets.filter(ticket => ticket && typeof ticket.title === "string")
    .map(({ type, color, title, store, expiry, obtained }) => ({ type, color, title, store, expiry, obtained }));
  function saveTickets() { preferences.write("tickets", state.tickets); }
  saveTickets();
  // Points are session-only; every reload starts at 120 pt.
  preferences.remove("account");
  preferences.remove("points");
  preferences.remove("motion");
  const pile = new window.CapsulePile(ui.capsuleCanvas);
  const palette = { blue: "#6194b5", orange: "#d28b45", gold: "#e2b653", green: "#639263", red: "#bd6953", purple: "#9680ac" };
  const templates = {
    gold: { type: "gold", color: "gold", title: "KITランチ引換券", store: "ラテラ" },
    normal: { type: "normal", color: "blue", title: "ドリンク券", store: "KITカフェテリア" },
    none: { type: "none", color: "orange", title: "次回ポイント", store: "+5 pt" }
  };
  let toastTimer;
  function toast(text) {
    clearTimeout(toastTimer); ui.toast.textContent = text; ui.toast.hidden = false;
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 2600);
  }
  function say(text) { ui.statusText.textContent = text || "\u00a0"; }
  function phase(value) {
    state.phase = value; document.body.dataset.phase = value;
    ui.handle.disabled = !["ready", "turning"].includes(value);
    ui.coinButton.disabled = !["idle", "error"].includes(value);
    ui.coinButton.hidden = !["idle", "error"].includes(value);
    ui.cancelCoinButton.hidden = !["charging", "coin"].includes(value);
    ui.coinSlot.disabled = value !== "coin";
    ui.settingsButton.disabled = ["charging", "prethrow", "throwing", "turning", "drawing", "ejecting", "reveal"].includes(value);
  }
  function points(change) {
    state.points = Math.max(0, state.points + change);
    ui.pointsValue.textContent = state.points;
    ui.pointsValue.parentElement.classList.remove("spent");
    if (change) { void ui.pointsValue.offsetWidth; ui.pointsValue.parentElement.classList.add("spent"); }
  }
  function vibrate(value) { if (navigator.vibrate) navigator.vibrate(value); }
  function audio() {
    if (!state.sound) return null;
    try {
      if (!state.audioContext) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return null;
        state.audioContext = new Audio(); state.master = state.audioContext.createGain();
        state.master.connect(state.audioContext.destination);
      }
      state.master.gain.value = state.volume / 100 * .12;
      if (state.audioContext.state === "suspended") state.audioContext.resume().catch(() => { });
      return state.audioContext;
    } catch { return null; }
  }
  function tone(freq, duration = .1, offset = 0, type = "triangle", power = .45) {
    const ctx = audio(); if (!ctx) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + offset;
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(power, t + .008);
    gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(state.master); osc.start(t); osc.stop(t + duration + .03);
  }
  function sound(name) {
    if (name === "coin") { tone(940, .17); tone(1480, .13, .07); tone(350, .09, .18, "square", .2); }
    if (name === "click") tone(175, .05, 0, "square", .2);
    if (name === "motor") { tone(85, .42, 0, "sawtooth", .12); tone(120, .5, .15, "triangle", .15); }
    if (name === "roll") { tone(180, .11, 0, "square", .12); tone(130, .13, .13, "triangle", .2); tone(90, .18, .26, "sine", .4); }
    if (name === "impact") { tone(80, .18, 0, "sine", .8); tone(400, .1, 0, "triangle", .2); }
    if (name === "open") { tone(500, .15); tone(750, .27, .1); tone(1000, .35, .22); }
    if (name === "rare") { [0, 4, 7, 12].forEach((n, i) => tone(523 * Math.pow(2, n / 12), .45, i * .11, "sine", .45)); }
  }
  const cancelled = () => new DOMException("Sequence cancelled", "AbortError");
  function check(run) { if (run !== state.run) throw cancelled(); }
  async function wait(ms, run) {
    await new Promise(resolve => setTimeout(resolve, state.skip ? Math.min(40, ms) : ms)); check(run);
  }
  async function animate(el, frames, ms, run, easing = "cubic-bezier(.2,.8,.3,1)") {
    check(run);
    const getFrames = typeof frames === "function" ? frames : () => frames;
    const animation = el.animate(getFrames(), {duration:state.skip ? 1 : ms,easing,fill:"forwards"});
    const reframe = () => { if (animation.playState !== "finished") animation.effect.setKeyframes(getFrames()); };
    if (typeof frames === "function") addEventListener("resize",reframe);
    state.animations.add(animation);
    try {
      await animation.finished; check(run);
      const final = getFrames().at(-1);
      for (const [key,value] of Object.entries(final)) if (!["offset","easing","composite"].includes(key)) el.style[key] = value;
    } catch (error) { if (run !== state.run) throw cancelled(); }
    finally { removeEventListener("resize",reframe); animation.cancel(); state.animations.delete(animation); }
  }
  function setTurn(progress) {
    const before = state.progress;
    state.progress = Math.max(0, Math.min(TURN_DEGREES, Math.round(progress * 1000) / 1000));
    ui.handle.style.setProperty("--rotation", state.progress + 90 + "deg");
    ui.handle.parentElement.style.setProperty("--crank-angle", state.progress - 18 + "deg");
    ui.turnProgress.style.strokeDashoffset = 1 - state.progress / TURN_DEGREES;
    if (["ready", "turning"].includes(state.phase) && Math.abs(state.progress - before) > .001) pile.turnBy(state.progress - before);
    ui.handle.setAttribute("aria-label", "中央のレバーを1回転すると抽選が始まります。Enterでも回せます。");
  }
  function coinCenter() {
    // Fixed layers and the normal layout share the usable width, excluding scrollbars.
    const viewport = ui.coinStage.getBoundingClientRect();
    return { x: viewport.left + viewport.width / 2, y: viewport.top + viewport.height / 2 };
  }
  function coinTransform(scale = 1, turn = 0, tilt = 0, pitch = 0) {
    return "translate(-50%,-50%) perspective(900px) rotateX(" + pitch + "deg) rotateY(" + turn + "deg) rotateZ(" + tilt + "deg) scale(" + scale + ")";
  }
  function buildCoinEdge() {
    const radius = ui.coinToken.offsetWidth / 2, facets = 64;
    ui.coinEdge.replaceChildren();
    for (let i = 0; i < facets; i++) {
      const angle = i / facets * Math.PI * 2, edge = document.createElement("i");
      Object.assign(edge.style, {
        left: radius + Math.cos(angle) * (radius - 1) + "px",
        top: radius + Math.sin(angle) * (radius - 1) + "px",
        width: 2 * Math.PI * radius / facets + .6 + "px",
        transform: "translate(-50%,-50%) rotateZ(" + (i / facets * 360 + 90) + "deg) rotateX(90deg)"
      });
      ui.coinEdge.append(edge);
    }
  }
  function buildCoinEnergy() {
    ui.coinEnergy.replaceChildren();
    const trails = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const bounds = ui.coinStage.getBoundingClientRect();
    trails.setAttribute("viewBox", "0 0 " + bounds.width + " " + bounds.height);
    trails.setAttribute("width", "100%"); trails.setAttribute("height", "100%");
    ui.coinEnergy.append(trails);
    const center = coinCenter(), c = {x:center.x-bounds.left,y:center.y-bounds.top};
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2, distance = Math.hypot(innerWidth, innerHeight) * (.42 + i % 4 * .06);
      const x = c.x + Math.cos(a) * distance, y = c.y + Math.sin(a) * distance;
      const bend = (i % 2 ? 1 : -1) * Math.min(100, distance * .15);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M" + x + " " + y + " Q" + ((x + c.x) / 2 - Math.sin(a) * bend) + " " + ((y + c.y) / 2 + Math.cos(a) * bend) + " " + c.x + " " + c.y);
      path.setAttribute("pathLength", "1"); path.setAttribute("stroke-width", i % 4 === 0 ? "4" : "2");
      path.style.setProperty("--duration", (640 + i % 5 * 100) + "ms");
      path.style.setProperty("--delay", (-i * 83) + "ms"); trails.append(path);
    }
  }
  function coinPosition(x, y, scale = 1, tilt = 0) {
    state.coinX = x; state.coinY = y;
    Object.assign(ui.coinToken.style, { left: x + "px", top: y + "px", transform: coinTransform(scale, 0, tilt) });
  }
  function slotPoint() {
    const r = ui.coinSlot.querySelector(".slot-slit").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * .55, width: r.width, height: r.height };
  }
  function goldMask(level, wave) {
    const edge = [];
    for (let x = 0; x <= 100; x += 10) {
      const ripple = Math.sin(x / 18 + wave) * 2.4;
      edge.push(x + "% " + Math.max(0, Math.min(100, 100 - level + ripple)) + "%");
    }
    return "polygon(" + edge.join(",") + ",100% 100%,0% 100%)";
  }
  function slideBanner() {
    ui.gestureLabel.animate([{transform:"translateX(-105%)"},{transform:"translateX(0)"}], {duration:300,easing:"cubic-bezier(.2,.8,.2,1)"});
  }
  function aimCoin(armed) {
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
  function layoutPullArrow(armed) {
    const center = coinCenter(), radius = ui.coinToken.offsetWidth / 2;
    const bottom = ui.coinToken.getBoundingClientRect().top - 6;
    const length = armed ? Math.max(32,bottom-center.y) : Math.max(20,state.coinPullDistance-4);
    const top = armed ? bottom-length : center.y+radius+4;
    ui.pullArrow.setAttribute("viewBox","0 0 64 "+length);
    Object.assign(ui.pullArrow.style,{height:length+"px",left:center.x-32+"px",top:top+"px"});
    ui.pullArrow.dataset.distance = state.coinPullDistance;
    const shoulder = Math.max(4,length-30);
    ui.pullArrowShape.setAttribute("d","M22 2 H42 V"+shoulder+" H60 L32 "+(length-2)+" L4 "+shoulder+" H22 Z");
  }
  function hideCoin() {
    ui.coinToken.hidden = true; ui.coinEnergy.hidden = true; ui.coinGesture.hidden = true;
    ui.coinToken.classList.remove("dragging", "is-charged", "charge-flash");
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
    ui.coinGold.style.clipPath = goldMask(0, 0);
    const p = coinCenter(); coinPosition(p.x, p.y);
    ui.coinToken.hidden = false; buildCoinEdge(); buildCoinEnergy();
    ui.coinEnergy.hidden = false; ui.coinGesture.hidden = true;
    say(""); sound("click");
    await animate(ui.coinToken, [
      { opacity: 0, transform: coinTransform(.8, -300) },
      { opacity: 1, transform: coinTransform(1, 0) }
    ], 500, run);
    const filling = Array.from({ length: 21 }, (_, n) => ({
      clipPath: goldMask(n * 5, n * .85), offset: n / 20
    }));
    await animate(ui.coinGold, filling, 1550, run, "linear");
    ui.coinGold.style.clipPath = "inset(0% 0 0)";
    ui.coinEnergy.hidden = true; ui.coinToken.classList.add("is-charged", "charge-flash");
    tone(760, .16); tone(1140, .18, .09);
    await wait(260, run);
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
    const run = state.run, p = slotPoint(), fromX = state.coinX, fromY = state.coinY;
    const captured = state.coinPointer;
    state.coinPointer = null; state.keyboardPull = false;
    if (captured) { try { ui.coinToken.releasePointerCapture(captured.id); } catch {} }
    ui.coinToken.disabled = true; ui.coinToken.classList.remove("dragging", "charge-flash");
    ui.coinGesture.hidden = true; document.body.classList.remove("dragging");
    document.body.style.overflow = "hidden";
    // Changing phase synchronously latches this launch before pointerup/keyup can repeat it.
    phase("throwing"); say("");
    tone(300, .18, 0, "sine", .16); vibrate(12);
    try {
      const entryScale = () => Math.min(.26,p.width * .9 / ui.coinToken.offsetWidth);
      const flightFrames = () => {
        Object.assign(p,slotPoint());
        const scale = entryScale(), apex = Math.max(38,Math.min(82,p.y-170)), flight = [];
        for (let i=0;i<=48;i++) {
          const t=i/48, up=t<.56, u=up?t/.56:(t-.56)/.44;
          const y=up?apex+(fromY-apex)*(1-u)**2:apex+(p.y-17-apex)*u**2;
          const x=fromX+(p.x-fromX)*t+Math.sin(Math.PI*t)*Math.min(36,innerWidth*.05);
          const turn=t<.8?720*t/.8:720;
          const pitch=t<.8?18*Math.sin(t*Math.PI*3):(t-.8)/.2*68;
          flight.push({left:x+"px",top:y+"px",opacity:1,transform:coinTransform(1-(1-scale)*t,turn,-18*Math.sin(Math.PI*t),pitch),offset:t});
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
          {left:p.x+"px",top:(p.y-17)+"px",transform:coinTransform(scale,turn,0,68)},
          {left:p.x+"px",top:(p.y+22)+"px",transform:coinTransform(scale,turn,0,78)}
        ];
      },190,run,"cubic-bezier(.35,0,.8,.5)");
      sound("coin"); vibrate([12,25,18]);
      hideCoin(); state.refundDue = true; points(-10);
      phase("ready"); setTurn(0); say("回せ！");
      ui.handle.focus({preventScroll:true});
    } catch (error) { if (error.name !== "AbortError") console.error(error); }
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
  ui.coinToken.addEventListener("pointerdown", e => {
    if (state.phase !== "coin" || ui.coinToken.disabled || !e.isPrimary) return;
    e.preventDefault(); state.keyboardPull = false;
    state.coinPointer = {
      id: e.pointerId, startX: e.clientX, startY: e.clientY,
      originX: state.coinX, originY: state.coinY,
      armed: false, maxDy: 0
    };
    ui.coinToken.setPointerCapture(e.pointerId); ui.coinToken.classList.add("dragging");
    document.body.classList.add("dragging");
  });
  ui.coinToken.addEventListener("pointermove", e => {
    const pointer = state.coinPointer;
    if (!pointer || pointer.id !== e.pointerId) return;
    e.preventDefault();
    const dx = Math.max(-55, Math.min(55, e.clientX - pointer.startX));
    const rawDy = e.clientY - pointer.startY;
    const dy = Math.max(0, Math.min(state.coinPullDistance, rawDy));
    pointer.maxDy = Math.max(pointer.maxDy, rawDy);
    if (!pointer.armed && rawDy >= state.coinPullDistance - 2) {
      pointer.armed = true; vibrate(14); tone(260,.09,0,"triangle",.25); ui.liveRegion.textContent = "はなせ！";
    }
    coinPosition(pointer.originX + dx * .4, pointer.originY + dy, 1, dx * .08 - dy / state.coinPullDistance * 6);
    aimCoin(pointer.armed);
    if (pointer.armed && pointer.maxDy - rawDy >= 10) throwCoin().catch(() => {});

  });
  async function returnCoin(run) {
    ui.coinToken.disabled = true;
    const p = coinCenter();
    aimCoin(false);
    await animate(ui.coinToken, [
      { left: state.coinX + "px", top: state.coinY + "px", transform: ui.coinToken.style.transform },
      { left: p.x + "px", top: p.y + "px", transform: coinTransform(1) }
    ], 320, run);
    if (state.phase === "coin") { const center = coinCenter(); coinPosition(center.x,center.y); ui.coinToken.disabled = false; }
  }
  async function releaseCoin(e, interrupted = false) {
    const pointer = state.coinPointer;
    if (!pointer || pointer.id !== e.pointerId) return;
    e.preventDefault();
    state.coinPointer = null; ui.coinToken.classList.remove("dragging"); document.body.classList.remove("dragging");
    try { ui.coinToken.releasePointerCapture(e.pointerId); } catch {}
    if (!interrupted && pointer.armed) {
      await throwCoin();
    } else {
      await returnCoin(state.run);
    }
  }
  ui.coinToken.addEventListener("pointerup", e => releaseCoin(e).catch(() => {}));
  ui.coinToken.addEventListener("pointercancel", e => releaseCoin(e, true).catch(() => {}));
  ui.coinToken.addEventListener("keydown", e => {
    if (state.phase !== "coin" || ui.coinToken.disabled) return;
    if (["Enter", " "].includes(e.key)) { e.preventDefault(); assistedThrow().catch(() => {}); }
    if (e.key === "ArrowDown") {
      e.preventDefault(); state.keyboardPull = true;
      const p = coinCenter(); coinPosition(p.x, p.y + state.coinPullDistance, 1, -6); aimCoin(true);
    }
  });
  ui.coinToken.addEventListener("keyup", e => {
    if (e.key === "ArrowDown" && state.phase === "coin" && state.keyboardPull) { e.preventDefault(); throwCoin().catch(() => {}); }
  });
  ui.coinSlot.addEventListener("click", e => {
    if (e.detail === 0) assistedThrow().catch(() => {});
  });
  ui.cancelCoinButton.addEventListener("click", cancelCoin);
  ui.coinButton.addEventListener("click", () => spawnCoin().catch(() => {}));
  function handleAngle(e) {
    const r = ui.handle.getBoundingClientRect();
    const cx = state.pointer?.centerX ?? r.left + r.width / 2;
    const cy = state.pointer?.centerY ?? r.top + r.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
  }
  function tickCrank() {
    if (performance.now() - state.lastTick > 85) {
      state.lastTick = performance.now(); sound("click"); vibrate(7);
      ui.machine.classList.remove("cranking"); void ui.machine.offsetWidth; ui.machine.classList.add("cranking");
    }
  }
  ui.handle.parentElement.addEventListener("pointerdown", e => {
    if (state.phase !== "ready" || state.autoTurning || !e.isPrimary) return;
    e.preventDefault();
    const rect = ui.handle.getBoundingClientRect();
    state.pointer = { id: e.pointerId, centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2, angle: 0 };
    state.pointer.angle = handleAngle(e);
    ui.handle.setPointerCapture(e.pointerId); phase("turning"); document.body.classList.add("dragging");
  });
  ui.handle.parentElement.addEventListener("pointermove", e => {
    if (state.phase !== "turning" || state.pointer?.id !== e.pointerId) return;
    e.preventDefault();
    let delta = handleAngle(e) - state.pointer.angle;
    if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
    state.pointer.angle = handleAngle(e);
    if (Math.abs(delta) > 100) return;
    setTurn(Math.min(TURN_DEGREES, state.progress + delta)); if (Math.abs(delta) > 1) tickCrank();
    if (state.progress >= TURN_DEGREES) finishTurn();
  });
  function releaseHandle(e) {
    if (state.pointer?.id !== e.pointerId) return;
    state.pointer = null; document.body.classList.remove("dragging");
    try { ui.handle.releasePointerCapture(e.pointerId); } catch {}
    pile.stopMix();
    if (state.phase === "turning") { phase("ready"); say("回せ！"); }
  }
  ui.handle.parentElement.addEventListener("pointerup", releaseHandle);
  ui.handle.parentElement.addEventListener("pointercancel", releaseHandle);
  async function autoTurn() {
    if (!["ready", "turning"].includes(state.phase) || state.autoTurning || state.pointer) return;
    state.autoTurning = true;
    phase("turning"); const from = state.progress, run = state.run, start = performance.now();
    const duration = Math.max(700, 1400 * (TURN_DEGREES - from) / TURN_DEGREES);
    await new Promise(resolve => {
      function frame(now) {
        if (run !== state.run) { resolve(); return; }
        const p = Math.min(1, (now - start) / duration);
        const eased = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        setTurn(from + (TURN_DEGREES - from) * eased); tickCrank();
        if (p < 1) requestAnimationFrame(frame); else resolve();
      } requestAnimationFrame(frame);
    });
    state.autoTurning = false;
    if (run === state.run) finishTurn();
  }
  ui.handle.addEventListener("click", e => { if (e.detail === 0) autoTurn(); });
  ui.handle.addEventListener("keydown", e => {
    if (!["ready", "turning"].includes(state.phase)) return;
    if (state.autoTurning) { if (["Enter", " ", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Home", "End"].includes(e.key)) e.preventDefault(); return; }
    if (["Enter", " "].includes(e.key)) { e.preventDefault(); autoTurn(); return; }
    if (["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "End") { autoTurn(); return; }
      setTurn(e.key === "Home" ? 0 : Math.min(TURN_DEGREES, state.progress + (["ArrowRight", "ArrowUp"].includes(e.key) ? 24 : -24)));
      tickCrank(); if (state.progress >= TURN_DEGREES) finishTurn();
    }
  });
  function normalizeResult(value) {
    if (!value || !["gold", "normal", "none"].includes(value.type)) throw new Error("Invalid draw result");
    const base = templates[value.type];
    const expiry = new Date(); expiry.setDate(expiry.getDate() + 30);
    return {
      ...base, color: palette[value.color] ? value.color : base.color,
      title: typeof value.title === "string" ? value.title : base.title,
      store: typeof value.store === "string" ? value.store : base.store,
      expiry: value.expiry || expiry.toLocaleDateString("ja-JP")
    };
  }
  async function requestResult(run) {
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
    if (type === "random") { const roll = Math.random(); type = roll < .10 ? "gold" : roll < .82 ? "normal" : "none"; }
    return normalizeResult({ type });
  }
  function finishTurn() {
    if (!["ready", "turning"].includes(state.phase)) return;
    state.pointer = null; document.body.classList.remove("dragging"); setTurn(TURN_DEGREES);
    draw().catch(error => { if (error.name !== "AbortError") console.error(error); });
  }
  async function draw() {
    const run = ++state.run; state.skip = false; phase("drawing"); say(" "); pile.stopMix(); sound("motor");
    try {
      const [result] = await Promise.all([requestResult(run), wait(1350, run)]);
      state.result = result; pile.stopMix(); ui.machine.classList.remove("rumbling"); say("");
      await wait(400, run);
      // The selected ball passes behind the cabinet. It is never drawn above the body.
      pile.take();
      await wait(360, run);
      await ejectAndReveal(result, run);
    } catch (error) {
      if (run !== state.run) return;
      pile.stopMix(); ui.machine.classList.remove("rumbling"); hideReveal();
      if (state.refundDue) { state.refundDue = false; points(10); }
      phase("error"); say("つながりませんでした。もう一度"); toast("10 ptを戻しました");
    }
  }
  function setHero(x, y, size, rotation = 0) {
    Object.assign(ui.heroCapsule.style, { left: x + "px", top: y + "px", width: size + "px", height: size + "px", transform: "translate(-50%,-50%) rotate(" + rotation + "deg)" });
  }
  async function trembleCapsule(strength, duration, run, rotation = 360) {
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
  async function anticipateOpening(run) {
    await wait(150, run);
    for (const [strength, duration, pause] of [[2, 200, 180], [4, 260, 130], [7, 320, 100]]) {
      if (state.skip) break;
      sound("click"); vibrate(8);
      await trembleCapsule(strength, duration, run);
      await wait(pause, run);
    }
    check(run);
  }
  function hideReveal() {
    state.animations.forEach(a => a.cancel()); state.animations.clear();
    ui.revealLayer.hidden = true; ui.revealLayer.classList.remove("focused");
    ui.revealLayer.style.clipPath = ""; ui.heroCapsule.style.clipPath = ""; ui.heroCapsule.style.filter = "";
    ui.scene.removeAttribute("aria-busy");
    ui.revealLayer.setAttribute("aria-hidden", "true"); ui.heroCapsule.classList.remove("split");
    ui.revealWord.classList.remove("visible"); ui.outlet.classList.remove("is-open");
    document.body.style.overflow = "";
    ui.machine.closest(".scene").inert = false;
  }
  async function ejectAndReveal(result, run) {
    phase("ejecting");
    document.body.style.overflow = "hidden";
    ui.scene.inert = true;
    const frame = ui.outlet.closest(".outlet-frame");
    const trayElement = frame?.querySelector(".outlet-tray");
    const plinthElement = ui.machine.querySelector(".machine-plinth");
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
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
      const edgeX = clamp(tray.right + r * .16, safeLeft, safeRight);
      const stepX = clamp(edgeX + size * .2, safeLeft, safeRight);
      const impactX = clamp(stepX + Math.min(size * .62, machine.width * .06), safeLeft, safeRight);
      const stopX = clamp(Math.min(impactX, machine.left + machine.width * .41), safeLeft, safeRight);
      return {
        hole, tray, machine, size, r, floor, edgeX, stepX, impactX, stopX,
        trayFloor: tray.top + Math.min(2, tray.height * .16), safeLeft, safeRight
      };
    };
    const pose = (x, y, size, rotation, extra = {}) => ({
      left: x + "px", top: y + "px", width: size + "px", height: size + "px", opacity: 1,
      transform: "translate(-50%,-50%) rotate(" + rotation + "deg)", ...extra
    });
    const maskOpening = g => {
      const cut = n => Math.round(n * 10) / 10;
      const front = g.tray.top + g.tray.height * .42;
      ui.revealLayer.style.clipPath = 'path("M ' + cut(g.hole.left + 1) + ' ' + cut(g.hole.top + g.hole.height * .18) +
        ' H ' + cut(g.hole.right - 1) + ' V ' + cut(g.hole.bottom - 1) + ' H ' + cut(g.hole.left + 1) +
        ' Z M 0 ' + cut(front) + ' H ' + innerWidth + ' V ' + innerHeight + ' H 0 Z")';
    };

    // Points are functions of live geometry; animate() can rebuild the complete path on resize.
    let point = g => ({ x: g.hole.left + g.hole.width * .38, y: g.hole.top + g.hole.height * .46 });
    let rotation = -28;
    // y(t) = y0 + dy*t - A*t*(1-t) is a parabola. This A gives the requested
    // rise above the starting position even when the landing position is lower.
    const parabola = (dy, rise) => dy + 2 * rise + 2 * Math.sqrt(Math.max(0, rise * (rise + dy)));
    async function moveTo(nextPoint, options = {}) {
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
    sound("roll"); vibrate([15, 35, 12]);
    await wait(200, run);
    // 1. Only the outlet's dark opening can reveal the ball while it is inside.
    await moveTo(g => ({ x: g.hole.left + g.hole.width * .38, y: g.hole.bottom - g.r - 2 }),
      { duration: 300, fromScale: .58, dark: true, mask: true, easing: "cubic-bezier(.35,0,.7,1)" });
    ui.revealLayer.style.clipPath = "none";

    // 2. One small hop clears the front lip, then the ball rolls along the tray.
    await moveTo(g => ({ x: Math.min(g.tray.right - g.r, g.hole.left + g.hole.width * .38 + g.tray.width * .16), y: g.trayFloor - g.r }),
      { duration: 270, ballistic: true, rise: g => Math.min(8, g.size * .2) });
    sound("click"); vibrate(7);
    await moveTo(g => ({ x: g.edgeX, y: g.trayFloor - g.r }),
      { duration: 390, easing: "cubic-bezier(.3,.2,.65,1)" });

    // 3. The rounded edge provides a second, lower contact. It gives a small
    // outward kick before gravity carries the ball down to the floor by the plinth.
    await moveTo(g => ({ x: g.stepX, y: Math.min(g.floor, g.tray.bottom - g.r * .05) }),
      { ballistic: true });
    sound("click"); vibrate(5);
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
    // This equivalent angle prevents a long reverse spin before the 360-degree resting pose.
    g = geometry(); p = restingPoint(g); setHero(p.x, p.y, g.size, restingRotation);
    await animate(ui.heroCapsule, () => {
      const g = geometry(), p = restingPoint(g), target = coinCenter(), large = Math.min(190, innerWidth * .4);
      return [
        pose(p.x, p.y, g.size, restingRotation),
        pose(target.x + 8, target.y - 18, large * 1.08, 360, { offset: .78 }),
        pose(target.x, target.y, large, 360)
      ];
    }, 650, run);
    sound("impact"); vibrate(result.type === "gold" ? [22, 35, 22] : 22);
    await anticipateOpening(run);
    ui.revealName.textContent = result.type === "none" ? "+5 pt" : result.title;
    ui.revealedTicket?.classList.toggle("gold", result.type === "gold");
    ui.revealWord.textContent = result.type === "gold" ? "大当たり！" : result.type === "none" ? "次の一回へ" : "引換券を獲得";
    ui.heroCapsule.classList.add("split"); ui.revealWord.classList.add("visible");
    sound(result.type === "gold" ? "rare" : "open"); vibrate([14, 25, 14]);
    ui.liveRegion.textContent = result.title;
    await wait(1250, run);
    showResult(result);
  }
  function saveResult(result) {
    state.refundDue = false;
    if (result.type === "none") { points(5); state.claimed = true; }
    else {
      state.tickets.unshift({ ...result, obtained: new Date().toISOString() });
      state.tickets = state.tickets.slice(0, 100); saveTickets();
      ui.collectionCount.textContent = state.tickets.length;
    }
  }
  function showResult(result) {
    if (state.phase === "result") return;
    saveResult(result); hideReveal(); phase("result");
    ui.resultTitle.textContent = result.type === "none" ? "+5 pt" : result.title;
    ui.resultKind.textContent = result.type === "gold" ? "当たり" : result.type === "none" ? "参加賞" : "引換券";
    ui.resultStore.textContent = result.type === "none" ? "ポイントに加算しました" : result.store;
    ui.resultExpiry.textContent = result.type === "none" ? "次のガチャに使えます" : "有効期限 " + result.expiry;
    ui.resultTicket.classList.toggle("gold", result.type === "gold");
    state.returnFocus = ui.coinButton;
    ui.resultDialog.showModal();
  }
  function finishResult() {
    if (state.phase !== "result") return;
    ui.resultDialog.close(); state.result = null; state.skip = false; phase("idle"); setTurn(0); pile.refill(); say("");
    ui.coinButton.focus({ preventScroll: true });
  }
  ui.closeResultButton.addEventListener("click", finishResult);
  ui.resultDialog.addEventListener("cancel", e => { e.preventDefault(); finishResult(); });
  ui.againButton.addEventListener("click", () => { finishResult(); spawnCoin().catch(() => { }); });
  ui.skipButton.addEventListener("click", () => { state.skip = true; state.animations.forEach(a => { try { a.finish(); } catch { } }); });
  ui.settingsButton.addEventListener("click", () => {
    const open = ui.settingsPanel.hidden; ui.settingsPanel.hidden = !open; ui.settingsButton.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("pointerdown", e => {
    if (!ui.settingsPanel.hidden && !ui.settingsPanel.contains(e.target) && !ui.settingsButton.contains(e.target)) {
      ui.settingsPanel.hidden = true; ui.settingsButton.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (["charging", "coin"].includes(state.phase)) { cancelCoin(); return; }
    if (!ui.settingsPanel.hidden) { ui.settingsPanel.hidden = true; ui.settingsButton.setAttribute("aria-expanded", "false"); ui.settingsButton.focus(); }
  });
  ui.soundToggle.checked = state.sound;
  ui.soundToggle.addEventListener("change", () => { state.sound = ui.soundToggle.checked; preferences.write("sound", state.sound); if (state.master) state.master.gain.value = state.sound ? state.volume / 100 * .12 : 0; if (state.sound) sound("click"); });
  ui.volume.value = state.volume;
  ui.volume.addEventListener("input", () => { state.volume = Number(ui.volume.value); preferences.write("volume", state.volume); if (state.master) state.master.gain.value = state.sound ? state.volume / 100 * .12 : 0; });
  ui.collectionCount.textContent = state.tickets.length;
  ui.collectionButton.addEventListener("click", () => {
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
  ui.closeCollectionButton.addEventListener("click", () => ui.collectionDialog.close());
  ui.collectionDialog.addEventListener("close", () => ui.settingsButton.focus({ preventScroll: true }));
  if (new URLSearchParams(location.search).get("debug") === "1") ui.debugPanel.hidden = false;
  ui.resetButton.addEventListener("click", () => {
    ++state.run; state.request?.abort(); pile.stopMix(); hideReveal(); hideCoin();
    ui.resultDialog.close(); ui.machine.classList.remove("rumbling");
    state.points = 120; state.refundDue = false; state.tickets = []; saveTickets(); ui.collectionCount.textContent = "0";
    points(0); setTurn(0); phase("idle"); say(""); pile.refill();
  });
  addEventListener("resize", () => {
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
})();

type ElementConstructor<T extends Element> = { new (): T };

function element<T extends Element>(id: string, constructor: ElementConstructor<T>): T {
  const node = document.getElementById(id);
  if (!(node instanceof constructor)) throw new Error("Missing or invalid gacha element: " + id);
  return node;
}

export function getGachaElements() {
  return {
    pointsValue: element("pointsValue", HTMLElement),
    settingsButton: element("settingsButton", HTMLButtonElement),
    settingsPanel: element("settingsPanel", HTMLElement),
    soundToggle: element("soundToggle", HTMLInputElement),
    volume: element("volume", HTMLInputElement),
    collectionButton: element("collectionButton", HTMLButtonElement),
    collectionCount: element("collectionCount", HTMLElement),
    collectionDialog: element("collectionDialog", HTMLDialogElement),
    collectionList: element("collectionList", HTMLElement),
    closeCollectionButton: element("closeCollectionButton", HTMLButtonElement),
    debugPanel: element("debugPanel", HTMLElement),
    demoMode: element("demoMode", HTMLSelectElement),
    resetButton: element("resetButton", HTMLButtonElement),
    machine: element("machine", HTMLElement),
    glassCase: element("glassCase", HTMLElement),
    capsuleCanvas: element("capsuleCanvas", HTMLCanvasElement),
    coinSlot: element("coinSlot", HTMLButtonElement),
    handle: element("handle", HTMLButtonElement),
    turnProgress: element("turnProgress", SVGCircleElement),
    outlet: element("outlet", HTMLElement),
    coinButton: element("coinButton", HTMLButtonElement),
    coinButtonLabel: element("coinButtonLabel", HTMLElement),
    statusText: element("statusText", HTMLElement),
    cancelCoinButton: element("cancelCoinButton", HTMLButtonElement),
    coinToken: element("coinToken", HTMLButtonElement),
    coinGold: element("coinGold", HTMLElement),
    coinSolid: element("coinSolid", HTMLElement),
    coinEdge: element("coinEdge", HTMLElement),
    coinStage: element("coinStage", HTMLElement),
    coinEnergy: element("coinEnergy", HTMLElement),
    coinGesture: element("coinGesture", HTMLElement),
    pullArrow: element("pullArrow", SVGSVGElement),
    pullArrowShape: element("pullArrowShape", SVGPathElement),
    gestureLabel: element("gestureLabel", HTMLElement),
    coinSpotlight: element("coinSpotlight", HTMLElement),
    revealLayer: element("revealLayer", HTMLElement),
    heroCapsule: element("heroCapsule", HTMLElement),
    revealName: element("revealName", HTMLElement),
    revealWord: element("revealWord", HTMLElement),
    skipButton: element("skipButton", HTMLButtonElement),
    resultDialog: element("resultDialog", HTMLDialogElement),
    resultTicket: element("resultTicket", HTMLElement),
    resultTitle: element("resultTitle", HTMLElement),
    resultKind: element("resultKind", HTMLElement),
    resultStore: element("resultStore", HTMLElement),
    resultExpiry: element("resultExpiry", HTMLElement),
    revealedTicket: element("revealedTicket", HTMLElement),
    scene: element("scene", HTMLElement),
    againButton: element("againButton", HTMLButtonElement),
    closeResultButton: element("closeResultButton", HTMLButtonElement),
    toast: element("toast", HTMLElement),
    liveRegion: element("liveRegion", HTMLElement),
  };
}

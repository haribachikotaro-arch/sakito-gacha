"use client";

// @refresh reset

import { useEffect } from "react";
import { initializeGacha } from "@/lib/gacha/controller";

// Animation frames stay inside the controller; React renders the unchanged scene once.
export function GachaGame() {
  useEffect(() => initializeGacha(), []);

  return (
    <>
      <header className="header">
          <a className="wordmark" href="./" aria-label="SAKITO ガチャ">SAKITO<span>ガチャ</span></a>
          <div className="header-tools">
            <p className="balance" aria-label="所持ポイント"><strong id="pointsValue">120</strong><span>pt</span></p>
            <button className="icon-button" id="settingsButton" type="button" aria-label="設定" aria-controls="settingsPanel" aria-expanded="false">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 17h16" stroke="currentColor" strokeWidth="1.5"/><circle cx="9" cy="7" r="3" fill="var(--paper)" stroke="currentColor" strokeWidth="1.5"/><circle cx="15" cy="17" r="3" fill="var(--paper)" stroke="currentColor" strokeWidth="1.5"/></svg>
            </button>
          </div>
          <section className="settings-panel" id="settingsPanel" aria-label="設定" hidden>
            <label><span>効果音</span><input type="checkbox" id="soundToggle" role="switch" /></label>
            <label><span>音量</span><input type="range" id="volume" min="0" max="100" defaultValue="40" aria-label="音量" /></label>
            <button type="button" id="collectionButton">獲得した引換券 <span id="collectionCount">0</span></button>
            <div className="debug-controls" id="debugPanel" hidden>
              <label>抽選結果<select id="demoMode"><option value="random">ランダム</option><option value="gold">当たり</option><option value="normal">通常</option><option value="none">参加賞</option><option value="error">通信エラー</option></select></label>
              <button type="button" id="resetButton">データをリセット</button>
            </div>
          </section>
        </header>
      
        <main className="playground" aria-label="引換券ガチャ">
          <div className="scene" id="scene">
            <div className="ground" aria-hidden="true"></div>
            <div className="machine" id="machine" aria-label="角型ケースのガチャ本体">
              <div className="case-roof" aria-hidden="true"><span className="roof-name">SAKITO</span></div>
              <div className="glass-case" id="glassCase">
                <canvas id="capsuleCanvas" aria-label="ケースの底に積み重なったカプセル"></canvas>
                <div className="glass-shine" aria-hidden="true"></div>
                <div className="glass-foot" aria-hidden="true"></div>
              </div>
              <div className="case-collar" aria-hidden="true"></div>
              <div className="cabinet">
                <div className="cabinet-top" aria-hidden="true"></div>
                <i className="screw screw-left" aria-hidden="true"></i><i className="screw screw-right" aria-hidden="true"></i>
                <button type="button" className="coin-slot" id="coinSlot" aria-label="レバー上のコイン投入口。キーボードではEnterでコインを投げる">
                  <span className="slot-slit" aria-hidden="true"></span>
                </button>
                <div className="handle-mount">
                  <svg className="turn-guide" viewBox="0 0 140 140" aria-hidden="true">
                    <circle className="turn-track" cx="70" cy="70" r="65"/>
                    <circle className="turn-progress" id="turnProgress" cx="70" cy="70" r="65" pathLength="1"/>
                  </svg>
                  <button type="button" className="handle" id="handle" disabled aria-label="コイン投入後にレバーが自動で2回転します">
                    <span className="handle-dial" aria-hidden="true"><span className="handle-grip"></span><span className="handle-pin"></span></span>
                  </button>
                  <svg className="crank-arrow" viewBox="0 0 200 200" aria-hidden="true">
                    <defs>
                      <linearGradient id="crankBrass" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
                        <stop offset="0" stopColor="#a4824b"/><stop offset=".32" stopColor="#d8b777"/>
                        <stop offset=".52" stopColor="#fff0bf"/><stop offset=".72" stopColor="#d3ae69"/><stop offset="1" stopColor="#9b7841"/>
                      </linearGradient>
                    </defs>
                    <circle className="crank-hit-area" cx="100" cy="100" r="98"/>
                    <path className="crank-arrow-outline" d="M38 153 A82 82 0 1 1 180 82"/>
                    <path className="crank-arrow-color" d="M38 153 A82 82 0 1 1 180 82"/>
                    <path className="crank-arrow-head-outline" d="M167 85 L187 108 L194 79 Z"/>
                    <path className="crank-arrow-head" d="M167 85 L187 108 L194 79 Z"/>
                  </svg>
                </div>
                <div className="outlet-frame" aria-hidden="true">
                  <div className="outlet" id="outlet"><span className="outlet-flap" id="outletFlap"></span></div>
                  <div className="outlet-tray"></div>
                </div>
                <div className="cabinet-foot" aria-hidden="true"></div>
              </div>
              <div className="machine-plinth" aria-hidden="true"></div>
            </div>
          </div>
          <div className="play-controls">
            <p className="status" id="statusText" role="status" aria-live="polite"> </p>
            <button className="coin-action" id="coinButton" type="button"><span className="small-coin" aria-hidden="true">S</span><span id="coinButtonLabel">コインを使う</span><span className="button-cost">10 pt</span></button>
            <button className="cancel-action" id="cancelCoinButton" type="button" hidden>やめる</button>
          </div>
        </main>
      
        <div className="coin-spotlight" id="coinSpotlight" aria-hidden="true"></div>
        <div className="coin-energy" id="coinEnergy" aria-hidden="true" hidden></div>
        <div className="coin-stage" id="coinStage">
        <button className="coin-token" id="coinToken" type="button" aria-label="コイン。下へ引っ張り、はなせの表示が出たら指を離す。Enterでも投げられます" hidden>
          <span className="coin-shell coin-ghost" aria-hidden="true"><span className="coin-face"><span className="coin-letter">S</span><span className="coin-rim-label">SAKITO</span></span></span>
          <span className="coin-shell coin-gold" id="coinGold" aria-hidden="true"><span className="coin-face"><span className="coin-letter">S</span><span className="coin-rim-label">SAKITO</span></span></span>
          <span className="coin-solid" id="coinSolid" aria-hidden="true">
            <span className="coin-shell coin-front"><span className="coin-face"><span className="coin-letter">S</span><span className="coin-rim-label">SAKITO</span></span></span>
            <span className="coin-shell coin-back"><span className="coin-face"><span className="coin-letter">S</span><span className="coin-rim-label">SAKITO</span></span></span>
            <span className="coin-edge" id="coinEdge"></span>
          </span>
        </button>
        </div>
        <div className="coin-gesture" id="coinGesture" aria-hidden="true" hidden>
          <svg className="pull-arrow" id="pullArrow" viewBox="0 0 64 120">
            <defs>
              <linearGradient id="gestureBrass" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#a4824b"/><stop offset=".32" stopColor="#d8b777"/>
                <stop offset=".52" stopColor="#fff0bf"/><stop offset=".72" stopColor="#d3ae69"/>
                <stop offset="1" stopColor="#9b7841"/>
              </linearGradient>
            </defs>
            <path className="pull-arrow-shape" id="pullArrowShape" d="M28 3 H36 V95 L48 85 L52 90 L32 117 L12 90 L16 85 L28 95 Z"/>
          </svg>
          <span id="gestureLabel">下に引っ張れ！</span>
        </div>
      
        <div className="reveal-layer" id="revealLayer" aria-hidden="true" hidden>
          <div className="reveal-glow" aria-hidden="true"></div><div className="reveal-rays" aria-hidden="true"></div>
          <div className="hero-capsule" id="heroCapsule" aria-hidden="true">
            <span className="shell shell-top"></span><span className="shell shell-bottom"></span>
            <div className="revealed-ticket" id="revealedTicket"><span id="revealName"></span></div>
          </div>
          <p className="reveal-word" id="revealWord" aria-hidden="true"></p>
          <button className="skip-action" id="skipButton" type="button">スキップ</button>
        </div>
      
        <dialog className="result-dialog" id="resultDialog" aria-labelledby="resultTitle">
          <button className="dialog-close" id="closeResultButton" aria-label="結果を閉じる" type="button">×</button>
          <div className="result-ticket" id="resultTicket">
            <p className="ticket-kind" id="resultKind">引換券</p>
            <h1 id="resultTitle"></h1>
            <p className="ticket-store" id="resultStore"></p>
            <p className="ticket-expiry" id="resultExpiry"></p>
          </div>
          <div className="result-actions"><button type="button" className="main-action" id="againButton">もう一回 <span>10 pt</span></button></div>
        </dialog>
      
        <dialog className="collection-dialog" id="collectionDialog" aria-labelledby="collectionTitle">
          <button className="dialog-close" id="closeCollectionButton" type="button" aria-label="一覧を閉じる">×</button>
          <h2 id="collectionTitle">獲得した引換券</h2>
          <div id="collectionList"></div>
        </dialog>
        <p className="toast" id="toast" role="status" hidden></p>
        <div className="sr-only" id="liveRegion" aria-live="polite" aria-atomic="true"></div>
    </>
  );
}

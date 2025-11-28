// ------------- DOM -------------
const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("status");
const gestureEl = document.getElementById("gesture");
const confidenceEl = document.getElementById("confidence");
const confidenceBar = document.getElementById("confidence-bar");
const switchCamBtn = document.getElementById("switchCamBtn");

// ------------- 全域狀態 -------------
let detector = null;
let running = true;
let currentFacing = "user"; // 預設前鏡頭

// 手指骨架鏈
const fingerChains = [
  [0, 1, 2, 3, 4],    // thumb
  [0, 5, 6, 7, 8],    // index
  [0, 9, 10, 11, 12], // middle
  [0, 13, 14, 15, 16],// ring
  [0, 17, 18, 19, 20] // pinky
];

// 每根手指的重要點
const fingerDefs = {
  index:  { tip: 8,  pip: 6 },
  middle: { tip: 12, pip: 10 },
  ring:   { tip: 16, pip: 14 },
  pinky:  { tip: 20, pip: 18 }
};

// ------------- 工具函式 -------------
function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// 判斷四根手指的「伸直 / 彎曲」
function getFingerStates(hand) {
  const kp = hand.keypoints;
  const wrist = kp[0];

  const states = {};
  for (const name of Object.keys(fingerDefs)) {
    const { tip, pip } = fingerDefs[name];
    const tipPt = kp[tip];
    const pipPt = kp[pip];

    const dTip = distance(tipPt, wrist);
    const dPip = distance(pipPt, wrist);

    // tip 比 pip 離 wrist 遠很多 → 手指伸直
    const extended = dTip > dPip * 1.25;
    states[name] = { extended, dTip, dPip };
  }
  return states;
}

// 用手指狀態推估：石頭 / 剪刀 / 布
function classifyRPS(states) {
  const idx = states.index.extended;
  const mid = states.middle.extended;
  const ring = states.ring.extended;
  const pin = states.pinky.extended;

  const extCount = [idx, mid, ring, pin].filter(Boolean).length;

  if (extCount === 0) {
    return { label: "石頭", raw: "rock", confidence: 0.9 };
  }

  if (idx && mid && !ring && !pin) {
    return { label: "剪刀", raw: "scissors", confidence: 0.9 };
  }

  if (extCount >= 3) {
    return { label: "布", raw: "paper", confidence: 0.85 };
  }

  return { label: "不確定", raw: "unknown", confidence: 0.3 };
}

// 畫手部骨架
function drawHand(hand) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!hand || !hand.keypoints || !video.videoWidth || !video.videoHeight) {
    return;
  }

  const kp = hand.keypoints;
  const toScreen = (p) => ({
    x: (p.x / video.videoWidth) * canvas.width,
    y: (p.y / video.videoHeight) * canvas.height
  });

  // 骨架線
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#38bdf8";
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 12;
  ctx.beginPath();

  fingerChains.forEach(chain => {
    for (let i = 0; i < chain.length - 1; i++) {
      const a = kp[chain[i]];
      const b = kp[chain[i + 1]];
      if (!a || !b) continue;
      const sa = toScreen(a);
      const sb = toScreen(b);
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
  });

  ctx.stroke();
  ctx.restore();

  // 關節點
  kp.forEach((p, i) => {
    const { x, y } = toScreen(p);
    const isTip = [4, 8, 12, 16, 20].includes(i);

    // 外光圈
    ctx.save();
    ctx.fillStyle = isTip
      ? "rgba(56,189,248,0.25)"
      : "rgba(249,115,22,0.2)";
    ctx.shadowColor = isTip ? "#38bdf8" : "#f97316";
    ctx.shadowBlur = isTip ? 14 : 8;
    ctx.beginPath();
    ctx.arc(x, y, isTip ? 9 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 內圓
    ctx.save();
    ctx.fillStyle = isTip ? "#38bdf8" : "#f97316";
    ctx.beginPath();
    ctx.arc(x, y, isTip ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ------------- 相機（可切換前 / 後鏡頭） -------------
async function setupCamera() {
  statusEl.textContent = currentFacing === "user"
    ? "啟動前鏡頭…"
    : "啟動後鏡頭…";

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: currentFacing },
    audio: false
  });

  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resizeCanvas();
      resolve();
    };
  });
}

async function switchCamera() {
  currentFacing = currentFacing === "user" ? "environment" : "user";

  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
  }

  try {
    await setupCamera();
  } catch (e) {
    console.error("switchCamera error", e);
    statusEl.textContent = "切換鏡頭失敗：" + e.message;
    alert("切換鏡頭失敗，請確認有開啟相機權限。");
  }
}

switchCamBtn.addEventListener("click", () => {
  switchCamera();
});

function resizeCanvas() {
  const vw = video.videoWidth || 360;
  const vh = video.videoHeight || 640;
  canvas.width = vw;
  canvas.height = vh;
}

// ------------- 推論迴圈 -------------
async function detectionLoop() {
  if (!running || !detector) return;

  let hands = [];
  try {
    // 不使用 flipHorizontal，確保前 / 後鏡頭都一致
    hands = await detector.estimateHands(video);
  } catch (e) {
    console.error("estimateHands error", e);
    statusEl.textContent = "偵測錯誤：" + e.message;
  }

  if (!hands || hands.length === 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    statusEl.textContent = "請把一隻手放到畫面中央，手心朝向鏡頭。";
    gestureEl.textContent = "--";
    confidenceEl.textContent = "0";
    confidenceBar.style.width = "0%";
  } else {
    const hand = hands[0];
    drawHand(hand);

    const states = getFingerStates(hand);
    const result = classifyRPS(states);

    statusEl.textContent = "偵測中（請保持手在畫面中央）。";
    gestureEl.textContent = result.label;

    const confPercent = Math.round(result.confidence * 100);
    confidenceEl.textContent = confPercent.toString();
    confidenceBar.style.width = confPercent + "%";
  }

  setTimeout(() => {
    if (running) requestAnimationFrame(detectionLoop);
  }, 60);
}

// ------------- Main -------------
async function main() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("瀏覽器不支援相機，請改用 iPhone Safari 或新版 Chrome。");
    statusEl.textContent = "此瀏覽器不支援相機。";
    return;
  }

  statusEl.textContent = "啟動相機中…";

  await setupCamera();
  window.addEventListener("resize", resizeCanvas);

  statusEl.textContent = "載入手勢模型中…";

  try {
    detector = await handPoseDetection.createDetector(
      handPoseDetection.SupportedModels.MediaPipeHands,
      {
        runtime: "mediapipe",
        modelType: "lite",
        maxHands: 1,
        solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/hands"
      }
    );
  } catch (e) {
    console.error("createDetector error", e);
    statusEl.textContent = "載入模型失敗：" + e.message;
    alert("載入手勢模型失敗，可以稍後再試或換一個網路環境。");
    return;
  }

  statusEl.textContent = "請把一隻手放到畫面中央，比出石頭 / 剪刀 / 布。";

  detectionLoop();
}

main().catch(err => {
  console.error(err);
  statusEl.textContent = "初始化失敗：" + err.message;
  alert("初始化失敗，請稍後再試。");
});

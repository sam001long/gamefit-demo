// --------------------
// 基本設定：關節與骨架線
// --------------------
const importantJoints = [
  "left_shoulder", "right_shoulder",
  "left_hip", "right_hip",
  "left_knee", "right_knee",
  "left_ankle", "right_ankle",
  "left_wrist", "right_wrist",
  "nose"
];

const adjacentPairs = [
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["left_shoulder", "nose"],
  ["right_shoulder", "nose"]
];

// 角度工具（B 為關節）
function angleBetween(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
  const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y);
  if (!magAB || !magCB) return 0;
  const cos = dot / (magAB * magCB);
  const clamped = Math.min(1, Math.max(-1, cos));
  return (Math.acos(clamped) * 180) / Math.PI;
}

// --------------------
// DOM 元素
// --------------------
const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const angleEl = document.getElementById("angle");
const qualityEl = document.getElementById("quality");
const scoreEl = document.getElementById("score");
const stableEl = document.getElementById("stable");
const completionEl = document.getElementById("completion");
const completionBar = document.getElementById("completion-bar");
const modeLabelEl = document.getElementById("mode-label");
const modeButtons = document.querySelectorAll("#controls button");
const switchCamBtn = document.getElementById("switchCamBtn");
const repsLabelEl = document.getElementById("reps-label");
const repsEl = document.getElementById("reps");

let detector = null;

// 模式：free / yoga / squat
let currentMode = "free";

// 鏡頭方向：environment 後鏡頭、user 前鏡頭
let currentFacing = "environment";

// 共用狀態
let score = 0;
let stableStart = null;
let stableSeconds = 0;
let yogaTargetStable = 8;   // 瑜珈關卡目標秒數
let squatReps = 0;
let squatPhase = "up";      // "up" or "down"

// --------------------
// 模式切換
// --------------------
modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.getAttribute("data-mode");
    if (!mode || mode === currentMode) return;
    currentMode = mode;
    modeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    resetStateForMode();
  });
});

function resetStateForMode() {
  score = 0;
  stableStart = null;
  stableSeconds = 0;
  squatReps = 0;
  squatPhase = "up";

  stableEl.textContent = "0.0";
  completionEl.textContent = "0";
  completionBar.style.width = "0%";
  scoreEl.textContent = "0";
  repsEl.textContent = "0";
  repsEl.style.display = "none";
  repsLabelEl.style.display = "none";

  if (currentMode === "free") {
    modeLabelEl.textContent = "自由練習";
    qualityEl.textContent = "自由活動，看看角度與骨架變化。";
  } else if (currentMode === "yoga") {
    modeLabelEl.textContent = "關卡1 瑜珈平衡";
    qualityEl.textContent = "保持穩定半蹲（或單腳），試著維持 8 秒。";
  } else if (currentMode === "squat") {
    modeLabelEl.textContent = "關卡2 深蹲挑戰";
    qualityEl.textContent = "站直 → 蹲下 → 再站直，完成深蹲次數。";
    repsEl.style.display = "inline";
    repsLabelEl.style.display = "inline";
  }
}

// --------------------
// 相機（前 / 後鏡頭切換）
// --------------------
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: currentFacing },
    audio: false
  });
  video.srcObject = stream;
  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

async function switchCamera() {
  currentFacing = currentFacing === "environment" ? "user" : "environment";

  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
  }

  await setupCamera();
  resizeCanvas();
}

switchCamBtn.addEventListener("click", () => {
  switchCamera().catch((err) => {
    console.error(err);
    alert("切換鏡頭失敗，請確認瀏覽器有相機權限。");
  });
});

function resizeCanvas() {
  const vw = video.videoWidth || 360;
  const vh = video.videoHeight || 640;
  canvas.width = vw;
  canvas.height = vh;
}

// --------------------
// 繪製骨架
// --------------------
function drawKeypoints(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!video.videoWidth || !video.videoHeight) return;

  const toScreen = (kp) => ({
    x: (kp.x / video.videoWidth) * canvas.width,
    y: (kp.y / video.videoHeight) * canvas.height
  });

  // 骨架線
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#38bdf8";
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 12;
  ctx.beginPath();

  adjacentPairs.forEach(([aName, bName]) => {
    const a = keypoints.find((k) => k.name === aName || k.part === aName);
    const b = keypoints.find((k) => k.name === bName || k.part === bName);
    if (!a || !b || a.score < 0.3 || b.score < 0.3) return;

    const sa = toScreen(a);
    const sb = toScreen(b);
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
  });

  ctx.stroke();
  ctx.restore();

  // 關節點
  keypoints.forEach((kp) => {
    if (kp.score < 0.3) return;
    const { x, y } = toScreen(kp);
    const name = kp.name || kp.part;
    const important = importantJoints.includes(name);

    // 外光圈
    ctx.save();
    ctx.fillStyle = important
      ? "rgba(56, 189, 248, 0.25)"
      : "rgba(249, 115, 22, 0.2)";
    ctx.shadowColor = important ? "#38bdf8" : "#f97316";
    ctx.shadowBlur = important ? 14 : 8;
    ctx.beginPath();
    ctx.arc(x, y, important ? 10 : 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 內圓
    ctx.save();
    ctx.fillStyle = important ? "#38bdf8" : "#f97316";
    ctx.beginPath();
    ctx.arc(x, y, important ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// --------------------
// 模式邏輯：姿勢判斷
// --------------------
function evaluatePose(keypoints) {
  if (currentMode === "free") {
    handleFreeMode(keypoints);
  } else if (currentMode === "yoga") {
    handleYogaMode(keypoints);
  } else if (currentMode === "squat") {
    handleSquatMode(keypoints);
  }
}

// 取得左膝角度（hip-knee-ankle），找不到就回 null
function getLeftKneeAngle(kp) {
  const hip = kp.find((k) => k.name === "left_hip" || k.part === "left_hip");
  const knee = kp.find((k) => k.name === "left_knee" || k.part === "left_knee");
  const ankle = kp.find(
    (k) => k.name === "left_ankle" || k.part === "left_ankle"
  );

  if (
    !hip || !knee || !ankle ||
    hip.score < 0.3 || knee.score < 0.3 || ankle.score < 0.3
  ) {
    return null;
  }

  const a = { x: hip.x, y: hip.y };
  const b = { x: knee.x, y: knee.y };
  const c = { x: ankle.x, y: ankle.y };
  return Math.round(angleBetween(a, b, c));
}

// 自由練習：只是看角度 & 提示文字
function handleFreeMode(kp) {
  const ang = getLeftKneeAngle(kp);
  if (ang === null) {
    angleEl.textContent = "--";
    qualityEl.textContent = "請退後一點讓下半身入鏡。";
    return;
  }

  angleEl.textContent = ang;

  if (ang > 160) {
    qualityEl.textContent = "現在幾乎是站直的姿勢。";
  } else if (ang > 130) {
    qualityEl.textContent = "不錯的半蹲位置。";
  } else {
    qualityEl.textContent = "深蹲角度很低，注意膝蓋負擔。";
  }
}

// 關卡1：瑜珈平衡（穩定維持一定角度）
function handleYogaMode(kp) {
  const ang = getLeftKneeAngle(kp);
  if (ang === null) {
    angleEl.textContent = "--";
    qualityEl.textContent = "偵測中，請退後一點讓下半身入鏡。";
    stableStart = null;
    stableSeconds = 0;
    stableEl.textContent = "0.0";
    completionEl.textContent = "0";
    completionBar.style.width = "0%";
    return;
  }

  angleEl.textContent = ang;

  // 設定一個「舒服半蹲區間」
  const good = ang > 130 && ang < 155;
  const now = performance.now();

  if (good) {
    qualityEl.textContent = "很好，保持這個姿勢不動！";
    if (!stableStart) stableStart = now;
    stableSeconds = (now - stableStart) / 1000;
    score += 0.2;
  } else {
    qualityEl.textContent = "試著找到一個穩定的半蹲角度。";
    stableStart = null;
    stableSeconds = 0;
  }

  stableEl.textContent = stableSeconds.toFixed(1);

  const comp = Math.min(100, Math.round((stableSeconds / yogaTargetStable) * 100));
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";
  scoreEl.textContent = Math.floor(score);

  if (comp >= 100) {
    qualityEl.textContent = "恭喜通關！這就是 GameFit 瑜珈平衡關卡。";
  }
}

// 關卡2：深蹲挑戰（計次）
function handleSquatMode(kp) {
  const ang = getLeftKneeAngle(kp);
  if (ang === null) {
    angleEl.textContent = "--";
    qualityEl.textContent = "偵測中，請退後一點讓下半身入鏡。";
    return;
  }

  angleEl.textContent = ang;

  // 簡單規則：
  // 角度 > 160 視為站直、角度 < 130 視為蹲下
  const standing = ang > 160;
  const squatting = ang < 130;

  if (squatPhase === "up" && squatting) {
    // 從站直 → 蹲下
    squatPhase = "down";
    qualityEl.textContent = "很好！保持重心穩定往下。";
  } else if (squatPhase === "down" && standing) {
    // 從蹲下 → 站直，算一個完整深蹲
    squatPhase = "up";
    squatReps += 1;
    repsEl.textContent = squatReps.toString();
    score += 5;
    qualityEl.textContent = `完成第 ${squatReps} 次深蹲！`;
  }

  // 用深蹲次數當完成度（假設 5 次滿分）
  const targetReps = 5;
  const comp = Math.min(100, Math.round((squatReps / targetReps) * 100));
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";
  scoreEl.textContent = Math.floor(score);

  if (comp >= 100) {
    qualityEl.textContent = "深蹲關卡通關！可以想像接上 GameFit 關卡動畫。";
  }
}

// --------------------
// Pose 迴圈
// --------------------
async function poseLoop() {
  if (!detector) return;

  let poses;
  try {
    poses = await detector.estimatePoses(video, { maxPoses: 1 });
  } catch (e) {
    console.error("estimatePoses error:", e);
    requestAnimationFrame(poseLoop);
    return;
  }

  if (poses && poses.length > 0) {
    const kp = poses[0].keypoints;
    drawKeypoints(kp);
    evaluatePose(kp);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    qualityEl.textContent = "找不到人，請退後一點。";
  }

  requestAnimationFrame(poseLoop);
}

// --------------------
// Main
// --------------------
async function main() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("瀏覽器不支援相機，請用 iPhone Safari 或新版 Chrome。");
    return;
  }

  resetStateForMode();

  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  try {
    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
      }
    );
  } catch (e) {
    console.error("createDetector error:", e);
    alert("建立姿勢偵測器失敗，請檢查網路或稍後再試。");
    return;
  }

  poseLoop();
}

main().catch((err) => {
  console.error(err);
  alert("初始化失敗，請打開主控台查看錯誤訊息。");
});

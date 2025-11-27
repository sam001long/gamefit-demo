// --------------------
// 設定：關節 / 骨架
// --------------------
const importantJoints = [
  "left_shoulder", "right_shoulder",
  "left_hip", "right_hip",
  "left_knee", "right_knee",
  "left_ankle", "right_ankle",
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

// 角度工具：計算三點之間的角度（B 為關節）
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
const modeLabel = document.getElementById("mode-label");
const modeButtons = document.querySelectorAll("#controls button");

let detector = null;

// 模式：free / yoga / squat
let currentMode = "free";

// 通用分數 / 穩定時間
let score = 0;
let stableStart = null;
let stableSeconds = 0;

// 瑜珈關卡目標穩定秒數
const TARGET_STABLE_SECONDS_YOGA = 5;
// 自由練習穩定秒數
const TARGET_STABLE_SECONDS_FREE = 8;

// 深蹲關卡
let squatState = "idle"; // idle / down
let squatCount = 0;
const SQUAT_DOWN_ANGLE = 120; // 膝角度小於這個算「蹲下」
const SQUAT_UP_ANGLE = 160;   // 回到這個以上算「站起」

// --------------------
// 模式切換
// --------------------
modeButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.getAttribute("data-mode");
    if (!mode || mode === currentMode) return;

    currentMode = mode;
    modeButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    resetGameStateForMode();
  });
});

function resetGameStateForMode() {
  // 重置共用狀態
  score = 0;
  stableStart = null;
  stableSeconds = 0;
  squatState = "idle";
  squatCount = 0;

  stableEl.textContent = "0.0";
  completionEl.textContent = "0";
  completionBar.style.width = "0%";
  scoreEl.textContent = "0";

  if (currentMode === "free") {
    modeLabel.textContent = "自由練習";
    qualityEl.textContent = "隨意活動，試試看骨架與角度。";
  } else if (currentMode === "yoga") {
    modeLabel.textContent = "關卡1 瑜珈平衡";
    qualityEl.textContent = "請抬起左腳並維持單腳平衡。";
  } else if (currentMode === "squat") {
    modeLabel.textContent = "關卡2 深蹲挑戰";
    qualityEl.textContent = "蹲下再站起算1次，目標3次。";
  }
}

// --------------------
// 相機與畫布
// --------------------
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });
  video.srcObject = stream;
  return new Promise(resolve => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

function resizeCanvas() {
  const vw = video.videoWidth || 360;
  const vh = video.videoHeight || 640;
  canvas.width = vw;
  canvas.height = vh;
}

// --------------------
// 繪製骨架（科技線條 + 光暈節點）
// --------------------
function drawKeypoints(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const toScreen = kp => ({
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
    const a = keypoints.find(k => k.name === aName || k.part === aName);
    const b = keypoints.find(k => k.name === bName || k.part === bName);
    if (!a || !b || a.score < 0.4 || b.score < 0.4) return;

    const sa = toScreen(a);
    const sb = toScreen(b);
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
  });

  ctx.stroke();
  ctx.restore();

  // 關節節點
  keypoints.forEach(kp => {
    if (kp.score < 0.4) return;
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
  const hipL = keypoints.find(k => k.name === "left_hip" || k.part === "left_hip");
  const kneeL = keypoints.find(k => k.name === "left_knee" || k.part === "left_knee");
  const ankleL = keypoints.find(k => k.name === "left_ankle" || k.part === "left_ankle");

  if (!hipL || !kneeL || !ankleL ||
      hipL.score < 0.4 || kneeL.score < 0.4 || ankleL.score < 0.4) {
    angleEl.textContent = "--";
    if (currentMode === "free") {
      qualityEl.textContent = "偵測中，請退後一點讓全身入鏡。";
    }
    stableStart = null;
    stableSeconds = 0;
    stableEl.textContent = "0.0";
    completionEl.textContent = "0";
    completionBar.style.width = "0%";
    return;
  }

  const leftKneeAngle = Math.round(
    angleBetween(
      { x: hipL.x, y: hipL.y },
      { x: kneeL.x, y: kneeL.y },
      { x: ankleL.x, y: ankleL.y }
    )
  );
  angleEl.textContent = leftKneeAngle;

  if (currentMode === "free") {
    handleFreeMode(leftKneeAngle);
  } else if (currentMode === "yoga") {
    handleYogaMode(keypoints, leftKneeAngle);
  } else if (currentMode === "squat") {
    handleSquatMode(leftKneeAngle);
  }
}

// 自由練習模式：原本的半蹲評分邏輯
function handleFreeMode(angle) {
  let good = false;
  if (angle > 160) {
    qualityEl.textContent = "站太直，可以試試半蹲。";
  } else if (angle > 130) {
    qualityEl.textContent = "不錯的半蹲！";
    good = true;
  } else {
    qualityEl.textContent = "蹲很多，很認真！";
    good = true;
  }

  const now = performance.now();
  if (good) {
    if (!stableStart) stableStart = now;
    stableSeconds = (now - stableStart) / 1000;
    score += 0.2;
  } else {
    stableStart = null;
    stableSeconds = 0;
  }

  stableEl.textContent = stableSeconds.toFixed(1);
  const comp = Math.min(
    100,
    Math.round((stableSeconds / TARGET_STABLE_SECONDS_FREE) * 100)
  );
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";
  scoreEl.textContent = Math.floor(score);
}

// 瑜珈平衡模式：粗略判斷「左腳抬起 + 膝彎曲」並維持
function handleYogaMode(keypoints, leftKneeAngle) {
  const kneeR = keypoints.find(k => k.name === "right_knee" || k.part === "right_knee");
  const ankleL = keypoints.find(k => k.name === "left_ankle" || k.part === "left_ankle");

  if (!kneeR || !ankleL || kneeR.score < 0.4 || ankleL.score < 0.4) {
    qualityEl.textContent = "請面向鏡頭站好，慢慢抬起左腳。";
    stableStart = null;
    stableSeconds = 0;
    stableEl.textContent = "0.0";
    completionEl.textContent = "0";
    completionBar.style.width = "0%";
    return;
  }

  // Tree Pose 粗略條件：
  // 1) 左膝有明顯彎曲（角度 < 140）
  // 2) 左腳踝高度在右膝附近或以上（拍攝角度會有誤差，只做大略）
  const kneeBent = leftKneeAngle < 140;
  const footRaised = ankleL.y < kneeR.y + 40; // y 值越小位置越高

  const good = kneeBent && footRaised;

  const now = performance.now();
  if (good) {
    if (!stableStart) stableStart = now;
    stableSeconds = (now - stableStart) / 1000;
    qualityEl.textContent = "平衡中，保持不要晃動…";
  } else {
    stableStart = null;
    stableSeconds = 0;
    qualityEl.textContent = "請抬起左腳並維持穩定。";
  }

  stableEl.textContent = stableSeconds.toFixed(1);

  const comp = Math.min(
    100,
    Math.round((stableSeconds / TARGET_STABLE_SECONDS_YOGA) * 100)
  );
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";

  if (comp >= 100) {
    qualityEl.textContent = "平衡達成！CLEAR！";
    score = 100;
  } else {
    score = comp;
  }
  scoreEl.textContent = Math.floor(score);
}

// 深蹲模式：蹲下再站起記 1 次
function handleSquatMode(angle) {
  // 重設與深蹲無關的顯示
  stableEl.textContent = "0.0";

  if (squatState === "idle") {
    if (angle < SQUAT_DOWN_ANGLE) {
      squatState = "down";
      qualityEl.textContent = "已蹲下，準備站起。";
    } else {
      qualityEl.textContent = "請蹲下，膝角度變小。";
    }
  } else if (squatState === "down") {
    if (angle > SQUAT_UP_ANGLE) {
      squatCount += 1;
      squatState = "idle";
      qualityEl.textContent = "完成一次深蹲！再來！";
    } else {
      qualityEl.textContent = "保持蹲姿，再站起來。";
    }
  }

  // 目標 3 次，當作 100% 完成
  const comp = Math.min(100, Math.round((squatCount / 3) * 100));
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";

  score = squatCount;
  scoreEl.textContent = squatCount + " 次";

  if (squatCount >= 3) {
    qualityEl.textContent = "挑戰完成！你很棒！";
  }
}

// --------------------
// Pose 迴圈
// --------------------
async function poseLoop() {
  if (!detector) return;

  const poses = await detector.estimatePoses(video, { maxPoses: 1 });
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

  resetGameStateForMode(); // 初始化模式文字

  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
    }
  );

  poseLoop();
}

main().catch(err => {
  console.error(err);
  alert("初始化失敗，請打開主控台查看錯誤訊息。");
});

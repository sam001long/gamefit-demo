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
const angleUnitEl = document.getElementById("angle-unit");
const qualityEl = document.getElementById("quality");
const scoreEl = document.getElementById("score");
const stableEl = document.getElementById("stable");
const completionEl = document.getElementById("completion");
const completionBar = document.getElementById("completion-bar");
const modeLabelEl = document.getElementById("mode-label");
const modeButtons = document.querySelectorAll("#controls button");
const switchCamBtn = document.getElementById("switchCamBtn");

let detector = null;

// 模式：body / hand / face
let currentMode = "body";

// 鏡頭方向：environment 後鏡頭、user 前鏡頭
let currentFacing = "environment";

// 共用狀態
let score = 0;
let stableStart = null;
let stableSeconds = 0;

// 全身模式目標穩定秒數
const TARGET_STABLE_BODY = 8;

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

  stableEl.textContent = "0.0";
  completionEl.textContent = "0";
  completionBar.style.width = "0%";
  scoreEl.textContent = "0";

  if (currentMode === "body") {
    modeLabelEl.textContent = "全身模式";
    angleUnitEl.textContent = "°";
    angleEl.textContent = "--";
    qualityEl.textContent = "試著做半蹲或站姿，看看角度與穩定度。";
  } else if (currentMode === "hand") {
    modeLabelEl.textContent = "手勢模式";
    angleUnitEl.textContent = "";
    angleEl.textContent = "--";
    qualityEl.textContent = "試著舉手、雙手舉高、左右揮手。";
  } else if (currentMode === "face") {
    modeLabelEl.textContent = "臉部模式";
    angleUnitEl.textContent = "";
    angleEl.textContent = "--";
    qualityEl.textContent = "頭轉左/右、抬頭、低頭，看看狀態變化。";
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

  if (!video.videoWidth || !video.videoHeight) {
    return; // 還沒拿到畫面尺寸時先跳過
  }

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
  if (currentMode === "body") {
    handleBodyMode(keypoints);
  } else if (currentMode === "hand") {
    handleHandMode(keypoints);
  } else if (currentMode === "face") {
    handleFaceMode(keypoints);
  }
}

// 全身模式：半蹲穩定度
function handleBodyMode(kp) {
  const hip = kp.find((k) => k.name === "left_hip" || k.part === "left_hip");
  const knee = kp.find((k) => k.name === "left_knee" || k.part === "left_knee");
  const ankle = kp.find(
    (k) => k.name === "left_ankle" || k.part === "left_ankle"
  );

  if (
    !hip ||
    !knee ||
    !ankle ||
    hip.score < 0.3 ||
    knee.score < 0.3 ||
    ankle.score < 0.3
  ) {
    angleEl.textContent = "--";
    qualityEl.textContent = "偵測中，請退後一點讓下半身入鏡。";
    stableStart = null;
    stableSeconds = 0;
    stableEl.textContent = "0.0";
    completionEl.textContent = "0";
    completionBar.style.width = "0%";
    return;
  }

  const a = { x: hip.x, y: hip.y };
  const b = { x: knee.x, y: knee.y };
  const c = { x: ankle.x, y: ankle.y };

  const ang = Math.round(angleBetween(a, b, c));
  angleEl.textContent = ang;

  let good = false;
  if (ang > 160) {
    qualityEl.textContent = "站太直，可以試試半蹲。";
  } else if (ang > 130) {
    qualityEl.textContent = "不錯的半蹲！維持看看。";
    good = true;
  } else {
    qualityEl.textContent = "深蹲很強！小心膝蓋。";
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
    Math.round((stableSeconds / TARGET_STABLE_BODY) * 100)
  );
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";
  scoreEl.textContent = Math.floor(score);
}

// 手勢模式：用手腕與肩膀高度
function handleHandMode(kp) {
  const leftShoulder = kp.find(
    (k) => k.name === "left_shoulder" || k.part === "left_shoulder"
  );
  const rightShoulder = kp.find(
    (k) => k.name === "right_shoulder" || k.part === "right_shoulder"
  );
  const leftWrist = kp.find(
    (k) => k.name === "left_wrist" || k.part === "left_wrist"
  );
  const rightWrist = kp.find(
    (k) => k.name === "right_wrist" || k.part === "right_wrist"
  );

  if (
    !leftShoulder ||
    !rightShoulder ||
    !leftWrist ||
    !rightWrist ||
    leftShoulder.score < 0.3 ||
    rightShoulder.score < 0.3 ||
    leftWrist.score < 0.3 ||
    rightWrist.score < 0.3
  ) {
    qualityEl.textContent = "請讓上半身與雙手入鏡。";
    angleEl.textContent = "--";
    stableEl.textContent = "0.0";
    completionEl.textContent = "0";
    completionBar.style.width = "0%";
    return;
  }

  const leftUp = leftWrist.y < leftShoulder.y - 20;
  const rightUp = rightWrist.y < rightShoulder.y - 20;

  let statusText = "";
  if (leftUp && rightUp) {
    statusText = "雙手舉高！像在應援一樣～";
  } else if (leftUp) {
    statusText = "左手舉高中。";
  } else if (rightUp) {
    statusText = "右手舉高中。";
  } else {
    statusText = "請舉起一隻或雙手。";
  }

  // 左右偏移（用雙手中心 vs 肩膀中心）
  const centerX = (leftWrist.x + rightWrist.x) / 2;
  const shouldersCenterX = (leftShoulder.x + rightShoulder.x) / 2;
  const delta = centerX - shouldersCenterX;

  let dirText = "";
  if (Math.abs(delta) > 40) {
    dirText = delta > 0 ? "（整體偏右側）" : "（整體偏左側）";
  }

  qualityEl.textContent = statusText + dirText;

  const now = performance.now();
  if (leftUp && rightUp) {
    if (!stableStart) stableStart = now;
    stableSeconds = (now - stableStart) / 1000;
    score += 0.3;
  } else {
    stableStart = null;
    stableSeconds = 0;
  }

  stableEl.textContent = stableSeconds.toFixed(1);

  const comp = Math.min(100, Math.round(stableSeconds * 20)); // 0~5 秒 → 0~100
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";
  scoreEl.textContent = Math.floor(score);

  angleEl.textContent = comp; // 主數值顯示完成度
}

// 臉部模式：用鼻子相對肩膀位置估頭部方向
function handleFaceMode(kp) {
  const nose = kp.find((k) => k.name === "nose" || k.part === "nose");
  const leftShoulder = kp.find(
    (k) => k.name === "left_shoulder" || k.part === "left_shoulder"
  );
  const rightShoulder = kp.find(
    (k) => k.name === "right_shoulder" || k.part === "right_shoulder"
  );

  if (
    !nose ||
    !leftShoulder ||
    !rightShoulder ||
    nose.score < 0.3 ||
    leftShoulder.score < 0.3 ||
    rightShoulder.score < 0.3
  ) {
    qualityEl.textContent = "請把上半身與頭部正面對著鏡頭。";
    angleEl.textContent = "--";
    stableEl.textContent = "0.0";
    completionEl.textContent = "0";
    completionBar.style.width = "0%";
    return;
  }

  const centerX = (leftShoulder.x + rightShoulder.x) / 2;
  const centerY = (leftShoulder.y + rightShoulder.y) / 2;
  const dx = nose.x - centerX;
  const dy = nose.y - centerY;

  let yawText = "";
  if (Math.abs(dx) < 20) yawText = "正面";
  else if (dx > 0) yawText = "頭往右轉";
  else yawText = "頭往左轉";

  let pitchText = "";
  if (dy < -20) pitchText = "抬頭";
  else if (dy > 20) pitchText = "低頭";
  else pitchText = "高度正常";

  qualityEl.textContent = yawText + "，" + pitchText + "。";

  const dist = Math.sqrt(dx * dx + dy * dy);
  const poseScore = Math.max(0, 100 - Math.round((dist / 80) * 100));
  angleEl.textContent = poseScore;
  angleUnitEl.textContent = "分";

  const now = performance.now();
  const facingFront = Math.abs(dx) < 20 && Math.abs(dy) < 20;
  if (facingFront) {
    if (!stableStart) stableStart = now;
    stableSeconds = (now - stableStart) / 1000;
  } else {
    stableStart = null;
    stableSeconds = 0;
  }

  stableEl.textContent = stableSeconds.toFixed(1);
  const comp = Math.min(100, Math.round(stableSeconds * 20)); // 0~5s → 0~100
  completionEl.textContent = comp;
  completionBar.style.width = comp + "%";
  scoreEl.textContent = poseScore;
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

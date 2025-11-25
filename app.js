// 重要關節：畫成比較大的發光節點
const importantJoints = [
  "left_shoulder",
  "right_shoulder",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "nose",
];

// 要連成線的關節組合（骨架線）
const adjacentPairs = [
  // 上半身
  ["left_shoulder", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],

  // 軀幹
  ["left_shoulder", "left_hip"],
  ["right_shoulder", "right_hip"],
  ["left_hip", "right_hip"],

  // 下半身
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],

  // 頭部（接到鼻子）
  ["left_shoulder", "nose"],
  ["right_shoulder", "nose"],
];

// 類似裝甲板的三角區塊（用線描出來）
const trianglePlates = [
  ["left_shoulder", "right_shoulder", "left_hip"],
  ["right_shoulder", "left_hip", "right_hip"],
  ["left_hip", "right_hip", "left_knee"],
  ["right_hip", "left_knee", "right_knee"],
];

// 算三點夾角（中間那點是關節）
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

const video = document.getElementById("video");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

const angleEl = document.getElementById("angle");
const qualityEl = document.getElementById("quality");
const scoreEl = document.getElementById("score");
const stableEl = document.getElementById("stable");
const completionEl = document.getElementById("completion");
const completionBar = document.getElementById("completion-bar");

let detector = null;
let score = 0;

// 用來記錄「保持好姿勢」的時間
let stableStart = null; // 開始穩定的時刻 (ms)
let stableSeconds = 0; // 累積穩定秒數

// 要保持幾秒視為 100% 完成
const TARGET_STABLE_SECONDS = 10;

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "environment", // 後鏡頭
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
}

async function loadModel() {
  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    }
  );
}

function resizeCanvas() {
  // 直接用影片解析度，讓座標對齊
  const vw = video.videoWidth || 360;
  const vh = video.videoHeight || 640;
  canvas.width = vw;
  canvas.height = vh;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawKeypoints(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  function screenXY(kp) {
    const x = (kp.x / video.videoWidth) * canvas.width;
    const y = (kp.y / video.videoHeight) * canvas.height;
    return { x, y };
  }

  // =========================
  // 1. 霓虹骨架主線
  // =========================
  ctx.save();
  ctx.lineWidth = 5;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "#fb7185"); // 粉紅
  grad.addColorStop(1, "#22d3ee"); // 藍綠
  ctx.strokeStyle = grad;
  ctx.shadowColor = "rgba(56, 189, 248, 0.7)";
  ctx.shadowBlur = 16;

  ctx.beginPath();
  adjacentPairs.forEach(([aName, bName]) => {
    const a = keypoints.find((k) => k.name === aName || k.part === aName);
    const b = keypoints.find((k) => k.name === bName || k.part === bName);
    if (!a || !b || a.score < 0.4 || b.score < 0.4) return;

    const sa = screenXY(a);
    const sb = screenXY(b);
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
  });
  ctx.stroke();
  ctx.restore();

  // =========================
  // 2. 三角裝甲板線條
  // =========================
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.9)";
  ctx.shadowColor = "rgba(148, 163, 184, 0.6)";
  ctx.shadowBlur = 10;

  trianglePlates.forEach(([p1, p2, p3]) => {
    const a = keypoints.find((k) => k.name === p1 || k.part === p1);
    const b = keypoints.find((k) => k.name === p2 || k.part === p2);
    const c = keypoints.find((k) => k.name === p3 || k.part === p3);
    if (!a || !b || !c || a.score < 0.4 || b.score < 0.4 || c.score < 0.4)
      return;

    const sa = screenXY(a);
    const sb = screenXY(b);
    const sc = screenXY(c);

    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.lineTo(sc.x, sc.y);
    ctx.closePath();
    ctx.stroke();
  });
  ctx.restore();

  // =========================
  // 3. 關節節點（外圈光暈 + 內圈實心圓）
  // =========================
  keypoints.forEach((kp) => {
    if (kp.score < 0.4) return;

    const { x, y } = screenXY(kp);
    const jointName = kp.name || kp.part;
    const isImportant = importantJoints.includes(jointName);

    // 外圈光暈
    ctx.save();
    ctx.fillStyle = isImportant
      ? "rgba(248, 250, 252, 0.2)"
      : "rgba(248, 250, 252, 0.1)";
    ctx.shadowColor = isImportant
      ? "rgba(251, 113, 133, 0.9)"
      : "rgba(56, 189, 248, 0.7)";
    ctx.shadowBlur = isImportant ? 18 : 12;
    ctx.beginPath();
    ctx.arc(x, y, isImportant ? 11 : 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 內部實心圓
    ctx.save();
    ctx.fillStyle = isImportant ? "#e5e7eb" : "#38bdf8";
    ctx.beginPath();
    ctx.arc(x, y, isImportant ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function evaluatePose(keypoints) {
  const hip = keypoints.find((k) => k.name === "left_hip" || k.part === "left_hip");
  const knee = keypoints.find((k) => k.name === "left_knee" || k.part === "left_knee");
  const ankle = keypoints.find(
    (k) => k.name === "left_ankle" || k.part === "left_ankle"
  );

  if (!hip || !knee || !ankle || hip.score < 0.4 || knee.score < 0.4 || ankle.score < 0.4) {
    angleEl.textContent = "--";
    qualityEl.textContent = "偵測中…";
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

  let quality = "";
  let isGoodPose = false;

  // 130°～160° 當作「好看的半蹲」，你可以自己調
  if (ang > 160) {
    quality = "站太直";
  } else if (ang > 130) {
    quality = "不錯的半蹲";
    isGoodPose = true;
  } else {
    quality = "蹲很多，很認真！";
    isGoodPose = true;
  }

  qualityEl.textContent = quality;

  const now = performance.now();

  if (isGoodPose) {
    if (stableStart === null) {
      stableStart = now;
    }
    stableSeconds = (now - stableStart) / 1000;
    score += 0.2; // 穩定時緩慢加分
  } else {
    stableStart = null;
    stableSeconds = 0;
  }

  stableEl.textContent = stableSeconds.toFixed(1);

  const completion = Math.max(
    0,
    Math.min(100, Math.round((stableSeconds / TARGET_STABLE_SECONDS) * 100))
  );
  completionEl.textContent = completion;
  completionBar.style.width = `${completion}%`;

  scoreEl.textContent = Math.floor(score);
}

async function poseLoop() {
  if (!detector) return;

  const poses = await detector.estimatePoses(video, {
    maxPoses: 1,
    flipHorizontal: false,
  });

  if (poses && poses.length > 0) {
    const kp = poses[0].keypoints;
    drawKeypoints(kp);
    evaluatePose(kp);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    qualityEl.textContent = "找不到人，退後一點？";
  }

  requestAnimationFrame(poseLoop);
}

async function main() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("這個瀏覽器不支援相機，請用 iPhone Safari 或新版 Chrome。");
    return;
  }

  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  await loadModel();
  poseLoop();
}

main().catch((err) => {
  console.error(err);
  alert("初始化失敗，請打開主控台查看錯誤訊息。");
});

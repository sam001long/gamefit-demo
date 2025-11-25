// 簡單工具：算兩點距離（目前沒用到，但可以保留）
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// 算三點夾角（中間那點是關節）
function angleBetween(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + cb.y * cb.y;
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
let stableSeconds = 0;  // 累積穩定秒數

// 設定：要保持幾秒視為 100% 完成（你可以改成 5 或 8 之類）
const TARGET_STABLE_SECONDS = 10;

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "environment",
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
  // 如果影片還沒準備好，就先給一個預設值
  const vw = video.videoWidth || 360;
  const vh = video.videoHeight || 640;

  // canvas 的「內部解析度」直接跟影片一樣
  canvas.width = vw;
  canvas.height = vh;

  // 讓座標系統回到 1:1（不要再用 devicePixelRatio 放大）
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}


function drawKeypoints(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#38bdf8";
  ctx.fillStyle = "#f97316";

  // 畫關節點
  keypoints.forEach((kp) => {
    if (kp.score < 0.3) return;
    const x = (kp.x / video.videoWidth) * canvas.width;
    const y = (kp.y / video.videoHeight) * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // 簡易骨架（只畫部分線段）
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

function drawKeypoints(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  function screenXY(kp) {
    return {
      x: (kp.x / video.videoWidth) * canvas.width,
      y: (kp.y / video.videoHeight) * canvas.height,
    };
  }

  // 先畫骨架線
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#38bdf8";
  ctx.beginPath();
  adjacentPairs.forEach(([aName, bName]) => {
    const a = keypoints.find((k) => k.name === aName || k.part === aName);
    const b = keypoints.find((k) => k.name === bName || k.part === bName);
    if (!a || !b || a.score < 0.3 || b.score < 0.3) return;
    const sa = screenXY(a);
    const sb = screenXY(b);
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
  });
  ctx.stroke();

  // 再畫節點
  keypoints.forEach((kp) => {
    if (kp.score < 0.3) return;
    const { x, y } = screenXY(kp);

    const isImportant =
      importantJoints.includes(kp.name) || importantJoints.includes(kp.part);

    // 外圈光暈
    if (isImportant) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // 內部核心點
    ctx.fillStyle = isImportant ? "#38bdf8" : "#f97316";
    ctx.beginPath();
    ctx.arc(x, y, isImportant ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  });
}


  function find(name) {
    return keypoints.find((k) => k.name === name || k.part === name);
  }

  ctx.beginPath();
  adjacentPairs.forEach(([aName, bName]) => {
    const a = find(aName);
    const b = find(bName);
    if (!a || !b || a.score < 0.3 || b.score < 0.3) return;

    const ax = (a.x / video.videoWidth) * canvas.width;
    const ay = (a.y / video.videoHeight) * canvas.height;
    const bx = (b.x / video.videoWidth) * canvas.width;
    const by = (b.y / video.videoHeight) * canvas.height;

    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
  });
  ctx.stroke();
}

function evaluatePose(keypoints) {
  const hip = keypoints.find((k) => k.name === "left_hip" || k.part === "left_hip");
  const knee = keypoints.find((k) => k.name === "left_knee" || k.part === "left_knee");
  const ankle = keypoints.find(
    (k) => k.name === "left_ankle" || k.part === "left_ankle"
  );

  if (!hip || !knee || !ankle || hip.score < 0.3 || knee.score < 0.3 || ankle.score < 0.3) {
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

  // 定義「好姿勢」的角度範圍（可以依照你要的動作調整）
  // 這裡假設：130°～160° 是「不錯的半蹲」
  let quality = "";
  let isGoodPose = false;

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
    // 開始或延續穩定姿勢
    if (stableStart === null) {
      stableStart = now;
    }
    stableSeconds = (now - stableStart) / 1000;
    // 穩定時每幀都加一點分數
    score += 0.2;
  } else {
    // 姿勢一跑掉就歸零
    stableStart = null;
    stableSeconds = 0;
  }

  // 更新 HUD：穩定秒數
  stableEl.textContent = stableSeconds.toFixed(1);

  // 完成度：穩定時間 / 目標秒數（最多 100%）
  const completion = Math.max(
    0,
    Math.min(100, Math.round((stableSeconds / TARGET_STABLE_SECONDS) * 100))
  );
  completionEl.textContent = completion;
  completionBar.style.width = `${completion}%`;

  // 更新分數（取整數看起來比較像遊戲）
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

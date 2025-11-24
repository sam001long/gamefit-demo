// 簡單工具：算兩點距離
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

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

let detector = null;
let score = 0;

async function setupCamera() {
  // 嘗試使用後鏡頭
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
  // 使用 MoveNet
  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
    }
  );
}

function resizeCanvas() {
  const rect = video.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
}

function drawKeypoints(keypoints) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#38bdf8";
  ctx.fillStyle = "#f97316";

  // 畫點
  keypoints.forEach((kp) => {
    if (kp.score < 0.3) return;
    const x = (kp.x / video.videoWidth) * canvas.width;
    const y = (kp.y / video.videoHeight) * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // 定義簡單骨架線（只畫幾條就好）
  const adjacentPairs = [
    ["left_shoulder", "left_elbow"],
    ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"],
    ["right_elbow", "right_wrist"],
    ["left_hip", "left_knee"],
    ["left_knee", "left_ankle"],
    ["right_hip", "right_knee"],
    ["right_knee", "right_ankle"],
    ["left_shoulder", "right_shoulder"],
    ["left_hip", "right_hip"],
  ];

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
  // 以左膝為例：用 left_hip - left_knee - left_ankle 算角度
  const hip = keypoints.find((k) => k.name === "left_hip" || k.part === "left_hip");
  const knee = keypoints.find(
    (k) => k.name === "left_knee" || k.part === "left_knee"
  );
  const ankle = keypoints.find(
    (k) => k.name === "left_ankle" || k.part === "left_ankle"
  );

  if (!hip || !knee || !ankle || hip.score < 0.3 || knee.score < 0.3 || ankle.score < 0.3) {
    angleEl.textContent = "--";
    qualityEl.textContent = "偵測中…";
    return;
  }

  const a = { x: hip.x, y: hip.y };
  const b = { x: knee.x, y: knee.y };
  const c = { x: ankle.x, y: ankle.y };

  const ang = Math.round(angleBetween(a, b, c));
  angleEl.textContent = ang;

  let quality = "";
  if (ang > 160) {
    quality = "站太直";
  } else if (ang > 130) {
    quality = "不錯的半蹲";
    score += 1;
  } else {
    quality = "蹲很多，很認真！";
    score += 2;
  }

  qualityEl.textContent = quality;
  scoreEl.textContent = score;
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

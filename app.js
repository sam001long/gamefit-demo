// --------------------
// 基本設定
// --------------------
const importantJoints = [
  "left_shoulder","right_shoulder",
  "left_hip","right_hip",
  "left_knee","right_knee",
  "left_ankle","right_ankle",
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

// --------------------
// 計算角度
// --------------------
function angleBetween(a, b, c) {
  const ab = {x: a.x - b.x, y: a.y - b.y};
  const cb = {x: c.x - b.x, y: c.y - b.y};
  const dot = ab.x*cb.x + ab.y*cb.y;
  const magAB = Math.sqrt(ab.x*ab.x + ab.y*ab.y);
  const magCB = Math.sqrt(cb.x*cb.x + cb.y*cb.y);
  if (!magAB || !magCB) return 0;
  const cos = dot / (magAB * magCB);
  return Math.acos(Math.min(1,Math.max(-1,cos))) * 180/Math.PI;
}

// --------------------
// DOM
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

let detector = null;
let score = 0;
let stableStart = null;
let stableSeconds = 0;
const TARGET_STABLE_SECONDS = 8;

// --------------------
// 相機
// --------------------
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false
  });
  video.srcObject = stream;
  return new Promise(res => {
    video.onloadedmetadata = () => {
      video.play();
      res();
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
// 乾淨骨架：線 + 光暈節點
// --------------------
function drawKeypoints(keypoints) {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  const xy = kp => ({
    x: (kp.x / video.videoWidth) * canvas.width,
    y: (kp.y / video.videoHeight) * canvas.height
  });

  // ---- 骨架線 ----
  ctx.save();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#38bdf8";
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 12;
  ctx.beginPath();

  adjacentPairs.forEach(([aName,bName])=>{
    const a = keypoints.find(k=>k.name===aName||k.part===aName);
    const b = keypoints.find(k=>k.name===bName||k.part===bName);
    if (!a||!b || a.score<0.4 || b.score<0.4) return;

    const sA = xy(a);
    const sB = xy(b);
    ctx.moveTo(sA.x,sA.y);
    ctx.lineTo(sB.x,sB.y);
  });

  ctx.stroke();
  ctx.restore();

  // ---- 關節點 ----
  keypoints.forEach(kp=>{
    if (kp.score < 0.4) return;
    const {x,y} = xy(kp);
    const name = kp.name || kp.part;
    const important = importantJoints.includes(name);

    // 外光圈
    ctx.save();
    ctx.fillStyle = important
      ? "rgba(56, 189, 248, 0.25)"
      : "rgba(255, 180, 0, 0.2)";
    ctx.shadowColor = important ? "#38bdf8" : "#f97316";
    ctx.shadowBlur = important ? 14 : 8;
    ctx.beginPath();
    ctx.arc(x,y,important?10:6,0,Math.PI*2);
    ctx.fill();
    ctx.restore();

    // 內圓
    ctx.save();
    ctx.fillStyle = important ? "#38bdf8" : "#f97316";
    ctx.beginPath();
    ctx.arc(x,y,important?4:3,0,Math.PI*2);
    ctx.fill();
    ctx.restore();
  });
}

// --------------------
// 偵測姿勢
// --------------------
function evaluatePose(kp) {
  const hip = kp.find(k=>k.name==="left_hip"||k.part==="left_hip");
  const knee = kp.find(k=>k.name==="left_knee"||k.part==="left_knee");
  const ankle = kp.find(k=>k.name==="left_ankle"||k.part==="left_ankle");
  if (!hip||!knee||!ankle || hip.score<0.4 || knee.score<0.4 || ankle.score<0.4)
    return;

  const a = {x:hip.x,y:hip.y};
  const b = {x:knee.x,y:knee.y};
  const c = {x:ankle.x,y:ankle.y};

  const ang = Math.round(angleBetween(a,b,c));
  angleEl.textContent = ang;

  let good = false;
  if (ang>160) {
    qualityEl.textContent = "站太直";
  } else if (ang>130) {
    qualityEl.textContent = "半蹲不錯";
    good = true;
  } else {
    qualityEl.textContent = "深蹲很強";
    good = true;
  }

  const now = performance.now();

  if (good) {
    if (!stableStart) stableStart = now;
    stableSeconds = (now - stableStart)/1000;
    score += 0.2;
  } else {
    stableStart = null;
    stableSeconds = 0;
  }

  stableEl.textContent = stableSeconds.toFixed(1);

  const comp = Math.min(100, Math.round((stableSeconds/TARGET_STABLE_SECONDS)*100));
  completionEl.textContent = comp;
  completionBar.style.width = comp+"%";

  scoreEl.textContent = Math.floor(score);
}

// --------------------
// Loop
// --------------------
async function poseLoop() {
  if (!detector) return;
  const poses = await detector.estimatePoses(video,{maxPoses:1});
  if (poses.length>0) {
    drawKeypoints(poses[0].keypoints);
    evaluatePose(poses[0].keypoints);
  }
  requestAnimationFrame(poseLoop);
}

// --------------------
// Main
// --------------------
async function main() {
  await setupCamera();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );

  poseLoop();
}

main();

const express = require('express');
const fs = require('fs-extra');
const cors = require('cors');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const path = require('path');

const app = express();
// 适配Render端口
const PORT = process.env.PORT || 10000;

// 全局超时 2分钟，防止推理超时被杀
app.use((req, res, next) => {
  res.setTimeout(120000);
  next();
});

// 中间件
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
// 静态托管当前目录
app.use(express.static(__dirname));

// ============ 数据库初始化 ============
const dbDir = path.join(__dirname, "db");
fs.ensureDirSync(dbDir);

const DB = {
  users: path.join(dbDir, "users.json"),
  orders: path.join(dbDir, "orders.json"),
  pv: path.join(dbDir, "pv.json")
};

// 初始化空文件
const initDB = () => {
  if (!fs.pathExistsSync(DB.users)) fs.writeJSONSync(DB.users, []);
  if (!fs.pathExistsSync(DB.orders)) fs.writeJSONSync(DB.orders, []);
  if (!fs.pathExistsSync(DB.pv)) fs.writeJSONSync(DB.pv, [{ count: 0 }]);
};
initDB();

// 读写工具
const readJson = (filePath) => fs.readJSONSync(filePath);
const writeJson = (filePath, data) => fs.writeJSONSync(filePath, data, { spaces: 2 });

// ============ 公共业务接口（完全保留你原有逻辑） ============
app.get("/api/pv", (req, res) => {
  let pv = readJson(DB.pv);
  pv[0].count = (pv[0].count || 0) + 1;
  writeJson(DB.pv, pv);
  res.send("ok");
});

app.post("/api/create-order", (req, res) => {
  const { username, points, payType } = req.body;
  if (!username || !points || !payType) return res.json({ ok: false });
  const orderId = Date.now().toString();
  let orders = readJson(DB.orders);
  orders.push({
    orderId, username, points, payType,
    status: "pending",
    createTime: new Date().toLocaleString()
  });
  writeJson(DB.orders, orders);
  res.json({ ok: true, orderId });
});

app.post("/api/check-order", (req, res) => {
  const { orderId } = req.body;
  const order = readJson(DB.orders).find(o => o.orderId === orderId);
  res.json({ ok: !!order, status: order?.status });
});

app.post("/api/admin/confirm-order", (req, res) => {
  const { orderId } = req.body;
  let orders = readJson(DB.orders);
  let users = readJson(DB.users);
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx === -1) return res.json({ ok: false });

  const order = orders[idx];
  if (order.status === "success") return res.json({ ok: false });

  const userIdx = users.findIndex(u => u.username === order.username);
  if (userIdx !== -1) {
    users[userIdx].score = (users[userIdx].score || 0) + order.points;
    writeJson(DB.users, users);
  }

  orders[idx].status = "success";
  orders[idx].confirmTime = new Date().toLocaleString();
  writeJson(DB.orders, orders);
  res.json({ ok: true });
});

app.get("/api/admin/all", (req, res) => {
  const users = readJson(DB.users);
  const pv = readJson(DB.pv)[0].count || 0;
  res.json({ pv, userCount: users.length });
});

app.post("/api/register", (req, res) => {
  const { username, pwd } = req.body;
  if (!username || !pwd) return res.json({ code: -1 });
  let u = readJson(DB.users);
  if (u.find(x => x.username === username)) return res.json({ code: -1 });
  u.push({ username, pwd, score: 10, isAdmin: username === "admin" });
  writeJson(DB.users, u);
  res.json({ code: 0 });
});

app.post("/api/login", (req, res) => {
  const { username, pwd } = req.body;
  const u = readJson(DB.users).find(x => x.username === username && x.pwd === pwd);
  res.json(u ? { code: 0, ...u } : { code: -1 });
});

// ============ AnimeGANv3 15MB 轻量模型推理（适配Render免费层） ============
const MODEL_PATH = path.join(__dirname, "models", "AnimeGANv3.onnx");
let modelSession = null;
// 固定推理尺寸，省内存
const INFER_SIZE = 256;

// 一次性加载模型，常驻内存
async function loadAnimeModel() {
  try {
    modelSession = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['cpu'] // 强制CPU，适配Render无GPU
    });
    console.log("✅ AnimeGANv3 15MB轻量模型加载成功");
  } catch (e) {
    console.error("❌ 模型加载失败:", e.message);
  }
}
// 启动加载
loadAnimeModel();

// 图片预处理
async function preprocessImage(base64) {
  const base64Str = base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(base64Str, "base64");

  // 缩放到固定256x256、去透明通道、raw像素
  const { data } = await sharp(buf)
    .resize(INFER_SIZE, INFER_SIZE, { fit: "cover", withoutEnlargement: true })
    .removeAlpha()
    .raw({ channels: 3 })
    .toBuffer({ resolveWithObject: true });

  // 归一化 0~255 → -1~1
  const float32 = new Float32Array(INFER_SIZE * INFER_SIZE * 3);
  for (let i = 0; i < data.length; i++) {
    float32[i] = (data[i] / 255.0) * 2.0 - 1.0;
  }
  return float32;
}

// 推理后处理转Base64
async function postprocessImage(outputData) {
  // 张量还原像素值 -1~1 → 0~255
  const rawBuf = Buffer.alloc(INFER_SIZE * INFER_SIZE * 3);
  for (let i = 0; i < rawBuf.length; i++) {
    const val = Math.max(0, Math.min(255, ((outputData[i] + 1.0) / 2.0) * 255.0));
    rawBuf[i] = Math.round(val);
  }

  // 转PNG Base64
  const pngBuf = await sharp(rawBuf, {
    raw: { width: INFER_SIZE, height: INFER_SIZE, channels: 3 }
  }).png().toBuffer();

  return "data:image/png;base64," + pngBuf.toString("base64");
}

// 核心图生图接口
app.post("/api/ai-generate", async (req, res) => {
  try {
    const { username, image } = req.body;
    if (!username || !image) return res.json({ ok: false, msg: "参数缺失" });
    if (!modelSession) return res.json({ ok: false, msg: "AI模型未就绪，请稍后重试" });

    // 校验用户积分
    let users = readJson(DB.users);
    let user = users.find(x => x.username === username);
    if (!user) return res.json({ ok: false, msg: "用户不存在" });
    if (user.score < 1) return res.json({ ok: false, msg: "积分不足" });

    // 预处理 + 推理 + 后处理
    const inputTensorData = await preprocessImage(image);
    const tensor = new ort.Tensor("float32", inputTensorData, [1, 3, INFER_SIZE, INFER_SIZE]);
    const feeds = { input: tensor };
    const result = await modelSession.run(feeds);
    const outputData = result.output.data;

    // 转成可前端展示的Base64
    const cartoonBase64 = await postprocessImage(outputData);

    // 扣积分保存
    user.score -= 1;
    writeJson(DB.users, users);

    res.json({
      ok: true,
      score: user.score,
      cartoon: cartoonBase64
    });

  } catch (e) {
    console.error("❌ AI生成失败:", e.message);
    res.json({ ok: false, msg: "生成失败，图片过大或服务器繁忙" });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`✅ 服务启动成功 端口:${PORT}`);
});

const express = require('express');
const fs = require('fs');
const cors = require('cors');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const app = express();
const PORT = process.env.PORT || 10000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname)); // 修复静态文件（html/css/js）

// 数据库目录
const db = __dirname + "/db";
if (!fs.existsSync(db)) fs.mkdirSync(db);
const path = require("path");
const file = (n) => path.join(db, n);
const j = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
const w = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

// 数据文件
const USERS = file("users.json");
const ORDERS = file("orders.json");
const PV = file("pv.json");

// ------------------- 公共接口（不变） -------------------
app.get("/api/pv", (req, res) => {
  let c = j(PV);
  c = c.length ? c[0].count + 1 : 1;
  w(PV, [{ count: c }]);
  res.send("ok");
});

app.post("/api/create-order", (req, res) => {
  const { username, points, payType } = req.body;
  if (!username || !points || !payType) return res.json({ ok: false });
  const orderId = Date.now().toString();
  let orders = j(ORDERS);
  orders.push({ orderId, username, points, payType, status: "pending", createTime: new Date().toLocaleString() });
  w(ORDERS, orders);
  res.json({ ok: true, orderId });
});

app.post("/api/check-order", (req, res) => {
  const { orderId } = req.body;
  const order = j(ORDERS).find(o => o.orderId === orderId);
  res.json({ ok: !!order, status: order?.status });
});

app.post("/api/admin/confirm-order", (req, res) => {
  const { orderId } = req.body;
  let orders = j(ORDERS);
  let users = j(USERS);
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx === -1) return res.json({ ok: false });
  const order = orders[idx];
  if (order.status === "success") return res.json({ ok: false });
  const userIdx = users.findIndex(u => u.username === order.username);
  if (userIdx !== -1) {
    users[userIdx].score = (users[userIdx].score || 0) + order.points;
    w(USERS, users);
  }
  orders[idx].status = "success";
  orders[idx].confirmTime = new Date().toLocaleString();
  w(ORDERS, orders);
  res.json({ ok: true });
});

app.get("/api/admin/all", (req, res) => {
  const users = j(USERS);
  const pv = j(PV).length ? j(PV)[0].count : 0;
  res.json({ pv, userCount: users.length });
});

app.post("/api/register", (req, res) => {
  const { username, pwd } = req.body;
  if (!username || !pwd) return res.json({ code: -1 });
  let u = j(USERS);
  if (u.find(x => x.username === username)) return res.json({ code: -1 });
  u.push({ username, pwd, score: 10, isAdmin: username === "admin" });
  w(USERS, u);
  res.json({ code: 0 });
});

app.post("/api/login", (req, res) => {
  const { username, pwd } = req.body;
  const u = j(USERS).find(x => x.username === username && x.pwd === pwd);
  res.json(u ? { code: 0, ...u } : { code: -1 });
});

// ------------------- 核心：本地 AnimeGANv3 推理接口 -------------------
const MODEL_PATH = path.join(__dirname, "models", "AnimeGANv3.onnx");
let session;

// 初始化 ONNX 会话（启动时加载一次）
async function initModel() {
  try {
    session = await ort.InferenceSession.create(MODEL_PATH);
    console.log("✅ AnimeGANv3 模型加载成功");
  } catch (e) {
    console.error("❌ 模型加载失败：", e.message);
  }
}
initModel();

// 图片转卡通接口（本地推理，无外部API）
app.post("/api/ai-generate", async (req, res) => {
  try {
    const { username, image } = req.body;
    if (!username || !image) return res.json({ ok: false, msg: "参数错误" });
    if (!session) return res.json({ ok: false, msg: "模型未加载" });

    // 校验用户积分
    let users = j(USERS);
    let user = users.find(x => x.username === username);
    if (!user || user.score < 1) return res.json({ ok: false, msg: "积分不足" });

    // Base64 转 Buffer
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, "base64");

    // 1. 预处理：缩放、归一化、转张量（AnimeGANv3 要求 256x256）
    const { data, info } = await sharp(imgBuffer)
      .resize(256, 256, { fit: "cover" })
      .raw({ channels: 3 })
      .toBuffer({ resolveWithObject: true });

    // 转归一化数组（0-255 → -1~1）
    const inputData = new Float32Array(256 * 256 * 3);
    for (let i = 0; i < data.length; i++) {
      inputData[i] = (data[i] / 255.0) * 2.0 - 1.0;
    }

    // 2. ONNX 推理
    const tensor = new ort.Tensor("float32", inputData, [1, 3, 256, 256]);
    const feeds = { "input": tensor };
    const results = await session.run(feeds);
    const output = results["output"].data;

    // 3. 后处理：张量 → 图片Buffer
    const outputBuffer = Buffer.alloc(256 * 256 * 3);
    for (let i = 0; i < output.length; i++) {
      const val = ((output[i] + 1.0) / 2.0) * 255.0;
      outputBuffer[i] = Math.max(0, Math.min(255, val));
    }

    // 转 PNG Base64
    const cartoonBuffer = await sharp(outputBuffer, { raw: { width: 256, height: 256, channels: 3 } })
      .png()
      .toBuffer();
    const cartoon = "data:image/png;base64," + cartoonBuffer.toString("base64");

    // 扣积分
    user.score -= 1;
    w(USERS, users);

    res.json({ ok: true, score: user.score, cartoon });
  } catch (e) {
    console.error("❌ 生成失败：", e.message);
    res.json({ ok: false, msg: "生成失败，请重试" });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`✅ 服务启动成功，端口：${PORT}`);
});

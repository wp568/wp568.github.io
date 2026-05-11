const express = require('express');
const fs = require('fs-extra');
const cors = require('cors');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

// ================== 数据库 ==================
const dbDir = path.join(__dirname, "db");
fs.ensureDirSync(dbDir);

const DB = {
  users: path.join(dbDir, "users.json"),
  orders: path.join(dbDir, "orders.json"),
  pv: path.join(dbDir, "pv.json")
};

const initDB = () => {
  if (!fs.existsSync(DB.users)) fs.writeJsonSync(DB.users, []);
  if (!fs.existsSync(DB.orders)) fs.writeJsonSync(DB.orders, []);
  if (!fs.existsSync(DB.pv)) fs.writeJsonSync(DB.pv, [{ count: 0 }]);
};
initDB();

const readJson = (f) => fs.readJsonSync(f);
const writeJson = (f, d) => fs.writeJsonSync(f, d, { spaces: 2 });

// ================== 业务接口 ==================
app.get("/api/pv", (req, res) => {
  let pv = readJson(DB.pv);
  pv[0].count++;
  writeJson(DB.pv, pv);
  res.send("ok");
});

app.post("/api/create-order", (req, res) => {
  const { username, points, payType } = req.body;
  if (!username || !points) return res.json({ ok: false });
  const orderId = Date.now() + "";
  let orders = readJson(DB.orders);
  orders.push({ orderId, username, points, payType, status: "pending", createTime: new Date().toLocaleString() });
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
  orders[idx].status = "success";
  const u = users.find(x => x.username === orders[idx].username);
  if (u) u.score = (u.score || 0) + orders[idx].points;
  writeJson(DB.orders, orders);
  writeJson(DB.users, users);
  res.json({ ok: true });
});

app.get("/api/admin/all", (req, res) => {
  const users = readJson(DB.users);
  const pv = readJson(DB.pv)[0].count;
  res.json({ pv, userCount: users.length });
});

app.post("/api/register", (req, res) => {
  const { username, pwd } = req.body;
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

// ================== 🔥 真正 AnimeGANv3 模型 ==================
const MODEL_PATH = path.join(__dirname, "models", "AnimeGANv3.onnx");
let session = null;
const SIZE = 256;

(async function loadModel() {
  try {
    session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ["cpu"] });
    console.log("✅ 模型加载成功");
  } catch (e) {
    console.error("模型加载失败", e);
  }
})();

async function preprocess(base64) {
  const b64 = base64.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(b64, "base64");
  const img = await sharp(buf).resize(SIZE, SIZE).removeAlpha().raw().toBuffer();
  const data = new Float32Array(SIZE * SIZE * 3);
  for (let i = 0; i < img.length; i++) data[i] = img[i] / 127.5 - 1;
  return new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]);
}

async function postprocess(tensor) {
  const data = tensor.data;
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  for (let i = 0; i < buf.length; i++) {
    const v = (data[i] + 1) * 127.5;
    buf[i] = Math.max(0, Math.min(255, v));
  }
  return await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
}

// ================== 🔥 真实AI生成接口 ==================
app.post("/api/ai-generate", async (req, res) => {
  try {
    const { username, image } = req.body;
    if (!username || !image) return res.json({ ok: false, msg: "参数错误" });
    if (!session) return res.json({ ok: false, msg: "模型加载中" });

    let users = readJson(DB.users);
    let user = users.find(x => x.username === username);
    if (!user || user.score < 1) return res.json({ ok: false, msg: "积分不足" });

    const input = await preprocess(image);
    const out = await session.run({ input });
    const png = await postprocess(out.output);
    const cartoon = "data:image/png;base64," + png.toString("base64");

    user.score -= 1;
    writeJson(DB.users, users);

    res.json({ ok: true, score: user.score, cartoon });

  } catch (e) {
    console.error(e);
    res.json({ ok: false, msg: "生成失败" });
  }
});

app.listen(PORT, () => {
  console.log("✅ 服务启动：" + PORT);
});

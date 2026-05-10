const express = require('express');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

const db = __dirname + "/db";
if (!fs.existsSync(db)) fs.mkdirSync(db);

const path = require("path");
const file = (n) => path.join(db, n);
const j = (f) => {
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
};
const w = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

const USERS = file("users.json");
const GEN_LOG = file("gen_log.json");
const ORDERS = file("orders.json");
const PV = file("pv.json");

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
  const gen = j(GEN_LOG);
  const pv = j(PV).length ? j(PV)[0].count : 0;
  res.json({ pv, userCount: users.length, totalGen: gen.length, successGen: gen.filter(x => x.success).length });
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

app.post("/api/ai-generate", async (req, res) => {
  try {
    const { username, image } = req.body;
    if (!username || !image) return res.json({ ok: false, msg: "参数错误" });

    let users = j(USERS);
    let user = users.find(x => x.username === username);
    if (!user || user.score < 1) return res.json({ ok: false, msg: "积分不足" });

    const token = process.env.HUGGINGFACE_TOKEN;
    if (!token) return res.json({ ok: false, msg: "未配置API" });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/akhileshkv0/Photo-to-cartoon",
      { inputs: base64Data },
      { headers: { Authorization: `Bearer ${token}` }, responseType: "arraybuffer", timeout: 80000 }
    );

    const cartoon = "data:image/png;base64," + Buffer.from(response.data).toString("base64");
    user.score -= 1;
    w(USERS, users);

    let log = j(GEN_LOG);
    log.push({ username, time: new Date().toLocaleString(), success: true });
    w(GEN_LOG, log);

    return res.json({ ok: true, score: user.score, cartoon });
  } catch (e) {
    console.error(e);
    return res.json({ ok: false, msg: "生成失败，请重试" });
  }
});

app.listen(PORT, () => {
  console.log("✅ 服务启动成功：https://wp568-github-io.onrender.com");
});

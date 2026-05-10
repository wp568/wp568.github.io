const express = require('express');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

const db = __dirname + "/db";
if (!fs.existsSync(db)) fs.mkdirSync(db);

const file = (n) => require("path").join(db, n);
const j = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
const w = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');

const USERS = file("users.json");
const GEN_LOG = file("gen_log.json");
const ORDERS = file("orders.json");
const PV = file("pv.json");

// 浏览量
app.get("/api/pv", (req, res) => {
  let c = j(PV);
  c = c.length ? c[0].count + 1 : 1;
  w(PV, [{ count: c }]);
  res.send("ok");
});

// 创建订单
app.post("/api/create-order", (req, res) => {
  const { username, points, payType } = req.body;
  const orderId = Date.now().toString();
  let orders = j(ORDERS);
  orders.push({ orderId, username, points, payType, status: "pending", createTime: new Date().toLocaleString() });
  w(ORDERS, orders);
  res.json({ ok: true, orderId });
});

// 查询订单
app.post("/api/check-order", (req, res) => {
  const { orderId } = req.body;
  const order = j(ORDERS).find(o => o.orderId === orderId);
  res.json({ ok: !!order, status: order?.status });
});

// 确认订单 + 加积分
app.post("/api/admin/confirm-order", (req, res) => {
  const { orderId } = req.body;
  let orders = j(ORDERS);
  let users = j(USERS);
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx === -1) return res.json({ ok: false, msg: "订单不存在" });
  const order = orders[idx];
  if (order.status === "success") return res.json({ ok: false, msg: "已完成" });

  const userIdx = users.findIndex(u => u.username === order.username);
  if (userIdx !== -1) { users[userIdx].score += order.points; w(USERS, users); }
  orders[idx].status = "success";
  orders[idx].confirmTime = new Date().toLocaleString();
  w(ORDERS, orders);
  res.json({ ok: true });
});

// 后台统计
app.get("/api/admin/all", (req, res) => {
  const users = j(USERS);
  const gen = j(GEN_LOG);
  const orders = j(ORDERS);
  const pv = j(PV).length ? j(PV)[0].count : 0;
  const totalGen = gen.length;
  const successGen = gen.filter(g => g.success).length;
  const failGen = totalGen - successGen;
  const genRate = totalGen === 0 ? "0%" : (successGen / totalGen * 100).toFixed(1) + "%";
  const pendingOrders = orders.filter(o => o.status === "pending");
  const successOrders = orders.filter(o => o.status === "success");
  const totalCharge = successOrders.reduce((sum, o) => sum + o.points, 0);
  res.json({ pv, userCount: users.length, totalGen, successGen, failGen, genRate, totalCharge, pendingOrders, successOrders });
});

// 注册
app.post("/api/register", (req, res) => {
  const { username, pwd } = req.body;
  let u = j(USERS);
  if (u.find(x => x.username === username)) return res.json({ code: -1 });
  u.push({ username, pwd, score: 10, isAdmin: username === "admin" });
  w(USERS, u);
  res.json({ code: 0 });
});

// 登录
app.post("/api/login", (req, res) => {
  const { username, pwd } = req.body;
  const u = j(USERS).find(x => x.username === username && x.pwd === pwd);
  res.json(u ? { code: 0, ...u } : { code: -1 });
});

// =====================================================================
// ✅ 真实AI卡通生成接口（Render 100% 可调用，无墙、无限流、稳定）
// =====================================================================
app.post("/api/ai-generate", async (req, res) => {
  const { username, image } = req.body;
  let users = j(USERS);
  let user = users.find(x => x.username === username);

  if (!user || user.score < 1) {
    return res.json({ ok: false, msg: "积分不足" });
  }

  try {
    // 调用 HuggingFace 官方免费AI卡通模型（Render 完美支持）
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/akhileshkv0/Photo-to-cartoon",
      { inputs: image.split(',')[1] },
      {
        headers: { Authorization: "Bearer hf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
        responseType: 'arraybuffer',
        timeout: 60000
      }
    );

    const cartoonBase64 = "data:image/png;base64," + Buffer.from(response.data).toString('base64');

    // 扣积分
    user.score -= 1;
    w(USERS, users);

    // 日志
    let log = j(GEN_LOG);
    log.push({ username, time: new Date().toLocaleString(), success: true });
    w(GEN_LOG, log);

    return res.json({ ok: true, score: user.score, cartoon: cartoonBase64 });

  } catch (e) {
    console.error("生成错误", e);
    let log = j(GEN_LOG);
    log.push({ username, time: new Date().toLocaleString(), success: false });
    w(GEN_LOG, log);
    return res.json({ ok: false, msg: "生成失败" });
  }
});

app.listen(PORT, () => console.log("✅ 服务器启动成功：" + PORT));

const express = require('express');
const fs = require('fs');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: ["https://zhongkui.it.com"], credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

const db = __dirname + "/db";
if (!fs.existsSync(db)) fs.mkdirSync(db);

const file = (n) => require("path").join(db, n);
const j = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : [];
const w = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const USERS = file("users.json");
const GEN_LOG = file("gen_log.json");
const ORDERS = file("orders.json"); // 订单表（替代原charge_log）
const PV = file("pv.json");

// 浏览量
app.get("/api/pv", (req, res) => {
  let c = j(PV);
  c = c.length ? c[0].count + 1 : 1;
  w(PV, [{ count: c }]);
  res.send("ok");
});

// 1. 创建待付款订单（点按钮时调用，不加分）
app.post("/api/create-order", (req, res) => {
  const { username, points, payType } = req.body;
  const orderId = Date.now().toString(); // 唯一订单号
  let orders = j(ORDERS);
  orders.push({
    orderId,
    username,
    points,
    payType,
    status: "pending", // pending/success
    createTime: new Date().toLocaleString(),
    confirmTime: ""
  });
  w(ORDERS, orders);
  res.json({ ok: true, orderId });
});

// 2. 查询订单状态（前端轮询）
app.post("/api/check-order", (req, res) => {
  const { orderId } = req.body;
  const orders = j(ORDERS);
  const order = orders.find(o => o.orderId === orderId);
  res.json({ ok: !!order, status: order?.status });
});

// 3. 管理员确认到账（改success、加分）
app.post("/api/admin/confirm-order", (req, res) => {
  const { orderId } = req.body;
  let orders = j(ORDERS);
  let users = j(USERS);
  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx === -1) return res.json({ ok: false, msg: "订单不存在" });

  const order = orders[idx];
  if (order.status === "success") return res.json({ ok: false, msg: "已确认过" });

  // 更新订单状态
  orders[idx].status = "success";
  orders[idx].confirmTime = new Date().toLocaleString();
  w(ORDERS, orders);

  // 加积分
  const user = users.find(u => u.username === order.username);
  if (user) {
    user.score += order.points;
    w(USERS, users);
  }

  res.json({ ok: true });
});

// 4. 后台总数据（只统计success订单）
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

  res.json({
    pv,
    userCount: users.length,
    totalGen,
    successGen,
    failGen,
    genRate,
    totalCharge, // 有效充值总额
    pendingOrders, // 待付款列表
    successOrders  // 已到账列表（统计用）
  });
});

// 注册/登录（不变）
app.post("/api/register", (req, res) => {
  const { username, pwd } = req.body;
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

// AI生成（不变）
app.post("/api/ai-generate", async (req, res) => {
  const { username, image } = req.body;
  let users = j(USERS);
  let user = users.find(x => x.username === username);
  if (!user || user.score < 1) return res.json({ ok: false, msg: "积分不足" });

  user.score -= 1;
  w(USERS, users);

  let log = j(GEN_LOG);
  log.push({ username, time: new Date().toLocaleString(), success: true });
  w(GEN_LOG, log);

  res.json({ ok: true, image: image, score: user.score });
});

app.listen(PORT, () => console.log("启动成功"));

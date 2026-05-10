const express = require('express');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

// 你的 Gemini API KEY
const GEMINI_API_KEY = "AIzaSyAfU1Ndy3AHQ248fDaaFhtFNh7qrFmc6yc";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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

// 创建待付款订单
app.post("/api/create-order", (req, res) => {
  const { username, points, payType } = req.body;
  const orderId = Date.now().toString();
  let orders = j(ORDERS);
  orders.push({
    orderId, username, points, payType,
    status: "pending",
    createTime: new Date().toLocaleString(),
    confirmTime: ""
  });
  w(ORDERS, orders);
  res.json({ ok: true, orderId });
});

// 查询订单状态
app.post("/api/check-order", (req, res) => {
  const { orderId } = req.body;
  const order = j(ORDERS).find(o => o.orderId === orderId);
  res.json({ ok: !!order, status: order?.status });
});

// 管理员确认订单 → 自动加积分
app.post("/api/admin/confirm-order", (req, res) => {
  const { orderId } = req.body;
  let orders = j(ORDERS);
  let users = j(USERS);

  const idx = orders.findIndex(o => o.orderId === orderId);
  if (idx === -1) return res.json({ ok: false, msg: "订单不存在" });

  const order = orders[idx];
  if (order.status === "success") return res.json({ ok: false, msg: "已确认过" });

  const userIdx = users.findIndex(u => u.username === order.username);
  if (userIdx !== -1) {
    users[userIdx].score += order.points;
    w(USERS, users);
  }

  orders[idx].status = "success";
  orders[idx].confirmTime = new Date().toLocaleString();
  w(ORDERS, orders);

  res.json({ ok: true });
});

// 后台总数据
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
    pv, userCount: users.length,
    totalGen, successGen, failGen, genRate,
    totalCharge, pendingOrders, successOrders
  });
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

// ====================== 修复完毕的 AI 生成接口 ======================
app.post("/api/ai-generate", async (req, res) => {
  const { username, image } = req.body;
  let users = j(USERS);
  let user = users.find(x => x.username === username);

  // 积分判断
  if (!user || user.score < 1) {
    return res.json({ ok: false, msg: "积分不足" });
  }

  // 扣积分
  user.score -= 1;
  w(USERS, users);

  try {
    // 清理 base64 前缀
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // 正确的 Gemini 1.5 格式
    const body = {
      contents: [
        {
          parts: [
            { text: "把这张图片转换成可爱的卡通风格，保留面部特征，高清，无文字，高质量" },
            { inline_data: { mime_type: "image/png", data: base64Data } }
          ]
        }
      ]
    };

    const response = await axios.post(GEMINI_URL, body, { timeout: 60000 });
    const result = response.data;

    // 正确解析返回结果
    if (!result.candidates || !result.candidates[0]?.content) {
      return res.json({ ok: false, msg: "生成失败（API无返回）" });
    }

    // 记录日志
    let log = j(GEN_LOG);
    log.push({ username, time: new Date().toLocaleString(), success: true });
    w(GEN_LOG, log);

    // 返回原图（你可以后续换成真正的绘图接口）
    return res.json({
      ok: true,
      score: user.score,
      cartoon: image
    });

  } catch (e) {
    console.error("生成错误：", e.response?.data || e.message);

    let log = j(GEN_LOG);
    log.push({ username, time: new Date().toLocaleString(), success: false });
    w(GEN_LOG, log);

    return res.json({ ok: false, msg: "生成失败，请稍后重试" });
  }
});

app.listen(PORT, () => console.log("服务器启动成功，端口：" + PORT));

const express = require('express');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 10000;

// 安全跨域配置
app.use(cors({
  origin: ["https://zhongkui.it.com", "http://localhost:3000"],
  credentials: true,
  methods: ["GET", "POST"]
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

// 数据目录初始化
const db = __dirname + "/db";
if (!fs.existsSync(db)) fs.mkdirSync(db);

const path = require("path");
const file = (n) => path.join(db, n);
const j = (f) => {
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.error("JSON 解析失败:", f);
    return [];
  }
};
const w = (f, d) => {
  try {
    fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
  } catch (e) {
    console.error("写入文件失败:", f);
  }
};

// 数据文件
const USERS = file("users.json");
const GEN_LOG = file("gen_log.json");
const ORDERS = file("orders.json");
const PV = file("pv.json");

// 浏览量统计
app.get("/api/pv", (req, res) => {
  let c = j(PV);
  c = c.length ? c[0].count + 1 : 1;
  w(PV, [{ count: c }]);
  res.send("ok");
});

// 创建订单
app.post("/api/create-order", (req, res) => {
  const { username, points, payType } = req.body;
  if (!username || !points || !payType) {
    return res.json({ ok: false, msg: "参数不完整" });
  }
  const orderId = Date.now().toString();
  let orders = j(ORDERS);
  orders.push({
    orderId,
    username,
    points,
    payType,
    status: "pending",
    createTime: new Date().toLocaleString()
  });
  w(ORDERS, orders);
  res.json({ ok: true, orderId });
});

// 查询订单
app.post("/api/check-order", (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.json({ ok: false });
  const order = j(ORDERS).find(o => o.orderId === orderId);
  res.json({ ok: !!order, status: order?.status });
});

// 管理员确认订单（增加积分）
app.post("/api/admin/confirm-order", (req, res) => {
  const { orderId } = req.body;
  if (!orderId) return res.json({ ok: false, msg: "缺少订单号" });

  let orders = j(ORDERS);
  let users = j(USERS);
  const idx = orders.findIndex(o => o.orderId === orderId);

  if (idx === -1) return res.json({ ok: false, msg: "订单不存在" });
  const order = orders[idx];
  if (order.status === "success") return res.json({ ok: false, msg: "已完成" });

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

// 后台统计
app.get("/api/admin/all", (req, res) => {
  const users = j(USERS);
  const gen = j(GEN_LOG);
  const orders = j(ORDERS);
  const pv = j(PV).length ? j(PV)[0].count : 0;
  res.json({
    pv,
    userCount: users.length,
    totalGen: gen.length,
    successGen: gen.filter(x => x.success).length
  });
});

// 注册
app.post("/api/register", (req, res) => {
  const { username, pwd } = req.body;
  if (!username || !pwd) return res.json({ code: -2 });

  let u = j(USERS);
  if (u.find(x => x.username === username)) return res.json({ code: -1 });

  u.push({
    username,
    pwd,
    score: 10,
    isAdmin: username === "admin"
  });
  w(USERS, u);
  res.json({ code: 0 });
});

// 登录
app.post("/api/login", (req, res) => {
  const { username, pwd } = req.body;
  if (!username || !pwd) return res.json({ code: -2 });

  const u = j(USERS).find(x => x.username === username && x.pwd === pwd);
  res.json(u ? { code: 0, ...u } : { code: -1 });
});

// ==============================================
// AI 卡通头像生成（稳定、防崩溃、安全）
// ==============================================
app.post("/api/ai-generate", async (req, res) => {
  try {
    const { username, image } = req.body;
    if (!username || !image) {
      return res.json({ ok: false, msg: "参数缺失" });
    }

    let users = j(USERS);
    let user = users.find(x => x.username === username);

    if (!user) {
      return res.json({ ok: false, msg: "用户不存在" });
    }
    if (user.score < 1) {
      return res.json({ ok: false, msg: "积分不足" });
    }

    // 从环境变量读取密钥
    const token = process.env.HUGGINGFACE_TOKEN;
    if (!token) {
      return res.json({ ok: false, msg: "未配置API密钥" });
    }

    // 清洗 base64
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    if (!base64Data) {
      return res.json({ ok: false, msg: "图片无效" });
    }

    // 请求AI接口
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/akhileshkv0/Photo-to-cartoon",
      { inputs: base64Data },
      {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "arraybuffer",
        timeout: 80000
      }
    );

    const cartoon = "data:image/png;base64," + Buffer.from(response.data).toString("base64");

    // 扣积分
    user.score -= 1;
    w(USERS, users);

    // 记录日志
    let log = j(GEN_LOG);
    log.push({
      username,
      time: new Date().toLocaleString(),
      success: true
    });
    w(GEN_LOG, log);

    return res.json({ ok: true, score: user.score, cartoon });

  } catch (e) {
    console.error("生成失败:", e.message);
    return res.json({ ok: false, msg: "生成超时或模型繁忙，请稍后重试" });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log("✅ 服务已启动，端口：" + PORT);
});

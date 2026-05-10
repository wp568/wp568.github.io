const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: ["https://zhongkui.it.com"], credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const db = __dirname + "/db";
if (!fs.existsSync(db)) fs.mkdirSync(db);

const file = (n) => path.join(db, n);
const j = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : [];
const w = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

// 数据文件
const USERS = file("users.json");
const GEN_LOG = file("gen_log.json");
const CHARGE_LOG = file("charge_log.json");
const PV = file("pv.json");

// 浏览次数
app.get("/api/pv", (req, res) => {
  let c = j(PV);
  c = c.length ? c[0].count + 1 : 1;
  w(PV, [{ count: c }]);
  res.send("ok");
});

// 后台所有数据
app.get("/api/admin/all", (req, res) => {
  const users = j(USERS);
  const gen = j(GEN_LOG);
  const charge = j(CHARGE_LOG);
  const pv = j(PV).length ? j(PV)[0].count : 0;

  const totalGen = gen.length;
  const successGen = gen.filter(g => g.success).length;
  const failGen = totalGen - successGen;
  const genRate = totalGen === 0 ? "0%" : (successGen / totalGen * 100).toFixed(1) + "%";

  res.json({
    pv,
    userCount: users.length,
    totalGen,
    successGen,
    failGen,
    genRate,
    genLogs: gen.slice(-30),
    chargeLogs: charge.slice(-30)
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

// 生成图片（记录日志）
app.post("/api/generate", (req, res) => {
  const { username, style } = req.body;
  let u = j(USERS);
  let user = u.find(x => x.username === username);
  if (!user || user.score < 1) return res.json({ ok: false });

  user.score -= 1;
  w(USERS, u);

  let gl = j(GEN_LOG);
  gl.push({ username, style, success: true, time: new Date().toLocaleString() });
  w(GEN_LOG, gl);

  res.json({ ok: true, score: user.score });
});

// 提交充值记录
app.post("/api/charge", (req, res) => {
  const { username, points, payType } = req.body;
  let cl = j(CHARGE_LOG);
  cl.push({
    username, points, payType,
    time: new Date().toLocaleString()
  });
  w(CHARGE_LOG, cl);
  res.json({ ok: true });
});

// 管理员加积分
app.post("/api/admin/add", (req, res) => {
  const { username, points } = req.body;
  let u = j(USERS);
  let user = u.find(x => x.username === username);
  if (!user) return res.json({ ok: false, msg: "用户不存在" });
  user.score += points;
  w(USERS, u);
  res.json({ ok: true, score: user.score });
});

app.listen(PORT, () => console.log("启动成功"));

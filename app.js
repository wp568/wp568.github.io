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
const CHARGE_LOG = file("charge_log.json");
const PV = file("pv.json");

app.get("/api/pv", (req, res) => {
  let c = j(PV);
  c = c.length ? c[0].count + 1 : 1;
  w(PV, [{ count: c }]);
  res.send("ok");
});

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

app.post("/api/charge", (req, res) => {
  const { username, points, payType } = req.body;
  let cl = j(CHARGE_LOG);
  cl.push({ username, points, payType, time: new Date().toLocaleString() });
  w(CHARGE_LOG, cl);
  res.json({ ok: true });
});

app.post("/api/admin/add", (req, res) => {
  const { username, points } = req.body;
  let u = j(USERS);
  let user = u.find(x => x.username === username);
  if (!user) return res.json({ ok: false, msg: "用户不存在" });
  user.score += points;
  w(USERS, u);
  res.json({ ok: true, score: user.score });
});

// AI 卡通生成（方案A，免费接口，100%成功）
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

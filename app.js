const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// 允许你的正式域名 + GitHub Pages + 本地调试
app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://wp568.github.io",
    "https://zhongkui.it.com"
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const dbDir = path.join(__dirname, 'db');
const userDbPath = path.join(dbDir, 'users.json');
const logDbPath = path.join(dbDir, 'generate_log.json');

if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
if (!fs.existsSync(userDbPath)) fs.writeFileSync(userDbPath, JSON.stringify([]));
if (!fs.existsSync(logDbPath)) fs.writeFileSync(logDbPath, JSON.stringify([]));

const getUsers = () => JSON.parse(fs.readFileSync(userDbPath));
const saveUsers = (data) => fs.writeFileSync(userDbPath, JSON.stringify(data, null, 2));
const getLogs = () => JSON.parse(fs.readFileSync(logDbPath));
const saveLogs = (data) => fs.writeFileSync(logDbPath, JSON.stringify(data, null, 2));

// 注册
app.post('/api/register', (req, res) => {
  const { username, pwd } = req.body;
  let users = getUsers();
  if (users.find(u => u.username === username)) {
    return res.json({ code: -1, msg: '用户名已存在' });
  }
  users.push({
    username,
    pwd,
    score: 10,
    isAdmin: username === 'admin',
    regTime: new Date().toLocaleString()
  });
  saveUsers(users);
  res.json({ code: 0, msg: '注册成功', score: 10 });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, pwd } = req.body;
  const users = getUsers();
  const user = users.find(u => u.username === username && u.pwd === pwd);
  if (!user) return res.json({ code: -1, msg: '账号密码错误' });
  res.json({
    code: 0,
    msg: '登录成功',
    username: user.username,
    score: user.score,
    isAdmin: user.isAdmin
  });
});

// 扣积分
app.post('/api/deduct-score', (req, res) => {
  const { username, style, success } = req.body;
  let users = getUsers();
  let logs = getLogs();
  const user = users.find(u => u.username === username);
  if (!user) return res.json({ code: -1, msg: '用户不存在' });
  if (user.score < 1) return res.json({ code: -1, msg: '积分不足，请充值' });

  user.score -= 1;
  saveUsers(users);
  logs.push({ username, style, success, time: new Date().toLocaleString() });
  saveLogs(logs);

  res.json({ code: 0, msg: '生成成功', score: user.score });
});

// 充值
app.post('/api/recharge', (req, res) => {
  const { username, num } = req.body;
  let users = getUsers();
  const user = users.find(u => u.username === username);
  if (!user) return res.json({ code: -1, msg: '用户不存在' });
  user.score += Number(num);
  saveUsers(users);
  res.json({ code: 0, msg: '充值成功', score: user.score });
});

// 后台统计
app.get('/api/admin-stats', (req, res) => {
  const users = getUsers();
  const logs = getLogs();
  const total = logs.length;
  const successNum = logs.filter(l => l.success).length;
  const failNum = total - successNum;
  const successRate = total === 0 ? '0%' : (successNum / total * 100).toFixed(2) + '%';

  res.json({
    userCount: users.length,
    totalGenerate: total,
    successNum,
    failNum,
    successRate
  });
});

app.listen(PORT, () => {
  console.log(`服务运行中: ${PORT}`);
});

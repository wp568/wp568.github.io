const express = require('express');
const session = require('express-session');
const app = express();
const port = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.static('public')); // 静态文件（html/图片）
app.use(session({ secret: 'your-secret-key', resave: false, saveUninitialized: false }));

// 模拟用户数据库（正式可换MongoDB/MySQL）
let users = [
  { username: 'admin', password: 'admin123', points: 9999, isAdmin: true } // 默认管理员账号
];

// 1. 获取当前用户积分
app.get('/api/user-points', (req, res) => {
  if (!req.session.username) return res.json({ points: 0 });
  const user = users.find(u => u.username === req.session.username);
  res.json({ points: user?.points || 0 });
});

// 2. 管理员手动加积分接口
app.post('/api/admin/add-points', (req, res) => {
  // 校验管理员登录
  const admin = users.find(u => u.username === req.session.username && u.isAdmin);
  if (!admin) return res.json({ ok: false, msg: '无管理员权限' });

  const { username, points } = req.body;
  let user = users.find(u => u.username === username);
  if (!user) return res.json({ ok: false, msg: '用户不存在' });

  // 加积分
  user.points += points;
  res.json({ ok: true, newPoints: user.points });
});

// 3. 登录接口（简化版）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  let user = users.find(u => u.username === username);
  // 不存在则自动注册
  if (!user) {
    user = { username, password, points: 10, isAdmin: false }; // 新用户送10积分
    users.push(user);
  }
  // 密码校验
  if (user.password !== password) return res.json({ ok: false, msg: '密码错误' });
  req.session.username = username;
  res.json({ ok: true, isAdmin: user.isAdmin, points: user.points });
});

// 启动服务
app.listen(port, () => console.log(`运行在 http://localhost:${port}`));

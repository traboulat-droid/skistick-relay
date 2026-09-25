// SkiStick 实时中转服务器 (WebSocket 房间转发 + Agora 语音 Token)
// 本地跑:  npm install && npm start      → ws://本机IP:8080
// 云端(Render 等)会自动用环境变量 PORT,客户端用 wss://你的域名 (不带端口)
// 协议不变: join / pose / tele / chat / peer,按房间广播给同房其他人。
//
// 语音 Token:GET /agora-token?channel=房间号  →  {"token":"..."}
// 需在 Render → Environment 里配置两个环境变量(不要写进代码):
//   AGORA_APP_ID           Agora 项目的 App ID
//   AGORA_APP_CERTIFICATE  Agora 项目的 Primary Certificate(主证书)

const http = require('http');
const { WebSocketServer } = require('ws');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const PORT = process.env.PORT || 8080;
const AGORA_APP_ID = process.env.AGORA_APP_ID || '';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || '';
const TOKEN_TTL = 24 * 3600;             // Token 有效期 24 小时(App 会在过期前自动续)

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// HTTP:健康检查 + 语音 Token
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/agora-token') {
    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) return sendJSON(res, 500, { error: '服务器未配置 AGORA_APP_ID / AGORA_APP_CERTIFICATE' });
    const channel = String(url.searchParams.get('channel') || '').toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/.test(channel)) return sendJSON(res, 400, { error: '频道名无效' });
    // uid 0:Token 对该频道内任意 uid 有效(App 用 uid 0 让 Agora 自动分配)
    const token = RtcTokenBuilder.buildTokenWithUid(AGORA_APP_ID, AGORA_APP_CERTIFICATE, channel, 0, RtcRole.PUBLISHER, TOKEN_TTL, TOKEN_TTL);
    return sendJSON(res, 200, { token, channel, expiresIn: TOKEN_TTL });
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('SkiStick relay OK\n');
});

const wss = new WebSocketServer({ server });
const rooms = new Map();                 // room -> Set<ws>

function broadcast(room, obj, except) {
  const set = rooms.get(room); if (!set) return;
  const s = JSON.stringify(obj);
  for (const c of set) if (c !== except && c.readyState === 1) c.send(s);
}

wss.on('connection', (ws) => {
  ws.room = null; ws.role = null; ws.name = null;
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.t === 'join') {
      ws.room = String(m.room || '').toUpperCase();
      ws.role = m.role || 'viewer';
      ws.name = m.name || '匿名';
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      rooms.get(ws.room).add(ws);
      ws.send(JSON.stringify({ t: 'joined', room: ws.room, peers: rooms.get(ws.room).size }));
      broadcast(ws.room, { t: 'peer', event: 'join', role: ws.role, name: ws.name }, ws);
      console.log(`[${ws.room}] + ${ws.role} ${ws.name}  (共${rooms.get(ws.room).size})`);
      return;
    }
    if (!ws.room) return;
    if (m.t === 'chat') m.name = ws.name;          // 用服务端记录的名字,防冒充
    broadcast(ws.room, m, ws);                     // 姿态/遥测/消息 一律转给同房其他人
  });
  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
      broadcast(ws.room, { t: 'peer', event: 'leave', role: ws.role, name: ws.name }, ws);
      if (rooms.get(ws.room).size === 0) rooms.delete(ws.room);
      console.log(`[${ws.room}] - ${ws.role} ${ws.name}`);
    }
  });
});

server.listen(PORT, () => {
  console.log('SkiStick 中转服务器已启动, 端口 ' + PORT);
  console.log(AGORA_APP_ID && AGORA_APP_CERTIFICATE ? '语音 Token 接口已启用: /agora-token' : '⚠️ 未配置 AGORA_APP_ID / AGORA_APP_CERTIFICATE,语音 Token 接口不可用');
});

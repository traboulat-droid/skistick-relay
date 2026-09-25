
//Share server · JS
// SkiStick 实时中转服务器 (WebSocket 房间转发)
// 本地跑:  npm install && npm start      → ws://本机IP:8080
// 云端(Render 等)会自动用环境变量 PORT,客户端用 wss://你的域名 (不带端口)
// 协议不变: join / pose / tele / chat / peer,按房间广播给同房其他人。
 
const http = require('http');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8080;
 
// 一个最简 HTTP 服务:用于云平台健康检查 + 浏览器打开可看到"活着"
const server = http.createServer((req, res) => {
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
 
server.listen(PORT, () => console.log('SkiStick 中转服务器已启动, 端口 ' + PORT));
 


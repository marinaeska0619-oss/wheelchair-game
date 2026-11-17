import Peer from 'peerjs';

const rid = () => 'wc-' + Math.random().toString(36).slice(2, 8);

// P2P-сеть на PeerJS (WebRTC). Простая mesh-топология: при подключении
// узлы обмениваются списками друзей и соединяются между собой автоматически.
export class Net {
  constructor(cb) {
    this.cb = cb;
    this.id = null;
    this.color = cb.color;
    this.conns = new Map();
    this.pending = new Set();
    this.start();
  }

  start() {
    this.peer = new Peer(rid());
    this.peer.on('open', (id) => { this.id = id; this.cb.onId(id); });
    this.peer.on('connection', (c) => this.add(c));
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { this.peer.destroy(); this.start(); return; }
      if (e.type === 'peer-unavailable') this.cb.onStatus('Игрок с таким ID не найден');
      else this.cb.onStatus('Ошибка сети: ' + e.type);
    });
  }

  connect(id) {
    id = (id || '').trim();
    if (!id || id === this.id || this.conns.has(id) || this.pending.has(id) || !this.id) return;
    this.pending.add(id);
    const c = this.peer.connect(id, { reliable: false });
    c._out = true;
    this.add(c);
  }

  add(c) {
    const initiator = (x) => (x._out ? this.id : x.peer);
    c.on('open', () => {
      this.pending.delete(c.peer);
      const old = this.conns.get(c.peer);
      if (old && old !== c) {
        // дубликат соединения: оставляем то, которое открыл узел с меньшим ID (одинаково на обеих сторонах)
        if (initiator(c) < initiator(old)) { old._dup = true; old.close(); }
        else { c._dup = true; c.close(); return; }
      }
      this.conns.set(c.peer, c);
      this.status();
      c.send({ t: 'hi', c: this.color, ids: [...this.conns.keys()].filter((k) => k !== c.peer) });
    });
    c.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 's') this.cb.onState(c.peer, d);
      else if (d.t === 'hi') {
        if (typeof d.c === 'number') this.cb.onHello(c.peer, d.c);
        if (Array.isArray(d.ids)) d.ids.slice(0, 16).forEach((id) => typeof id === 'string' && this.connect(id));
      }
    });
    const close = () => {
      this.pending.delete(c.peer);
      if (c._dup) return;
      if (this.conns.get(c.peer) === c) {
        this.conns.delete(c.peer);
        this.cb.onLeave(c.peer);
        this.status();
      }
    };
    c.on('close', close);
    c.on('error', close);
  }

  status() { this.cb.onStatus('Игроков онлайн: ' + (this.conns.size + 1)); }

  send(msg) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }
}

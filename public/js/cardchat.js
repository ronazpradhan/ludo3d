// Table chat for the card games (Jutpatti, Flash, Dhumbal): a 💬 button, a slide-in panel,
// quick phrases and emoji. The server relays each message to everyone at the table and keeps the
// last 30 for anyone who joins or reconnects. Messages are shown with textContent only.
function cardChat(P) {
  const net = window.claude && claude.raw; if (!net) return;
  const $ = id => document.getElementById(id);
  const EMO = ['😀', '😂', '🤣', '😍', '😎', '🥳', '😅', '😭', '😡', '🤔', '👏', '👍', '🙏', '🔥', '🎉', '🏆', '💀', '😱', '😏', '😴', '❤️', '🍀', '😈', '🫡'];
  const PH = ['Good game! 🎉', 'GG', 'Well played 👏', 'Nice!', 'Good luck 🍀', 'Unlucky 😅', 'Hurry up ⏰', 'Your turn!', 'Thanks 🙏', 'One more game?', 'Wow! 😱', 'Oops 😬'];
  const PAL = typeof COLORS != 'undefined' ? COLORS : ['#fbc916', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316'];
  document.body.insertAdjacentHTML('beforeend',
    '<button id="ccbtn" class="glass" type="button" aria-label="Chat">' + ICON.chat + '<b id="ccbadge"></b></button>' +
    '<div id="ccpanel" class="glass" role="dialog" aria-label="Table chat"><div class="cch">Chat<button id="ccclose" type="button" aria-label="Close chat">' + ICON.x + '</button></div>' +
    '<div id="cclog"></div><div id="ccpick"></div>' +
    '<form id="ccform"><button id="ccemo" type="button" aria-label="Emoji and quick messages">' + ICON.smile + '</button>' +
    '<input id="cctext" maxlength="200" placeholder="Message…" autocomplete="off" enterkeyhint="send"><button id="ccsend" type="submit" aria-label="Send">' + ICON.send + '</button></form></div>' +
    '<div id="ccfloat"></div>');
  const btn = $('ccbtn'), panel = $('ccpanel'), log = $('cclog'), input = $('cctext'), pick = $('ccpick'), float = $('ccfloat');
  let me = null, names = {}, open = false, unread = 0, last = 0;

  const colorOf = pid => { const i = Object.keys(names).indexOf(pid); return PAL[(i < 0 ? 0 : i) % PAL.length]; };
  const badge = () => { $('ccbadge').textContent = unread ? (unread > 9 ? '9+' : unread) : ''; };
  function line(m) {
    const d = document.createElement('div'), b = document.createElement('b');
    d.className = 'ccm' + (m.pid === me ? ' mine' : '');
    b.textContent = m.pid === me ? 'You' : m.name; b.style.color = colorOf(m.pid);
    d.append(b, document.createTextNode(' ' + m.text));
    return d;
  }
  function add(m, quiet) {
    log.append(line(m)); while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = 1e9;
    if (quiet || open || m.pid === me) return;
    unread++; badge();
    const f = line(m); f.className = 'ccf'; float.append(f); while (float.children.length > 3) float.firstChild.remove();
    setTimeout(() => { f.classList.add('out'); setTimeout(() => f.remove(), 450); }, 5000);
  }
  function setOpen(on) {
    open = on; panel.classList.toggle('open', on); document.body.classList.toggle('cc-open', on);
    if (on) { unread = 0; badge(); float.textContent = ''; log.scrollTop = 1e9; } else { pick.classList.remove('on'); input.blur(); }
  }
  function sendText(t) {
    t = String(t || '').trim().slice(0, 200); if (!t) return;
    if (Date.now() - last < 500) return; last = Date.now();
    net.send({ t: P + 'chat', text: t });
  }
  function inRoom(on) {
    document.body.classList.toggle('cc-on', on);
    if (!on) { setOpen(false); log.textContent = ''; float.textContent = ''; unread = 0; badge(); }
  }

  // emoji row + quick phrases
  const er = document.createElement('div'), qr = document.createElement('div'); er.className = 'ccemos'; qr.className = 'ccquick';
  EMO.forEach(e => { const b = document.createElement('button'); b.type = 'button'; b.textContent = e; b.onclick = () => { const a = input.selectionStart ?? input.value.length; input.value = (input.value.slice(0, a) + e + input.value.slice(input.selectionEnd ?? a)).slice(0, 200); }; er.append(b); });
  PH.forEach(w => { const b = document.createElement('button'); b.type = 'button'; b.textContent = w; b.onclick = () => { sendText(w); pick.classList.remove('on'); }; qr.append(b); });
  pick.append(qr, er);

  btn.onclick = () => setOpen(!open);
  $('ccclose').onclick = () => setOpen(false);
  $('ccemo').onclick = () => pick.classList.toggle('on');
  $('ccform').onsubmit = e => { e.preventDefault(); sendText(input.value); input.value = ''; pick.classList.remove('on'); };

  // phones: keep the panel above the on-screen keyboard
  const vv = window.visualViewport;
  if (vv) {
    const fit = () => {
      if (!open || innerWidth > 640) { panel.style.top = panel.style.height = panel.style.bottom = ''; return; }
      const kb = innerHeight - vv.height > 120;
      if (kb) { panel.style.top = (vv.offsetTop + 8) + 'px'; panel.style.bottom = 'auto'; panel.style.height = (vv.height - 16) + 'px'; log.scrollTop = 1e9; }
      else panel.style.top = panel.style.height = panel.style.bottom = '';
    };
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); input.addEventListener('focus', () => setTimeout(fit, 300));
  }

  net.on(m => {
    if (typeof m.t != 'string' || !m.t.startsWith(P)) return;
    const t = m.t.slice(P.length);
    if (t == 'state' && m.room) { me = m.you; names = m.room.names || {}; inRoom(true); }
    else if (t == 'left' || t == 'kicked') inRoom(false);
    else if (t == 'chatlog' && Array.isArray(m.msgs)) { log.textContent = ''; m.msgs.forEach(x => add(x, true)); }
    else if (t == 'chat' && m.text) add(m);
  });
}

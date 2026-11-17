'use strict';

const $ = id => document.getElementById(id);
const tip = $('tip');

// ── 中文时长格式 ────────────────────────────────────────────────────────────
function fmtDur(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (total === 0) return '不到 1 分钟';
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

// ── 自定义 tooltip（跟随鼠标，自动避让屏幕边缘） ────────────────────────────
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTip() { tip.hidden = true; }

function bindTip(el, html) {
  el.addEventListener('mousemove', e => showTip(e, html));
  el.addEventListener('mouseleave', hideTip);
}

// ── 数字滚动动画 ────────────────────────────────────────────────────────────
function animText(el, ms) {
  const t0 = performance.now();
  const dur = 550;
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtDur(eased * ms);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function animCount(el, target) {
  const t0 = performance.now();
  const dur = 550;
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(eased * target));
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── 图表渲染 ────────────────────────────────────────────────────────────────
function renderHours(hours) {
  const host = $('hours');
  host.textContent = '';
  const max = Math.max(1, ...hours.map(h => h.ms));
  hours.forEach((h, i) => {
    const col = document.createElement('div');
    col.className = 'col';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = '0%';
    const target = Math.round((h.ms / max) * 100);
    setTimeout(() => { bar.style.height = target + '%'; }, 40 + i * 18);   // 逐柱升起
    bindTip(col, `<div class="tt-title">${String(i).padStart(2, '0')}:00 ~ ${String((i + 1) % 24).padStart(2, '0')}:00</div>` +
      `时长 <span class="tt-green">${fmtDur(h.ms)}</span><br>首数 <span class="tt-green">${h.count}</span>`);
    col.appendChild(bar);
    host.appendChild(col);
  });
}

function renderDays(days) {
  const host = $('days');
  host.textContent = '';
  const max = Math.max(1, ...days.map(x => x.ms));
  const todayKey = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  days.forEach((day, i) => {
    const col = document.createElement('div');
    col.className = 'col' + (day.date === todayKey ? ' today' : '');
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = '0%';
    const target = Math.round((day.ms / max) * 100);
    setTimeout(() => { bar.style.height = target + '%'; }, 40 + i * 12);
    const d = new Date(`${day.date}T00:00:00`);
    bindTip(col, `<div class="tt-title">${d.getMonth() + 1} 月 ${d.getDate()} 日${day.date === todayKey ? '（今天）' : ''}</div>` +
      `时长 <span class="tt-green">${fmtDur(day.ms)}</span><br>首数 <span class="tt-green">${day.count}</span>`);
    col.appendChild(bar);
    host.appendChild(col);
  });
  $('daysFrom').textContent = days.length ? `${new Date(`${days[0].date}T00:00:00`).getMonth() + 1}-${days[0].date.slice(-2)}` : '';
  $('daysTo').textContent = days.length ? `今天` : '';
}

async function load() {
  if (document.hidden) return;
  const d = await window.fl.stats.data();
  if (!d) return;

  // 今日横幅：中文时长 + 今天最常听的歌（书名号）
  animText($('bannerDur'), d.today.ms);
  animCount($('bannerCnt'), d.today.count);
  if (d.todayTop) {
    $('bannerSong').textContent = `《${d.todayTop.title}》`;
    $('bannerSongMeta').textContent = `今天听了 ${d.todayTop.count} 次 · 约 ${fmtDur(d.todayTop.ms)}`;
  } else {
    $('bannerSong').textContent = '还没有完整听歌记录';
    $('bannerSongMeta').textContent = '切歌满 1 秒即计一首';
  }

  // 卡片（滚动动画，仅当数值变化）
  const setCard = (durId, cntId, ms, cnt) => {
    if ($(durId).dataset.ms !== String(ms)) {
      animText($(durId), ms);
      animCount($(cntId), cnt);
      $(durId).dataset.ms = String(ms);
    }
  };
  setCard('todayDur', 'todayCnt', d.today.ms, d.today.count);
  setCard('weekDur', 'weekCnt', d.week.ms, d.week.count);
  setCard('monthDur', 'monthCnt', d.month.ms, d.month.count);

  renderHours(d.hours);
  renderDays(d.days);

  const top = $('top');
  if (top.dataset.sig !== JSON.stringify(d.top)) {
    top.dataset.sig = JSON.stringify(d.top);
    top.textContent = '';
    if (!d.top.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '还没有记录，播放一首歌试试。';
      top.appendChild(li);
    } else {
      d.top.forEach((t, i) => {
        const li = document.createElement('li');
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = i + 1;
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = t.title + (t.artist ? ' — ' + t.artist : '');
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${t.count} 次 · ${fmtDur(t.ms)}`;
        li.append(rank, name, meta);
        top.appendChild(li);
      });
    }
  }

  const recent = $('recent');
  if (recent.dataset.sig !== JSON.stringify(d.recent)) {
    recent.dataset.sig = JSON.stringify(d.recent);
    recent.textContent = '';
    if (!d.recent.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '暂无播放记录。';
      recent.appendChild(li);
    } else {
      d.recent.forEach(r => {
        const li = document.createElement('li');
        const time = document.createElement('span');
        time.className = 'meta';
        time.textContent = fmtDate(r.start);
        const name = document.createElement('span');
        name.className = 'name';
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = r.title || '未知歌曲';
        const a = document.createElement('span');
        a.className = 'a';
        a.textContent = r.artist || '';
        name.append(t, a);
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = `${Math.round(r.sec || 0)} 秒`;
        li.append(time, name, meta);
        recent.appendChild(li);
      });
    }
  }
}

async function copyReport(type, btn) {
  const md = await window.fl.stats.report(type);
  await window.fl.stats.copy(md);
  const old = btn.textContent;
  btn.textContent = '已复制 ✓';
  btn.classList.add('ok');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1600);
}

// Click a report button to copy it; right-click it to save it as a file.
async function saveAs(kind, btn) {
  const p = await window.fl.stats.save(kind);
  const old = btn.textContent;
  if (!p) return;
  btn.textContent = '已保存 ✓';
  btn.classList.add('ok');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1800);
}

$('btnWeek').onclick = () => copyReport('week', $('btnWeek'));
$('btnMonth').onclick = () => copyReport('month', $('btnMonth'));
$('btnCsv').onclick = async () => {
  const csv = await window.fl.stats.csv();
  await window.fl.stats.copy(csv);
  const btn = $('btnCsv');
  const old = btn.textContent;
  btn.textContent = '已复制 ✓';
  btn.classList.add('ok');
  setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1600);
};
for (const [btn, kind] of [[$('btnWeek'), 'week-md'], [$('btnMonth'), 'month-md'], [$('btnCsv'), 'csv']]) {
  btn.addEventListener('contextmenu', async e => {
    e.preventDefault();
    await saveAs(kind, btn);
  });
}
$('btnClear').onclick = async () => {
  const ok = await window.fl.stats.clear();
  if (ok) {
    const btn = $('btnClear');
    btn.textContent = '已清空 ✓';
    setTimeout(() => { btn.textContent = '清空数据'; }, 1800);
    load();
  }
};

load();
setInterval(load, 30000);
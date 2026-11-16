'use strict';

const $ = id => document.getElementById(id);

function fmtDur(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (total === 0) return '0 分';
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtClock(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function load() {
  const d = await window.fl.stats.data();
  if (!d) return;

  $('todayDur').textContent = fmtDur(d.today.ms);
  $('todayCnt').textContent = d.today.count;
  $('weekDur').textContent = fmtDur(d.week.ms);
  $('weekCnt').textContent = d.week.count;
  $('monthDur').textContent = fmtDur(d.month.ms);
  $('monthCnt').textContent = d.month.count;

  // Hour buckets: bar height by minutes, tooltip shows duration + plays.
  const hours = $('hours');
  hours.textContent = '';
  const hMax = Math.max(1, ...d.hours.map(h => h.ms));
  d.hours.forEach((h, i) => {
    const col = document.createElement('div');
    col.className = 'col';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = Math.round((h.ms / hMax) * 100) + '%';
    bar.title = `${String(i).padStart(2, '0')}:00 — ${fmtDur(h.ms)} · ${h.count} 首`;
    col.appendChild(bar);
    hours.appendChild(col);
  });

  // Day chart: last entries of the 30-day window.
  const days = $('days');
  days.textContent = '';
  const dMax = Math.max(1, ...d.days.map(x => x.ms));
  const first = d.days.length ? d.days[0].date : '';
  const last = d.days.length ? d.days[d.days.length - 1].date : '';
  $('daysFrom').textContent = first;
  $('daysTo').textContent = last;
  d.days.forEach(day => {
    const col = document.createElement('div');
    col.className = 'col';
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = Math.round((day.ms / dMax) * 100) + '%';
    bar.title = `${day.date} — ${fmtDur(day.ms)} · ${day.count} 首`;
    col.appendChild(bar);
    days.appendChild(col);
  });

  const top = $('top');
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

  const recent = $('recent');
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
      time.textContent = fmtClock(r.start);
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
      meta.textContent = `${Math.round((r.sec || 0))}s`;
      li.append(time, name, meta);
      recent.appendChild(li);
    });
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

load();
setInterval(load, 30000);
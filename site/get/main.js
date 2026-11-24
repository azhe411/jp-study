// 一駅 宣传页：首屏片段可以点、路线计算器、下载按钮的版本号读发布清单、两处入场动效。
document.documentElement.classList.add('js');

/* ───────── 首屏：标题入场 ───────── */
requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('.hero').classList.add('ready')));

/* ───────── 首屏：今日页片段 ───────── */
(() => {
  const route = document.getElementById('route-demo');
  const stops = [...route.querySelectorAll('.stop')];
  const out = document.getElementById('fragDone');
  const endNote = document.getElementById('endNote');
  const legs = stops.length - 1;
  let done = 0;

  const paint = () => {
    stops.forEach((s, i) => {
      s.classList.toggle('done', i < done || (i === legs && done === legs));
      s.classList.toggle('here', i === done && i < legs);
    });
    route.style.setProperty('--fill', String((done / legs) * 100));
    out.textContent = String(done);
    if (done === legs) endNote.textContent = '今天的路线走完了。勉强及格。';
  };

  stops.forEach((s, i) => {
    const btn = s.querySelector('.stop-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      // 按顺序走：点了后面的站，前面的也算走过
      done = Math.max(done, i + 1);
      paint();
    });
  });
  paint();
})();

/* ───────── 路线计算器 ───────── */
(() => {
  // 到某个终点为止的站数与总学习量（server/src/content/curriculum.ts 的 CUMULATIVE_HOURS）：零基础、中文母语的估算
  const GOALS = [
    { id: 'N5', stops: 30, minutes: 250 * 60 },
    { id: 'N4', stops: 54, minutes: 450 * 60 },
    { id: 'N3', stops: 75, minutes: 700 * 60 },
    { id: 'N2', stops: 87, minutes: 1000 * 60 },
    { id: 'N1', stops: 99, minutes: 1700 * 60 },
  ];
  const goalsEl = document.getElementById('goals');
  const mins = document.getElementById('mins');
  const $ = (id) => document.getElementById(id);
  let goal = GOALS[GOALS.length - 1];

  for (const g of GOALS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = g.id;
    b.addEventListener('click', () => { goal = g; render(); });
    goalsEl.append(b);
  }
  // 方向键在选项间移动，和原生单选组一致
  goalsEl.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = (GOALS.indexOf(goal) + step + GOALS.length) % GOALS.length;
    goal = GOALS[i];
    render();
    goalsEl.children[i].focus();
  });

  const fmt = (d) => `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;

  function render() {
    const perDay = Number(mins.value);
    const days = Math.ceil(goal.minutes / perDay);
    const arrive = new Date();
    arrive.setDate(arrive.getDate() + days);
    [...goalsEl.children].forEach((b, i) => {
      const on = GOALS[i] === goal;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $('minsOut').textContent = String(perDay);
    $('daysOut').textContent = String(days);
    $('dateOut').textContent = fmt(arrive);
    $('stopsOut').textContent = String(goal.stops);
    $('hoursOut').textContent = String(Math.round(goal.minutes / 60));
  }
  mins.addEventListener('input', render);
  render();
})();

/*
 * 下载：本页同时部署在两处 —— 香港（https）和国内下载服务器（http://160.202.237.19:9080）。
 *   https 页面直接下载 http 文件会被浏览器拦截，所以 https 页面的按钮先跳到国内的这份页面（#android / #windows），到了再开始下载。
 *   国内这份页面的按钮直接指向 /latest/ 下的固定文件，不经过香港；地址栏带 #android 时自动开始。
 */
const ON_MIRROR = location.port === '9080';
const FILES = { android: '/latest/android.apk', windows: '/latest/windows.exe' };
if (ON_MIRROR) {
  const links = { android: document.getElementById('dlAndroid'), windows: document.getElementById('dlWindows') };
  for (const [k, a] of Object.entries(links)) {
    a.href = FILES[k];
    a.setAttribute('download', '');
  }
  // 这份页面没有网页版，"打开网页版"去香港
  document.querySelectorAll('a[href="/"]').forEach((a) => { a.href = 'https://jpd.azclient.top:8443/'; });
  const want = location.hash.slice(1);
  if (FILES[want]) {
    const status = document.getElementById('dlStatus');
    const name = want === 'android' ? '安卓安装包' : 'Windows 安装包';
    status.hidden = false;
    status.textContent = `${name}（约 55 MB）开始下载了，请看浏览器的下载提示。如果没有弹出，再点一下上面的按钮。`;
    document.getElementById('download').scrollIntoView({ block: 'center' });
    location.href = FILES[want];
  }
}

/* ───────── 下载按钮上的版本号 ───────── */
(async () => {
  try {
    const res = await fetch(ON_MIRROR ? '/latest/versions.json' : '/api/v1/app/manifest', { cache: 'no-store' });
    if (!res.ok) return;
    const m = await res.json();
    const setVer = (k, v) => document.querySelectorAll(`[data-ver="${k}"]`).forEach((el) => { el.textContent = v; });
    if (m.android?.version) setVer('android', m.android.version);
    if (m.desktop?.version) setVer('desktop', m.desktop.version);
    if (m.web?.version) setVer('web', m.web.version);
    // 校验值只在 https 页面展示：明文页面上的值本身可能被篡改
    if (!ON_MIRROR && (m.android?.sha256 || m.desktop?.sha256)) {
      const body = document.getElementById('hashBody');
      body.replaceChildren(
        ...[['安卓', m.android], ['Windows', m.desktop]].filter(([, x]) => x?.sha256).flatMap(([name, x]) => {
          const code = document.createElement('code');
          code.textContent = x.sha256;
          code.style.wordBreak = 'break-all';
          return [`${name} v${x.version}：`, code, document.createElement('br')];
        }),
      );
    }
  } catch {
    /* 清单拿不到时保留页面里写好的版本 */
  }
})();

/* ───────── 各区块入场 ───────── */
(() => {
  const els = [...document.querySelectorAll('.reveal')];
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  els.forEach((el) => io.observe(el));
})();

/* ───────── 站名牌照片：进入视野时打开快门，只演一次 ───────── */
(() => {
  const el = document.querySelector('.shutter');
  if (!el) return;
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.classList.add('open');
    return;
  }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      el.classList.add('open');
      io.disconnect();
    }
  }, { threshold: 0.3 });
  // 观察外层区块：照片自身的 clip-path 初始是全关，按它算永远“看不见”
  io.observe(el.parentElement);
})();

// <nc-clock> 时间 + 日期 + 一行说明；<nc-quote> 名言。
import { h, clear, staticHTML } from './dom.js';
import { cnDate, isoWeek, pad2 } from './format.js';
import { createWater, waterLevel } from './water.js';
import { quoteAt } from './quotes.js';
import { now as getNow, quoteNow } from './clock-source.js';

// 水面高度：0 点在字形底边，24 点在字形顶边（见 water.js 的 waterLevel）。
const levelFor = waterLevel;

class NcClock extends HTMLElement {
  connectedCallback() {
    if (this.water) return;
    staticHTML(
      this,
      `<div class="time fr e" style="--d:0ms">
         <span class="out"></span><span class="in back" aria-hidden="true"></span><span class="in" aria-hidden="true"></span>
       </div>
       <div class="date serif e" style="--d:180ms"></div>
       <div class="meta e" style="--d:240ms"><span class="wk"></span><span>·</span><span class="pct"></span></div>`
    );
    const [out, back, front] = this.querySelectorAll('.time span');
    this.digits = [out, back, front];
    this.dateEl = this.querySelector('.date');
    this.wkEl = this.querySelector('.wk');
    this.pctEl = this.querySelector('.pct');
    this.water = createWater(front, back);
    this.water.reset();
    this.lastDay = -1;
    this.update(getNow());
  }

  /** 每分钟调用一次。 */
  update(now = getNow()) {
    const text = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    for (const el of this.digits) el.textContent = text;
    const p = (now.getHours() * 60 + now.getMinutes()) / 1440;
    this.pctEl.textContent = '日子慢慢过去，今天走过了 ' + Math.round(p * 100) + '%';
    if (this.lastDay !== now.getDate()) {
      this.lastDay = now.getDate();
      this.dateEl.textContent = cnDate(now);
      this.wkEl.textContent = '第 ' + isoWeek(now) + ' 周';
    }
    this.water.to(levelFor(p));
  }

  /** 开机进场：先清空，等一小会儿再注水。 */
  fill(delay = 500) {
    this.water.reset();
    this.water.start();
    setTimeout(() => this.update(getNow()), delay);
  }

  pause() {
    this.water.stop();
  }
  resume() {
    this.water.start();
    this.update(getNow());
  }
}
customElements.define('nc-clock', NcClock);

class NcQuote extends HTMLElement {
  connectedCallback() {
    if (this.box) return;
    this.box = h('div', { class: 'quote e', style: '--d:380ms' });
    this.append(this.box);
    this.slot = null;
    this.update(false);
  }

  update(animate = true) {
    if (this.nightOn) return; // 深夜劝睡期间不换名言
    const { slot, quote } = quoteAt(quoteNow());
    if (slot === this.slot) return;
    const first = this.slot === null;
    this.slot = slot;
    if (first || !animate) return this.render(quote);
    this.box.classList.add('swap');
    setTimeout(() => {
      this.render(quote);
      this.box.classList.remove('swap');
    }, 900);
  }

  /** 深夜劝睡：名言换成一句劝睡的话（署名「晚安」）；on=false 还原名言。 */
  setNight(on, text, instant = false) {
    this.nightOn = on;
    const apply = () => {
      if (on) this.render({ zh: text, by: '晚安' });
      else {
        this.slot = null;
        this.update(false);
      }
      this.box.classList.remove('swap');
    };
    if (instant) return apply();
    this.box.classList.add('swap');
    setTimeout(apply, 900);
  }

  render(q) {
    clear(this.box);
    const lines = q.zh.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    const size = longest >= 25 ? 's24' : longest >= 21 ? 's28' : '';
    const p = h('p', { class: 'serif ' + size });
    lines.forEach((l, i) => {
      if (i) p.append(document.createElement('br'));
      p.append(l);
    });
    this.box.append(
      h('span', { class: 'mark', 'aria-hidden': 'true' }, '“'),
      p,
      h('p', { class: 'by' }, '— ' + q.by)
    );
  }
}
customElements.define('nc-quote', NcQuote);

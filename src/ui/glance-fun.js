// 简版的趣味组件显示位置：留言条（笔记本撕页，以胶带为支点轻摆）、深夜劝睡、一个月前的今天。
// 对外接口和完整版（full.js）一致，fun.js 按当前版式选其一调用；触发规则只写一份（fun.js）。
import { h, clear, onTap, prefersReducedMotion } from './dom.js';
import { foldButton } from './fold.js';
import { openDaily } from './open.js';
import { createSpringValue } from './motion.js';

const stage = document.getElementById('stage');

export function createGlanceFun() {
  const quote = () => document.querySelector('nc-quote');
  const daily = () => document.querySelector('nc-daily');
  const glow = h('div', { class: 'g-night-glow', 'aria-hidden': 'true' });
  stage.append(glow);

  const host = {
    nightOn: false,
    nightText: '',
    noteEl: null,
    noteData: null,
    monthInfo: null,
    onMonthBack: null,

    // ---------- 留言条 ----------
    /** note = { head, lines: [], tail }；点一下揉成纸团消失。 */
    showNote(note, instant = false) {
      this.hideNote(true);
      const el = h(
        'div',
        { class: 'gn', 'aria-label': '留言条，点一下收起', role: 'button' },
        h(
          'div',
          { class: 'gn-sway' },
          h('div', { class: 'gn-lift', 'aria-hidden': 'true' }),
          h('div', { class: 'gn-paper' }, h('div', { class: 'gn-head' }, note.head.replace(/——$/, ''), /——$/.test(note.head) ? h('span', { class: 'n-dash' }, '——') : ''), h('div', { class: 'gn-lines' }, ...note.lines.map((l) => h('div', { class: 'clamp2 gn-item' }, '· ' + l))), h('div', { class: 'gn-tail' }, note.tail))
        ),
        h('i', { class: 'gn-tape', 'aria-hidden': 'true' })
      );
      onTap(el, () => this.hideNote());
      stage.append(el);
      this.noteEl = el;
      this.noteData = note;
      if (instant) {
        el.style.transition = 'none';
        el.classList.add('show');
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    },
    hideNote(instant = false) {
      const el = this.noteEl;
      if (!el) return;
      this.noteEl = null;
      this.noteData = null;
      if (instant || prefersReducedMotion()) return el.remove();
      el.classList.add('crumple');
      setTimeout(() => el.remove(), 520);
    },
    get noteShown() {
      return !!this.noteEl;
    },

    // ---------- 深夜劝睡：名言换成一句劝睡的话，纸色变深，栏淡化，窗光变暖 ----------
    setNight(on, text, instant = false) {
      this.nightOn = on;
      this.nightText = on ? text : '';
      stage.classList.toggle('night', on);
      document.documentElement.classList.toggle('night', on);
      const q = quote();
      if (q && q.setNight) q.setNight(on, text, instant || prefersReducedMotion());
    },

    // ---------- 一个月前的今天：日报栏沿竖直中线翻成泛黄新闻纸（折角翻面） ----------
    /** on=true：info = { date: '10.07', title, missed?, none? }。 */
    showMonth(on, info, instant = false) {
      if (on) {
        if (!info) return;
        this.monthInfo = info;
        if (!this.monthEl) {
          this.monthEl = h(
            'article',
            { class: 'g-month', 'aria-label': '一个月前的今天' },
            foldButton('back', '翻回今天', () => this.showMonth(false)),
            h('div', { class: 'gmo-h' }, h('span', { class: 'gmo-t serif' }, '一个月前的今天'), h('span', { class: 'gmo-d' })),
            h('p', { class: 'gmo-lead serif clamp3' }),
            h('p', { class: 'gmo-sub' }),
            h('button', { class: 'gmo-back' }, '翻回今天 →')
          );
          onTap(this.monthEl.querySelector('.gmo-back'), () => this.showMonth(false));
          // 点背面其他地方：把那一期的日报打开成一张卡片（折角和「翻回今天」除外）
          onTap(this.monthEl, (e) => {
            if (e.target.closest && e.target.closest('.dfold, .gmo-back')) return;
            if (this.monthInfo && this.monthInfo.iso) openDaily(this.monthInfo.iso, this.monthEl);
          });
          stage.append(this.monthEl);
        }
        this.monthEl.querySelector('.gmo-d').textContent = info.date;
        this.monthEl.querySelector('.gmo-lead').textContent = info.title || '';
        this.monthEl.querySelector('.gmo-sub').textContent = info.none ? '那天没有出刊' : info.missed ? '那天没有出刊，这是最近的一期' : '那时，它是头条。';
        this.flip(true, instant);
      } else {
        if (!this.monthEl) return;
        this.monthInfo = null;
        this.flip(false, instant);
        if (this.onMonthBack) this.onMonthBack();
      }
    },
    /** 翻面：一个弹簧值 p（0 正面 / 1 背面）驱动，沿竖直中线转 180°，透视 1200px，中等弹簧；途中再点会掉头。减少动态效果：直接 150ms 淡入背面。 */
    flip(toBack, instant) {
      const m = this.monthEl;
      stage.classList.toggle('month-on', toBack);
      if (!this.flipSp) {
        this.flipSp = createSpringValue(0, (p) => {
          const d = daily();
          const mm = this.monthEl;
          if (!d || !mm) return;
          const deg = 180 * p;
          d.style.transform = `perspective(1200px) rotateY(${deg}deg)`;
          d.style.visibility = deg < 90 ? '' : 'hidden';
          mm.style.transform = `perspective(1200px) rotateY(${deg - 180}deg)`;
          mm.style.visibility = deg < 90 ? 'hidden' : '';
        });
      }
      const sp = this.flipSp;
      const clearFront = () => {
        const d = daily();
        if (d) d.style.transform = d.style.visibility = '';
      };
      const finish = (back) => {
        sp.stop();
        if (back) {
          const d = daily();
          if (d) d.style.visibility = 'hidden'; // 背面压在上面，正面不用再画
          if (m) m.style.transform = m.style.visibility = '';
        } else {
          clearFront();
          if (m) m.remove();
          if (this.monthEl === m) this.monthEl = null;
        }
      };
      m.style.display = 'flex';
      if (instant || prefersReducedMotion()) {
        sp.set(toBack ? 1 : 0);
        finish(toBack);
        if (!instant) (toBack ? m : daily()).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }); // 减少动态效果：背面 150ms 淡入
        return;
      }
      if (!sp.running) sp.set(sp.value); // 先把背面摆到「已转开」的位置，免得第一帧压在正面上
      sp.to(toBack ? 1 : 0, 'mid', () => finish(toBack));
    },
    monthEl: null,
    get monthShown() {
      return !!this.monthEl && this.monthInfo != null;
    },
  };
  return host;
}

// public/js/views/meet.js
// ②出会う: QRコードの読み取りとコード入力を切り替えて、キャラやエリアを獲得する。
// スポットに掲示したQRコードとコードで獲得する想定で、現地へ行かないと手に入らない（位置情報による判定はしていない）。
// カメラは HTTPS か localhost でのみ使える。使えない環境向けに、撮った写真から読み取ることもできる。

import { h, api, loadState, onLeave } from '../core.js';
import { icon } from '../icons.js';
import { reveal } from '../reveal.js';

export async function render(view, route) {
  let mode = route.query.mode === 'qr' ? 'qr' : 'code';
  let stream = null, raf = null;
  const seg = h('div.seg', { role: 'group', 'aria-label': '読み取り方' });
  const qrBtn = h('button', { 'aria-pressed': 'false', onclick: () => setMode('qr') }, [h('span', { html: icon('camera') }), 'QRコード']);
  const codeBtn = h('button', { 'aria-pressed': 'false', onclick: () => setMode('code') }, [h('span', { html: icon('keyboard') }), 'コード']);
  seg.append(qrBtn, codeBtn);
  const area = h('div');
  const msg = h('p.form-msg', { role: 'alert' });
  view.append(h('div.meet-wrap', [
    h('h1.page-title', [h('span', { html: icon('meet') }), '出会う']),
    h('p.muted', 'スタンプラリーの会場やイベントに貼られたQRコード、コードで、推しやエリアに出会えます。'),
    h('div.center-row', [seg]), area, msg,
    h('div.panel.hint-card', [h('h4', [h('span', { html: icon('sparkle') }), 'デモ用のコード']), h('p.small', '審査やお試し用に、設定の「すべてのキャラとエリアを獲得する」もあります。サンプルのコードとQRコードの画像は設計書に載せています。')]),
  ]));

  function stopCam() { if (raf) cancelAnimationFrame(raf); raf = null; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }
  onLeave(stopCam);

  async function redeem(code) {
    msg.textContent = '';
    try {
      const r = await api('/api/redeem', { method: 'POST', body: { code } });
      stopCam();
      await loadState();
      await reveal(r);
      if (mode === 'qr') setMode('qr');
    } catch (e) { msg.textContent = e.message; }
  }

  function setMode(m) {
    mode = m; stopCam();
    qrBtn.setAttribute('aria-pressed', String(m === 'qr')); codeBtn.setAttribute('aria-pressed', String(m === 'code'));
    msg.textContent = '';
    if (m === 'code') {
      const input = h('input', { type: 'text', inputmode: 'latin', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'MINI-XXXX-XXXX', 'aria-label': 'コード', maxlength: '40' });
      const form = h('form.code-form', [input, h('button.btn', { type: 'submit' }, [h('span', { html: icon('check') }), '出会う'])]);
      form.addEventListener('submit', e => { e.preventDefault(); if (!input.value.trim()) { msg.textContent = 'コードを入力してください'; return; } redeem(input.value); });
      area.replaceChildren(form);
      setTimeout(() => input.focus(), 50);
    } else {
      const video = h('video', { playsinline: true, muted: true, 'aria-label': 'カメラの映像' });
      const canvas = h('canvas.hidden');
      const say = h('p.scan-msg', 'QRコードを枠に入れてください');
      const box = h('div.scan-box', [video, h('div.scan-frame'), say]);
      const file = h('input.hidden', { type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': '写真から読み取る' });
      const fileBtn = h('button.btn.btn-white.btn-wide', { onclick: () => file.click() }, [h('span', { html: icon('image') }), '写真から読み取る']);
      file.addEventListener('change', () => readFile(file.files[0]));
      area.replaceChildren(box, canvas, fileBtn, file);
      startCam(video, canvas, say);
    }
  }

  async function startCam(video, canvas, say) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say.textContent = 'この環境ではカメラが使えません。写真から読み取ってください'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = stream; await video.play();
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = () => {
        if (!stream) return;
        if (video.readyState >= 2) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) { say.textContent = '読み取りました'; redeem(code.data); return; }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { say.textContent = 'カメラを使えませんでした。写真から読み取ってください'; }
  }

  function readFile(f) {
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const s = Math.min(1, 1200 / Math.max(img.width, img.height));
      c.width = img.width * s; c.height = img.height * s;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const code = window.jsQR(d.data, d.width, d.height);
      URL.revokeObjectURL(url);
      if (code && code.data) redeem(code.data); else msg.textContent = 'QRコードが見つかりませんでした';
    };
    img.src = url;
  }

  setMode(mode);
}

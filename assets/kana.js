/* SPDX-License-Identifier: Apache-2.0 */
/* =========================================================
   kana.js — 「かなにする」単体ページ

   しゅくだいノートとは 別の 読みもの。共有も 記録も しない。
   使うのは kanji.js だけで、そこが 辞書（kuromoji.js）を
   ワーカーの 中で 動かす。入れた 文は どこにも 送らない。
   ========================================================= */
(function(){
'use strict';

const $ = s => document.querySelector(s);
const src = $('#src'), out = $('#out'), status = $('#status'), marks = $('#marks');
const gradeSel = $('#grade'), goBtn = $('#go'), micBtn = $('#mic');

function say(text, isError){
  status.textContent = text || '';
  status.classList.toggle('err', !!isError);
}

/* 学年を 変えたら、印の 付けかたも すぐ 変わる。
   変換は 辞書が いるが、印だけなら 辞書なしで 出せる */
function applyGrade(){
  setReadingGrade(Number(gradeSel.value));
  renderMarks();
}
function renderMarks(){
  const text = src.value;
  if(!text.trim()){ marks.textContent = ''; return; }
  if(getReadingGrade() === 9){ marks.textContent = '「直さない」を選んでいます。'; return; }
  const list = unlearnedKanji(text);
  marks.innerHTML = list.length
    ? markUnlearnedHTML(text)
    : 'この学年までの漢字だけです。直すところはありません。';
}

gradeSel.addEventListener('change', applyGrade);
src.addEventListener('input', renderMarks);
$('#clear').addEventListener('click', ()=>{
  src.value = ''; out.value = ''; marks.textContent = ''; say(''); src.focus();
});

/* --- 変換 --- */
/* 辞書は 18MB ある。進み具合を 出さないと、止まったのか 待てばよいのか
   分からない。kanji.js が 1ファイルごとに 知らせてくる */
if(typeof setDictProgress === 'function'){
  setDictProgress(m => {
    if(!m || !m.total) return;
    say('じしょを よみこんでいます… ' + m.done + '/' + m.total);
  });
}

goBtn.addEventListener('click', async ()=>{
  const text = src.value;
  if(!text.trim()){ say('先に文を入れてください。', true); src.focus(); return; }
  if(getReadingGrade() === 9){ out.value = text; say('そのまま写しました。'); return; }

  goBtn.disabled = true;
  say('じしょを よみこんでいます…');
  try{
    const r = await convertForTranscription(text);
    out.value = r.text;
    if(!r.ok){
      /* 辞書が だめでも、元の 文は 返っている。印だけは 出ているので、
         手で 直せる。何も できないより ましな 形で 止める */
      say('じしょを よみこめませんでした（' + (r.reason || '') + '）。'
        + '下の印のところを手で直してください。', true);
    }else if(!r.unlearned.length){
      say('この学年までの漢字だけでした。そのまま写せます。');
    }else{
      say('直しました：' + r.unlearned.join('、'));
    }
  }catch(e){
    say('うまくいきませんでした：' + (e && e.message || e), true);
  }finally{
    goBtn.disabled = false;
  }
});

$('#copy').addEventListener('click', async ()=>{
  if(!out.value){ say('先に「かなにする」を押してください。', true); return; }
  try{
    await navigator.clipboard.writeText(out.value);
    say('コピーしました。');
  }catch(e){
    /* clipboard が 使えない ブラウザでは、選んで あげるところまで */
    out.removeAttribute('readonly');
    out.select();
    out.setAttribute('readonly', '');
    say('えらびました。長押しして「コピー」を選んでください。');
  }
});

/* --- 声で入れる --- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

if(!SR){
  micBtn.disabled = true;
  $('#micNote').textContent = 'この ブラウザでは 声の入力が つかえません。';
}else{
  micBtn.addEventListener('click', ()=>{
    if(rec){ rec.stop(); return; }
    rec = new SR();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = true;

    /* 話しているあいだの 途中経過は 打ち消して 書きかえるので、
       確定した ぶんだけ 本文に 足す。途中経過は 末尾に かりに 見せる */
    const base = src.value ? src.value.replace(/\s*$/, '') + '\n' : '';
    let fixed = '';

    rec.onresult = ev=>{
      let interim = '';
      for(let i = ev.resultIndex; i < ev.results.length; i++){
        const r = ev.results[i];
        if(r.isFinal) fixed += r[0].transcript;
        else interim += r[0].transcript;
      }
      src.value = base + fixed + interim;
      renderMarks();
    };
    rec.onerror = ev=>{
      say('声の入力が うまくいきませんでした（' + (ev && ev.error || '') + '）。', true);
    };
    rec.onend = ()=>{
      rec = null;
      micBtn.textContent = '🎤 声で入れる';
      micBtn.classList.remove('rec');
      src.value = base + fixed;
      renderMarks();
    };

    try{
      rec.start();
      micBtn.textContent = '■ とめる';
      micBtn.classList.add('rec');
      say('話してください。とめるまで 書きつづけます。');
    }catch(e){
      rec = null;
      say('マイクを つかえませんでした。', true);
    }
  });
}

applyGrade();
})();

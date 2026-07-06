/* practice-player engine — reads window.DAYCFG:
   {ns, audio, gate, exportTitle, seq, dwells, pens}                       */
(function(){
var C=window.DAYCFG;
var NS=C.ns;
function save(k,v){try{localStorage.setItem(NS+k,v)}catch(e){}}
function load(k){try{return localStorage.getItem(NS+k)}catch(e){return null}}
function jload(k,d){try{return JSON.parse(load(k))||d}catch(e){return d}}
function fmt(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
var SEQ=C.seq, DWELLS=C.dwells;

/* ---------- state ---------- */
var idx=Number(load('idx'))||0;
var tx=jload('tx',{});
var sat=jload('sat',{});
var cues=jload('cues',{});
var t0=Number(load('t0'))||0;
var au=document.getElementById('au');
var micStream=null, rec=null, chunks=[], recTimer=null, recStart=0, lastBlob=null, lastKey=null;
var dwellIv=null, dwellLoops=0, dwellStart=0, dwellOpen=false;

/* ---------- screens ---------- */
var scr={setup:document.getElementById('setup'),session:document.getElementById('session'),done:document.getElementById('done')};
function show(id){for(var k in scr)scr[k].classList.toggle('on',k===id);
  document.getElementById('notedock').hidden=(id!=='session');window.scrollTo(0,0)}

/* ---------- key: passphrase gate (if gate.json present) or raw key ---------- */
var keyin=document.getElementById('keyin');
keyin.value=localStorage.getItem('owaudio_key')||'';
keyin.addEventListener('change',function(){localStorage.setItem('owaudio_key',keyin.value.trim());keyStat()});
function keyStat(){
  document.getElementById('keystat').textContent=
    localStorage.getItem('owaudio_key')?'✓ unlocked on this device':'';
}
keyStat();
function b64a(s){var b=atob(s),a=new Uint8Array(b.length);for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a}
fetch(C.gate).then(function(r){return r.ok?r.json():null}).catch(function(){return null}).then(function(enc){
  if(!enc)return;
  document.getElementById('passrow').hidden=false;
  document.getElementById('rawkeywrap').open=false;
  document.getElementById('unlockbtn').addEventListener('click',function(){
    var pass=document.getElementById('passin').value.trim();
    if(!pass)return;
    var st=document.getElementById('keystat');st.textContent='unlocking… (a few seconds)';
    crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey'])
    .then(function(km){return crypto.subtle.deriveKey({name:'PBKDF2',salt:b64a(enc.salt),iterations:600000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['decrypt'])})
    .then(function(k){return crypto.subtle.decrypt({name:'AES-GCM',iv:b64a(enc.iv)},k,b64a(enc.ct))})
    .then(function(pt){
      localStorage.setItem('owaudio_key',new TextDecoder().decode(pt).trim());
      keyin.value=localStorage.getItem('owaudio_key');keyStat();
    })
    .catch(function(){st.textContent='✗ wrong passphrase'});
  });
});

/* ---------- mic test ---------- */
document.getElementById('mictest').addEventListener('click',function(){
  var st=document.getElementById('micstat');st.textContent='asking…';
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
    s.getTracks().forEach(function(t){t.stop()});st.textContent='✓ mic works';
  }).catch(function(e){st.textContent='✗ '+e.name});
});

/* ---------- dwell duration setup ---------- */
var dursEl=document.getElementById('durs');
DWELLS.forEach(function(d){
  var key=d[0],row=document.createElement('div');row.className='durrow';
  var cur=Number(load('dur_'+key))||0;
  row.innerHTML='<span class="lab">'+d[1]+'</span><button data-d="-30">−30s</button>'+
    '<span class="val">'+(cur?fmt(cur):'open')+'</span><button data-d="30">+30s</button>';
  row.querySelectorAll('button').forEach(function(b){
    b.addEventListener('click',function(){
      cur=Math.max(0,Math.min(1800,cur+Number(b.getAttribute('data-d'))));
      save('dur_'+key,String(cur));
      row.querySelector('.val').textContent=cur?fmt(cur):'open';
    });
  });
  dursEl.appendChild(row);
});
if(idx>0&&idx<SEQ.length){
  document.getElementById('resume').style.display='inline-block';
  document.getElementById('restart').style.display='inline-block';
}
function satTotal(){var s=0;for(var k in sat)s+=sat[k]||0;return s}
(function(){
  var sessions=jload('sessions',{}),n=0,dur=0,satd=0;
  for(var k in sessions){n++;dur+=sessions[k].dur||0;satd+=sessions[k].sat||0}
  if(n)document.getElementById('totals').textContent=
    'practiced here: '+fmt(dur)+' across '+n+' session'+(n>1?'s':'')+' · '+fmt(satd)+' in dwells';
})();
setInterval(function(){
  if(!scr.session.classList.contains('on')||!t0)return;
  document.getElementById('clock').textContent=fmt((Date.now()-t0)/1000);
  document.getElementById('satsum').textContent=fmt(satTotal());
},1000);
document.getElementById('begin').addEventListener('click',function(){
  if(!localStorage.getItem('owaudio_key')){document.getElementById('keystat').textContent='unlock or paste a key first';return}
  resetSession();wake();show('session');go(0);
});
document.getElementById('resume').addEventListener('click',function(){wake();show('session');go(idx)});
document.getElementById('restart').addEventListener('click',function(){resetSession();renderFeed();
  document.getElementById('resume').style.display='none';document.getElementById('restart').style.display='none'});
function resetSession(){idx=0;tx={};sat={};cues={};t0=Date.now();
  save('idx','0');save('tx','{}');save('sat','{}');save('cues','{}');save('t0',String(t0))}

/* ---------- wake lock ---------- */
var wl=null;
function wake(){if(navigator.wakeLock)navigator.wakeLock.request('screen').then(function(l){wl=l}).catch(function(){})}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&!scr.setup.classList.contains('on'))wake()});

/* ---------- session ui ---------- */
var crumb=document.getElementById('crumb'),title=document.getElementById('steptitle'),
    stage=document.getElementById('stage'),bigbtn=document.getElementById('bigbtn'),
    altbtn=document.getElementById('altbtn'),skipbtn=document.getElementById('skipbtn'),
    errbox=document.getElementById('errbox'),feed=document.getElementById('feed');
function setStage(html){stage.innerHTML=html}
function setButtons(main,mainFn,alt,altFn){
  bigbtn.textContent=main||'';bigbtn.style.display=main?'inline-block':'none';bigbtn.onclick=mainFn||null;
  altbtn.textContent=alt||'';altbtn.style.display=alt?'inline-block':'none';altbtn.onclick=altFn||null;
}
function err(msg){errbox.style.display=msg?'block':'none';errbox.textContent=msg||''}

function go(i){
  clearInterval(dwellIv);dwellIv=null;err('');narrActive=false;
  if(i>=SEQ.length){finish();return}
  idx=i;save('idx',String(i));
  var st=SEQ[i];crumb.textContent=st.crumb;title.textContent=st.title;
  if(st.t==='say')doSay(st);
  else if(st.t==='dwell')doDwell(st);
  else doSpeak(st);
}
skipbtn.addEventListener('click',function(){au.pause();au.onended=null;stopRec(true);go(idx+1)});

/* ---------- narration (transport: pause/play · −10s · restart) ---------- */
var narrActive=false;
function play(id,onend){au.onended=onend||null;au.src=C.audio+id+'.mp3';au.play().catch(function(e){err('Tap play — '+e.name)})}
function narrUI(id,onend){
  narrActive=true;
  setStage('<span class="word">narration</span>'+
    '<div class="transport"><button id="tp_back">−10s</button><button id="tp_start">↺ start</button></div>');
  function playing(){if(au.paused){au.play().catch(function(){})}bigbtn.textContent='Pause'}
  document.getElementById('tp_back').addEventListener('click',function(){
    au.currentTime=Math.max(0,(au.currentTime||0)-10);playing()});
  document.getElementById('tp_start').addEventListener('click',function(){
    au.currentTime=0;playing()});
  setButtons('Pause',function(){
    if(au.paused){playing()}else{au.pause();bigbtn.textContent='Play'}
  },null,null);
  play(id,function(){narrActive=false;onend()});
}
function doSay(st){narrUI(st.id,function(){go(idx+1)})}

/* ---------- dwell: looped silence -> chime ---------- */
function doDwell(st){
  var dur=Number(load('dur_'+st.key))||0;dwellOpen=(dur===0);
  dwellLoops=0;dwellStart=Date.now();
  function tick(){
    var el=(Date.now()-dwellStart)/1000;
    setStage('<span class="big">'+(dwellOpen?fmt(el):fmt(Math.max(0,dur-el)))+'</span>'+
      '<span class="word">'+(dwellOpen?'open dwell — end when you want':'the chime is permission, not a demand')+'</span>');
    if(!dwellOpen&&el>=dur){endDwell(st)}
  }
  dwellIv=setInterval(tick,500);tick();
  setButtons(dwellOpen?'End dwell':'End early',function(){endDwell(st)},
    st.cue?'⟲ the instruction':null,st.cue?function(){playCue(st)}:null);
  loopSilence();
}
/* sparse mode: full instruction only on request — each ask is logged (the miss record) */
function playCue(st){
  cues[st.key]=(cues[st.key]||0)+1;save('cues',JSON.stringify(cues));
  au.onended=function(){loopSilence()};
  au.src=C.audio+st.cue+'.mp3';au.play().catch(function(){loopSilence()});
}
function loopSilence(){au.onended=function(){dwellLoops++;loopSilence()};au.src=C.audio+'silence30.mp3';au.play().catch(function(){})}
function endDwell(st){
  clearInterval(dwellIv);dwellIv=null;au.onended=null;
  sat[st.key]=Math.round((Date.now()-dwellStart)/1000);save('sat',JSON.stringify(sat));
  au.src=C.audio+'chime.mp3';
  au.onended=function(){go(idx+1)};
  au.play().catch(function(){go(idx+1)});
}

/* ---------- speech windows ---------- */
function doSpeak(st){
  lastKey=st.key;lastBlob=null;
  function idle(){
    var existing=tx[st.key];
    setStage('<span class="word">'+st.title+(existing?'<br><em>already answered — record again to replace</em>':'')+'</span>');
    setButtons('● Record',startRec,'Continue →',function(){go(idx+1)});
  }
  if(st.prompt){narrUI(st.prompt,idle)}
  else idle();

  function startRec(){
    err('');
    navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
      micStream=s;chunks=[];
      var mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(function(m){return window.MediaRecorder&&MediaRecorder.isTypeSupported(m)})||'';
      rec=new MediaRecorder(s,mime?{mimeType:mime}:undefined);
      rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data)};
      rec.onstop=function(){
        micStream.getTracks().forEach(function(t){t.stop()});micStream=null;
        var blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});
        if(blob.size<1200){idle();return}
        lastBlob=blob;transcribe(blob,st);
      };
      recStart=Date.now();rec.start();
      recTimer=setInterval(function(){
        var el=(Date.now()-recStart)/1000;
        setStage('<span class="rec live">● recording</span><span class="big">'+fmt(el)+'</span>');
        if(el>=180)stopRec();
      },400);
      setStage('<span class="rec live">● recording</span><span class="big">0:00</span>');
      setButtons('⏹ Stop',function(){stopRec()},null,null);
    }).catch(function(e){err('Mic: '+e.name)});
  }
}
function stopRec(silent){
  clearInterval(recTimer);recTimer=null;
  if(rec&&rec.state!=='inactive'){if(silent)rec.onstop=function(){if(micStream){micStream.getTracks().forEach(function(t){t.stop()});micStream=null}};rec.stop()}
  rec=silent?null:rec;
}
function whisper(blob){
  var key=localStorage.getItem('owaudio_key');
  var ext=(blob.type.indexOf('mp4')>-1)?'mp4':'webm';
  var fd=new FormData();
  fd.append('file',blob,'clip.'+ext);
  fd.append('model','whisper-1');
  fd.append('language','en');
  fd.append('temperature','0');
  fd.append('prompt','Owning wanting course. Blackstone, Chapman, Hudson, midsection, facsimile, counterfeit, ferocity, wrathful, dantien, kua, desire settling on power, the dimmer, no clear border, many wants at once, without a subject.');
  return fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{'Authorization':'Bearer '+key},body:fd})
    .then(function(r){if(!r.ok)return r.text().then(function(t){throw new Error(r.status+' '+t.slice(0,120))});return r.json()})
    .then(function(j){return (j.text||'').trim()});
}
function transcribe(blob,st){
  setStage('<span class="word">transcribing…</span>');setButtons(null,null,null,null);
  whisper(blob)
  .then(function(text){
    tx[st.key]={text:text,at:Math.round((Date.now()-t0)/1000)};
    save('tx',JSON.stringify(tx));renderFeed();
    setStage('<span class="word">✓ landed below — edit it there if needed</span>');
    setButtons('Continue →',function(){go(idx+1)},'Re-record',function(){go(idx)});
  })
  .catch(function(e){
    err('Transcription failed: '+e.message);
    setStage('<span class="word">the recording is still here</span>');
    setButtons('Retry',function(){transcribe(blob,st)},'Type instead',function(){
      tx[st.key]={text:'',at:Math.round((Date.now()-t0)/1000)};save('tx',JSON.stringify(tx));
      renderFeed();err('');
      setStage('<span class="word">type into the entry below, then continue</span>');
      setButtons('Continue →',function(){go(idx+1)},null,null);
    });
  });
}

/* ---------- traveling pen: pause anywhere, type/paste or record ---------- */
var notebtn=document.getElementById('notebtn'),notepanel=document.getElementById('notepanel'),
    notepen=document.getElementById('notepen'),noteerr=document.getElementById('noteerr'),
    pausedByNote=false,nStream=null,nRec=null;
function noteErr(m){noteerr.style.display=m?'block':'none';noteerr.textContent=m||''}
notebtn.addEventListener('click',function(){
  if(!notepanel.hidden){closeNote(false);return}
  pausedByNote=(!au.paused&&SEQ[idx]&&SEQ[idx].t!=='dwell');
  if(pausedByNote){au.pause();if(narrActive)bigbtn.textContent='Play'}
  notepanel.hidden=false;notebtn.textContent='✕ close';notepen.focus();
});
document.getElementById('notecancel').addEventListener('click',function(){closeNote(false)});
document.getElementById('notesave').addEventListener('click',function(){closeNote(true)});
function closeNote(saveIt){
  stopNoteRec();
  if(saveIt){
    var t=notepen.innerText.trim();
    if(t){
      var k='note_'+Date.now();
      tx[k]={text:t,at:Math.round((Date.now()-t0)/1000),label:(SEQ[idx]?SEQ[idx].title:'')};
      save('tx',JSON.stringify(tx));renderFeed();
    }
  }
  notepen.textContent='';noteErr('');notepanel.hidden=true;notebtn.textContent='✎ thought';
  if(pausedByNote){au.play().catch(function(){});if(narrActive)bigbtn.textContent='Pause'}
  pausedByNote=false;
}
function stopNoteRec(){if(nRec&&nRec.state!=='inactive')nRec.stop();else if(nStream){nStream.getTracks().forEach(function(t){t.stop()});nStream=null}}
document.getElementById('noterec').addEventListener('click',function(){
  var b=this;
  if(nRec&&nRec.state==='recording'){nRec.stop();return}
  noteErr('');
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(s){
    nStream=s;var chunks2=[];
    var mime=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(function(m){return window.MediaRecorder&&MediaRecorder.isTypeSupported(m)})||'';
    nRec=new MediaRecorder(s,mime?{mimeType:mime}:undefined);
    nRec.ondataavailable=function(e){if(e.data.size)chunks2.push(e.data)};
    nRec.onstop=function(){
      nStream.getTracks().forEach(function(t){t.stop()});nStream=null;
      b.textContent='● Record';
      var blob=new Blob(chunks2,{type:nRec.mimeType||'audio/webm'});nRec=null;
      if(blob.size<1200)return;
      b.textContent='…transcribing';
      whisper(blob).then(function(text){
        b.textContent='● Record';
        notepen.textContent=(notepen.innerText.trim()?notepen.innerText.trim()+' ':'')+text;
      }).catch(function(e){b.textContent='● Record';noteErr('Transcription failed: '+e.message)});
    };
    nRec.start();b.textContent='⏹ Stop';
  }).catch(function(e){noteErr('Mic: '+e.name)});
});

/* ---------- transcript feed ---------- */
function labelFor(key){
  var s=SEQ.find(function(x){return x.t==='speak'&&x.key===key});return s?s.label:key;
}
function renderFeed(){
  feed.innerHTML='';
  Object.keys(tx).forEach(function(k){
    var e=document.createElement('div');e.className='entry';
    e.innerHTML='<div class="lab">'+(k.indexOf('note_')===0?('✎ thought · during '+(tx[k].label||'—')):labelFor(k))+' · at '+fmt(tx[k].at)+'</div>'+
      '<div class="txt" contenteditable="true"></div>';
    var t=e.querySelector('.txt');t.textContent=tx[k].text;
    t.addEventListener('input',function(){tx[k].text=t.textContent;save('tx',JSON.stringify(tx))});
    feed.appendChild(e);
  });
}
renderFeed();

/* ---------- export ---------- */
function buildExport(){
  var out=['## '+C.exportTitle+' ('+new Date().toISOString().slice(0,10)+')',
    '*session '+fmt((Date.now()-t0)/1000)+' · dwells sat '+fmt(satTotal())+'*'];
  var cueable=SEQ.filter(function(s){return s.t==='dwell'&&s.cue}).length;
  if(cueable)out.push('*recall: asked for the instruction at '+Object.keys(cues).length+' of '+cueable+' stations*');
  out.push('');
  DWELLS.forEach(function(d){
    var k=d[0],note=tx[C.stationPenPrefix+k];
    if(!sat[k]&&!(note&&note.text))return;
    out.push('**'+d[1].replace(' (optional)','')+'**'+(sat[k]?' — ✓ sat ('+fmt(sat[k])+')':'')+
      (cues[k]?' · ⟲ instruction'+(cues[k]>1?' ×'+cues[k]:''):''));
    if(note&&note.text)out.push(note.text);
    out.push('');
  });
  C.pens.forEach(function(k){
    if(tx[k]&&tx[k].text){out.push('**✎ '+k+'** · at '+fmt(tx[k].at),tx[k].text,'')}
  });
  Object.keys(tx).forEach(function(k){
    if(k.indexOf('note_')===0&&tx[k].text){out.push('**✎ thought · during '+(tx[k].label||'—')+' · at '+fmt(tx[k].at)+'**',tx[k].text,'')}
  });
  if(tx.feedback&&tx.feedback.text){out.push('**Feedback**',tx.feedback.text,'')}
  return out.join('\n');
}
function finish(){
  var sessions=jload('sessions',{});
  sessions[t0]={dur:Math.round((Date.now()-t0)/1000),sat:satTotal()};
  save('sessions',JSON.stringify(sessions));
  document.getElementById('exporttext').value=buildExport();show('done');
}
document.getElementById('copybtn').addEventListener('click',function(){
  var ta=document.getElementById('exporttext');ta.select();
  try{navigator.clipboard.writeText(ta.value)}catch(e){document.execCommand('copy')}
  this.textContent='Copied ✓';var b=this;setTimeout(function(){b.textContent='Copy'},1800);
});
document.getElementById('backbtn').addEventListener('click',function(){show('session');go(Math.min(idx,SEQ.length-1))});
document.getElementById('newbtn').addEventListener('click',function(){resetSession();renderFeed();show('setup')});
})();

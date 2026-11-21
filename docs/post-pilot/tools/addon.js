(function(){
var KEY='ui9a-fixround-answers-v1';
var HEAD='UI-9a plot selector fix round - my answers';
var ITEMS=[
 {n:1,title:'Number tiles',q:'Which number-tile design should I build?',opts:[
  {k:'A',t:'Approve A',rec:1,d:'5 across, no dot, tick in the corner, number 24 px',out:'APPROVE A - 5 across (4 below 340 px), no dot, tick in the top-right corner, number 24 px, tile 64 px tall'},
  {k:'B',t:'Approve B',d:'bigger: 4 across, number 30 px, one more row',out:'APPROVE B - bigger tiles, 4 across (3 below 340 px), number 30 px, tile 72 px tall'},
  {k:'C',t:'I want a change',d:'write it in the box below',out:''}]},
 {n:2,title:'Chosen-crop strip on the Log screen',q:'Which look for the strip at the top of the Log plot step?',opts:[
  {k:'A',t:'Approve A',rec:1,d:'dark green, same as a chosen plot; photo and crop name only',out:'APPROVE A - dark green strip like a chosen plot, photo + crop name only, label and count removed'},
  {k:'B',t:'Approve B',d:'keep today\'s pale green look; photo and crop name only',out:'APPROVE B - pale green strip as today, photo + crop name only, label and count removed'},
  {k:'C',t:'I want a change',d:'write it in the box below',out:''}]},
 {n:3,title:'Crop header',q:'What replaces the stray green bar?',opts:[
  {k:'A',t:'Approve A',rec:1,d:'bar removed; thin crop-colour line under the photo',out:'APPROVE A - stray bar removed, 4 px crop-colour strip under the 40 px photo, name 18 px, count line 14 px'},
  {k:'B',t:'Approve B',d:'bar removed; no colour in the header',out:'APPROVE B - stray bar removed, no colour in the header'},
  {k:'C',t:'I want a change',d:'write it in the box below',out:''}]},
 {n:4,title:'Count words (Marathi order)',q:'Use one correct sentence for the count everywhere?',opts:[
  {k:'A',t:'Approve A',rec:1,d:'total first everywhere: "१५ पैकी १ निवडले"',out:'APPROVE A - one wording everywhere, total first: "१५ पैकी १ निवडले"; with nothing picked a crop card keeps "३ प्लॉट"'},
  {k:'L',t:'Leave it',d:'keep the backwards wording as it is today',out:'LEAVE as it is today'},
  {k:'C',t:'I want a change',d:'write it in the box below',out:''}]},
 {n:5,title:'Text size and paleness',q:'Make the small text bigger and darker?',opts:[
  {k:'A',t:'Approve A',rec:1,d:'tile names 13 px; other small text 14 px in darker grey',out:'APPROVE A - tile names 13 px near black (white when chosen), other small text 14 px in darker grey (#44403c), no wording changed'},
  {k:'L',t:'Leave it',d:'keep 12 to 12.5 px light grey as today',out:'LEAVE as it is today'},
  {k:'C',t:'I want a change',d:'write it in the box below',out:''}]},
 {n:6,title:'Same crops drawn twice on the overview',q:'Remove the second row of the same crops?',opts:[
  {k:'A',t:'Approve A',rec:1,d:'keep the "सर्व पिकं" card; remove the lower crop cards (8 crops or fewer)',out:'APPROVE A - keep the all-crops card, remove the lower crop cards while every crop has its own photo (8 crops or fewer)'},
  {k:'B',t:'Approve B',d:'leave both as they are today',out:'APPROVE B - leave both rows as they are today'},
  {k:'C',t:'I want a change',d:'write it in the box below',out:''}]},
 {n:7,title:'Numbers on the calendar',q:'Should the calendar chips also show the new natural-order numbers?',opts:[
  {k:'A',t:'Approve A',rec:1,d:'yes: the calendar uses the same numbers as the tiles and cards (needs the CTO\'s ok, I will tell them)',out:'APPROVE A - the calendar chips use the same natural-order numbers as the tiles and plot cards, in this fix'},
  {k:'B',t:'Approve B',d:'no: leave the calendar for now, as the CTO said (it may disagree with the tiles)',out:'APPROVE B - leave the calendar alone for now; it may show a different number than the tile'},
  {k:'C',t:'I want a change',d:'write it in the box below',out:''}]}
];
var state={};
function load(){try{var s=window.localStorage.getItem(KEY);if(s){var o=JSON.parse(s);if(o&&typeof o==='object')state=o;}}catch(e){}}
var SAVE_NAME='ui-9a-plot-selector-fix-round-2026-11-20';
var SAVE_URL='http://localhost:3060/save/';
var diskTimer=null;
function setDisk(s){
  var t=s==='ok'?'Saved to disk on this PC':(s==='fail'?'Not saved to disk (answers server not reachable). Use Copy my answer.':'');
  $$('.disk').forEach(function(e){e.textContent=t;e.setAttribute('data-state',s||'');});
}
function toDisk(){
  clearTimeout(diskTimer);
  diskTimer=setTimeout(function(){
    try{
      fetch(SAVE_URL+SAVE_NAME,{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({page:SAVE_NAME,answers:state,text:outText(),savedAt:new Date().toISOString()})})
        .then(function(r){setDisk(r.ok?'ok':'fail');},function(){setDisk('fail');});
    }catch(e){setDisk('fail');}
  },400);
}
function fromDisk(done){
  try{
    fetch(SAVE_URL.replace('/save/','/answers/')+SAVE_NAME+'.json',{cache:'no-store'})
      .then(function(r){return r.ok?r.json():null;})
      .then(function(j){if(j&&j.answers&&typeof j.answers==='object'&&!answered()){state=j.answers;try{window.localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}done(true);}else done(false);},function(){done(false);});
  }catch(e){done(false);}
}
function save(){try{window.localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}toDisk();}
function item(n){for(var i=0;i<ITEMS.length;i++)if(ITEMS[i].n===n)return ITEMS[i];return null;}
function opt(it,k){for(var i=0;i<it.opts.length;i++)if(it.opts[i].k===k)return it.opts[i];return null;}
function oneLine(s){return String(s||'').replace(/\s*[\r\n]+\s*/g,' ').trim();}
function choiceLabel(it){var a=state[it.n];if(!a||!a.k)return '';var o=opt(it,a.k);return o?o.t:'';}
function line(it){
  var a=state[it.n],note=oneLine(a&&a.note);
  if(!a||!a.k)return it.n+'. '+it.title+': NOT ANSWERED - hold, do not build';
  if(a.k==='C')return it.n+'. '+it.title+': CHANGE - '+(note||'(not written yet - ask me before building)');
  var o=opt(it,a.k);
  return it.n+'. '+it.title+': '+o.out+(note?' | my note: '+note:'');
}
function answered(){var c=0;ITEMS.forEach(function(it){var a=state[it.n];if(a&&a.k)c++;});return c;}
function outText(){
  var l=[HEAD,''];
  ITEMS.forEach(function(it){l.push(line(it));});
  l.push('');
  l.push('Build exactly what is approved above and nothing else. Hold anything marked NOT ANSWERED or CHANGE until I confirm.');
  return l.join('\n');
}
function $(s,r){return (r||document).querySelector(s);}
function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
var CK='<svg class="ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function secFor(n){
  var nums=$$('.sec h2 .num');
  for(var i=0;i<nums.length;i++){if(nums[i].textContent.trim()===String(n))return nums[i].parentNode.parentNode;}
  return null;
}
function build(){
  ITEMS.forEach(function(it){
    var sec=secFor(it.n);if(!sec)return;
    sec.id='item-'+it.n;
    var d=document.createElement('div');d.className='ans';d.setAttribute('data-item',it.n);
    var h='<div class="ans-h"><span>Your answer, item '+it.n+': '+it.title+'</span>'+(it.size?'<span class="szt">Size of change: '+it.size+'</span>':'')+'<span class="ans-status" data-status></span></div>';
    h+='<p class="ans-q">'+it.q+'</p>';
    h+='<div class="opts" role="radiogroup" aria-label="Answer for item '+it.n+'">';
    it.opts.forEach(function(o){
      h+='<button type="button" class="opt" role="radio" aria-checked="false" data-k="'+o.k+'">'+CK+'<span class="tx"><span class="ot">'+o.t+(o.rec?' <em>(recommended)</em>':'')+'</span><small>'+o.d+'</small></span></button>';
    });
    h+='</div>';
    h+='<label class="nl">Your own change, or a note (needed if you choose "I want a change")<textarea data-note rows="2" placeholder="Write here, in English or Marathi"></textarea></label>';
    h+='<button type="button" class="lnk" data-clear>Clear this answer</button>';
    d.innerHTML=h;
    sec.appendChild(d);
    var ta=$('[data-note]',d);ta.value=(state[it.n]&&state[it.n].note)||'';
  });
}
function render(){
  ITEMS.forEach(function(it){
    var d=$('.ans[data-item="'+it.n+'"]');if(!d)return;
    var a=state[it.n]||{};
    $$('.opt',d).forEach(function(b){b.setAttribute('aria-checked',a.k===b.getAttribute('data-k')?'true':'false');});
    var st=$('[data-status]',d);
    if(a.k){st.textContent='Chosen: '+choiceLabel(it);st.className='ans-status done';}
    else{st.textContent='Not answered yet';st.className='ans-status';}
  });
  var tb=$('#sumtable');
  if(tb){
    var r='<table><tr><th>Item</th><th>Your choice</th></tr>';
    ITEMS.forEach(function(it){
      var c=choiceLabel(it),a=state[it.n]||{};
      r+='<tr><td><a href="#item-'+it.n+'">'+it.n+' '+it.title+'</a></td><td>'+(c?c:'<span class="na">Not answered</span>')+(a.k&&a.note&&a.note.trim()?' (with a note)':'')+'</td></tr>';
    });
    tb.innerHTML=r+'</table>';
  }
  var o=$('#out');if(o)o.value=outText();
  var n=answered(),t=ITEMS.length;
  var txt=n+' of '+t+' answered';
  var c1=$('#cnt'),c0=$('#cnt0');
  if(c1)c1.textContent=txt;if(c0)c0.textContent=txt;
}
function say(m){var e=$('#copied');if(e)e.textContent=m;var f=$('#copied2');if(f)f.textContent=m;}
function copy(){
  var o=$('#out');o.value=outText();
  var left=ITEMS.length-answered();
  var msg='Copied. Now paste it into the chat.'+(left?' ('+left+' item'+(left>1?'s':'')+' still not answered.)':'');
  function fb(){
    try{o.focus();o.select();if(document.execCommand&&document.execCommand('copy')){say(msg);return;}}catch(e){}
    say('Could not copy by button. The answer is selected: press Ctrl+C, then paste it into the chat.');
  }
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(o.value).then(function(){say(msg);},fb);return;}
  }catch(e){}
  fb();
}
function setAll(){
  ITEMS.forEach(function(it){
    var rec=null;it.opts.forEach(function(o){if(o.rec)rec=o;});
    if(rec){var a=state[it.n]||{};a.k=rec.k;state[it.n]=a;}
  });
  save();render();
}
function clearAll(){state={};save();$$('[data-note]').forEach(function(t){t.value='';});say('');render();}

document.addEventListener('click',function(ev){
  var b=ev.target.closest?ev.target.closest('.opt'):null;
  if(b){
    var d=b.closest('.ans'),n=+d.getAttribute('data-item');
    var a=state[n]||{};a.k=b.getAttribute('data-k');a.note=$('[data-note]',d).value;state[n]=a;
    save();render();
    if(a.k==='C'){var ta=$('[data-note]',d);if(!ta.value.trim())ta.focus();}
    return;
  }
  var c=ev.target.closest?ev.target.closest('[data-clear]'):null;
  if(c){
    var d2=c.closest('.ans'),n2=+d2.getAttribute('data-item');
    delete state[n2];$('[data-note]',d2).value='';save();render();return;
  }
  var id=ev.target.id;
  if(id==='copy'||id==='copy2')copy();
  else if(id==='allrec'||id==='allrec2')setAll();
  else if(id==='clearall')clearAll();
});
document.addEventListener('input',function(ev){
  var t=ev.target;
  if(t&&t.hasAttribute&&t.hasAttribute('data-note')){
    var d=t.closest('.ans'),n=+d.getAttribute('data-item');
    var a=state[n]||{};a.note=t.value;
    if(!a.k&&t.value.trim())a.k='C';
    state[n]=a;save();render();
  }
});

function boot(){
  load();
  var lead=$('.lead'),sm=lead&&lead.nextElementSibling;
  if(sm){
    var q=document.createElement('div');q.className='quick';
    q.innerHTML='<span><b>Short way:</b> tap this, then change only what you disagree with.</span><button type="button" class="btn pri" id="allrec2">Approve all recommended</button><span id="cnt0" style="font-weight:700"></span>';
    sm.parentNode.insertBefore(q,sm.nextSibling);
  }
  build();render();
  if(!answered()){
    fromDisk(function(got){
      if(got){
        $$('.ans').forEach(function(d){var a=state[+d.getAttribute('data-item')];$('[data-note]',d).value=(a&&a.note)||'';});
        render();setDisk('ok');
      }
    });
  }
}
boot();
})();

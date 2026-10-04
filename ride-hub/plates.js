'use strict';
const {REGIONS,TIERS,tier,generate,valid,key}=PlateEngine;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const tg=window.Telegram?.WebApp;
const DISPLAY_TIERS=[
  {name:'Обычный',color:'#9198a1',min:40,max:900,desc:'Обычная комбинация без выраженного рисунка.'},
  {name:'Необычный',color:'#35e982',min:1800,max:890000,desc:'Есть повтор цифр или букв.'},
  {name:'Редкий',color:'#318dff',min:900000,max:4900000,desc:'Зеркало, последовательность или сильный цифровой рисунок.'},
  {name:'Эпический',color:'#a15aff',min:5000000,max:9900000,desc:'Сильное совпадение букв или особая серия цифр.'},
  {name:'Легендарный',color:'#f0a51a',min:10000000,max:29990000,desc:'Максимально выразительное сочетание.'}
];
const baseKey='nomer-v2-'+(tg?.initDataUnsafe?.user?.id||'local');
const oldKey='nomer-v1-'+(tg?.initDataUnsafe?.user?.id||'local');
let state={rolls:0,collection:[],history:[],current:null,previous:null,region:'all',haptic:true,reduced:false};
let busy=false,toastTimer=0;

function load(){
  try{
    let raw=localStorage.getItem(baseKey);
    if(!raw){
      const old=JSON.parse(localStorage.getItem(oldKey)||'null');
      if(old&&typeof old==='object') raw=JSON.stringify({rolls:old.rolls||0,collection:old.collection||[],history:old.history||[],current:old.current||null,region:old.region||'all',haptic:old.haptic!==false});
    }
    const saved=JSON.parse(raw||'null');
    if(saved&&typeof saved==='object'){
      state={...state,...saved};
      state.collection=(Array.isArray(state.collection)?state.collection:[]).filter(valid).slice(0,5000);
      state.history=(Array.isArray(state.history)?state.history:[]).filter(valid).slice(0,20);
      state.current=valid(state.current)?state.current:null;
      state.previous=valid(state.previous)?state.previous:null;
      state.rolls=Math.max(0,Number(state.rolls)||0);
      if(state.region!=='all'&&!REGIONS.some(r=>r.code===state.region))state.region='all';
    }
  }catch{}
}
function persist(){try{localStorage.setItem(baseKey,JSON.stringify(state))}catch{}}
function fmtPrice(n){return Math.round(n).toLocaleString('ru-RU')+' ₽'}
function regionName(code){return REGIONS.find(r=>r.code===code)?.name||'Все регионы'}
function hashString(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function displayTier(p){return Math.min(4,tier(p))}
function priceFor(p){
  const t=displayTier(p),d=DISPLAY_TIERS[t],h=hashString(key(p));
  let max=d.max,min=d.min;
  if(t===4&&tier(p)===5){min=30000000;max=99900000}
  const x=(h%100000)/100000;
  return Math.round(min+(max-min)*(0.16+0.84*x));
}
function featuresFor(p){
  const out=[],letters=p.a+p.b+p.c,n=p.n;
  if(n[0]===n[1]&&n[1]===n[2])out.push('3 одинаковые цифры');
  else if(new Set(n).size<3)out.push('Повтор цифр');
  if(letters[0]===letters[1]&&letters[1]===letters[2])out.push('3 одинаковые буквы');
  else if(new Set(letters).size<3)out.push('Повтор букв');
  if(n[0]===n[2])out.push('Зеркальная комбинация');
  if(['123','234','345','456','567','678','789','987','876','765','654','543','432','321','210'].includes(n))out.push('Последовательность цифр');
  if(Number(n)%100===0)out.push('Ровная сотня');
  if(String(Number(p.r)).length<=3&&(n.includes(String(Number(p.r)).padStart(2,'0'))||n.endsWith(String(Number(p.r)))))out.push('Цифры совпадают с регионом');
  if(!out.length)out.push('Уникальная комбинация');
  return out.slice(0,4);
}
function plate(p){
  return '<div class="plate"><div class="plate-main"><span class="letter">'+p.a+'</span><span class="digits">'+p.n+'</span><span class="letter">'+p.b+p.c+'</span></div><div class="plate-region"><strong>'+p.r+'</strong><div class="plate-country">RUS<i class="flag"></i></div></div></div>';
}
function setTierVisual(index){
  const d=DISPLAY_TIERS[index];
  document.documentElement.style.setProperty('--tier',d.color);
  $('#rarityName').textContent=d.name;
  $$('#rarityScale i').forEach((el,i)=>el.classList.toggle('active',i<=index));
}
function updatePrevious(p){
  if(!p){$('#previousSlot').classList.add('hidden');return}
  $('#previousSlot').classList.remove('hidden');
  $('#previousPlate').innerHTML=plate(p);
  const t=displayTier(p);
  $('#previousTier').textContent=DISPLAY_TIERS[t].name;
  $('#previousTier').style.color=DISPLAY_TIERS[t].color;
  $('#previousPrice').textContent=fmtPrice(priceFor(p));
}
function renderCurrent(immediate=true){
  const p=state.current;
  if(!p){
    const demo={a:'М',n:'222',b:'М',c:'М',r:'22'};
    $('#currentPlate').innerHTML=plate(demo);
    $('#featureList').innerHTML='<span>Нажми синюю кнопку, чтобы выбить первый номер</span>';
    setTierVisual(0);$('#priceValue').textContent='0 ₽';return;
  }
  $('#currentPlate').innerHTML=plate(p);
  const t=displayTier(p);
  setTierVisual(t);
  $('#priceValue').textContent=fmtPrice(priceFor(p));
  $('#featureList').innerHTML=featuresFor(p).map(x=>'<span>'+x+'</span>').join('');
  $('#app').classList.add('revealed');
  updatePrevious(state.previous);
  updateSave();
}
function collectionValue(){return state.collection.reduce((sum,p)=>sum+priceFor(p),0)}
function renderStats(){
  $('#drawerOwned').textContent=state.collection.length.toLocaleString('ru-RU');
  $('#rollCounter').textContent=state.rolls.toLocaleString('ru-RU')+' выбито';
  $('#balanceValue').textContent=fmtPrice(collectionValue());
  const label=state.region==='all'?'Россия · все регионы':'Россия · '+state.region;
  $('#regionLabel').textContent=label;
  $('#drawerRegion').textContent=state.region==='all'?'Все регионы':state.region+' · '+regionName(state.region);
  updateSave();
}
function updateSave(){
  const saved=state.current&&state.collection.some(p=>key(p)===key(state.current));
  $('#saveBtn').classList.toggle('saved',Boolean(saved));
  $('#saveBtn').textContent=saved?'✓':'＋';
}
function haptic(kind='selection'){
  if(!state.haptic)return;
  try{kind==='success'?tg?.HapticFeedback.notificationOccurred('success'):tg?.HapticFeedback.selectionChanged()}catch{}
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function easeOutCubic(x){return 1-Math.pow(1-x,3)}
async function roll(){
  if(busy)return;
  busy=true;
  closeDrawer();
  $('#app').classList.remove('revealed','final-pop');
  $('#app').classList.add('rolling');
  $('#featureList').innerHTML='';
  $('#priceValue').textContent='0 ₽';
  setTierVisual(0);
  const old=state.current;
  const final=generate(state.region);
  const reduced=state.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps=reduced?2:22;
  for(let i=0;i<steps;i++){
    const temp=generate(state.region);
    $('#currentPlate').innerHTML=plate(temp);
    if(i%3===0){updatePrevious(i<4?old:temp);haptic()}
    await sleep(reduced?20:42+Math.min(55,i*2.2));
  }
  state.previous=old;
  state.current=final;
  state.rolls++;
  state.history=[final,...state.history].slice(0,20);
  persist();
  $('#currentPlate').innerHTML=plate(final);
  updatePrevious(old);
  $('#app').classList.remove('rolling');
  $('#app').classList.add('final-pop');
  await sleep(reduced?80:380);
  $('#app').classList.remove('final-pop');
  $('#app').classList.add('revealed');
  await analyze(final,reduced);
  renderStats();
  haptic('success');
  busy=false;
}
async function analyze(p,reduced){
  const targetTier=displayTier(p),targetPrice=priceFor(p);
  const duration=reduced?220:3200;
  const start=performance.now();
  return new Promise(resolve=>{
    function frame(now){
      const raw=Math.min(1,(now-start)/duration);
      const eased=easeOutCubic(raw);
      $('#priceValue').textContent=fmtPrice(targetPrice*eased);
      const stage=targetTier===0?0:Math.min(targetTier,Math.floor(raw*(targetTier+1)));
      setTierVisual(stage);
      if(raw<1)requestAnimationFrame(frame);
      else{
        setTierVisual(targetTier);
        $('#priceValue').textContent=fmtPrice(targetPrice);
        $('#featureList').innerHTML=featuresFor(p).map(x=>'<span>'+x+'</span>').join('');
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
function saveCurrent(){
  if(!state.current)return showToast('Сначала выбей номер');
  const i=state.collection.findIndex(p=>key(p)===key(state.current));
  if(i>=0){state.collection.splice(i,1);showToast('Убрано из коллекции')}
  else{
    if(state.collection.length>=5000)return showToast('Лимит коллекции — 5 000');
    state.collection.unshift({...state.current});showToast('Добавлено в коллекцию');haptic('success')
  }
  persist();renderStats();
  if($('#panel').classList.contains('open')&&$('#panelTitle').textContent==='Коллекция')renderCollection();
}
function showToast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),1800)}
function openDrawer(){$('#drawer').classList.add('open');$('#drawerBackdrop').classList.add('open');$('#drawer').setAttribute('aria-hidden','false')}
function closeDrawer(){$('#drawer').classList.remove('open');$('#drawerBackdrop').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true')}
function openPanel(title,eyebrow='НОМЕР'){
  closeDrawer();$('#panelTitle').textContent=title;$('#panelEyebrow').textContent=eyebrow;$('#panel').classList.add('open');$('#panel').setAttribute('aria-hidden','false')
}
function closePanel(){$('#panel').classList.remove('open');$('#panel').setAttribute('aria-hidden','true')}
function renderCollection(){
  openPanel('Коллекция','ТВОЙ ГАРАЖ');
  const body=$('#panelBody');
  if(!state.collection.length){body.innerHTML='<div class="empty-state"><b>Пока пусто</b><span>Сохраняй номера кнопкой «＋» слева.</span></div>';return}
  body.innerHTML='<div class="collection-grid">'+state.collection.map((p,i)=>{
    const t=displayTier(p),d=DISPLAY_TIERS[t];
    return '<button class="collection-card" data-remove="'+i+'" style="--card-tier:'+d.color+'"><div>'+plate(p)+'</div><div class="collection-meta"><b>'+d.name+'</b><span>'+fmtPrice(priceFor(p))+'</span></div></button>'
  }).join('')+'</div>';
  body.querySelectorAll('[data-remove]').forEach(btn=>btn.onclick=()=>{
    const idx=Number(btn.dataset.remove),p=state.collection[idx];
    if(p&&confirm('Убрать '+key(p)+' из коллекции?')){state.collection.splice(idx,1);persist();renderStats();renderCollection()}
  });
}
function renderRarity(){
  openPanel('Редкости','ШКАЛА ЦЕННОСТИ');
  $('#panelBody').innerHTML='<div class="tier-list">'+DISPLAY_TIERS.map((d,i)=>'<div class="tier-item" style="--c:'+d.color+'"><div class="tier-top"><b>'+d.name+'</b><strong>'+fmtPrice(d.min)+' — '+fmtPrice(d.max)+'</strong></div><p>'+d.desc+'</p></div>').join('')+'<div class="tier-item" style="--c:#f0a51a"><div class="tier-top"><b>Легендарный +</b><strong>до 99 900 000 ₽</strong></div><p>Тройное совпадение цифр и букв. Цена внутри приложения игровая и не является реальной рыночной оценкой.</p></div></div>';
}
function renderSettings(){
  openPanel('Настройки','ИНТЕРФЕЙС');
  $('#panelBody').innerHTML='<div class="setting"><div>Вибрация<small>Отклик Telegram при выбивании</small></div><button class="switch '+(state.haptic?'on':'')+'" id="hapticSwitch"><i></i></button></div><div class="setting"><div>Ускорить анимации<small>Сократить перебор и анализ цены</small></div><button class="switch '+(state.reduced?'on':'')+'" id="reducedSwitch"><i></i></button></div>';
  $('#hapticSwitch').onclick=()=>{state.haptic=!state.haptic;persist();renderSettings()};
  $('#reducedSwitch').onclick=()=>{state.reduced=!state.reduced;persist();renderSettings()};
}
function renderRegion(filter=''){
  openPanel('Регион','ГЕОГРАФИЯ');
  const body=$('#panelBody');
  body.innerHTML='<input class="region-search" id="regionSearch" placeholder="Москва, 777, Краснодар…"><div class="region-list" id="regionList"></div>';
  const input=$('#regionSearch'),list=$('#regionList');
  function paint(){
    const q=input.value.trim().toLowerCase();
    const rows=[{code:'all',name:'Все регионы'},...REGIONS].filter(r=>!q||(r.code+' '+r.name).toLowerCase().includes(q));
    list.innerHTML=rows.map(r=>'<button class="region-option '+(state.region===r.code?'selected':'')+'" data-code="'+r.code+'"><span>'+r.name+'</span><small>'+(r.code==='all'?'RUS':r.code)+'</small></button>').join('');
    list.querySelectorAll('[data-code]').forEach(b=>b.onclick=()=>{state.region=b.dataset.code;persist();renderStats();closePanel();showToast(state.region==='all'?'Все регионы':regionName(state.region))});
  }
  input.oninput=paint;paint();input.focus();
}
$('#rollBtn').onclick=roll;
$('#menuBtn').onclick=openDrawer;$('#drawerClose').onclick=closeDrawer;$('#drawerBackdrop').onclick=closeDrawer;
$('#panelClose').onclick=closePanel;
$('#saveBtn').onclick=saveCurrent;
$('#settingsBtn').onclick=renderSettings;
$('#collectionBtn').onclick=renderCollection;
$('#regionBtn').onclick=()=>renderRegion();
$$('.drawer-nav [data-action]').forEach(b=>b.onclick=()=>{
  const a=b.dataset.action;
  if(a==='hunt')closeDrawer();
  if(a==='collection')renderCollection();
  if(a==='rarity')renderRarity();
  if(a==='region')renderRegion();
  if(a==='settings')renderSettings();
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePanel();closeDrawer()}if(e.key==='Enter'&&!busy&&!$('#panel').classList.contains('open'))roll()});
load();renderStats();renderCurrent();updatePrevious(state.previous);
try{tg?.ready();tg?.expand();tg?.setHeaderColor('#090b10');tg?.setBackgroundColor('#090b10')}catch{}

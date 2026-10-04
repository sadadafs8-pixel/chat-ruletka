'use strict';

const {REGIONS,tier,generate,valid,key}=PlateEngine;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const tg=window.Telegram?.WebApp;

const ROLL_COST=1000;
const START_BALANCE=1000000;

const DISPLAY_TIERS=[
  {name:'Обычный',color:'#8b94a2',min:40,max:900,desc:'Обычная комбинация без выраженного рисунка.'},
  {name:'Необычный',color:'#35e982',min:1800,max:890000,desc:'Есть повтор цифр или букв.'},
  {name:'Редкий',color:'#318dff',min:900000,max:4900000,desc:'Зеркало, последовательность или сильный рисунок цифр.'},
  {name:'Эпический',color:'#a15aff',min:5000000,max:9900000,desc:'Сильное совпадение букв или особая серия.'},
  {name:'Легендарный',color:'#f0a51a',min:10000000,max:29990000,desc:'Максимально выразительное сочетание.'}
];

const storageKey='nomer-v7-'+(tg?.initDataUnsafe?.user?.id||'local');
const previousKeys=[
  'nomer-v7-'+(tg?.initDataUnsafe?.user?.id||'local'),
  'nomer-v6-'+(tg?.initDataUnsafe?.user?.id||'local'),
  'nomer-v5-'+(tg?.initDataUnsafe?.user?.id||'local'),
  'nomer-v4-'+(tg?.initDataUnsafe?.user?.id||'local'),
  'nomer-v2-'+(tg?.initDataUnsafe?.user?.id||'local'),
  'nomer-v1-'+(tg?.initDataUnsafe?.user?.id||'local')
];

let state={
  rolls:0,
  collection:[],
  history:[],
  current:null,
  previous:null,
  region:'all',
  haptic:true,
  reduced:false,
  balance:START_BALANCE,
  redeemedTransfers:[],
  transferredOut:[]
};

let busy=false;
let toastTimer=0;

function load(){
  try{
    let raw=localStorage.getItem(storageKey);
    if(!raw){
      for(const k of previousKeys){
        const candidate=localStorage.getItem(k);
        if(candidate){raw=candidate;break}
      }
    }

    const saved=JSON.parse(raw||'null');
    if(saved&&typeof saved==='object'){
      state={...state,...saved};
      state.collection=(Array.isArray(state.collection)?state.collection:[]).filter(valid).slice(0,5000);
      state.history=(Array.isArray(state.history)?state.history:[]).filter(valid).slice(0,20);
      state.current=valid(state.current)?state.current:null;
      state.previous=valid(state.previous)?state.previous:null;
      state.rolls=Math.max(0,Number(state.rolls)||0);
      state.balance=Number.isFinite(Number(state.balance))?Math.max(0,Math.round(Number(state.balance))):START_BALANCE;
      state.redeemedTransfers=Array.isArray(state.redeemedTransfers)?state.redeemedTransfers.slice(-1000):[];
      state.transferredOut=Array.isArray(state.transferredOut)?state.transferredOut.slice(-1000):[];
      if(state.region!=='all'&&!REGIONS.some(r=>r.code===state.region))state.region='all';
    }
  }catch{}
}

function persist(){
  try{localStorage.setItem(storageKey,JSON.stringify(state))}catch{}
}

function fmtPrice(n){
  return Math.round(n).toLocaleString('ru-RU')+' ₽';
}

function regionName(code){
  return REGIONS.find(r=>r.code===code)?.name||'Все регионы';
}

function hashString(s){
  let h=2166136261;
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}

function displayId(p){
  return 'NMR-'+String(p.id||'').toUpperCase();
}

function b64urlEncode(text){
  const bytes=new TextEncoder().encode(text);
  let bin='';
  for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function b64urlDecode(text){
  const padded=text.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((text.length+3)%4);
  const bin=atob(padded);
  const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function makeTransferCode(p){
  const payload={v:1,p:{a:p.a,b:p.b,c:p.c,n:p.n,r:p.r,id:p.id,at:p.at,favorite:false}};
  const json=JSON.stringify(payload);
  const sig=hashString(json).toString(36).toUpperCase();
  return 'NMR1.'+b64urlEncode(json)+'.'+sig;
}

function parseTransferCode(code){
  const parts=String(code||'').trim().split('.');
  if(parts.length!==3||parts[0]!=='NMR1')throw Error('bad-code');
  const json=b64urlDecode(parts[1]);
  const sig=hashString(json).toString(36).toUpperCase();
  if(sig!==parts[2])throw Error('bad-signature');
  const payload=JSON.parse(json);
  if(!payload||payload.v!==1||!valid(payload.p))throw Error('bad-payload');
  return {plate:payload.p,token:parts[2]+':'+payload.p.id};
}

function displayTier(p){
  return Math.min(4,tier(p));
}

function priceFor(p){
  const t=displayTier(p);
  const d=DISPLAY_TIERS[t];
  const h=hashString(key(p));
  let min=d.min;
  let max=d.max;

  if(t===4&&tier(p)===5){
    min=30000000;
    max=99900000;
  }

  const x=(h%100000)/100000;
  return Math.round(min+(max-min)*(0.16+0.84*x));
}

function featuresFor(p){
  const out=[];
  const letters=p.a+p.b+p.c;
  const n=p.n;

  if(n[0]===n[1]&&n[1]===n[2]) out.push('3 одинаковые цифры');
  else if(new Set(n).size<3) out.push('Повтор цифр');

  if(letters[0]===letters[1]&&letters[1]===letters[2]) out.push('3 одинаковые буквы');
  else if(new Set(letters).size<3) out.push('Повтор букв');

  if(n[0]===n[2]) out.push('Зеркальная комбинация');

  if(['123','234','345','456','567','678','789','987','876','765','654','543','432','321','210'].includes(n)){
    out.push('Последовательность цифр');
  }

  if(Number(n)%100===0) out.push('Ровная сотня');

  const regionDigits=String(Number(p.r));
  if(regionDigits&&n.endsWith(regionDigits)) out.push('Цифры совпадают с регионом');

  if(!out.length) out.push('Уникальная комбинация');

  return out.slice(0,4);
}

function plate(p){
  const region=String(p.r);
  const rid=(p.id||key(p)).replace(/[^a-zA-Z0-9]/g,'').slice(-10);

  const glyph=(x,text,size,weight=700)=>`
    <text
      x="${x}" y="59"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${size}"
      font-weight="${weight}"
      fill="#080909"
    >${text}</text>
  `;

  return `
    <div class="plate-shell" aria-label="${key(p)}">
      <svg
        class="plate-svg"
        viewBox="0 0 520 112"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="${key(p)}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="plateBg-${rid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fbfbfa"/>
            <stop offset="50%" stop-color="#f1f1ef"/>
            <stop offset="100%" stop-color="#e6e7e5"/>
          </linearGradient>
          <radialGradient id="plateScrew-${rid}" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stop-color="#f1f3f4"/>
            <stop offset="45%" stop-color="#aab0b4"/>
            <stop offset="100%" stop-color="#555b60"/>
          </radialGradient>
        </defs>

        <rect x="2" y="2" width="516" height="108" rx="7" fill="#24292d"/>
        <rect x="5" y="5" width="510" height="102" rx="5"
              fill="url(#plateBg-${rid})" stroke="#a5aaad" stroke-width="2"/>
        <rect x="10" y="10" width="500" height="92" rx="3"
              fill="none" stroke="#b9bdbf" stroke-width="1.2"/>

        <line x1="392" y1="5" x2="392" y2="107"
              stroke="#111416" stroke-width="3"/>

        <circle cx="18" cy="56" r="4.6"
                fill="url(#plateScrew-${rid})" stroke="#505559" stroke-width="1"/>
        <circle cx="502" cy="56" r="4.6"
                fill="url(#plateScrew-${rid})" stroke="#505559" stroke-width="1"/>

        ${glyph(52,p.a,64)}
        ${glyph(118,p.n[0],74)}
        ${glyph(174,p.n[1],74)}
        ${glyph(230,p.n[2],74)}
        ${glyph(302,p.b,64)}
        ${glyph(350,p.c,64)}

        <text
          x="456" y="39"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-size="46"
          font-weight="700"
          fill="#080909"
          textLength="${region.length===3?76:52}"
          lengthAdjust="spacingAndGlyphs"
        >${region}</text>

        <text
          x="426" y="82"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-size="15"
          font-weight="700"
          fill="#0b0c0d"
        >RUS</text>

        <g aria-label="Флаг России">
          <rect x="452" y="69" width="38" height="24" rx="1"
                fill="#fff" stroke="#8d9295" stroke-width="1"/>
          <rect x="452" y="77" width="38" height="8" fill="#1c61bb"/>
          <rect x="452" y="85" width="38" height="8" fill="#ce3035"/>
        </g>
      </svg>
    </div>
  `;
}

function setTierVisual(index){
  const d=DISPLAY_TIERS[index];
  document.documentElement.style.setProperty('--tier',d.color);
  $('#rarityName').textContent=d.name;

  $$('#rarityScale i').forEach((el,i)=>{
    el.classList.toggle('active',i<=index);
  });
}

function updatePrevious(p){
  if(!p){
    $('#previousSlot').classList.add('hidden');
    return;
  }

  $('#previousSlot').classList.remove('hidden');
  $('#previousPlate').innerHTML=plate(p);

  const t=displayTier(p);
  $('#previousTier').textContent=DISPLAY_TIERS[t].name;
  $('#previousTier').style.color=DISPLAY_TIERS[t].color;
  $('#previousPrice').textContent=fmtPrice(priceFor(p));
}

function renderCurrent(){
  const p=state.current;

  if(!p){
    const demo={a:'А',n:'024',b:'В',c:'М',r:'252'};
    $('#currentPlate').innerHTML=plate(demo);
    $('#featureList').innerHTML='<span>Нажми кнопку, чтобы выбить первый номер</span>';
    setTierVisual(0);
    $('#priceValue').textContent='0 ₽';
    updateSave();
    return;
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

function collectionValue(){
  return state.collection.reduce((sum,p)=>sum+priceFor(p),0);
}

function renderStats(){
  $('#drawerOwned').textContent=state.collection.length.toLocaleString('ru-RU');
  $('#rollCounter').textContent=state.rolls.toLocaleString('ru-RU');
  $('#balanceValue').textContent=fmtPrice(state.balance);

  const label=state.region==='all'?'Россия · все регионы':'Россия · '+state.region;
  $('#regionLabel').textContent=label;
  $('#drawerRegion').textContent=state.region==='all'
    ?'Все регионы'
    :state.region+' · '+regionName(state.region);

  updateSave();
}

function updateSave(){
  const saved=Boolean(
    state.current&&state.collection.some(p=>p.id===state.current.id)
  );
  $('#saveBtn').classList.toggle('saved',saved);
}

function haptic(kind='selection'){
  if(!state.haptic)return;

  try{
    if(kind==='success') tg?.HapticFeedback.notificationOccurred('success');
    else tg?.HapticFeedback.selectionChanged();
  }catch{}
}

function sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

function easeOutCubic(x){
  return 1-Math.pow(1-x,3);
}

async function roll(){
  if(busy)return;
  if(state.balance<ROLL_COST){
    showToast('Недостаточно средств · прокрутка стоит '+fmtPrice(ROLL_COST));
    return;
  }

  state.balance-=ROLL_COST;
  persist();
  renderStats();
  busy=true;
  closeDrawer();
  closePanel();

  $('#app').classList.remove('revealed','final-pop');
  $('#app').classList.add('rolling');
  $('#featureList').innerHTML='';
  $('#priceValue').textContent='0 ₽';
  setTierVisual(0);

  const old=state.current;
  const final=generate(state.region);
  const reduced=state.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps=reduced?3:20;

  for(let i=0;i<steps;i++){
    const temp=generate(state.region);
    $('#currentPlate').innerHTML=plate(temp);

    if(i%4===0){
      if(old) updatePrevious(old);
      haptic();
    }

    await sleep(reduced?18:44+Math.min(52,i*2));
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

  await sleep(reduced?90:360);

  $('#app').classList.remove('final-pop');
  $('#app').classList.add('revealed');

  await analyze(final,reduced);

  renderStats();
  haptic('success');
  busy=false;
}

async function analyze(p,reduced){
  const targetTier=displayTier(p);
  const targetPrice=priceFor(p);
  const duration=reduced?260:2600;
  const start=performance.now();

  return new Promise(resolve=>{
    function frame(now){
      const raw=Math.min(1,(now-start)/duration);
      const eased=easeOutCubic(raw);

      $('#priceValue').textContent=fmtPrice(targetPrice*eased);

      const stage=targetTier===0
        ?0
        :Math.min(targetTier,Math.floor(raw*(targetTier+1)));

      setTierVisual(stage);

      if(raw<1){
        requestAnimationFrame(frame);
      }else{
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
  if(!state.current){
    showToast('Сначала выбей номер');
    return;
  }

  const i=state.collection.findIndex(p=>p.id===state.current.id);

  if(i>=0){
    state.collection.splice(i,1);
    showToast('Убрано из коллекции');
  }else{
    if(state.collection.length>=5000){
      showToast('Лимит коллекции — 5 000');
      return;
    }

    state.collection.unshift({...state.current});
    showToast('Добавлено в коллекцию');
    haptic('success');
  }

  persist();
  renderStats();

  if($('#panel').classList.contains('open')&&$('#panelTitle').textContent==='Коллекция'){
    renderCollection();
  }
}

function showToast(text){
  clearTimeout(toastTimer);
  $('#toast').textContent=text;
  $('#toast').classList.add('visible');
  toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),1800);
}

function openDrawer(){
  $('#drawer').classList.add('open');
  $('#drawerBackdrop').classList.add('open');
  $('#drawer').setAttribute('aria-hidden','false');
}

function closeDrawer(){
  $('#drawer').classList.remove('open');
  $('#drawerBackdrop').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden','true');
}

function openPanel(title,eyebrow='НОМЕР'){
  closeDrawer();
  $('#panelTitle').textContent=title;
  $('#panelEyebrow').textContent=eyebrow;
  $('#panel').classList.add('open');
  $('#panel').setAttribute('aria-hidden','false');
}

function closePanel(){
  $('#panel').classList.remove('open');
  $('#panel').setAttribute('aria-hidden','true');
}

function renderCollection(){
  openPanel('Коллекция','ТВОЙ ГАРАЖ');

  const body=$('#panelBody');

  if(!state.collection.length){
    body.innerHTML='<div class="empty-state"><b>Пока пусто</b><span>Сохрани понравившийся номер значком сверху.</span></div>';
    return;
  }

  body.innerHTML='<div class="collection-grid">'+state.collection.map(p=>{
    const t=displayTier(p);
    const d=DISPLAY_TIERS[t];
    return `
      <button class="collection-card" data-plate-id="${p.id}" style="--card-tier:${d.color}">
        <div>${plate(p)}</div>
        <div class="collection-meta">
          <b>${d.name}</b>
          <span>${fmtPrice(priceFor(p))}</span>
          <small>${displayId(p).slice(0,18)}…</small>
        </div>
      </button>
    `;
  }).join('')+'</div>';

  body.querySelectorAll('[data-plate-id]').forEach(btn=>{
    btn.onclick=()=>renderPlateDetail(btn.dataset.plateId);
  });
}

function renderPlateDetail(id){
  const p=state.collection.find(x=>x.id===id);
  if(!p){renderCollection();return}

  const t=displayTier(p);
  const d=DISPLAY_TIERS[t];
  const value=priceFor(p);

  openPanel('Номер','ТВОЙ ЭКЗЕМПЛЯР');
  $('#panelBody').innerHTML=`
    <div class="detail-plate">${plate(p)}</div>
    <div class="ownership-card" style="--detail-tier:${d.color}">
      <div class="ownership-row"><span>Редкость</span><strong>${d.name}</strong></div>
      <div class="ownership-row"><span>Стоимость</span><strong>${fmtPrice(value)}</strong></div>
      <div class="ownership-id">
        <span>Уникальный ID</span>
        <code>${displayId(p)}</code>
      </div>
      <button class="ownership-copy" id="copyPlateId">Скопировать ID</button>
      <button class="ownership-primary" id="sellOwned">Продать за ${fmtPrice(value)}</button>
      <button class="ownership-secondary" id="transferOwned">Передать другу</button>
    </div>
  `;

  $('#copyPlateId').onclick=async()=>{
    try{await navigator.clipboard.writeText(displayId(p));showToast('ID скопирован')}
    catch{showToast(displayId(p))}
  };

  $('#sellOwned').onclick=()=>{
    const idx=state.collection.findIndex(x=>x.id===p.id);
    if(idx<0)return;
    state.collection.splice(idx,1);
    state.balance+=value;
    persist();
    renderStats();
    renderCollection();
    showToast('Продано за '+fmtPrice(value));
  };

  $('#transferOwned').onclick=()=>transferOwnedPlate(p.id);
}

async function transferOwnedPlate(id){
  const idx=state.collection.findIndex(x=>x.id===id);
  if(idx<0)return;
  const p=state.collection[idx];
  const code=makeTransferCode(p);

  state.collection.splice(idx,1);
  state.transferredOut=[...state.transferredOut,p.id].slice(-1000);
  persist();
  renderStats();

  openPanel('Передача','КОД ДЛЯ ДРУГА');
  $('#panelBody').innerHTML=`
    <div class="transfer-box">
      <h3>Номер снят с твоей коллекции</h3>
      <p>Отправь этот код другу. У получателя сохранится тот же уникальный ID номера.</p>
      <textarea id="transferCode" readonly>${code}</textarea>
      <button class="ownership-primary" id="copyTransferCode">Скопировать код</button>
    </div>
  `;

  $('#copyTransferCode').onclick=async()=>{
    try{await navigator.clipboard.writeText(code);showToast('Код передачи скопирован')}
    catch{showToast('Скопируй код вручную')}
  };

  try{await navigator.clipboard.writeText(code)}catch{}
}

function renderReceive(){
  openPanel('Получить номер','ПЕРЕДАЧА');
  $('#panelBody').innerHTML=`
    <div class="transfer-box">
      <h3>Вставь код передачи</h3>
      <p>После подтверждения номер появится в твоей коллекции с исходным уникальным ID.</p>
      <textarea id="receiveCode" placeholder="NMR1.…"></textarea>
      <button class="ownership-primary" id="redeemTransfer">Получить номер</button>
    </div>
  `;

  $('#redeemTransfer').onclick=()=>{
    try{
      const parsed=parseTransferCode($('#receiveCode').value);
      if(state.redeemedTransfers.includes(parsed.token))throw Error('used');
      if(state.collection.some(x=>x.id===parsed.plate.id))throw Error('owned');

      state.collection.unshift(parsed.plate);
      state.redeemedTransfers=[...state.redeemedTransfers,parsed.token].slice(-1000);
      persist();
      renderStats();
      showToast('Номер получен');
      renderPlateDetail(parsed.plate.id);
    }catch{
      showToast('Код передачи недействителен или уже использован');
    }
  };
}

function renderRarity(){
  openPanel('Редкости','ШКАЛА ЦЕННОСТИ');

  $('#panelBody').innerHTML=
    '<div class="tier-list">'+
    DISPLAY_TIERS.map(d=>`
      <div class="tier-item" style="--c:${d.color}">
        <div class="tier-top">
          <b>${d.name}</b>
          <strong>${fmtPrice(d.min)} — ${fmtPrice(d.max)}</strong>
        </div>
        <p>${d.desc}</p>
      </div>
    `).join('')+
    '<div class="tier-item" style="--c:#f0a51a"><div class="tier-top"><b>Легендарный +</b><strong>до 99 900 000 ₽</strong></div><p>Тройное совпадение цифр и букв. Стоимость игровая и не является рыночной оценкой реального регистрационного знака.</p></div></div>';
}

function renderSettings(){
  openPanel('Настройки','ИНТЕРФЕЙС');

  $('#panelBody').innerHTML=`
    <div class="setting">
      <div>Вибрация<small>Отклик при переборе и выпадении номера</small></div>
      <button class="switch ${state.haptic?'on':''}" id="hapticSwitch"><i></i></button>
    </div>
    <div class="setting">
      <div>Быстрая анимация<small>Ускоряет перебор и расчёт цены</small></div>
      <button class="switch ${state.reduced?'on':''}" id="reducedSwitch"><i></i></button>
    </div>
  `;

  $('#hapticSwitch').onclick=()=>{
    state.haptic=!state.haptic;
    persist();
    renderSettings();
  };

  $('#reducedSwitch').onclick=()=>{
    state.reduced=!state.reduced;
    persist();
    renderSettings();
  };
}

function renderRegion(){
  openPanel('Регион','ГЕОГРАФИЯ');

  const body=$('#panelBody');

  body.innerHTML=`
    <input class="region-search" id="regionSearch" placeholder="Москва, 777, Краснодар…">
    <div class="region-list" id="regionList"></div>
  `;

  const input=$('#regionSearch');
  const list=$('#regionList');

  function paint(){
    const q=input.value.trim().toLowerCase();

    const rows=[
      {code:'all',name:'Все регионы'},
      ...REGIONS
    ].filter(r=>!q||(r.code+' '+r.name).toLowerCase().includes(q));

    list.innerHTML=rows.map(r=>`
      <button class="region-option ${state.region===r.code?'selected':''}" data-code="${r.code}">
        <span>${r.name}</span>
        <small>${r.code==='all'?'RUS':r.code}</small>
      </button>
    `).join('');

    list.querySelectorAll('[data-code]').forEach(b=>{
      b.onclick=()=>{
        state.region=b.dataset.code;
        persist();
        renderStats();
        closePanel();
        showToast(state.region==='all'?'Все регионы':regionName(state.region));
      };
    });
  }

  input.oninput=paint;
  paint();
}

$('#rollBtn').onclick=roll;
$('#saveBtn').onclick=saveCurrent;
$('#menuBtn').onclick=openDrawer;
$('#drawerClose').onclick=closeDrawer;
$('#drawerBackdrop').onclick=closeDrawer;
$('#panelClose').onclick=closePanel;
$('#regionBtn').onclick=renderRegion;

$$('.drawer-nav [data-action]').forEach(b=>{
  b.onclick=()=>{
    const action=b.dataset.action;

    if(action==='hunt') closeDrawer();
    if(action==='collection') renderCollection();
    if(action==='rarity') renderRarity();
    if(action==='region') renderRegion();
    if(action==='receive') renderReceive();
    if(action==='settings') renderSettings();
  };
});

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    closePanel();
    closeDrawer();
  }

  if(
    e.key==='Enter'&&
    !busy&&
    !$('#panel').classList.contains('open')&&
    !$('#drawer').classList.contains('open')
  ){
    roll();
  }
});

load();
renderStats();
renderCurrent();
updatePrevious(state.previous);

try{
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor('#06080d');
  tg?.setBackgroundColor('#06080d');
}catch{};
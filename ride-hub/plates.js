'use strict';

const {REGIONS,tier,generate,valid,key}=PlateEngine;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const tg=window.Telegram?.WebApp;

const ROLL_COST=1000;
const START_BALANCE=1000000;

const DISPLAY_TIERS=[
  {name:'Обычный',color:'#8b94a2',min:300,max:4999,desc:'Случайный номер без красивой комбинации. Почти без ценности.'},
  {name:'Необычный',color:'#35e982',min:5000,max:24999,desc:'Лёгкие повторы и простые сочетания с небольшим спросом.'},
  {name:'Редкий',color:'#318dff',min:25000,max:149999,desc:'Зеркала, последовательности 123 / 321 и ровные числа.'},
  {name:'Эпический',color:'#a15aff',min:150000,max:799999,desc:'Тройки, низкие номера, одинаковые буквы и сильные сочетания.'},
  {name:'Легендарный',color:'#f0a51a',min:800000,max:30000000,desc:'Сильные сочетания цифр и букв, столичные коды и избранные серии.'}
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
  sound:true,
  reduced:false,
  balance:START_BALANCE,
  redeemedTransfers:[],
  transferredOut:[],
  luckyRolls:0,
  legendaryRolls:0,
  usedPromos:[]
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
      state.sound=state.sound!==false;
      state.balance=Number.isFinite(Number(state.balance))?Math.max(0,Math.round(Number(state.balance))):START_BALANCE;
      state.redeemedTransfers=Array.isArray(state.redeemedTransfers)?state.redeemedTransfers.slice(-1000):[];
      state.transferredOut=Array.isArray(state.transferredOut)?state.transferredOut.slice(-1000):[];
      state.luckyRolls=Math.max(0,Math.floor(Number(state.luckyRolls)||0));
      state.legendaryRolls=Math.max(0,Math.floor(Number(state.legendaryRolls)||0));
      state.usedPromos=Array.isArray(state.usedPromos)?state.usedPromos.map(x=>String(x).toUpperCase()).slice(-100):[];
      if(state.region!=='all'&&!REGIONS.some(r=>r.code===state.region))state.region='all';
    }
  }catch{}
}

function persist(){
  try{localStorage.setItem(storageKey,JSON.stringify(state))}catch{}
}

function fmtPrice(n){
  return Math.round(n)
    .toLocaleString('ru-RU')
    .replace(/[\s\u00A0\u202F]+/g,'\u00A0')+'\u00A0₽';
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

// Calibrated against asking prices on 2026-10-05, not completed sales.
// Ordinary plates: collectible premium only; transaction costs are excluded.
function regionPriceMultiplier(code,base){
  if(base<5000)return 1;
  if(code==='77')return 1.7;
  if(['97','99','177','197','199'].includes(code))return 1.45;
  if(['777','797','799','977','997'].includes(code))return 1.35;
  if(['50','90','150','190','250','550','750','790'].includes(code))return 1.2;
  if(['78','98','178','198'].includes(code))return 1.25;
  return 1;
}

function marketPriceFor(p){
  const n=String(p.n), letters=p.a+p.b+p.c, region=String(p.r);
  const h=hashString(key(p)), num=Number(n);
  const triple=/^(.)\1\1$/.test(n), same=/^(.)\1\1$/.test(letters);
  const mirror=n[0]===n[2]&&!triple;
  let price=350+(h%7)*100;
  // A random pair of repeated characters alone is not a valuable pattern.
  if(new Set(n).size===2)price=1100+(h%6)*300;
  if(mirror)price=n[1]==='0'?55000:28000;
  if(['123','321'].includes(n))price=60000;
  else if(['234','345','456','567','678','789','987','876','765','654','543','432','210'].includes(n))price=35000;
  if(num%100===0)price=85000;
  if(num>=10&&num<100&&num%10===0)price=105000;
  if(num>0&&num<10)price=({'001':750000,'002':320000,'003':290000,'004':220000,'005':340000,'006':230000,'007':650000,'008':330000,'009':310000})[n];
  if(triple)price=({'111':340000,'222':300000,'333':320000,'444':260000,'555':390000,'666':280000,'777':700000,'888':480000,'999':440000})[n]||300000;
  if(new Set(letters).size===2)price+=price>=25000?7000:400;
  if(same){
    const letterBase={А:550000,М:500000,О:550000,Х:450000,В:340000,С:380000,Е:320000,К:320000,Н:300000,Р:320000,Т:290000,У:260000}[p.a];
    price=letterBase+(price>=25000?price*2.2:0);
  }
  // Only a FULL numerical match counts: 178 in region 178, or 052 in 52.
  if(num===Number(region))price=Math.max(110000,price*1.45);
  // Collector-series premium must be region-specific, never universal.
  const seriesFloor={
    'АМР:97':4500000,'АМР:77':1700000,
    'ЕКХ:77':1800000,'ЕКХ:97':1200000,'ЕКХ:99':1200000,
    'АМО:77':900000,'АММ:77':650000
  }[letters+':'+region];
  if(seriesFloor)price=Math.max(price,seriesFloor+(triple||num<10?price*.5:0));
  else price*=regionPriceMultiplier(region,price);
  const variation=.94+(h%1000)/999*.12;
  price*=variation;
  const step=price<5000?100:price<25000?500:price<150000?1000:price<800000?5000:10000;
  return Math.max(300,Math.min(30000000,Math.round(price/step)*step));
}

function marketRange(p){
  const value=priceFor(p),step=value<5000?100:value<100000?1000:10000;
  return [Math.max(0,Math.round(value*.7/step)*step),Math.round(value*1.4/step)*step];
}

function renderEstimate(p){
  const range=$('#estimateRange');
  if(range)range.textContent=p?marketRange(p).map(fmtPrice).join(' — '):'Открой свой первый номер';
}

function priceFor(p){
  return marketPriceFor(p);
}

function displayTier(p){
  const value=priceFor(p);
  if(value<5000)return 0;
  if(value<25000)return 1;
  if(value<150000)return 2;
  if(value<800000)return 3;
  return 4;
}

function featuresFor(p){
  const out=[];
  const letters=p.a+p.b+p.c;
  const n=p.n;

  if(n[0]===n[1]&&n[1]===n[2]) out.push('3 одинаковые цифры');
  else if(n[0]!==n[2]&&new Set(n).size<3) out.push('Повтор цифр');

  if(letters[0]===letters[1]&&letters[1]===letters[2]) out.push('3 одинаковые буквы');
  else if(new Set(letters).size<3) out.push('Повтор букв');

  if(n[0]===n[2]&&new Set(n).size>1) out.push('Зеркальная комбинация');
  if(Number(n)<10)out.push('Первая десятка');

  if(['123','234','345','456','567','678','789','987','876','765','654','543','432','321','210'].includes(n)){
    out.push('Последовательность цифр');
  }

  if(Number(n)%100===0) out.push('Ровная сотня');

  const regionDigits=String(Number(p.r));
  if(Number(n)===Number(regionDigits)) out.push('Цифры совпадают с регионом');

  if(!out.length) out.push('Без особого сочетания');

  return out.slice(0,4);
}

function plate(p){
  const region=String(p.r);
  const rid=(p.id||key(p)).replace(/[^a-zA-Z0-9]/g,'').slice(-10);
  const chars=[p.a,p.n[0],p.n[1],p.n[2],p.b,p.c];
  const xs=[52,108,164,220,278,330];

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
            <stop offset="0%" stop-color="#fdfdfb"/>
            <stop offset="52%" stop-color="#f7f7f3"/>
            <stop offset="100%" stop-color="#ecece8"/>
          </linearGradient>
          <linearGradient id="plateEdge-${rid}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#9fa3a5"/>
            <stop offset="100%" stop-color="#6e7376"/>
          </linearGradient>
          <radialGradient id="screw-${rid}" cx="34%" cy="30%" r="72%">
            <stop offset="0%" stop-color="#f3f4f4"/>
            <stop offset="46%" stop-color="#abb0b3"/>
            <stop offset="100%" stop-color="#555a5e"/>
          </radialGradient>
          <filter id="emboss-${rid}" x="-5%" y="-8%" width="110%" height="120%">
            <feDropShadow dx="0" dy=".65" stdDeviation=".23" flood-color="#000" flood-opacity=".23"/>
          </filter>
        </defs>

        <rect x="1.5" y="1.5" width="517" height="109" rx="3"
              fill="url(#plateBg-${rid})"
              stroke="url(#plateEdge-${rid})"
              stroke-width="2"/>

        <rect x="8" y="8" width="504" height="96" rx="1.8"
              fill="none" stroke="#101214" stroke-width="2.5"/>

        <line x1="366" y1="8" x2="366" y2="104"
              stroke="#101214" stroke-width="2.5"/>

        <circle cx="18" cy="56" r="3.1"
                fill="url(#screw-${rid})" stroke="#555b5f" stroke-width=".75"/>
        <circle cx="502" cy="56" r="3.1"
                fill="url(#screw-${rid})" stroke="#555b5f" stroke-width=".75"/>

        <g filter="url(#emboss-${rid})">
          ${chars.map((ch,i)=>`
            <text
              x="${xs[i]}" y="58"
              text-anchor="middle"
              dominant-baseline="middle"
              class="gost-char"
            >${ch}</text>
          `).join('')}
        </g>

        <text
          x="431" y="48"
          text-anchor="middle"
          dominant-baseline="middle"
          class="gost-region"
          textLength="${region.length===3?91:61}"
          lengthAdjust="spacingAndGlyphs"
        >${region}</text>

        <text
          x="408" y="87"
          text-anchor="middle"
          dominant-baseline="middle"
          class="gost-rus"
        >RUS</text>

        <g aria-label="Флаг России">
          <rect x="441" y="74" width="46" height="20" rx=".4"
                fill="#fff" stroke="#72777a" stroke-width=".75"/>
          <rect x="441" y="80.67" width="46" height="6.66" fill="#235fbd"/>
          <rect x="441" y="87.33" width="46" height="6.67" fill="#cf3035"/>
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
  const slot=$('#previousSlot');

  if(!p){
    slot.classList.add('hidden');
    $('#previousPlate').innerHTML='';
    return;
  }

  slot.classList.remove('hidden');
  $('#previousPlate').innerHTML=`
    <div class="plate-stack">
      <span class="stack-sheet stack-sheet-3"></span>
      <span class="stack-sheet stack-sheet-2"></span>
      <span class="stack-sheet stack-sheet-1"></span>
      <div class="stack-top">${plate(p)}</div>
    </div>
  `;

  const t=displayTier(p);
  $('#previousTier').textContent=DISPLAY_TIERS[t].name;
  $('#previousTier').style.color=DISPLAY_TIERS[t].color;
  $('#previousPrice').textContent=fmtPrice(priceFor(p));
}

function updateSellButton(){
  const btn=$('#sellCurrentBtn');
  if(!btn)return;

  if(!state.current){
    btn.disabled=true;
    $('#sellCurrentPrice').textContent='0 ₽';
    $('#currentActions')?.classList.add('hidden');
    return;
  }

  btn.disabled=false;
  $('#currentActions')?.classList.remove('hidden');
  $('#sellCurrentPrice').textContent=fmtPrice(priceFor(state.current));
}

async function animateToStack(p,reduced=false){
  if(!p)return;

  const source=$('#currentPlate .plate-shell');
  if(!source){
    updatePrevious(p);
    return;
  }

  const sourceRect=source.getBoundingClientRect();

  updatePrevious(p);
  const target=$('#previousPlate .stack-top');
  if(!target)return;

  const targetRect=target.getBoundingClientRect();
  const slot=$('#previousSlot');
  slot.classList.add('stack-receiving');

  const flyer=document.createElement('div');
  flyer.className='stack-flyer';
  flyer.innerHTML=plate(p);
  flyer.style.left=sourceRect.left+'px';
  flyer.style.top=sourceRect.top+'px';
  flyer.style.width=sourceRect.width+'px';
  flyer.style.height=sourceRect.height+'px';
  document.body.appendChild(flyer);

  const dx=targetRect.left-sourceRect.left;
  const dy=targetRect.top-sourceRect.top;
  const scale=targetRect.width/sourceRect.width;
  const duration=reduced?120:520;

  try{
    const anim=flyer.animate([
      {
        transform:'translate3d(0,0,0) scale(1) rotate(0deg)',
        opacity:1,
        filter:'blur(0px)'
      },
      {
        offset:.68,
        transform:`translate3d(${dx*.72}px,${dy*.72}px,0) scale(${.72+(scale-.72)*.35}) rotate(-2.2deg)`,
        opacity:.95,
        filter:'blur(0px)'
      },
      {
        transform:`translate3d(${dx}px,${dy}px,0) scale(${scale}) rotate(.7deg)`,
        opacity:.35,
        filter:'blur(.4px)'
      }
    ],{
      duration,
      easing:'cubic-bezier(.2,.82,.2,1)',
      fill:'forwards'
    });
    await anim.finished;
  }catch{}

  flyer.remove();
  slot.classList.remove('stack-receiving');
  slot.classList.remove('stack-land');
  void slot.offsetWidth;
  slot.classList.add('stack-land');
  setTimeout(()=>slot.classList.remove('stack-land'),380);
}

async function sellCurrent(){
  if(busy||!state.current)return;

  const p=state.current;
  const value=priceFor(p);
  busy=true;

  const host=$('#currentPlate');
  host.classList.add('selling-out');
  haptic('success');

  await sleep(state.reduced?80:260);

  const ownedIndex=state.collection.findIndex(x=>x.id===p.id);
  if(ownedIndex>=0)state.collection.splice(ownedIndex,1);

  state.balance+=value;
  state.current=null;
  persist();

  host.classList.remove('selling-out');
  host.innerHTML='<div class="sold-empty"><b>НОМЕР ПРОДАН</b><span>Выбей следующий</span></div>';
  $('#featureList').innerHTML='';
  $('#priceValue').textContent='0 ₽';
  renderEstimate(null);
  setTierVisual(0);

  renderStats();
  updateSellButton();
  updateSave();
  showToast('Продано за '+fmtPrice(value));
  busy=false;
}

function renderCurrent(){
  const p=state.current;
  renderEstimate(p);

  if(!p){
    const demo={a:'А',n:'024',b:'В',c:'М',r:'252'};
    $('#currentPlate').innerHTML=plate(demo);
    $('#featureList').innerHTML='<span>Нажми кнопку, чтобы выбить первый номер</span>';
    setTierVisual(0);
    $('#priceValue').textContent='0 ₽';
    updateSellButton();
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
  updateSellButton();
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

  const luckyBadge=$('#luckyBadge');
  if(luckyBadge){
    if(state.legendaryRolls>0){
      luckyBadge.textContent='ЛЕГЕНДА ×'+state.legendaryRolls;
      luckyBadge.classList.remove('hidden');
    }else if(state.luckyRolls>0){
      luckyBadge.textContent='УДАЧА ×'+state.luckyRolls;
      luckyBadge.classList.remove('hidden');
    }else{
      luckyBadge.classList.add('hidden');
    }
  }

  const promoStatus=$('#promoStatus');
  if(promoStatus){
    promoStatus.textContent=state.legendaryRolls>0
      ?'Легендарных: '+state.legendaryRolls
      :(state.luckyRolls>0?'Удачных: '+state.luckyRolls:'Активировать бонус');
  }

  $('#app').classList.toggle('lucky-active',state.luckyRolls>0||state.legendaryRolls>0);
  $('#app').classList.toggle('legendary-active',state.legendaryRolls>0);

  updateSave();
}

function updateSave(){
  const saved=Boolean(
    state.current&&state.collection.some(p=>p.id===state.current.id)
  );

  $('#saveBtn').classList.toggle('saved',saved);

  const actions=$('#currentActions');
  const collectionBtn=$('#collectionCurrentBtn');
  const collectionLabel=$('#collectionCurrentLabel');

  if(actions){
    actions.classList.toggle('hidden',!state.current);
  }

  if(collectionBtn){
    collectionBtn.classList.toggle('saved',saved);
    collectionBtn.disabled=!state.current;
  }

  if(collectionLabel){
    collectionLabel.textContent=saved?'В коллекции':'В коллекцию';
  }
}

let audioCtx=null;

function ensureAudio(){
  if(!state.sound)return null;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return null;
    if(!audioCtx)audioCtx=new Ctx();
    if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});
    return audioCtx;
  }catch{
    return null;
  }
}

function playTone(freq,duration=.045,volume=.025,type='sine',delay=0){
  if(!state.sound)return;
  const ctx=ensureAudio();
  if(!ctx)return;

  try{
    const now=ctx.currentTime+delay;
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();

    osc.type=type;
    osc.frequency.setValueAtTime(freq,now);

    gain.gain.setValueAtTime(.0001,now);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),now+.006);
    gain.gain.exponentialRampToValueAtTime(.0001,now+duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now+duration+.015);
  }catch{}
}

function soundTick(position=0){
  playTone(620+position*46,.035,.018,'square');
}

function soundLand(position=0){
  playTone(340+position*34,.065,.035,'triangle');
  playTone(680+position*42,.045,.014,'sine',.014);
}

function soundFinal(p){
  const legendary=displayTier(p)>=4;

  if(legendary){
    playTone(523.25,.12,.045,'triangle',0);
    playTone(659.25,.13,.045,'triangle',.07);
    playTone(783.99,.16,.05,'triangle',.14);
    playTone(1046.5,.20,.055,'sine',.22);
  }else{
    playTone(440,.08,.03,'triangle',0);
    playTone(659.25,.12,.035,'sine',.065);
  }
}

function haptic(kind='selection'){
  if(!state.haptic)return;

  try{
    if(tg?.HapticFeedback){
      if(kind==='legendary'){
        tg.HapticFeedback.notificationOccurred('success');
        setTimeout(()=>{try{tg.HapticFeedback.impactOccurred('heavy')}catch{}},70);
      }else if(kind==='success'){
        tg.HapticFeedback.notificationOccurred('success');
      }else if(kind==='land'){
        tg.HapticFeedback.impactOccurred('light');
      }else{
        tg.HapticFeedback.selectionChanged();
      }
      return;
    }
  }catch{}

  try{
    if(!navigator.vibrate)return;
    if(kind==='legendary')navigator.vibrate([35,25,55,30,80]);
    else if(kind==='success')navigator.vibrate([30,25,45]);
    else if(kind==='land')navigator.vibrate(18);
    else navigator.vibrate(8);
  }catch{}
}

function sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

function easeOutCubic(x){
  return 1-Math.pow(1-x,3);
}


function generateLucky(region){
  const winners=[];
  let best=null;
  let bestValue=-1;

  for(let i=0;i<1400;i++){
    const candidate=generate(region);
    const value=priceFor(candidate);

    if(value>bestValue){
      best=candidate;
      bestValue=value;
    }

    if(value>=250000){
      winners.push(candidate);
      if(winners.length>=14)break;
    }
  }

  if(winners.length){
    winners.sort((a,b)=>priceFor(b)-priceFor(a));
    const pool=winners.slice(0,Math.min(8,winners.length));
    return pool[Math.floor(Math.random()*pool.length)];
  }

  return best||generate(region);
}

function generateLegendary(region){
  const premiumSeries=[
    ['А','М','Р'],
    ['Е','К','Х'],
    ['С','К','Р'],
    ['А','А','А'],
    ['О','О','О'],
    ['М','М','М']
  ];
  const premiumNumbers=['001','007','777','888','999','555'];
  const premiumRegions=['77','97','99','177','197','199','777','797','799'];

  const candidates=[];

  for(let i=0;i<24;i++){
    const actualRegion=region==='all'
      ?premiumRegions[Math.floor(Math.random()*premiumRegions.length)]
      :region;

    const base=generate(actualRegion);
    const letters=premiumSeries[Math.floor(Math.random()*premiumSeries.length)];
    const number=premiumNumbers[Math.floor(Math.random()*premiumNumbers.length)];

    const candidate={
      ...base,
      a:letters[0],
      b:letters[1],
      c:letters[2],
      n:number
    };

    const value=priceFor(candidate);

    if(value>=800000){
      candidates.push({candidate,value});
    }
  }

  if(candidates.length){
    candidates.sort((a,b)=>b.value-a.value);
    const pool=candidates.slice(0,Math.min(10,candidates.length));
    return pool[Math.floor(Math.random()*pool.length)].candidate;
  }

  // Hard fallback that is always legendary in the current economy.
  const fallbackRegion=region==='all'?'77':region;
  const fallback=generate(fallbackRegion);
  return {...fallback,a:'А',b:'А',c:'А',n:'777'};
}

const SLOT_LETTERS=['А','В','Е','К','М','Н','О','Р','С','Т','У','Х'];

function randomSlotLetter(){
  return SLOT_LETTERS[Math.floor(Math.random()*SLOT_LETTERS.length)];
}

function randomSlotDigit(){
  return String(Math.floor(Math.random()*10));
}

function randomSlotRegion(){
  return REGIONS[Math.floor(Math.random()*REGIONS.length)]?.code||'77';
}

function pulseSlotGlyph(node){
  if(!node)return;
  node.classList.remove('slot-tick');
  void node.getBoundingClientRect();
  node.classList.add('slot-tick');
}

function landSlotGlyph(node){
  if(!node)return;
  node.classList.remove('slot-tick','slot-pending','slot-active');
  node.classList.add('slot-land');
  setTimeout(()=>node.classList.remove('slot-land'),130);
}

async function animateSequentialPlate(final,reduced=false){
  const seed={
    ...final,
    a:randomSlotLetter(),
    n:randomSlotDigit()+randomSlotDigit()+randomSlotDigit(),
    b:randomSlotLetter(),
    c:randomSlotLetter(),
    r:randomSlotRegion()
  };

  $('#currentPlate').innerHTML=plate(seed);

  const chars=[...document.querySelectorAll('#currentPlate .gost-char')];
  const regionNode=$('#currentPlate .gost-region');
  const finalChars=[final.a,final.n[0],final.n[1],final.n[2],final.b,final.c];

  chars.forEach(node=>node.classList.add('slot-pending'));
  if(regionNode)regionNode.classList.add('slot-pending');

  const spins=reduced?1:4;
  const tick=reduced?16:27;

  for(let i=0;i<chars.length;i++){
    const node=chars[i];
    node.classList.remove('slot-pending');
    node.classList.add('slot-active');

    for(let s=0;s<spins;s++){
      node.textContent=i===0||i>=4?randomSlotLetter():randomSlotDigit();
      pulseSlotGlyph(node);
      soundTick(i);
      if(s===0||s===spins-1)haptic('selection');
      await sleep(tick);
    }

    node.textContent=finalChars[i];
    node.classList.remove('slot-active');
    landSlotGlyph(node);
    soundLand(i);
    haptic('land');
    await sleep(reduced?12:28);
  }

  if(regionNode){
    regionNode.classList.remove('slot-pending');
    regionNode.classList.add('slot-active');

    for(let s=0;s<(reduced?1:3);s++){
      const code=randomSlotRegion();
      regionNode.textContent=code;
      regionNode.setAttribute('textLength',code.length===3?'91':'61');
      pulseSlotGlyph(regionNode);
      soundTick(6);
      if(s===0)haptic('selection');
      await sleep(reduced?16:30);
    }

    regionNode.textContent=String(final.r);
    regionNode.setAttribute('textLength',String(final.r).length===3?'91':'61');
    regionNode.classList.remove('slot-active');
    landSlotGlyph(regionNode);
    soundLand(6);
    haptic('land');
  }

  await sleep(reduced?18:45);
}

async function roll(){
  if(busy)return;
  ensureAudio();
  if(state.balance<ROLL_COST){
    showToast('Недостаточно средств · прокрутка стоит '+fmtPrice(ROLL_COST));
    return;
  }

  const old=state.current;
  const reduced=state.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;

  busy=true;
  $('#rollBtn').disabled=true;
  closeDrawer();
  closePanel();

  if(old){
    await animateToStack(old,reduced);
    state.previous=old;
  }

  state.balance-=ROLL_COST;
  persist();
  renderStats();

  $('#app').classList.remove('revealed','final-pop');
  $('#app').classList.add('rolling');
  $('#featureList').innerHTML='';
  $('#priceValue').textContent='0 ₽';
  renderEstimate(null);
  setTierVisual(0);
  updateSellButton();

  const legendaryRoll=state.legendaryRolls>0;
  const luckyRoll=!legendaryRoll&&state.luckyRolls>0;
  const final=legendaryRoll
    ?generateLegendary(state.region)
    :(luckyRoll?generateLucky(state.region):generate(state.region));

  await animateSequentialPlate(final,reduced);

  state.current=final;
  state.rolls++;
  if(legendaryRoll)state.legendaryRolls=Math.max(0,state.legendaryRolls-1);
  else if(luckyRoll)state.luckyRolls=Math.max(0,state.luckyRolls-1);
  state.history=[final,...state.history].slice(0,20);
  persist();

  $('#currentPlate').innerHTML=plate(final);

  $('#app').classList.remove('rolling');
  $('#app').classList.add('revealed','slot-complete');
  setTimeout(()=>$('#app').classList.remove('slot-complete'),220);

  await analyze(final,reduced);

  renderStats();
  updateSellButton();
  soundFinal(final);
  haptic(displayTier(final)>=4?'legendary':'success');
  busy=false;
  $('#rollBtn').disabled=false;
}

async function analyze(p,reduced){
  const targetTier=displayTier(p);
  const targetPrice=priceFor(p);
  renderEstimate(p);
  const duration=reduced?200:1100;
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
  if(busy)return;
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
  $('#drawer').inert=false;
}

function closeDrawer(){
  $('#drawer').classList.remove('open');
  $('#drawerBackdrop').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden','true');
  $('#drawer').inert=true;
}

function openPanel(title,eyebrow='НОМЕР'){
  closeDrawer();
  $('#panelTitle').textContent=title;
  $('#panelEyebrow').textContent=eyebrow;
  $('#panel').classList.add('open');
  $('#panel').setAttribute('aria-hidden','false');
  $('#panel').inert=false;
}

function closePanel(){
  $('#panel').classList.remove('open');
  $('#panel').setAttribute('aria-hidden','true');
  $('#panel').inert=true;
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
    if(busy)return;
    const idx=state.collection.findIndex(x=>x.id===p.id);
    if(idx<0)return;
    state.collection.splice(idx,1);
    if(state.current?.id===p.id)state.current=null;
    renderCurrent();
    state.balance+=value;
    persist();
    renderStats();
    renderCollection();
    showToast('Продано за '+fmtPrice(value));
  };

  $('#transferOwned').onclick=()=>transferOwnedPlate(p.id);
}

async function transferOwnedPlate(id){
  if(busy)return;
  const idx=state.collection.findIndex(x=>x.id===id);
  if(idx<0)return;
  const p=state.collection[idx];
  const code=makeTransferCode(p);

  state.collection.splice(idx,1);
  if(state.current?.id===p.id)state.current=null;
  renderCurrent();
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
    '<div class="tier-item" style="--c:#c9b58b"><div class="tier-top"><b>Как считается цена</b></div><p>Ориентир по объявлениям на 5 октября 2026 года: рисунок цифр, сочетание букв и регион. Диапазон отражает неопределённость. Это модель для игры, не подтверждённая цена сделки. У обычных номеров учитывается только коллекционная надбавка; расходы на оформление не включены.</p><p>Источники: <a href="https://rosnomer.com/ceny" target="_blank" rel="noopener">Росномер</a> · <a href="https://t.me/s/gosnomer52?before=1128" target="_blank" rel="noopener">Объявления по Нижегородской области</a></p><p>Баланс и продажа виртуальные. Коллекция сохраняется на этом устройстве.</p></div></div>';
}

function renderPromo(){
  openPanel('Промокод','БОНУС');

  const body=$('#panelBody');

  body.innerHTML=`
    <div class="promo-box">
      <div class="promo-hero">
        <span>✦</span>
        <div>
          <b>Супер-удачные прокрутки</b>
          <small>SADA1 даёт +10 удачных прокруток. SADA2 даёт +100 легендарных прокруток — только номера стоимостью от 800 000 ₽. Оба кода можно использовать сколько угодно раз.</small>
        </div>
      </div>
      <input
        class="region-search promo-input"
        id="promoInput"
        placeholder="Введи промокод"
        autocomplete="off"
        autocapitalize="characters"
      >
      <button class="ownership-primary" id="activatePromo">
        Активировать
      </button>
      <div class="promo-remaining">
        <span>Удачные SADA1</span>
        <strong>${state.luckyRolls}</strong>
      </div>
      <div class="promo-remaining promo-legendary">
        <span>Легендарные SADA2</span>
        <strong>${state.legendaryRolls}</strong>
      </div>
    </div>
  `;

  $('#activatePromo').onclick=()=>{
    const code=String($('#promoInput')?.value||'').trim().toUpperCase();

    if(code!=='SADA1'&&code!=='SADA2'){
      showToast('Промокод не найден');
      return;
    }

    if(code==='SADA2'){
      state.legendaryRolls+=100;
    }else{
      state.luckyRolls+=10;
    }

    state.usedPromos=[...state.usedPromos,code].slice(-100);
    persist();
    renderStats();
    haptic('success');
    showToast(
      code==='SADA2'
        ?'SADA2 · +100 легендарных прокруток'
        :'SADA1 · +10 удачных прокруток'
    );
    $('#promoInput').value='';
    renderPromo();
  };
}

function renderSettings(){
  openPanel('Настройки','ИНТЕРФЕЙС');

  $('#panelBody').innerHTML=`
    <div class="setting">
      <div>Звук<small>Щелчки символов и финальный звук выпадения</small></div>
      <button class="switch ${state.sound?'on':''}" id="soundSwitch"><i></i></button>
    </div>
    <div class="setting">
      <div>Вибрация<small>Отклик при переборе и выпадении номера</small></div>
      <button class="switch ${state.haptic?'on':''}" id="hapticSwitch"><i></i></button>
    </div>
    <div class="setting">
      <div>Быстрая анимация<small>Ускоряет перебор и расчёт цены</small></div>
      <button class="switch ${state.reduced?'on':''}" id="reducedSwitch"><i></i></button>
    </div>
  `;

  $('#soundSwitch').onclick=()=>{
    state.sound=!state.sound;
    persist();
    if(state.sound){
      ensureAudio();
      playTone(660,.08,.025,'sine');
    }
    renderSettings();
  };

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

$('#rollBtn').onclick=()=>roll().catch(()=>{busy=false;$('#rollBtn').disabled=false;$('#app').classList.remove('rolling');renderCurrent();showToast('Не удалось завершить анимацию. Попробуй ещё раз.');});
$('#collectionNav').onclick=renderCollection;
$('#priceInfoBtn').onclick=renderRarity;
$('#promoNav').onclick=renderPromo;
$('#sellCurrentBtn').onclick=sellCurrent;
$('#collectionCurrentBtn').onclick=saveCurrent;
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
    if(action==='promo') renderPromo();
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
updateSellButton();

try{
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor('#101113');
  tg?.setBackgroundColor('#101113');
}catch{};

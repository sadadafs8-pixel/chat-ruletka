'use strict';

const {REGIONS,tier,generate,valid,key}=PlateEngine;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const tg=window.Telegram?.WebApp;

const ROLL_COST=1000;
const START_BALANCE=1000000;

const DISPLAY_TIERS=[
  {name:'Обычный',color:'#8b94a2',min:1500,max:14999,desc:'Обычный случайный номер почти без коллекционной ценности.'},
  {name:'Необычный',color:'#35e982',min:15000,max:59999,desc:'Небольшой рисунок: зеркало, повтор или последовательность.'},
  {name:'Редкий',color:'#318dff',min:60000,max:249999,desc:'Ровные десятки и сотни, сильные повторы и заметные сочетания.'},
  {name:'Эпический',color:'#a15aff',min:250000,max:699999,desc:'Низкие номера, тройные цифры и одинаковые буквы.'},
  {name:'Легендарный',color:'#f0a51a',min:700000,max:30000000,desc:'001, 007, 777, топовые сочетания и спецсерии.'}
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

function regionPriceMultiplier(code,base){
  const r=String(code);

  // Region matters only when the combination is already valuable.
  if(base<60000)return 1;

  if(r==='77')return base>=700000?1.55:1.22;
  if(['97','99','177','197','199'].includes(r))return base>=700000?1.35:1.15;
  if(r==='777')return base>=700000?1.28:1.12;
  if(['797','799','977','997'].includes(r))return base>=700000?1.22:1.10;
  if(['50','90','150','190','250','550','750','790'].includes(r))return base>=700000?1.16:1.07;
  if(['78','98','178','198'].includes(r))return base>=700000?1.18:1.08;

  return 1;
}

function marketPriceFor(p){
  const n=String(p.n);
  const letters=String(p.a)+String(p.b)+String(p.c);
  const region=String(p.r);
  const numeric=Number(n);
  const h=hashString(key(p));

  const sameDigits=n[0]===n[1]&&n[1]===n[2];
  const sameLetters=letters[0]===letters[1]&&letters[1]===letters[2];
  const twoSameLetters=new Set(letters).size===2;
  const repeatedDigits=new Set(n).size<3;
  const mirror=n[0]===n[2]&&!sameDigits;
  const sequence=['123','234','345','456','567','678','789','987','876','765','654','543','432','321'].includes(n);
  const roundHundred=numeric>0&&numeric%100===0;
  const roundTen=numeric>=10&&numeric<100&&numeric%10===0;
  const firstTen=numeric>=1&&numeric<=9;
  const regionDigits=String(Number(region));
  const matchesRegion=regionDigits&&(n===regionDigits.padStart(3,'0')||n.endsWith(regionDigits));

  // Most random combinations should be almost worthless.
  let price=1800+((h%7)*350);

  if(repeatedDigits)price=4500+((h%6)*650);
  if(mirror)price=12000+((h%7)*1800);
  if(sequence)price=24000+((h%7)*2800);

  // Clean rounded numbers are noticeably more desirable.
  if(roundHundred)price=85000+((h%7)*9000);
  if(roundTen)price=120000+((h%7)*12000);

  // Low numbers are the main premium category.
  if(firstTen){
    const lowPrices={
      '001':760000,
      '002':360000,
      '003':340000,
      '004':330000,
      '005':390000,
      '006':330000,
      '007':720000,
      '008':430000,
      '009':410000
    };
    price=lowPrices[n]||350000;
  }

  // Triple digits use market-like relative ranking.
  if(sameDigits){
    const triplePrices={
      '111':390000,
      '222':320000,
      '333':340000,
      '444':300000,
      '555':380000,
      '666':280000,
      '777':700000,
      '888':480000,
      '999':450000,
      '000':520000
    };
    price=triplePrices[n]||350000;
  }

  // Two matching letters should barely affect a bad number.
  if(twoSameLetters&&!sameLetters){
    price+=3000;
  }

  // Three identical letters are genuinely valuable.
  if(sameLetters){
    price=Math.max(price,500000);
  }

  // Matching region matters, but should not turn junk into an expensive plate.
  if(matchesRegion){
    if(price<60000)price+=6000;
    else price*=1.10;
  }

  const specialSeries={
    'АМР':4200000,
    'ЕКХ':1800000,
    'СКР':1400000,
    'АМО':900000,
    'АММ':450000
  };

  if(specialSeries[letters]){
    price=Math.max(price,specialSeries[letters]);
  }

  price*=regionPriceMultiplier(region,price);

  if(n==='777'&&region==='77')price*=1.30;
  if(n==='001'&&region==='77')price*=1.22;
  if(n==='007'&&region==='77')price*=1.18;

  const variance=.96+((h%1000)/999)*.08;
  price*=variance;

  if(price<15000){
    price=Math.round(price/500)*500;
  }else if(price<60000){
    price=Math.round(price/1000)*1000;
  }else if(price<250000){
    price=Math.round(price/5000)*5000;
  }else if(price<1000000){
    price=Math.round(price/10000)*10000;
  }else if(price<5000000){
    price=Math.round(price/25000)*25000;
  }else{
    price=Math.round(price/50000)*50000;
  }

  return Math.max(1500,Math.min(30000000,price));
}

function priceFor(p){
  return marketPriceFor(p);
}

function displayTier(p){
  const value=priceFor(p);
  if(value<15000)return 0;
  if(value<60000)return 1;
  if(value<250000)return 2;
  if(value<700000)return 3;
  return 4;
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
  setTierVisual(0);

  renderStats();
  updateSellButton();
  updateSave();
  showToast('Продано за '+fmtPrice(value));
  busy=false;
}

function renderCurrent(){
  const p=state.current;

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
    ['А','М','О']
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

    if(value>=700000){
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
  return {...fallback,a:'А',b:'М',c:'Р',n:'777'};
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
      if(s===0||s===spins-1)haptic();
      await sleep(tick);
    }

    node.textContent=finalChars[i];
    node.classList.remove('slot-active');
    landSlotGlyph(node);
    haptic();
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
      await sleep(reduced?16:30);
    }

    regionNode.textContent=String(final.r);
    regionNode.setAttribute('textLength',String(final.r).length===3?'91':'61');
    regionNode.classList.remove('slot-active');
    landSlotGlyph(regionNode);
  }

  await sleep(reduced?18:45);
}

async function roll(){
  if(busy)return;
  if(state.balance<ROLL_COST){
    showToast('Недостаточно средств · прокрутка стоит '+fmtPrice(ROLL_COST));
    return;
  }

  const old=state.current;
  const reduced=state.reduced||matchMedia('(prefers-reduced-motion: reduce)').matches;

  busy=true;
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
    '<div class="tier-item" style="--c:#f0a51a"><div class="tier-top"><b>Оценка рынка</b><strong>до 30 000 000 ₽</strong></div><p>Обычные номера стоят почти ничего. Высокая цена появляется только у реально сильных комбинаций и редких серий.</p></div></div>';
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
          <small>SADA1 даёт +10 удачных прокруток. SADA2 даёт +100 легендарных прокруток — только номера стоимостью от 700 000 ₽. Оба кода можно использовать сколько угодно раз.</small>
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
  tg?.setHeaderColor('#06080d');
  tg?.setBackgroundColor('#06080d');
}catch{};
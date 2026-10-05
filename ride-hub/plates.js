'use strict';

const {REGIONS,tier,generate,valid,key}=PlateEngine;
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const tg=window.Telegram?.WebApp;

const ROLL_COST=1000;
const START_BALANCE=1000000;
const HISTORY_LIMIT=500;
let videoMode=false;

const DISPLAY_TIERS=[
  {name:'Обычный',color:'#8b94a2',min:300,max:4999,desc:'Случайный номер без красивой комбинации. Почти без ценности.'},
  {name:'Необычный',color:'#35e982',min:5000,max:24999,desc:'Лёгкие повторы и простые сочетания с небольшим спросом.'},
  {name:'Редкий',color:'#318dff',min:25000,max:149999,desc:'Зеркала, последовательности 123 / 321 и ровные числа.'},
  {name:'Эпический',color:'#a15aff',min:150000,max:799999,desc:'Тройки, низкие номера, одинаковые буквы и сильные сочетания.'},
  {name:'Легендарный',color:'#f0a51a',min:800000,max:30000000,desc:'Сильные сочетания цифр и букв, столичные коды и избранные серии.'}
];
const TIER_PROGRESS=[9,31,53,75,99];

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
      state.history=(Array.isArray(state.history)?state.history:[]).filter(valid).slice(0,HISTORY_LIMIT);
      state.current=valid(state.current)?state.current:null;
      state.history=state.history.map(p=>({...p,status:['opened','sold','transferred','archived'].includes(p.status)?p.status:(p.id===state.current?.id||state.collection.some(x=>x.id===p.id)?'opened':'archived')}));
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

// GOST-inspired outlines by stanlapru, DWYWPL; see FONT-LICENSE.txt.
const PLATE_GLYPHS={"А":{"d":"M366 728Q379 728 382 716L616 23Q616 23 616 17Q616 0 599 0H520Q506 0 503 12L461 132Q458 143 445 143H215Q202 143 199 131L158 12Q155 0 141 0H69Q62 0 56.5 5.0Q51 10 51 18Q51 21 52 23L278 716Q281 728 294 728ZM249 283Q249 283 249 278Q249 260 266 260H395Q402 260 407.5 265.0Q413 270 413 278Q413 281 412 283L349 482Q346 494 332 494Q319 494 316 482Z","b":[51,0,616,728]},"В":{"d":"M540 295Q565 256 563 196Q562 160 547.0 126.0Q532 92 520.5 78.0Q509 64 499 55Q450 9 382 0H381H61Q51 0 51 10V730Q51 740 61 740H350H384H388Q436 738 481 699Q538 654 554 585Q565 539 552.0 490.5Q539 442 525.0 421.0Q511 400 496 383Q493 380 493 376V355Q493 351 496 348Q520 324 540 295ZM440 170Q455 198 455 213Q456 235 437 266Q421 292 405 301L389 311Q361 313 335 313H162Q154 313 154 298V132Q154 120 162 120Q162 120 379 120Q413 120 440 170ZM440 480Q455 508 455 524Q456 545 437 576Q421 602 405 611L389 621Q361 623 335 623H162Q154 623 154 615V614V442Q154 427 159 427Q342 429 373 427H376H379Q412 429 440 480Z","b":[51,0,563.1481481481482,740]},"Е":{"d":"M80 737H519Q531 737 540.0 728.5Q549 720 549 708V664Q549 652 540.0 643.5Q531 635 519 635H177Q165 635 156.5 626.5Q148 618 148 606V451Q148 439 156.5 430.0Q165 421 177 421H519Q531 421 540.0 412.5Q549 404 549 392V345Q549 333 540.0 324.5Q531 316 519 316H177Q165 316 156.5 307.5Q148 299 148 287V132Q148 120 156.5 111.0Q165 102 177 102H519Q531 102 539.5 94.0Q548 86 548 74V73V30Q548 18 539.0 9.0Q530 0 518 0H80Q68 0 59.5 9.0Q51 18 51 30V708Q51 720 59.5 728.5Q68 737 80 737Z","b":[51,0,549,737]},"К":{"d":"M51 32V698Q51 710 60.0 719.0Q69 728 81 728H139Q151 728 160.0 719.0Q169 710 169 698V509Q169 497 177.5 488.0Q186 479 198 479H211Q225 479 233 489L434 718Q442 728 457 728H518Q530 728 539.0 719.0Q548 710 548 698Q548 688 541 679L333 432Q326 423 326 412Q326 405 331 397L544 57Q549 49 549 42V32Q549 20 540.0 11.0Q531 2 519 2H468Q452 2 443 16L269 294Q260 309 243 309Q229 309 220 297L174 239Q167 230 167 220V32Q167 20 158.0 11.0Q149 2 137 2H81Q69 2 60.0 11.0Q51 20 51 32Z","b":[51,2,549,728]},"М":{"d":"M51 18V705Q51 713 56.5 719.0Q62 725 70 725H141Q151 725 157 715L333 430Q336 426 341.0 426.0Q346 426 349 430L519 715Q524 724 536 724H616Q635 724 635 705V18Q635 -1 616 -1H559Q540 -1 540 18V497Q540 513 524 513Q514 513 510 506L372 278Q362 261 343.0 261.0Q324 261 314 278L174 507Q170 514 162 514Q148 514 148 500V18Q148 -1 129 -1H70Q51 -1 51 18Z","b":[51,-1,635,725]},"Н":{"d":"M51 13V728Q51 741 64 741L149 740Q161 740 161 728V440Q161 427 174 427H427Q439 427 439 440V728Q439 740 452 740L536 741Q549 741 549 728V13Q549 1 536 1L449 0Q436 0 436 13V289Q436 301 424 301H174Q161 301 161 289V13Q161 0 149 0L64 1Q51 1 51 13Z","b":[51,0,549,741]},"О":{"d":"M538 134Q561 116 565 107L562 103Q545 83 523.5 64.0Q502 45 455.5 23.5Q409 2 360 2Q288 2 213 51Q109 118 70 245Q55 292 52.5 342.0Q50 392 56.0 427.5Q62 463 74.5 498.0Q87 533 94.0 547.0Q101 561 108 572Q181 695 287 724Q299 727 317.5 730.5Q336 734 378.5 731.5Q421 729 456 713Q510 689 559 640Q561 638 562.5 636.0Q564 634 565.0 633.0Q566 632 566 631Q566 629 565 629L521 590Q501 571 496 569Q493 567 466 588Q460 592 449.0 598.5Q438 605 404.5 613.0Q371 621 339 616Q297 609 254 575Q205 535 181 464Q161 402 172 324Q177 292 181.0 274.5Q185 257 199.5 226.5Q214 196 237 174Q287 124 357 119Q368 118 384.0 118.5Q400 119 431.5 129.5Q463 140 485 160Q486 160 487.0 161.0Q488 162 489 163Q492 166 495.0 166.0Q498 166 500 164ZM183 602Q160 620 156 629L159 632Q176 652 197.5 671.0Q219 690 265.5 712.0Q312 734 361 734Q432 734 508 684Q606 620 651 491Q666 444 668.5 394.0Q671 344 665.0 308.5Q659 273 646.5 238.0Q634 203 626.5 188.5Q619 174 613 163Q540 40 434 11Q423 8 404.0 5.0Q385 2 342.5 4.5Q300 7 265 23Q211 47 162 96Q160 98 158.5 100.0Q157 102 156 103Q155 103 155 105Q155 106 156 106L200 145Q220 164 225 166Q228 168 255 147Q261 143 272.0 136.5Q283 130 316.5 122.0Q350 114 382 119Q424 126 467 160Q516 200 540 271Q560 333 549 412Q544 443 540.0 461.0Q536 479 521.5 509.0Q507 539 484 561Q433 612 364 617Q353 618 337.0 617.5Q321 617 289.5 606.5Q258 596 236 576L232 572Q230 570 226 570Q223 570 221 572Z","b":[51.76470588235294,2,669.2352941176471,734]},"Р":{"d":"M518 641Q550 590 548.0 529.0Q546 468 513 419Q489 385 450.0 360.0Q411 335 369 334H366H331H172Q159 334 159 321V14Q159 1 146 1H64Q51 1 51 14V722Q51 735 64 735H367Q411 735 453.0 706.5Q495 678 518 641ZM437 516Q439 523 439 537Q439 552 437 559Q431 587 419 600Q405 614 390 618Q376 621 361 621H175Q162 621 162 608V464Q162 451 175 451H390Q393 452 413 472Q431 490 437 516Z","b":[51,1,548.1176470588235,735]},"С":{"d":"M562 117Q565 114 565 111Q565 107 563 105Q546 85 524.5 66.0Q503 47 456.5 25.5Q410 4 361 4Q291 4 215 54Q111 121 72 247Q57 294 54.5 344.0Q52 394 58.0 429.5Q64 465 76.5 500.0Q89 535 96.0 549.0Q103 563 110 574Q183 698 288 726Q300 729 318.5 732.5Q337 736 380.0 733.5Q423 731 458 715Q511 691 560 642L567 635Q568 634 568 633Q568 631 567 631L501 573Q499 571 496.0 571.0Q493 571 491 573Q418 631 341 618Q299 611 256 577Q208 538 183 466Q163 404 174 326Q179 293 183.0 276.0Q187 259 201.0 228.5Q215 198 238 176Q288 126 358 121Q369 120 385.5 120.5Q402 121 433.5 131.5Q465 142 487 162Q488 162 489.0 163.0Q490 164 491 165Q494 168 496 168Q500 168 502 166Z","b":[53.76470588235294,4,568,734.5416666666666]},"Т":{"d":"M66 725H545Q559 725 559 710V640Q559 626 545 626H372Q366 626 361.5 621.5Q357 617 357 611V15Q357 0 343 0H270Q264 0 259.5 4.5Q255 9 255 15V611Q255 617 250.5 621.5Q246 626 240 626H66Q60 626 55.5 630.5Q51 635 51 641V710Q51 716 55.5 720.5Q60 725 66 725Z","b":[51,0,559,725]},"У":{"d":"M160 -1Q147 -1 147 12Q147 15 148 17L239 218Q245 230 245 245Q245 258 240 271L58 692Q51 708 51 723V724Q51 730 55.5 734.5Q60 739 66 739H143Q156 739 163 726L293 421Q298 408 313 408Q327 408 332 420L471 725Q478 738 491 738H573Q587 738 587 727Q587 707 579 688L267 12Q260 -1 246 -1Z","b":[51,-1,587,739]},"Х":{"d":"M94 750H154Q169 750 176 737L310 515Q317 503 332 503H333Q348 503 355 515L490 737Q497 749 512 749H583Q594 749 601.5 741.5Q609 734 609 724V713Q609 708 605 700L413 390Q410 384 410 381V359Q410 353 414 345L596 48Q600 40 600 34V26Q600 16 592.0 8.0Q584 0 574 0H509Q496 0 487 12L356 220Q347 232 334 232H333Q321 232 312 220L176 12Q167 0 154 0H77Q66 0 58.5 8.0Q51 16 51 26Q51 35 55 40L256 348Q261 353 261 360V379V380Q261 385 257 393L71 696Q68 702 68 709V710V725Q68 735 75.5 742.5Q83 750 94 750Z","b":[51,0,609,750]},"0":{"d":"M610 650Q612 643 614.0 630.5Q616 618 620.5 576.5Q625 535 626.5 491.5Q628 448 624.5 382.5Q621 317 610 252Q605 217 593 185Q557 94 479 41Q410 -4 350 -5Q241 -8 148 103Q123 132 107.0 168.5Q91 205 84.0 232.5Q77 260 66 316Q50 398 50 482Q50 593 78 700Q91 747 99.0 772.0Q107 797 125.0 829.5Q143 862 169 887Q250 966 338 963Q365 962 391 954Q453 935 502 893Q526 872 545.0 842.5Q564 813 576.5 775.5Q589 738 595.5 714.0Q602 690 610 650ZM502 331Q509 373 509.5 412.0Q510 451 506.5 513.5Q503 576 502 591Q501 626 493 659Q483 707 461.0 746.5Q439 786 412 802Q385 817 354 820H347Q308 819 280 808Q219 785 192 665Q191 658 189 650Q165 515 186 349Q196 271 215 232Q241 179 274 158Q308 138 348 138Q350 138 353 138Q394 139 420 156Q445 172 467 217Q493 271 502 331Z","b":[50,-5.078947368421052,626.95,963.109756097561]},"1":{"d":"M379 970H474Q484 970 491.0 963.0Q498 956 498 946V31Q498 21 491.0 14.0Q484 7 474 7H391Q381 7 374.0 14.0Q367 21 367 31L366 724Q366 734 359.0 741.0Q352 748 342.0 748.0Q332 748 325 741L158 569Q151 562 141.0 562.0Q131 562 124 569L58 637Q51 644 51 653Q51 663 58 670L362 963Q369 970 379 970Z","b":[51,7,498,970]},"2":{"d":"M152 692Q82 692 82 692H81Q69 692 60.5 700.5Q52 709 52 721Q52 723 52 724Q54 736 56 747Q59 766 65 782Q69 795 78.0 812.5Q87 830 105.0 857.5Q123 885 155.0 910.0Q187 935 226 949Q309 980 398 952Q463 932 512.5 884.0Q562 836 582 774Q605 706 591 639Q581 592 556 551Q555 550 553.5 547.5Q552 545 551.0 544.0Q550 543 549 541Q531 519 500.5 483.5Q470 448 405.0 372.0Q340 296 297.0 245.5Q254 195 254 195Q247 187 247 176Q247 164 255.5 155.5Q264 147 276 147Q295 146 325.5 145.5Q356 145 420.0 144.5Q484 144 527.0 143.0Q570 142 570 142Q582 142 590.5 133.5Q599 125 599 113V28Q599 16 590.5 7.5Q582 -1 570 -1H79Q67 -1 58.5 7.5Q50 16 50 28Q50 35 50.0 45.5Q50 56 50.0 78.5Q50 101 50.0 116.0Q50 131 50 131Q50 142 57 150L435 594Q436 595 437 596Q464 634 465 680Q466 692 464.5 706.5Q463 721 450.0 750.0Q437 779 413 797Q377 823 316 820Q270 818 237 797Q208 777 190 747Q182 733 176 718Q172 708 171 706Q167 692 152 692Z","b":[50,-1,599,965.2881355932203]},"3":{"d":"M585 807Q585 801 581 796Q569 782 548.5 758.0Q528 734 485.5 683.5Q443 633 414.5 599.5Q386 566 386 566Q382 562 382 555Q382 543 393 539Q464 514 498 488Q565 435 591 353Q622 261 580 163Q576 155 570.5 145.0Q565 135 549.0 112.0Q533 89 514.5 70.5Q496 52 465.5 33.0Q435 14 401 5Q370 -2 339 -2Q314 -2 290 2Q202 18 132 87Q98 121 79.5 156.0Q61 191 56 213Q51 236 50 260Q50 260 50 260Q50 267 55.0 272.0Q60 277 67 277Q155 277 155 277Q167 277 171 266Q176 251 185 236Q211 190 242 163Q283 125 328 125Q381 125 424 162Q471 203 471 260Q471 302 452 338Q430 378 401 397Q393 403 382.0 406.5Q371 410 362.0 412.0Q353 414 342.0 415.0Q331 416 324.5 415.5Q318 415 310.0 415.0Q302 415 302 415Q251 415 251 415Q244 415 239.0 420.0Q234 425 234 432Q234 440 234.0 454.0Q234 468 234.0 496.5Q234 525 234.0 544.5Q234 564 234 564Q234 570 238 575Q250 588 268.5 609.5Q287 631 326.0 677.0Q365 723 391.0 754.0Q417 785 417 785Q421 789 421 796Q421 803 416.0 808.0Q411 813 404 813H87Q80 813 75.0 818.0Q70 823 70 830V926Q70 933 75.0 938.0Q80 943 87 943Q568 943 568 943Q575 943 580.0 938.0Q585 933 585 926Z","b":[50,-2,604.1643835616438,943]},"4":{"d":"M587 31Q587 19 578.5 10.5Q570 2 558 2H489Q477 2 468.5 10.5Q460 19 460 31Q460 31 459.5 84.5Q459 138 459 191V244Q459 257 450.0 265.5Q441 274 429 274Q429 274 341.5 274.0Q254 274 167 274H79Q67 274 58.5 282.5Q50 291 50 303V388Q51 417 65 442Q65 442 139.0 567.5Q213 693 286 819L360 945Q365 952 374 952H470Q482 952 486.5 945.0Q491 938 485 927L204 434Q198 423 202.5 415.5Q207 408 219 408H429Q441 408 450.0 416.5Q459 425 459 438V508Q459 520 467.5 528.5Q476 537 488 537Q488 537 505.5 537.0Q523 537 540 537H558Q570 536 578.5 527.5Q587 519 587 507Q587 507 587.0 388.0Q587 269 587 150Z","b":[50,2,587,952]},"5":{"d":"M259 609H268Q297 609 326 608Q348 608 382 600Q499 573 563 489Q623 411 625 313Q627 211 558 120Q495 38 408 12Q369 0 327 0Q291 0 256 9Q201 23 139 70Q93 106 53 179Q50 185 50 191Q50 209 67 215Q71 217 77.5 219.0Q84 221 97.5 226.5Q111 232 120.0 235.5Q129 239 129 239Q135 241 141 241Q161 241 172 224Q190 195 233 170Q281 142 326 144Q366 145 400 164Q453 194 476 258Q486 287 486 317Q486 338 482 357Q474 391 452 419Q412 466 351 468H347H313H119Q107 468 98.0 476.5Q89 485 89 498V931Q89 943 97.5 951.5Q106 960 118 960H566Q578 960 587.0 951.5Q596 943 596 931Q596 926 596.0 917.5Q596 909 596.0 891.0Q596 873 596.0 861.0Q596 849 596 849Q596 837 587.0 828.0Q578 819 566 819Q547 819 515.0 819.0Q483 819 416.0 819.0Q349 819 304.0 819.0Q259 819 259 819Q247 819 238.5 810.0Q230 801 230 789V638Q230 626 238.5 617.5Q247 609 259 609Z","b":[50,0,625.056338028169,960]},"6":{"d":"M604 425Q657 316 606 188Q555 56 443 15Q333 -25 217 36Q97 99 59 249Q46 302 54 390Q58 447 71.0 501.0Q84 555 103.5 601.0Q123 647 136.0 673.0Q149 699 168 732Q240 860 346 963Q346 963 347 963Q355 969 365 969Q374 969 390.0 969.0Q406 969 439.5 969.0Q473 969 495.5 969.0Q518 969 518 969Q524 969 524 962Q524 959 522 957Q350 809 243 589Q242 588 242 586Q242 580 248 580Q250 580 258.0 581.5Q266 583 282.5 584.5Q299 586 323 586Q364 585 405 577Q430 572 454 562Q482 551 508.0 533.0Q534 515 549.5 498.5Q565 482 578.5 463.5Q592 445 596.5 437.0Q601 429 604 425ZM240.0 199.0Q283 156 344.5 156.0Q406 156 449.0 199.0Q492 242 492.0 303.5Q492 365 449.0 408.0Q406 451 344.5 451.0Q283 451 240.0 408.0Q197 365 197.0 303.5Q197 242 240.0 199.0Z","b":[50.95238095238095,-0.8415841584158414,631.0096153846154,969]},"7":{"d":"M79 961H577Q589 961 597.5 952.5Q606 944 606 932Q606 927 606.0 918.0Q606 909 606.0 890.5Q606 872 606.0 859.5Q606 847 606 847Q605 818 596 791L309 26Q298 0 270 -1H185Q172 -1 166.5 7.0Q161 15 166 26L460 792Q464 803 458.5 811.0Q453 819 441 819H79Q67 819 58.5 828.0Q50 837 50 849V932Q50 944 58.5 952.5Q67 961 79 961Z","b":[50,-1,606,961]},"8":{"d":"M536 532Q533 528 533 523Q533 516 538 512Q583 471 609.0 414.5Q635 358 635 294Q635 173 549.5 87.0Q464 1 343 1Q341 1 339 1Q220 3 135.5 88.0Q51 173 50 291Q50 292 50.0 293.0Q50 294 50 294Q50 358 76.0 414.5Q102 471 148 512Q153 516 153 523Q153 528 149 532Q88 603 88 698Q88 799 157.5 872.0Q227 945 327 952Q403 956 468.5 918.5Q534 881 569.0 814.0Q604 747 596 671Q588 592 536 532ZM334 832Q282 829 245.0 792.0Q208 755 205 703Q205 702 205 696Q205 640 245.0 600.0Q285 560 341.5 560.0Q398 560 437.5 600.0Q477 640 477.0 696.0Q477 752 437.5 792.0Q398 832 341 832Q338 832 334 832ZM226.0 177.0Q273 130 339.5 130.0Q406 130 453.5 177.0Q501 224 501.0 291.0Q501 358 453.5 405.0Q406 452 339.5 452.0Q273 452 226.0 405.0Q179 358 179.0 291.0Q179 224 226.0 177.0Z","b":[50,1,635,952.3855421686746]},"9":{"d":"M77 547Q24 656 74 784Q125 915 238 956Q347 996 463 936Q583 873 621 722Q634 669 627 582Q622 525 609.0 471.0Q596 417 576.5 371.0Q557 325 544.0 298.5Q531 272 513 240Q440 112 335 9Q334 9 334 8Q325 3 315 3Q306 3 290.0 3.0Q274 3 240.5 3.0Q207 3 185.0 3.0Q163 3 163 3Q156 3 156 9Q156 12 158 14H159Q330 163 438 382Q438 384 438 385Q438 392 432 392Q430 392 422.0 390.5Q414 389 397.5 387.5Q381 386 357 386Q316 386 276 395Q250 400 226 409Q198 420 172.5 438.5Q147 457 131.0 473.5Q115 490 101.5 508.5Q88 527 83.5 534.5Q79 542 77 547ZM440.0 772.5Q397 816 335.5 816.0Q274 816 231.0 772.5Q188 729 188.0 668.0Q188 607 231.0 564.0Q274 521 335.5 521.0Q397 521 440.0 564.0Q483 607 483.0 668.0Q483 729 440.0 772.5Z","b":[49.728155339805824,3,629.45,972.0]}};
let plateSerial=0;
function glyphPath(ch,x,y,w,h){
  const g=PLATE_GLYPHS[ch];if(!g)return '';
  const [x0,y0,x1,y1]=g.b,sx=w/(x1-x0),sy=h/(y1-y0);
  return `<path d="${g.d}" transform="translate(${x-sx*x0} ${y+sy*y1}) scale(${sx} ${-sy})"/>`;
}
const PLATE_X=[45,99,153,207,263,317];
function slotPath(ch,i){
  const digit=i>0&&i<4;
  return glyphPath(ch,PLATE_X[i]-(digit?23.5:21),digit?16:33,digit?47:42,digit?80:64);
}
function regionPaths(code){
  const r=String(code),w=r.length===3?30:37,gap=r.length===3?4.5:7;
  const start=441-(r.length*w+(r.length-1)*gap)/2;
  return [...r].map((c,i)=>glyphPath(c,start+i*(w+gap),11,w,61)).join('');
}
function updateSlot(node,ch,index){node.innerHTML=slotPath(ch,index);}
function plate(p){
  const id='plate-'+(++plateSerial),chars=[p.a,...p.n,p.b,p.c];
  return `<div class="plate-shell" aria-label="${key(p)}"><svg class="plate-svg" viewBox="0 0 520 112" role="img" aria-label="${key(p)}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="${id}-metal" x2=".2" y2="1"><stop stop-color="#e3e5e3"/><stop offset=".45" stop-color="#fafbf8"/><stop offset="1" stop-color="#9da39f"/></linearGradient>
      <linearGradient id="${id}-face" x2="0" y2="1"><stop stop-color="#ffffff"/><stop offset=".5" stop-color="#f8f9f4"/><stop offset="1" stop-color="#e9ece5"/></linearGradient>
      <pattern id="${id}-texture" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".3" fill="#454d3c" opacity=".12"/></pattern>
      <filter id="${id}-emboss" x="-3%" y="-3%" width="106%" height="108%"><feDropShadow dx="0" dy=".6" stdDeviation=".2" flood-color="#fff" flood-opacity=".95"/></filter>
    </defs>
    <rect x=".7" y=".7" width="518.6" height="110.6" rx="5.5" fill="url(#${id}-metal)" stroke="#8f9491" stroke-width="1"/>
    <rect x="2.7" y="2.7" width="514.6" height="106.6" rx="4" fill="url(#${id}-face)" stroke="#fff" stroke-width=".8"/>
    <rect x="5.5" y="5.5" width="509" height="101" rx="3.5" fill="url(#${id}-texture)" stroke="#171b18" stroke-width="1.8"/>
    <path d="M374 6.5v99" stroke="#171b18" stroke-width="1.8"/>
    <g fill="#090d0a" filter="url(#${id}-emboss)">${chars.map((c,i)=>`<g class="gost-char">${slotPath(c,i)}</g>`).join('')}<g class="gost-region">${regionPaths(p.r)}</g></g>
    <text x="401" y="95" class="gost-rus">RUS</text>
    <g><rect x="443" y="79" width="38" height="18" fill="#fff" stroke="#969c97" stroke-width=".45"/><path d="M443 88h38" stroke="#164fa2" stroke-width="6"/><path d="M443 94h38" stroke="#c52832" stroke-width="6"/></g>
    <g fill="#888e89" stroke="#d8ddd6" stroke-width="1"><circle cx="16" cy="56" r="2.3"/><circle cx="503" cy="56" r="2.3"/></g>
  </svg></div>`;
}

function setTierVisual(index,progress=TIER_PROGRESS[index]??0){
  const safeIndex=Math.max(0,Math.min(DISPLAY_TIERS.length-1,index));
  const d=DISPLAY_TIERS[safeIndex];
  const pct=Math.max(0,Math.min(100,Number(progress)||0));
  document.documentElement.style.setProperty('--tier',d.color);
  $('#rarityName').textContent=d.name;

  const scale=$('#rarityScale');
  if(scale)scale.style.setProperty('--rarity-progress',pct+'%');

  document.querySelectorAll('#rarityScale i').forEach((el,i)=>{
    el.classList.toggle('active',i<=safeIndex);
    el.classList.toggle('current',i===safeIndex);
  });
  document.querySelectorAll('.rarity-ladder-labels span').forEach((el,i)=>{
    el.classList.toggle('passed',i<safeIndex);
    el.classList.toggle('current',i===safeIndex);
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

  markHistory(p.id,'sold');
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
  updateStudio(p);

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
  $('#historyCount').textContent=state.history.length;
  $('.edition').textContent='№ '+String(state.rolls).padStart(3,'0')+' / RUS';

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

  if(!busy)updateStudio(state.current);
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

  const spins=reduced?1:(videoMode?8:5);
  const tick=reduced?16:(videoMode?46:30);

  for(let i=0;i<chars.length;i++){
    const node=chars[i];
    node.classList.remove('slot-pending');
    node.classList.add('slot-active');

    for(let s=0;s<spins;s++){
      updateSlot(node,i===0||i>=4?randomSlotLetter():randomSlotDigit(),i);
      pulseSlotGlyph(node);
      soundTick(i);
      if(s===0||s===spins-1)haptic('selection');
      await sleep(tick);
    }

    updateSlot(node,finalChars[i],i);
    node.classList.remove('slot-active');
    landSlotGlyph(node);
    soundLand(i);
    haptic('land');
    await sleep(reduced?12:(videoMode?120:40));
  }

  if(regionNode){
    regionNode.classList.remove('slot-pending');
    regionNode.classList.add('slot-active');

    for(let s=0;s<(reduced?1:3);s++){
      const code=randomSlotRegion();
      regionNode.innerHTML=regionPaths(code);
      pulseSlotGlyph(regionNode);
      soundTick(6);
      if(s===0)haptic('selection');
      await sleep(reduced?16:30);
    }

    regionNode.innerHTML=regionPaths(final.r);
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
    if(!videoMode)await animateToStack(old,reduced);
    state.previous=old;
  }

  state.balance-=ROLL_COST;
  persist();
  renderStats();

  $('#app').classList.remove('revealed','final-pop','video-reveal');
  $('#studioHeadline').textContent='Что выпадет на этот раз?';
  $('#studioStatus').textContent='ОТКРЫВАЕМ НОМЕР';
  $('#studioAttempt').textContent='ОТКРЫТИЕ № '+String(state.rolls+1).padStart(3,'0');
  $('#app').classList.add('rolling');
  $('#featureList').innerHTML='';
  $('#priceValue').textContent='0 ₽';
  renderEstimate(null);
  setTierVisual(0,0);
  updateSellButton();

  const legendaryRoll=state.legendaryRolls>0;
  const luckyRoll=!legendaryRoll&&state.luckyRolls>0;
  const final=legendaryRoll
    ?generateLegendary(state.region)
    :(luckyRoll?generateLucky(state.region):generate(state.region));

  await animateSequentialPlate(final,reduced);

  final.priceAtOpen=priceFor(final);
  final.rollNumber=state.rolls+1;
  final.status='opened';
  final.bonus=legendaryRoll?'legendary':luckyRoll?'lucky':'normal';
  state.current=final;
  state.rolls++;
  if(legendaryRoll)state.legendaryRolls=Math.max(0,state.legendaryRolls-1);
  else if(luckyRoll)state.luckyRolls=Math.max(0,state.luckyRolls-1);
  state.history=[{...final},...state.history].slice(0,HISTORY_LIMIT);
  persist();

  $('#currentPlate').innerHTML=plate(final);

  $('#app').classList.remove('rolling');
  $('#app').classList.add('revealed','slot-complete');
  setTimeout(()=>$('#app').classList.remove('slot-complete'),220);

  await analyze(final,reduced);

  renderStats();
  updateSellButton();
  soundFinal(final);
  $('#app').classList.add('video-reveal');
  updateStudio(final);
  haptic(displayTier(final)>=4?'legendary':'success');
  busy=false;
  $('#rollBtn').disabled=false;
}

async function analyze(p,reduced){
  const targetTier=displayTier(p);
  const targetPrice=priceFor(p);
  const targetProgress=TIER_PROGRESS[targetTier];
  renderEstimate(p);

  // Чем дороже номер, тем дольше идёт оценка и накрутка суммы.
  // Верхний предел оставляем достаточно коротким, чтобы открытие не утомляло.
  const revealDuration=
    targetPrice>=10000000?6200:
    targetPrice>=5000000?5400:
    targetPrice>=2000000?4700:
    targetPrice>=800000?3900:
    targetPrice>=300000?3250:
    targetPrice>=150000?2750:
    targetPrice>=25000?1900:
    targetPrice>=5000?1350:1050;

  const applyProgress=raw=>{
    const clamped=Math.max(0,Math.min(1,raw));
    const rarityEased=easeOutCubic(clamped);
    const progress=targetProgress*rarityEased;
    let stage=0;
    for(let i=1;i<=targetTier;i++){
      const threshold=(TIER_PROGRESS[i-1]+TIER_PROGRESS[i])*.5;
      if(progress>=threshold)stage=i;
    }
    setTierVisual(stage,progress);

    // Деньги идут почти линейно: дорогая сумма не появляется почти целиком
    // в первую секунду, а реально докручивается до самого финала.
    $('#priceValue').textContent=fmtPrice(targetPrice*clamped);
  };

  const animatePhase=(from,to,duration)=>new Promise(resolve=>{
    const start=performance.now();
    function frame(now){
      const t=Math.min(1,(now-start)/Math.max(1,duration));
      applyProgress(from+(to-from)*t);
      if(t<1)requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });

  if(reduced){
    applyProgress(1);
  }else if(targetTier>=3){
    const holdAt=targetTier===4?.76:.70;
    const firstPhase=Math.round(revealDuration*.46);
    const suspensePhase=Math.round(revealDuration*.18);
    const finalPhase=Math.round(revealDuration*.36);

    await animatePhase(0,holdAt,firstPhase);
    $('#app').classList.add('rarity-suspense');
    $('#studioStatus').textContent=targetTier===4?'ЛЕГЕНДАРНОЕ СОЧЕТАНИЕ':'ОЧЕНЬ РЕДКОЕ СОЧЕТАНИЕ';
    haptic('selection');
    await sleep(suspensePhase);
    $('#app').classList.remove('rarity-suspense');
    await animatePhase(holdAt,1,finalPhase);
  }else{
    await animatePhase(0,1,revealDuration);
  }

  setTierVisual(targetTier,targetProgress);
  $('#priceValue').textContent=fmtPrice(targetPrice);
  $('#featureList').innerHTML=featuresFor(p).map(x=>'<span>'+x+'</span>').join('');
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
    markHistory(p.id,'sold');
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
  markHistory(p.id,'transferred');
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


function markHistory(id,status){
  state.history=state.history.map(p=>p.id===id?{...p,status}:p);
}
function historyValue(p){return Number.isFinite(p.priceAtOpen)&&p.priceAtOpen>=0?p.priceAtOpen:priceFor(p);}
function historyStatus(p){
  if(p.status==='sold')return 'Продан';
  if(p.status==='transferred'||state.transferredOut.includes(p.id))return 'Передан';
  if(state.collection.some(x=>x.id===p.id))return 'В коллекции';
  return p.status==='archived'?'Архив':'Открыт';
}
function renderHistory(){
  openPanel('История открытий','КАЖДЫЙ НОМЕР — ЧАСТЬ ИСТОРИИ');
  const best=state.history.reduce((max,p)=>Math.max(max,historyValue(p)),0);
  $('#panelBody').innerHTML=`<div class="history-summary"><div><small>Сохранено открытий</small><strong>${state.history.length}<span> / ${HISTORY_LIMIT}</span></strong></div><div><small>Лучший в истории</small><strong>${fmtPrice(best)}</strong></div></div>
    <div class="history-tools"><input id="historySearch" class="region-search" placeholder="Найти номер или регион…" aria-label="Поиск в истории"><select id="historySort" aria-label="Порядок истории"><option value="new">Сначала новые</option><option value="price">Сначала дорогие</option><option value="rare">Редкие и выше</option></select></div><div id="historyList" class="history-list"></div><p class="history-note">Последние ${HISTORY_LIMIT} открытий на этом устройстве. Для новых открытий цена фиксируется в момент выпадения.</p>`;
  let shown=40,filtered=[];
  function paint(reset=true){
    if(reset)shown=40;
    const q=$('#historySearch').value.trim().toUpperCase().replace(/\s/g,'');
    const sort=$('#historySort').value;
    filtered=state.history.filter(p=>(!q||key(p).replace(/\s/g,'').includes(q)||regionName(p.r).toUpperCase().includes(q))&&(sort!=='rare'||historyValue(p)>=25000));
    if(sort==='price')filtered.sort((a,b)=>historyValue(b)-historyValue(a));
    $('#historyList').innerHTML=filtered.length?filtered.slice(0,shown).map(p=>{
      const d=DISPLAY_TIERS[displayTier(p)];
      const date=new Date(p.at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<button class="history-card" data-history-id="${p.id}" style="--card-tier:${d.color}"><div class="history-meta"><span>${p.rollNumber?'№ '+String(p.rollNumber).padStart(3,'0')+' · ':''}${date}</span><span>${historyStatus(p)}</span></div><div class="history-plate">${plate(p)}</div><div class="history-value"><span>${d.name}</span><strong>${fmtPrice(historyValue(p))}</strong></div></button>`;
    }).join('')+(filtered.length>shown?'<button class="ownership-secondary" id="historyMore">Показать ещё</button>':''):'<div class="empty-state"><b>'+ (state.history.length?'Ничего не найдено':'История начинается здесь')+'</b><span>'+(state.history.length?'Попробуй другой номер или фильтр.':'Открой номер — он автоматически появится здесь.')+'</span></div>';
    $$('[data-history-id]').forEach(b=>b.onclick=()=>renderHistoryDetail(b.dataset.historyId));
    if($('#historyMore'))$('#historyMore').onclick=()=>{shown+=40;paint(false)};
  }
  $('#historySearch').oninput=()=>paint();$('#historySort').onchange=()=>paint();paint();
}
function renderHistoryDetail(id){
  const p=state.history.find(p=>p.id===id);if(!p)return;
  const owned=state.collection.some(x=>x.id===id),available=p.status==='opened'&&!state.transferredOut.includes(id);
  openPanel('Открытый номер','ИСТОРИЯ');
  $('#panelBody').innerHTML=`<div class="detail-plate">${plate(p)}</div><div class="ownership-card" style="--detail-tier:${DISPLAY_TIERS[displayTier(p)].color}"><div class="ownership-row"><span>Статус</span><strong>${historyStatus(p)}</strong></div><div class="ownership-row"><span>${Number.isFinite(p.priceAtOpen)?'Цена при открытии':'Текущая оценка'}</span><strong>${fmtPrice(historyValue(p))}</strong></div><div class="ownership-row"><span>Открыт</span><strong>${new Date(p.at).toLocaleString('ru-RU')}</strong></div><p class="history-note">${featuresFor(p).join(' · ')}</p>${owned?'<button class="ownership-primary" id="historyOwned">Открыть в коллекции</button>':available?'<button class="ownership-primary" id="historySave">В коллекцию</button>':''}<button class="ownership-secondary" id="historyBack">Назад к истории</button></div>`;
  $('#historyBack').onclick=renderHistory;
  if($('#historyOwned'))$('#historyOwned').onclick=()=>renderPlateDetail(id);
  if($('#historySave'))$('#historySave').onclick=()=>{
    if(busy)return;
    if(state.collection.length>=5000){showToast('Лимит коллекции — 5 000');return;}
    if(!state.collection.some(x=>x.id===id)){state.collection.unshift({...p});persist();renderStats();}
    renderHistoryDetail(id);showToast('Добавлено в коллекцию');
  };
}
function updateStudio(p){
  $('#studioAttempt').textContent='ОТКРЫТИЕ № '+String(p?.rollNumber||state.rolls||1).padStart(3,'0');
  $('#studioHeadline').textContent=p?(['Каждый номер — история.','Хорошее начало.','Красивое сочетание.','Вот это находка.','Легенда в коллекции.'][displayTier(p)]):'Что выпадет на этот раз?';
  $('#studioStatus').textContent=p?'ТВОЙ НОВЫЙ НОМЕР':'ОДНО НАЖАТИЕ — НОВАЯ ИСТОРИЯ';
  $('#studioBonus').textContent=state.legendaryRolls>0?'БОНУС · ЛЕГЕНДАРНОЕ ОТКРЫТИЕ':state.luckyRolls>0?'БОНУС · УДАЧНОЕ ОТКРЫТИЕ':'СЛУЧАЙНОЕ ОТКРЫТИЕ';
}
function setVideoMode(enabled){
  if(busy)return;
  videoMode=enabled;
  $('#app').classList.toggle('video-mode',enabled);
  $('#studioHeader').classList.toggle('hidden',!enabled);
  $('#studioExit').disabled=false;
  closePanel();closeDrawer();updateStudio(state.current);
  try{tg?.expand()}catch{}
  window.scrollTo({top:0,behavior:'instant'});
}

$('#rollBtn').onclick=()=>roll().catch(()=>{busy=false;$('#rollBtn').disabled=false;$('#app').classList.remove('rolling');renderCurrent();showToast('Не удалось завершить анимацию. Попробуй ещё раз.');});
$('#collectionNav').onclick=renderCollection;
$('#priceInfoBtn').onclick=renderRarity;
$('#promoNav').onclick=renderPromo;
$('#historyNav').onclick=renderHistory;
$('#studioExit').onclick=()=>setVideoMode(false);
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
    if(action==='history')renderHistory();
    if(action==='studio')setVideoMode(true);
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

function enterAppFullscreen(){
  try{tg?.expand()}catch{}
  try{tg?.disableVerticalSwipes?.()}catch{}
  try{
    if(tg?.requestFullscreen && !tg?.isFullscreen)tg.requestFullscreen();
  }catch{}
}

try{
  tg?.ready();
  tg?.setHeaderColor('#101113');
  tg?.setBackgroundColor('#101113');
  tg?.setBottomBarColor?.('#101113');
}catch{}
enterAppFullscreen();
document.addEventListener('pointerdown',enterAppFullscreen,{once:true,passive:true});

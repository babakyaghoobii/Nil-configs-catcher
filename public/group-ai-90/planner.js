
"use strict";
const $=id=>document.getElementById(id);
const form=$("intake");
const roles={ai:"مدیر AI گروه",it:"IT و زیرساخت",security:"امنیت و حریم خصوصی",legal:"حقوقی و خرید",finance:"مالی",data:"داده و یکپارچه‌سازی",engineering:"مهندسی AI",change:"آموزش و مدیریت تغییر",ops:"پشتیبانی عملیات"};
const weekdays=["یکشنبه","دوشنبه","سه‌شنبه","چهارشنبه","پنجشنبه","جمعه","شنبه"];
const sections=["ارزیابی و تعیین اختیار","طراحی و آزمون کنترل‌شده","بهره‌برداری محدود و تصمیم گسترش"];
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
weekdays.forEach((day,i)=>{const label=make("label");const check=make("input");check.type="checkbox";check.name="workday";check.value=i;label.append(check,day);$("weekdays").append(label)});
function field(title,name,value="",options={}){
 const label=make("label",title);const input=make(options.multiline?"textarea":"input");input.name=name;input.value=value??"";input.maxLength=options.multiline?3000:240;input.required=!!options.required;label.append(input);return label;
}
Object.entries(roles).forEach(([key,title])=>$("roles").append(field(title,"role_"+key)));
function record(parent,title,fields,remove=true){
 const box=make("fieldset",undefined,"record");const legend=make("legend",title);const grid=make("div",undefined,"grid");grid.append(...fields);box.append(legend,grid);
 if(remove){const b=make("button","حذف");b.type="button";b.addEventListener("click",()=>{box.remove();syncUnits();invalidate()});grid.append(b)}
 $(parent).append(box);return box;
}
let nextUnit=0;
function addUnit(d={}){
 const box=record("unitRows","واحد / شرکت",[
 field("نام شرکت یا واحد *","unit",d.unit,{required:true}),field("مالک فرایند *","owner",d.owner,{required:true}),
 field("فرایند اولویت‌دار *","process",d.process,{required:true}),field("داده و KPI پایه یا وضعیت نامشخص *","baseline",d.baseline,{required:true}),
 field("کارشناسان، ظرفیت یا محدودیت اختصاصی","availability",d.availability)
 ],$("unitRows").children.length>0);
 box.dataset.unitId=String(++nextUnit);box.querySelector('[name="unit"]').addEventListener("input",syncUnits);syncUnits();return box;
}
function syncUnits(){
 const units=[...$("unitRows").children];
 $("pilotRows").querySelectorAll("select").forEach(select=>{
  const prev=select.value;
  select.replaceChildren(new Option("انتخاب واحد",""));
  units.forEach((u,i)=>select.add(new Option(u.querySelector('[name="unit"]').value.trim()||"واحد "+(i+1),u.dataset.unitId)));
  select.value=prev;
 });
}
function addPilot(d={}){
 const label=make("label","واحد مسئول *");const select=make("select");select.name="unitId";select.required=true;label.append(select);
 record("pilotRows","فرصت پیشنهادی",[
 field("عنوان / مسئله *","title",d.title,{required:true}),label,
 field("شاخص پایه و هدف *","target",d.target,{required:true}),field("منبع داده و وضعیت مجوز *","data",d.data,{required:true}),
 field("ریسک، محدودیت یا هزینهٔ تخمینی","risk",d.risk)
 ]);
 syncUnits();select.value=d.unitId||"";
}
addUnit();
$("addUnit").onclick=()=>{addUnit().querySelector("input").focus();invalidate()};
$("addPilot").onclick=()=>{addPilot();invalidate()};
const tasksText=`
ai|sponsor|مرور مأموریت و اولویت‌های گروه|با حامی، اهداف را به تصمیم‌های قابل‌اندازه‌گیری تبدیل کن|صورت‌جلسه با هدف، اختیار، ریسک و تصمیم باز
ai|finance,sponsor|پیش‌نویس منشور و سقف هزینه|دامنه، اختیارات، ظرفیت و هزینه‌های مجاز را با مالی مرور کن|منشور نسخهٔ ۱ و بودجهٔ مصوب یا درخواست تصمیم
ai|sponsor|تصویب منشور و تشکیل کمیته|حامی، مرجع توقف و ریتم گزارش‌دهی را تأیید کند|GATE:تصمیم مکتوب و نام مسئول هر حوزه
ai|change|ابلاغ معرفی پروژه و تعیین رابط‌ها|برای هر واحد، مالک فرایند و زمان مصاحبه را ثبت کن|فهرست واحدها با رابط و تاریخ مصاحبه
unit|ai|مصاحبهٔ مالک فرایند و مشاهده کار واقعی|گلوگاه، حجم، استثنا و تصمیم انسانی را مستند کن|نقشهٔ گردش‌کار و تعریف مسئله
it|data,unit|نقشهٔ سامانه‌ها و مسیر داده|منابع، API، مالک داده و مرز دسترسی را ثبت کن|فهرست سامانه‌ها و نمودار جریان داده
security|legal,it|شناسایی ابزارهای AI و طبقه‌بندی داده|ابزارهای فعلی و محل پردازش را ثبت کن|رجیستر اولیه و فهرست جریان‌های نیازمند تأیید
unit|finance,data|ثبت خط پایهٔ فرایند|حجم، زمان، خطا و هزینه را از نمونهٔ مجاز اندازه بگیر|خط پایه با منبع، بازه و مالک KPI
data|unit,security|سنجش آمادگی داده|نمونهٔ مجاز را برای تازگی، پوشش و کیفیت بررسی کن|گزارش کیفیت و شکاف‌های داده
ai|unit,finance|ایجاد کارت فرصت برای هر فرایند|اثر، هزینه، ریسک و معیار پذیرش را مشخص کن|کارت فرصت قابل رتبه‌بندی
legal|security,it|بررسی کشور کاربران و شرایط تأمین‌کننده|شرایط سرویس، پردازش و قرارداد را با شواهد رسمی چک کن|ماتریس گزینه‌های مجاز و موارد ممنوع
it|security,ai|طراحی تخصیص لایسنس موج اول|نقش، کاربرد، دعوت، لغو دسترسی و مرز اشتراک را مشخص کن|لیست کاربران نام‌دار و فرآیند ورود و خروج
finance|ai,unit|مقایسه ساخت، خرید و اتوماسیون متعارف|هزینه و اثر را با خط پایه و بازبینی انسانی مقایسه کن|Business Case اولیه و بازهٔ هزینه
security|legal,ai|تعریف سیاست استفاده و طبقه‌بندی ریسک|دسترسی، ابزارهای مجاز، استثنا و مسیر رخداد را مشخص کن|سیاست اولیه و ماتریس ریسک
ai|unit,finance|رتبه‌بندی فرصت‌ها|امتیاز ارزش، آمادگی، تلاش و ریسک را با دلیل ثبت کن|فهرست رتبه‌بندی‌شده با شواهد
change|unit,ai|انتخاب کاربران اولیه و ثبت روش آموزش|گروه آزمایش و شیوهٔ دریافت بازخورد را با واحد هماهنگ کن|فهرست گروه آزمایش و برنامهٔ آموزش
security|data,it|بررسی مرز داده و ارزیابی اولیه تهدید|جریان‌های حساس، جداسازی واحدها و دسترسی‌ها را بررسی کن|تهدیدها، کنترل‌ها و ریسک‌های باز
ai|sponsor,finance,security|تصمیم دربارهٔ پایلوت‌های موج اول|حداکثر دو فرصت را با مالک، KPI، سقف و مجوز بررسی کن|GATE:تصویب مشروط یا توقف با دلیل
engineering|ai,data|انتخاب طراحی و روش آزمون پایلوت|خط پایه، گزینهٔ فنی و حالت خطا را با کارت فرصت پیوند بده|طراحی نسخهٔ ۱ و معیار توقف
security|it,data|تأیید محیط ایزوله و حداقل دسترسی|هویت، لاگ، رازها و مسیر خروج داده را مرور کن|GATE:تأیید محیط و دامنهٔ مجاز داده
data|unit,security|آماده‌سازی دادهٔ آزمون|نمونه‌ها و سناریوهای استثنا را نسخه‌گذاری کن|مجموعه ارزیابی مجاز با پوشش سناریوها
engineering|it,security|راه‌اندازی مسیر اجرا و پایش پایه|محیط، رصد هزینه، نسخه و ثبت اجرای پایلوت را تنظیم کن|محیط قابل بازتولید و شواهد ثبت لاگ
unit|ai,engineering|تعریف معیار پذیرش با مالک فرایند|آستانهٔ کیفیت، زمان، خطا و بازبینی انسانی را نهایی کن|معیار پذیرش و نمونهٔ پذیرفته یا ردشده
engineering|data|پیاده‌سازی گردش‌کار اولیه|ورودی و خروجی واقعی مجاز و مسیر بازبینی را متصل کن|نسخهٔ آزمون‌پذیر با قابلیت ردیابی
engineering|it,unit|آزمون اتصال و حالات شکست|تایم‌اوت، ورودی تکراری و قطع سامانه را تمرین کن|گزارش تست و مسیر بازگشت به کار دستی
security|engineering,legal|آزمون کنترل‌های AI و مجوزها|کنترل دسترسی، نشتی و سناریوهای سوءاستفاده را بر اساس طراحی بررسی کن|گزارش امنیت و موارد مسدودکننده
data|engineering,unit|ارزیابی آفلاین در برابر خط پایه|نتایج را روی دادهٔ مجاز و استثناها بازتولید کن|جدول کیفیت، هزینه و زمان در برابر خط پایه
change|unit,ops|آماده‌سازی دستور کار کاربران|کار مجاز، تأیید انسانی و مسیر پشتیبانی را آموزش بده|راهنما و فهرست کاربران آموزش‌دیده
ai|security,unit|تصمیم ورود به آزمایش با کاربر|خطاهای بحرانی، وضعیت داده و تأیید مالک را مرور کن|GATE:مجوز آزمایش محدود یا بازگشت به اصلاح
unit|change,engineering|اجرای نوبت اول پایلوت با کاربران|نتیجه را در کنار مسیر معمول ثبت و خطا را برچسب‌گذاری کن|سوابق استفاده، خطا و بازخورد
ops|engineering,it|تمرین پاسخ به رخداد و توقف|سناریوی خطا و بازگشت به فرایند دستی را اجرا کن|گزارش تمرین و زمان بازیابی
engineering|unit,data|اصلاح موارد پرتکرار|ریشه‌یابی و تست رگرسیون روی دادهٔ ثابت انجام بده|نسخهٔ اصلاح‌شده و مقایسهٔ قبل و بعد
unit|change,finance|اجرای نوبت دوم و ثبت پذیرش|استفاده، نرخ اصلاح دستی و زمان پرونده را مقایسه کن|گزارش کاربردپذیری و شکاف معیار پذیرش
finance|ai,unit|محاسبه هزینهٔ کامل و ارزش تحقق‌یافته|هزینهٔ داده، اجرا، بازبینی و پشتیبانی را تفکیک کن|مدل مالی پایلوت با فرضیات ثبت‌شده
ai|sponsor,security,unit|تصمیم پایان پایلوت|نتایج، ریسک باقیمانده و ظرفیت عملیات را ارائه کن|GATE:ادامه، اصلاح یا توقف ثبت‌شده
ops|it,engineering|آماده‌سازی راهنمای عملیات و توافق خدمت|مسیر پشتیبانی، هشدار و مالک شیفت را مشخص کن|Runbook، SLA پیشنهادی و مالک عملیات
security|ops,legal|بازبینی پیش از انتشار|شواهد کنترل، قرارداد و حداقل دسترسی را مرور کن|چک‌لیست انتشار و ریسک‌های مسدودکننده
unit|ops,change|تمرین عملیاتی و تحویل کار به واحد|سناریوهای پذیرش، استثنا و آموزش را اجرا کن|صورت‌جلسهٔ پذیرش مالک فرایند
sponsor|ai,security,unit|تصمیم انتشار محدود|پشتیبانی، پایش و بازگشت را به تأیید برسان|GATE:مجوز انتشار یا مسیر اصلاح
engineering|it,ops|انتشار محدود مشروط به مجوز|دسترسی را برای گروه مصوب باز کن و وضعیت سلامت را ثبت کن|نسخه، دامنه و شواهد انتشار یا گزارش عدم انتشار
ops|engineering,unit|پایش کیفیت و رخدادهای موج اول|هشدارها، هزینه و نرخ بازگشت دستی را روزانه مرور کن|گزارش سلامت و موارد نیازمند اقدام
change|unit,ops|بازبینی استفاده و رفع اصطکاک|از کاربران فعال و غیرفعال بازخورد بگیر|فهرست اصلاح فرایند و مواد آموزشی
security|it,ops|ممیزی دسترسی و گردش داده پس از انتشار|دسترسی‌ها، ثبت فعالیت و توقف اضطراری را مرور کن|گزارش اختلاف، اقدام اصلاحی و مالک
finance|unit,ai|مقایسه عملکرد عملیاتی با خط پایه|حجم و کیفیت مشابه را مقایسه و اثر را تفکیک کن|KPI تحقق‌یافته، هزینه و محدودیت اندازه‌گیری
it|finance,ai|بازبینی خرید و تخصیص لایسنس|کاربران فعال، هزینه، جابه‌جایی و مجوز را بررسی کن|فهرست تمدید، حذف یا ارتقا با دلیل
engineering|ops,data|استانداردسازی دارایی‌های قابل استفاده مجدد|الگوهای ارزیابی، استقرار و مانیتورینگ را ثبت کن|بستهٔ تکرارپذیر با مالک و نسخه
unit|ai,change|ارزیابی آمادگی واحدهای بعدی|فرایند، داده، ظرفیت و محدودیت‌ها را مقایسه کن|فهرست موج بعد با شرط ورود
security|legal,ai|بازبینی رجیستر و ریسک‌های باز|کنترل باقیمانده، مهلت و پذیرندهٔ ریسک را مشخص کن|رجیستر به‌روز و ریسک‌های ارجاع‌شده
ai|finance,it,unit|طراحی برنامهٔ توسعه و منابع فصل بعد|هزینه، ظرفیت، استفادهٔ مجدد و زمان تحویل را برآورد کن|نقشهٔ راه فصل بعد و درخواست بودجه
ai|sponsor,finance|گزارش نهایی و تصمیم گسترش|اثر سنجیده‌شده، ریسک، مالک و گزینه‌های تصمیم را ارائه کن|GATE:گسترش، اصلاح یا توقف با تاریخ و مسئول
ops|ai,unit|تحویل مالکیت و ثبت پیگیری‌ها|SLA، مسئول پایش، تاریخ بازبینی و تسک‌های باز را منتقل کن|صورت‌جلسهٔ تحویل و فهرست کارهای باز
`.trim().split("\n").map(line=>line.split("|"));
let latest=null;
const status=$("status");
function invalidate(){
 if(latest){latest=null;$("result").hidden=true;status.textContent="ورودی تغییر کرد. دوباره تأیید کن و برنامه را تولید کن."}
 form.elements.approved.checked=false;
}
form.addEventListener("input",e=>{if(e.target.name!=="approved"&&e.target.id!=="importFile")invalidate()});
function clean(d){return Object.fromEntries([...d].map(([k,v])=>[k,String(v).trim()]))}
function fromRecord(box){return Object.fromEntries([...box.querySelectorAll("[name]")].map(e=>[e.name,e.value.trim()]))}
function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s}
function getInput(){
 const fd=new FormData(form);
 const keys=["group","start","locations","sponsor","budget","capacity","goals","systems","constraints","blockers","holidays","reportTool","reportCadence",...Object.keys(roles).map(k=>"role_"+k)];
 const data=clean(keys.map(k=>[k,fd.get(k)||""]));
 data.workdays=fd.getAll("workday").map(Number);
 data.units=[...$("unitRows").children].map(box=>({id:box.dataset.unitId,...fromRecord(box)}));
 data.pilots=[...$("pilotRows").children].map(fromRecord);
 if(["group","locations","sponsor","budget","capacity","goals","constraints"].some(k=>!data[k])||!validDate(data.start))throw Error("همهٔ ورودی‌های الزامی را با مقدار معتبر پر کن.");
 if(!data.workdays.length)throw Error("حداقل یک روز کاری هفته انتخاب کن.");
 if(data.units.some(u=>!u.unit||!u.owner||!u.process||!u.baseline))throw Error("برای همهٔ واحدها نام، مالک، فرایند و وضعیت شاخص پایه را وارد کن.");
 if(data.pilots.some(p=>!p.title||!p.target||!p.data||!data.units.some(u=>u.id===p.unitId)))throw Error("برای هر فرصت، واحد معتبر، عنوان، شاخص و منبع داده لازم است.");
 data.daysOff=data.holidays.split(/[,،\s]+/).filter(Boolean);
 if(data.daysOff.some(d=>!validDate(d)))throw Error("تعطیلات را با قالب میلادی YYYY-MM-DD وارد کن.");
 return data;
}
function dateLabel(date){return new Intl.DateTimeFormat("fa-IR-u-ca-persian",{timeZone:"UTC",weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(new Date(date))}
function generate(d){
 const dayMs=86400000;
 const start=Date.parse(d.start);
 const byUnit=new Map(d.units.map(u=>[u.id,u]));
 const roster=Object.fromEntries(Object.entries(roles).map(([k,title])=>[k,d["role_"+k]||title+" (انتصاب باز)"]));
 const dateRows=Array.from({length:90},(_,i)=>{
  const date=new Date(start+i*dayMs);const iso=date.toISOString().slice(0,10);
  return {day:i+1,date:iso,stage:sections[Math.floor(i/30)],work:d.workdays.includes(date.getUTCDay())&&!d.daysOff.includes(iso),tasks:[]};
 });
 const assignment=[[],[],[]];
 const overflow=[];
 const unitSteps=new Set([5,6,8,9,10,15,16,47]);
 const pilotSteps=new Set([19,21,22,23,24,25,26,27,28,30,31,32,33,34,36,37,38,40,41,42,43,44]);
 const pilotRefs=d.pilots.length?d.pilots.slice(0,2).map(p=>({u:byUnit.get(p.unitId),p})): [{u:null,p:null}];
 const context={
  1:"اهداف: "+d.goals,2:"بودجه: "+d.budget+" · ظرفیت: "+d.capacity,
  6:d.systems?"سامانه‌ها: "+d.systems:"",
  11:"محل کاربران: "+d.locations,14:"محدودیت: "+d.constraints,
  17:d.blockers?"تصمیم‌ها و موانع: "+d.blockers:"",
  18:d.pilots.length?"فرصت‌های ثبت‌شده: "+d.pilots.map(p=>p.title).join("، "):"تعیین نامزد از رتبه‌بندی واحدها",
  35:"اهداف: "+d.goals,50:"اهداف: "+d.goals+" · بودجه: "+d.budget
 };
 const phaseStarts=[0,18,35],phaseEnds=[18,35,51];
 for(let phase=0;phase<3;phase++){
  const work=dateRows.slice(phase*30,phase*30+30).filter(r=>r.work);
  const count=phaseEnds[phase]-phaseStarts[phase];
  for(let j=0;j<count;j++){
   const i=phaseStarts[phase]+j, n=i+1;
   const [owner,collaborators,title,method,deliverable]=tasksText[i];
   const subjects=unitSteps.has(n)?d.units.map(u=>({u,p:null})):pilotSteps.has(n)?pilotRefs:[{u:null,p:null}];
   const dateIndex=work.length>=count?(count===1?0:Math.floor(j*(work.length-1)/(count-1))):j;
   const row=work[dateIndex];
   const ids=[];
   const prevDate=work[work.length>=count&&j>0?Math.floor((j-1)*(work.length-1)/(count-1)):j-1]?.date;
   const openDate=j===0?work[0]?.date:dateRows.find(r=>r.work&&r.date>prevDate)?.date;
   subjects.forEach(({u,p},index)=>{
    const id="AI-"+String(n).padStart(2,"0")+(subjects.length>1?"."+String(index+1):"");
    const who=k=>k==="unit"?(u?.owner||"مالکان فرایند شرکت‌ها"):k==="sponsor"?d.sponsor:roster[k];
    const gate=deliverable.startsWith("GATE:");
    const extra=[
     context[n],u?"فرایند: "+u.process:"",u&&[5,8,9,10,15,23,27,44].includes(n)?"خط پایه: "+u.baseline:"",
     u?.availability&&[5,16,19,47].includes(n)?"ظرفیت/محدودیت واحد: "+u.availability:"",
     p&&[19,23,27,34,44].includes(n)?"شاخص هدف: "+p.target:"",
     p&&[19,21,26,37].includes(n)?"داده/مجوز: "+p.data+(p.risk?" · ریسک/هزینه: "+p.risk:""):"",
     pilotSteps.has(n)?(n>=40?"مشروط به مجوز انتشار و تداوم شرایط گیت":"مشروط به انتخاب رسمی پایلوت و مجوز داده"):""
    ].filter(Boolean).join(" · ");
    const prev=phase>0&&j===0?assignment[phase-1].at(-1):assignment[phase].at(-1);
    const dependency=prev?.join("، ")||"—";
    const reporting=gate
     ? "مسئول تسک ← "+d.sponsor+"؛ بستهٔ تصمیم شامل شواهد، ریسک باز، گزینه‌ها و تصمیم ثبت‌شده در پایان بازه."
     : "مسئول تسک ← "+roster.ai+(u?" و "+u.owner:"")+"؛ در پایان روز موعد، وضعیت، شواهد خروجی، مانع و قدم بعد را در "+(d.reportTool||"برد پروژه")+" ثبت کند.";
    const task={id,window:row?(openDate||row.date)+" تا "+row.date:"پس از بازتنظیم تقویم",reporting,scope:p?u.unit+" / "+p.title:u?.unit||(pilotSteps.has(n)?"پایلوت منتخب پس از تصویب":"سطح گروه"),
     owner:who(owner),support:collaborators.split(",").map(who).join("، "),title,method:method+(extra?" · "+extra:""),
     deliverable:deliverable.replace(/^GATE:/,""),dependency,gate,due:row?.date||null};
    (row?row.tasks:overflow).push(task);ids.push(id);
   });
   assignment[phase].push(ids);
  }
 }
 const blocked=new Set(overflow.map(t=>t.id));
 const sorted=[...dateRows.flatMap(r=>r.tasks)].sort((a,b)=>a.id.localeCompare(b.id));
 for(const task of sorted){
  task.blocked=task.dependency.split("، ").some(id=>blocked.has(id));
  if(task.blocked)blocked.add(task.id);
 }
 return {calendar:dateRows,overflow,openRoles:Object.keys(roles).filter(k=>!d["role_"+k]).map(k=>roles[k])};
}
const headers=["روز / تاریخ","شناسه و تسک","دامنه","مسئول پاسخ‌گو","همکاران","روش اجرا","خروجی / معیار تحویل","وابستگی","بازهٔ اجرا","گزارش‌دهی"];
function taskCells(t){return [t.id+" · "+(t.gate?"گیت · ":"")+t.title+(t.blocked?" · مسدود با تقویم فعلی":""),t.scope,t.owner,t.support,t.method,t.deliverable,t.dependency,t.window,t.reporting]}
function rowsFor(r){
 return r.tasks.length?r.tasks.map(t=>[r.day+" / "+r.date,...taskCells(t)]):[[r.day+" / "+r.date,r.work?"بافر پیگیری، رفع مانع و به‌روزرسانی وضعیت":"غیرکاری",r.work?"سطح گروه":"—",r.work?(latest.input.role_ai||"مدیر AI گروه (انتصاب باز)"):"—","—",r.work?"وابستگی‌های باز و ظرفیت را مرور کن":"—",r.work?"وضعیت ثبت‌شده و اقدام اصلاحی در صورت نیاز":"—","—",r.work?r.date:"—",r.work?"مدیر AI · ثبت وضعیت، مانع و اقدام بعد در "+(latest.input.reportTool||"برد پروژه"):"—"]];
}
function tableFor(columns,items){
 const wrap=make("div",undefined,"table");const table=make("table");const head=make("thead");const tr=make("tr");
 columns.forEach(h=>tr.append(make("th",h)));head.append(tr);table.append(head);
 const body=make("tbody");
 items.forEach(({cells,cls})=>{const row=make("tr",undefined,cls);cells.forEach(x=>row.append(make("td",x)));body.append(row)});
 table.append(body);wrap.append(table);return wrap;
}
function render(){
 const {input:d,plan:p}=latest;
 $("planTitle").textContent="برنامهٔ ۹۰روزهٔ "+d.group;
 const summary=$("summary");summary.replaceChildren();
 [dateLabel(p.calendar[0].date)+" تا "+dateLabel(p.calendar.at(-1).date),p.calendar.filter(r=>r.work).length+" روز کاری",d.units.length+" واحد موج اول",p.calendar.flatMap(r=>r.tasks).length+" تسک زمان‌بندی‌شده",p.overflow.length+" تسک خارج از ظرفیت تقویم"].forEach(s=>summary.append(make("span",s,"pill")));
 summary.append(make("p","منطق زمان‌بندی: سه فاز ۳۰روزه؛ موعدها فقط روی روز کاری. وابستگی پیش‌فرض ترتیبی است. چند تسک یک‌روزه برای واحدهای مختلف به ظرفیت موازی نیاز دارند.","hint"));
 summary.append(make("p","ریتم گزارش گروه: "+(d.reportCadence||"هفتگی، در آخرین روز کاری هفته")+" · مدیر AI به "+d.sponsor+" · کارهای تحویل‌شده، انحراف KPI/بودجه، ریسک‌ها و تصمیم‌های درخواستی.","hint"));
 if(p.openRoles.length)summary.append(make("p","انتصاب‌های باز — "+p.openRoles.join("، "),"hint"));
 if(d.pilots.length)summary.append(make("p","جزئیات اجرا با دو نامزد اول فرم ساخته شده است. اولویت نهایی در گیت انتخاب پایلوت ثبت می‌شود. اگر انتخاب کمیته فرق داشت، ترتیب یا نامزدها را در فرم اصلاح و برنامه را دوباره تولید کن.","hint"));
 if(p.overflow.length)summary.append(make("p","تقویم برخی فازها ظرفیت کافی ندارد. تسک‌های بدون موعد و وابستگی‌های مسدود پایین آمده‌اند. دامنه یا تقویم را بازبینی کن.","status"));
 const weeks=$("weeks");weeks.replaceChildren();
 for(let i=0;i<13;i++){
  const chunk=p.calendar.slice(i*7,i*7+7);
  const el=make("details");el.open=i===0;
  el.append(make("summary","هفتهٔ "+(i+1)+" · روزهای "+chunk[0].day+" تا "+chunk.at(-1).day+" · "+dateLabel(chunk[0].date)));
  el.append(tableFor(headers,chunk.flatMap(r=>rowsFor(r).map((cells,j)=>({cells,cls:r.tasks[j]?.gate?"gate":!r.work?"rest":""})))));
  weeks.append(el);
 }
 const extra=$("overflow");extra.replaceChildren();
 if(p.overflow.length){extra.append(make("h3","تسک‌های بدون موعد"),tableFor(headers.slice(1),p.overflow.map(t=>({cells:taskCells(t),cls:t.gate?"gate":""}))))}
 $("result").hidden=false;$("handoff").hidden=true;$("exportStatus").textContent="";$("planTitle").focus();$("result").scrollIntoView({behavior:"smooth"});
}
form.addEventListener("submit",e=>{
 e.preventDefault();status.textContent="";
 try{const input=getInput();latest={schema:"group-ai-office-v1",input,plan:generate(input)};render()}
 catch(error){status.textContent=error.message}
});
function download(name,type,content){
 const url=URL.createObjectURL(new Blob([content],{type}));const a=make("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
$("json").onclick=()=>download("Group-AI-90-input-and-plan.json","application/json;charset=utf-8",JSON.stringify(latest,null,2));
function csvCell(x){const s=String(x);return '"'+(/^[\s\uFEFF]*[=+\-@\t\r\n]/.test(s)?"'":"")+s.replaceAll('"','""')+'"'}
$("csv").onclick=()=>{
 const {calendar,overflow}=latest.plan;
 const rows=[headers,...calendar.flatMap(rowsFor),...overflow.map(t=>["بدون موعد",...taskCells(t)])];
 download("Group-AI-90-plan.csv","text/csv;charset=utf-8","\uFEFF"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n"));
};
$("expand").onclick=()=>{
 const details=[...$("weeks").children];const open=details.some(d=>!d.open);details.forEach(d=>d.open=open);
 $("expand").textContent=open?"بستن همهٔ هفته‌ها":"باز کردن همهٔ هفته‌ها";
};
$("copy").onclick=async()=>{
 const instruction="این ورودی‌ها را برای دفتر AI گروه تأیید کرده‌ام. برنامهٔ اجرایی اختصاصی ۹۰ روز تقویمی را با حفظ تعطیلات و گیت‌های تصمیم تولید کن. برای هر تسک تاریخ، واحد، یک مسئول پاسخ‌گو، همکاران، وابستگی، روش اجرا، خروجی و معیار پذیرش بده. برای هر تسک بازهٔ شروع و پایان، گیرندهٔ گزارش، زمان و کانال گزارش، شواهد و مسیر ارجاع مانع را تعیین کن. ظرفیت و تصمیم‌های باز را از واقعیت‌های تأییدشده جدا کن. مالکان یا داده‌های مجهول را با عنوان نقش و اقدام رفع ابهام مشخص کن. ریسک‌های هر پایلوت، ماتریس تخصیص لایسنس و برنامهٔ گزارش‌دهی مدیریت را نیز برگردان. خرید یا اجرای واقعی نیازمند تأیید جداگانهٔ سازمان است.\n\n";
 const text=instruction+JSON.stringify(latest.input,null,2);
 try{await navigator.clipboard.writeText(text);$("exportStatus").textContent="بسته کپی شد. آن را در پروژهٔ ChatGPT Work پیست کن."}
 catch{$("handoff").value=text;$("handoff").hidden=false;$("handoff").focus();$("handoff").select();$("exportStatus").textContent="بسته را از کادر پایین کپی کن."}
};
$("importBtn").onclick=()=>$("importFile").click();
$("importFile").addEventListener("change",async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  if(file.size>5000000)throw Error("فایل ورودی بیش از حد بزرگ است.");
  const {schema,input:d}=JSON.parse(await file.text());
  if(schema!=="group-ai-office-v1"||!d||!Array.isArray(d.units)||!d.units.length||!Array.isArray(d.pilots)||!Array.isArray(d.workdays)||d.units.some(u=>!u||typeof u!=="object")||d.pilots.some(p=>!p||typeof p!=="object"))throw Error("فایل JSON معتبر این برنامه را انتخاب کن.");
  for(const input of form.elements){
   if(input.type==="checkbox"&&input.name==="workday")input.checked=d.workdays.includes(Number(input.value));
   if(input.name&&["text","date","textarea"].includes(input.type)&&typeof d[input.name]==="string")input.value=d[input.name];
  }
  $("pilotRows").replaceChildren();$("unitRows").replaceChildren();
  const ids=new Map(d.units.map(u=>[u.id,addUnit(u).dataset.unitId]));
  d.pilots.forEach(p=>addPilot({...p,unitId:ids.get(p.unitId)}));
  invalidate();status.textContent="ورودی بازیابی شد. پس از بررسی، دوباره تأیید کن.";
 }catch(error){status.textContent=error.message||"فایل بازیابی نشد."}
 finally{e.target.value=""}
});

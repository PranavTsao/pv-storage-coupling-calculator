const $ = (id) => document.getElementById(id);

const ids = ["loadInput","pvInput","batteryInput","yieldInput","effInput","powerInput","profileInput"];
const defaults = {loadInput:4500,pvInput:6,batteryInput:5,yieldInput:930,effInput:90,powerInput:3,profileInput:"balanced"};
const units = {load:"kWh/a",pv:"kWp",battery:"kWh"};

function clamp(v,min,max){return Math.min(max,Math.max(min,v));}
function n(id){return Number($(id).value)||0;}
function fmt(v,d=0){return Number(v).toLocaleString("zh-CN",{maximumFractionDigits:d,minimumFractionDigits:d});}

function makeProfiles(annualLoad,pvSize,specificYield,profile){
  const loadWeights=[],pvWeights=[];
  for(let day=0;day<365;day++){
    const seasonSolar=0.38+0.62*Math.sin(Math.PI*(day+10)/365)**2;
    const dayLength=8+8*Math.sin(Math.PI*(day-80)/365);
    const sunrise=12-dayLength/2, sunset=12+dayLength/2;
    const weekday=day%7<5;
    const weather=0.78+0.14*Math.sin(day*1.71)+0.08*Math.sin(day*.37+1.4);
    for(let hour=0;hour<24;hour++){
      const t=hour+.5;
      let sun=0;
      if(t>sunrise&&t<sunset) sun=Math.sin(Math.PI*(t-sunrise)/dayLength)**1.45*seasonSolar*clamp(weather,.48,1.03);
      pvWeights.push(sun);
      const morning=Math.exp(-(((t-7.2)/1.55)**2));
      const evening=Math.exp(-(((t-19.2)/2.25)**2));
      const midday=Math.exp(-(((t-13)/3.1)**2));
      const night=Math.exp(-(((t-1.8)/2.8)**2));
      let w=.36+.42*morning+.78*evening+.18*midday+.08*night;
      if(profile==="evening") w=.28+.25*morning+1.28*evening+.08*midday;
      if(profile==="daytime") w=.38+.36*morning+.52*evening+.62*midday;
      if(profile==="heatpump"){
        const winter=1+.7*(1-Math.sin(Math.PI*(day+10)/365)**2);
        w=(.5+.32*morning+.58*evening+.18*midday)*winter;
      }
      if(!weekday) w*=.97+(.13*midday);
      loadWeights.push(w);
    }
  }
  const loadScale=annualLoad/loadWeights.reduce((a,b)=>a+b,0);
  const pvScale=(pvSize*specificYield)/(pvWeights.reduce((a,b)=>a+b,0)||1);
  return {load:loadWeights.map(v=>v*loadScale),pv:pvWeights.map(v=>v*pvScale)};
}

function simulate(params){
  const {load,pv}=makeProfiles(params.load,params.pv,params.yield,params.profile);
  const eta=Math.sqrt(clamp(params.eff/100,.01,.999));
  const cap=Math.max(0,params.battery);
  let soc=cap*.5;
  const run=(collect)=>{
    const totals={load:0,pv:0,direct:0,chargeIn:0,batteryOut:0,gridImport:0,gridExport:0,loss:0};
    for(let i=0;i<8760;i++){
      const l=load[i],g=pv[i],direct=Math.min(l,g);
      let surplus=g-direct,deficit=l-direct;
      const charge=Math.min(surplus,params.power,cap>0?(cap-soc)/eta:0);
      soc+=charge*eta; surplus-=charge;
      const out=Math.min(deficit,params.power,cap>0?soc*eta:0);
      soc-=out/eta; deficit-=out;
      if(collect){totals.load+=l;totals.pv+=g;totals.direct+=direct;totals.chargeIn+=charge;totals.batteryOut+=out;totals.gridImport+=deficit;totals.gridExport+=surplus;}
    }
    if(collect) totals.loss=totals.chargeIn-totals.batteryOut;
    return totals;
  };
  run(false);
  const t=run(true);
  t.scr=t.pv>0?100*(t.pv-t.gridExport)/t.pv:0;
  t.ssr=t.load>0?100*(t.direct+t.batteryOut)/t.load:0;
  t.cycles=cap>0?t.batteryOut/cap:0;
  return t;
}

function params(){return {load:n("loadInput"),pv:n("pvInput"),battery:n("batteryInput"),yield:n("yieldInput"),eff:n("effInput"),power:n("powerInput"),profile:$("profileInput").value};}

function render(){
  const p=params(),r=simulate(p);
  $("scrValue").textContent=fmt(r.scr,1)+"%"; $("ssrValue").textContent=fmt(r.ssr,1)+"%";
  $("scrBar").style.width=clamp(r.scr,0,100)+"%"; $("ssrBar").style.width=clamp(r.ssr,0,100)+"%";
  $("pvGen").textContent=fmt(r.pv)+" kWh"; $("directUse").textContent=fmt(r.direct)+" kWh";
  $("batteryOut").textContent=fmt(r.batteryOut)+" kWh"; $("gridImport").textContent=fmt(r.gridImport)+" kWh";
  $("gridExport").textContent=fmt(r.gridExport)+" kWh"; $("cycles").textContent=fmt(r.cycles)+" 次/a";
  const direct=100*r.direct/r.load,bat=100*r.batteryOut/r.load,grid=100*r.gridImport/r.load;
  $("balanceBar").innerHTML=`<span class="direct-bg" style="width:${direct}%"></span><span class="battery-bg" style="width:${bat}%"></span><span class="grid-bg" style="width:${grid}%"></span>`;
  const ratio=p.pv>0?p.battery/p.pv:0, demandLimit=1.5*p.load/1000, pvLimit=1.5*p.pv;
  let hint=`储能/PV = ${fmt(ratio,2)} kWh/kWp；HTW型上限约 ${fmt(Math.min(demandLimit,pvLimit),1)} kWh。`;
  if(ratio>1.5) hint+=" 当前容量偏大，需由备电或动态电价价值支撑。";
  else if(ratio<.6&&p.battery>0) hint+=" 当前容量偏小但循环利用率通常较高。";
  else hint+=" 当前比例位于常见工程区间。";
  $("sizingHint").textContent=hint;
}

function setRangePair(input,range){
  $(input).addEventListener("input",()=>{$(range).value=$(input).value;render();});
  $(range).addEventListener("input",()=>{$(input).value=$(range).value;render();});
}
setRangePair("loadInput","loadRange");setRangePair("pvInput","pvRange");setRangePair("batteryInput","batteryRange");
ids.slice(3).forEach(id=>$(id).addEventListener("input",render));

function syncOptBounds(){
  const v=$("optVariable").value;
  $("optMinUnit").textContent=units[v];$("optMaxUnit").textContent=units[v];
  if(v==="battery"){$("optMin").value=0;$("optMax").value=15;}
  if(v==="pv"){$("optMin").value=.5;$("optMax").value=15;}
  if(v==="load"){$("optMin").value=1000;$("optMax").value=12000;}
}

function optimize(){
  const variable=$("optVariable").value,metric=$("optMetric").value;
  let min=n("optMin"),max=n("optMax"); if(max<min)[min,max]=[max,min]; if(max===min)max=min+1;
  const base=params(),pts=[];
  for(let i=0;i<=80;i++){
    const x=min+(max-min)*i/80,p={...base,[variable]:x};
    const r=simulate(p);pts.push({x,y:r[metric],scr:r.scr,ssr:r.ssr});
  }
  let best=pts[0];for(const pt of pts)if(pt.y>best.y)best=pt;
  const start=pts[0].y,gain=best.y-start,target=start+.95*Math.max(0,gain);
  let knee=pts.find(pt=>pt.y>=target)||best;
  if(metric==="scr"&&best.x===min){knee=best;}
  const unit=units[variable],metricName=metric==="scr"?"自用率":"自给率";
  $("optimumValue").textContent=`${fmt(best.x,variable==="load"?0:1)} ${unit}`;
  $("optimumSummary").textContent=`在 ${fmt(min)}–${fmt(max)} ${unit} 内，${metricName}最高为 ${fmt(best.y,1)}%。`;
  $("kneeValue").textContent=`${fmt(knee.x,variable==="load"?0:1)} ${unit}`;
  $("kneeSummary").textContent=`已获得区间内可实现增益的95%，对应${metricName} ${fmt(knee.y,1)}%。`;
  drawChart(pts,best,knee,variable,metricName);
}

function drawChart(pts,best,knee,variable,metricName){
  const svg=$("optChart"),W=720,H=230,pad={l:52,r:20,t:22,b:38};
  const xmin=pts[0].x,xmax=pts.at(-1).x,ymin=Math.max(0,Math.min(...pts.map(p=>p.y))-5),ymax=Math.min(100,Math.max(...pts.map(p=>p.y))+5);
  const sx=x=>pad.l+(x-xmin)/(xmax-xmin)*(W-pad.l-pad.r),sy=y=>H-pad.b-(y-ymin)/(Math.max(1,ymax-ymin))*(H-pad.t-pad.b);
  const path=pts.map((p,i)=>`${i?"L":"M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const grid=[0,.25,.5,.75,1].map(q=>{const y=pad.t+q*(H-pad.t-pad.b);const val=ymax-q*(ymax-ymin);return `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="#203b4a"/><text x="${pad.l-9}" y="${y+4}" text-anchor="end" fill="#78909b" font-size="11">${fmt(val,0)}%</text>`}).join("");
  svg.innerHTML=`${grid}<path d="${path}" fill="none" stroke="#ffbd4a" stroke-width="3"/><circle cx="${sx(best.x)}" cy="${sy(best.y)}" r="6" fill="#ffbd4a"/><circle cx="${sx(knee.x)}" cy="${sy(knee.y)}" r="5" fill="#68d7ca"/><text x="${pad.l}" y="${H-12}" fill="#91a8b3" font-size="11">${variable==="battery"?"储能容量 kWh":variable==="pv"?"PV规模 kWp":"年用电量 kWh/a"}</text><text x="${W-pad.r}" y="${H-12}" text-anchor="end" fill="#91a8b3" font-size="11">${metricName}</text>`;
}

function financialCase(base,pv,battery,finance){
  const scenario={...base,pv,battery};
  const full=simulate(scenario);
  const noBattery=battery>0?simulate({...scenario,battery:0}):full;
  const pvCapex=pv*1000*finance.pvCost,batCapex=battery*finance.batteryCost,capex=pvCapex+batCapex;
  const fullBenefit=(full.direct+full.batteryOut)*finance.buyPrice+full.gridExport*finance.feedPrice;
  const pvOnlyBenefit=noBattery.direct*finance.buyPrice+noBattery.gridExport*finance.feedPrice;
  const maintenance=pvCapex*.01+batCapex*.005;
  let npv=-capex;
  for(let year=1;year<=20;year++){
    const pvPart=pvOnlyBenefit*Math.pow(.995,year-1);
    const batteryPart=year<=15?Math.max(0,fullBenefit-pvOnlyBenefit)*Math.pow(.98,year-1):0;
    npv+=(pvPart+batteryPart-maintenance)/Math.pow(1.04,year);
  }
  const netAnnual=Math.max(0,fullBenefit-maintenance);
  return {pv,battery,capex,npv,annual:fullBenefit,payback:netAnnual>0?capex/netAnnual:Infinity,result:full};
}

function recommendForIncome(income,base,finance){
  const budget=income*finance.budgetShare/100;
  let best={pv:0,battery:0,capex:0,npv:0,annual:0,payback:Infinity,result:simulate({...base,pv:0,battery:0})};
  for(let pv=.5;pv<=finance.roofLimit+.001;pv+=.5){
    for(let battery=0;battery<=15.001;battery+=1){
      const capex=pv*1000*finance.pvCost+battery*finance.batteryCost;
      if(capex>budget+.01)continue;
      const candidate=financialCase(base,pv,battery,finance);
      if(candidate.npv>best.npv)best=candidate;
    }
  }
  return {...best,budget,income};
}

function financeParams(){return {pvCost:n("pvCost"),batteryCost:n("batteryCost"),buyPrice:n("buyPrice"),feedPrice:n("feedPrice"),budgetShare:n("budgetShare"),roofLimit:n("roofLimit")};}

function paintRecommendation(rec){
  $("recPv").textContent=fmt(rec.pv,1)+" kWp";$("recBattery").textContent=fmt(rec.battery,1)+" kWh";
  $("recCapex").textContent="€"+fmt(rec.capex);$("recAnnual").textContent="€"+fmt(rec.annual)+"/a";
  $("recNpv").textContent=(rec.npv>=0?"€":"−€")+fmt(Math.abs(rec.npv));
  $("recPayback").textContent=Number.isFinite(rec.payback)?fmt(rec.payback,1)+" 年":"—";
  $("recSsr").textContent=fmt(rec.result.ssr,1)+"%";
  const storageText=rec.battery===0?"在当前价格假设下，储能的边际现金流不足，因此推荐仅配置PV。":"储能在当前电价差、负荷曲线与预算下可增加净现值。";
  $("recNarrative").textContent=`可投资上限 €${fmt(rec.budget)}。${storageText} 收入在模型中只约束预算，不改变物理能量平衡。`;
}

function renderTierCards(base,finance){
  const tiers=[{name:"较低收入 Q1",income:23640},{name:"中等收入 Median",income:38112},{name:"较高收入 Q3",income:61200}];
  const recs=tiers.map(t=>({...t,rec:recommendForIncome(t.income,base,finance)}));
  $("tierCards").innerHTML=recs.map(({name,income,rec})=>`<article class="tier-card"><span>${name} · €${fmt(income)}/a</span><strong>${fmt(rec.pv,1)} kWp + ${fmt(rec.battery,1)} kWh</strong><p>投资 €${fmt(rec.capex)} · NPV ${rec.npv>=0?"€":"−€"}${fmt(Math.abs(rec.npv))}</p></article>`).join("");
}

function runEconomics(){
  const button=$("recommendBtn");button.disabled=true;button.firstChild.textContent="计算中… ";
  setTimeout(()=>{
    const base=params(),finance=financeParams(),income=n("incomeInput");
    const rec=recommendForIncome(income,base,finance);paintRecommendation(rec);renderTierCards(base,finance);
    button.disabled=false;button.firstChild.textContent="推荐经济配置 ";
  },20);
}

$("optVariable").addEventListener("change",syncOptBounds);$("optimizeBtn").addEventListener("click",optimize);
$("incomeTier").addEventListener("change",()=>{if($("incomeTier").value!=="custom")$("incomeInput").value=$("incomeTier").value;});
$("incomeInput").addEventListener("input",()=>{$("incomeTier").value="custom";});
$("recommendBtn").addEventListener("click",runEconomics);
$("resetBtn").addEventListener("click",()=>{Object.entries(defaults).forEach(([id,v])=>$(id).value=v);$("loadRange").value=4500;$("pvRange").value=6;$("batteryRange").value=5;$("incomeTier").value="38112";$("incomeInput").value=38112;$("budgetShare").value=20;$("roofLimit").value=15;$("pvCost").value=1.25;$("batteryCost").value=700;$("buyPrice").value=.34;$("feedPrice").value=.08;syncOptBounds();render();optimize();runEconomics();});
syncOptBounds();render();optimize();runEconomics();

function registerModelTool(){
  const context=document.modelContext;
  if(!context?.registerTool)return;
  const finite=(v,name,min,max)=>{const x=Number(v);if(!Number.isFinite(x)||x<min||x>max)throw new Error(`${name} must be between ${min} and ${max}`);return x;};
  try{
    void Promise.resolve(context.registerTool({
      name:"configure_energy_scenario",
      title:"配置PV储能场景",
      description:"Set annual household consumption, PV capacity and usable battery capacity in the visible calculator, then return the simulated self-consumption and self-sufficiency rates.",
      inputSchema:{type:"object",properties:{annualConsumptionKwh:{type:"number",minimum:500,maximum:30000},pvCapacityKwp:{type:"number",minimum:.1,maximum:50},usableBatteryKwh:{type:"number",minimum:0,maximum:50}},required:["annualConsumptionKwh","pvCapacityKwp","usableBatteryKwh"],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input){
        const load=finite(input?.annualConsumptionKwh,"annualConsumptionKwh",500,30000);
        const pv=finite(input?.pvCapacityKwp,"pvCapacityKwp",.1,50);
        const battery=finite(input?.usableBatteryKwh,"usableBatteryKwh",0,50);
        $("loadInput").value=load;$("loadRange").value=clamp(load,500,15000);
        $("pvInput").value=pv;$("pvRange").value=clamp(pv,.1,20);
        $("batteryInput").value=battery;$("batteryRange").value=clamp(battery,0,20);
        render();optimize();
        const result=simulate(params());
        return {annualConsumptionKwh:load,pvCapacityKwp:pv,usableBatteryKwh:battery,selfConsumptionPercent:Number(result.scr.toFixed(1)),selfSufficiencyPercent:Number(result.ssr.toFixed(1)),gridImportKwh:Math.round(result.gridImport),gridExportKwh:Math.round(result.gridExport)};
      }
    })).catch(()=>{});
    void Promise.resolve(context.registerTool({
      name:"recommend_affordable_system",
      title:"推荐可负担PV储能配置",
      description:"Recommend the PV and battery capacities with the highest 20-year NPV under a household annual net-income budget constraint, and update the visible economic-sizing panel.",
      inputSchema:{type:"object",properties:{annualConsumptionKwh:{type:"number",minimum:500,maximum:30000},annualNetIncomeEur:{type:"number",minimum:10000,maximum:300000},maxInvestmentSharePercent:{type:"number",minimum:5,maximum:100}},required:["annualConsumptionKwh","annualNetIncomeEur","maxInvestmentSharePercent"],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input){
        const load=finite(input?.annualConsumptionKwh,"annualConsumptionKwh",500,30000);
        const income=finite(input?.annualNetIncomeEur,"annualNetIncomeEur",10000,300000);
        const share=finite(input?.maxInvestmentSharePercent,"maxInvestmentSharePercent",5,100);
        $("loadInput").value=load;$("loadRange").value=clamp(load,500,15000);$("incomeInput").value=income;$("incomeTier").value="custom";$("budgetShare").value=share;
        render();
        const rec=recommendForIncome(income,params(),financeParams());paintRecommendation(rec);
        return {annualConsumptionKwh:load,annualNetIncomeEur:income,investmentBudgetEur:Math.round(rec.budget),recommendedPvKwp:rec.pv,recommendedUsableBatteryKwh:rec.battery,initialInvestmentEur:Math.round(rec.capex),netPresentValue20YearsEur:Math.round(rec.npv),selfSufficiencyPercent:Number(rec.result.ssr.toFixed(1))};
      }
    })).catch(()=>{});
  }catch(_error){}
}
registerModelTool();

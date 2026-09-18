const C={expense:["식비","교통","쇼핑","고정비","공과금","여가","의료","교육","생활","대출상환","기타"],income:["급여","부수입","용돈","이자/배당","환급","기타"]};
const $=id=>document.getElementById(id);
const won=n=>new Intl.NumberFormat("ko-KR",{style:"currency",currency:"KRW",maximumFractionDigits:0}).format(Number(n)||0);
const pad=n=>String(n).padStart(2,"0");
const localDateString=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const now=new Date(),today=localDateString(now),thisMonth=today.slice(0,7);
const KEYS={tx:"hb_transactions",debts:"hb_debts",auto:"hb_automation_rules",pending:"hb_pending_entries",assets:"hb_assets",pass:"hb_password_hash",salt:"hb_password_salt",lock:"hb_auto_lock_minutes",localUpdated:"hb_local_updated_at",cloudAuto:"hb_cloud_auto_sync",device:"hb_device_id"};
let transactions=safeArray(KEYS.tx),debts=safeArray(KEYS.debts),rules=safeArray(KEYS.auto),pending=safeArray(KEYS.pending),assets=safeArray(KEYS.assets);
let deferredPrompt,inactivityTimer=null,editingTransactionId=null,currentFilteredTransactions=[];
let cloudClient=null,cloudUser=null,cloudChannel=null,cloudPushTimer=null,cloudApplying=false;
const DEVICE_ID=localStorage.getItem(KEYS.device)||uid();localStorage.setItem(KEYS.device,DEVICE_ID);
const CLOUD_CONFIG=window.HB_CLOUD_CONFIG||{};

function safeArray(key){try{const v=JSON.parse(localStorage.getItem(key)||"[]");return Array.isArray(v)?v:[]}catch{return []}}
function uid(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function ym(d){return String(d||"").slice(0,7)}
function type(){return document.querySelector('input[name="type"]:checked').value}
function monthData(m){return transactions.filter(t=>ym(t.date)===m)}
function daysInMonth(y,m){return new Date(y,m,0).getDate()}
function scheduledDate(rule,month){const [y,m]=month.split("-").map(Number);return `${y}-${pad(m)}-${pad(Math.min(Number(rule.day)||1,daysInMonth(y,m)))}`}
function dateDiffDays(a,b){const x=new Date(a+"T12:00:00"),y=new Date(b+"T12:00:00");return Math.round((y-x)/86400000)}
function debtTypeLabel(t){return t==="loan"?"금융기관 대출":t==="personal"?"개인 채무":"기타 채무"}
function assetTypeLabel(t){return ({bank:"은행 계좌",cash:"현금",saving:"예금 / 적금",investment:"투자",other:"기타 자산"})[t]||"기타 자산"}
function kindLabel(k){return k==="fixed"?"정기 지출":k==="salary"?"정기 수입":k==="card"?"카드 결제일":"채무 상환"}
function kindBadge(k){return k==="fixed"?"red":k==="salary"?"blue":k==="card"?"gold":"green"}
function modeLabel(m){return m==="fixed"?"금액 고정":m==="pending"?"입력 대기":"알림만"}
function totalDebt(){return debts.reduce((s,d)=>s+Math.max(0,Number(d.remaining)||0),0)}
function totalAssets(){return assets.reduce((s,a)=>s+Math.max(0,Number(a.balance)||0),0)}
function save(markChanged=true){
  localStorage.setItem(KEYS.tx,JSON.stringify(transactions));localStorage.setItem(KEYS.debts,JSON.stringify(debts));localStorage.setItem(KEYS.auto,JSON.stringify(rules));localStorage.setItem(KEYS.pending,JSON.stringify(pending));localStorage.setItem(KEYS.assets,JSON.stringify(assets));
  if(markChanged){localStorage.setItem(KEYS.localUpdated,new Date().toISOString());scheduleCloudPush();}
}

function normalizeData(){
  rules=rules.map(r=>{if(r.mode)return r;let mode="pending";if(r.kind==="card")mode="reminder";else if(r.kind==="debt")mode="pending";else if(r.autoCreate&&Number(r.amount)>0)mode="fixed";return {...r,mode,active:r.active!==false}});
  pending=pending.filter(p=>p&&p.ruleId&&p.month);
  assets=assets.map(a=>({...a,balance:Math.max(0,Number(a.balance)||0)}));
  save(false);
}
normalizeData();

$("date").value=today;$("monthFilter").value=thisMonth;$("dashMonthInput").value=thisMonth;$("automationStartMonth").value=thisMonth;$("autoLockMinutes").value=localStorage.getItem(KEYS.lock)||"0";
for(let i=1;i<=31;i++)$("automationDay").insertAdjacentHTML("beforeend",`<option value="${i}">${i}일</option>`);

function refreshCats(){const a=C[type()];$("category").innerHTML=a.map(x=>`<option>${x}</option>`).join("")}
document.querySelectorAll('input[name="type"]').forEach(x=>x.onchange=refreshCats);refreshCats();

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>goTab(b.dataset.tab));
document.querySelectorAll("[data-go-tab]").forEach(b=>b.onclick=()=>goTab(b.dataset.goTab));
function goTab(id){document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));document.querySelectorAll(".page").forEach(x=>x.classList.toggle("active",x.id===id))}

function refreshAutomationForm(){
  const k=$("automationKind").value;
  if(k==="card")$("automationMode").value="reminder";
  if(k==="debt"&&$("automationMode").value==="fixed"){};
  const mode=$("automationMode").value;
  [...$("automationMode").options].forEach(o=>o.disabled=false);
  if(k==="card"){[...$("automationMode").options].forEach(o=>o.disabled=o.value!=="reminder");$("automationMode").value="reminder"}
  const actualMode=$("automationMode").value;
  const showAmount=actualMode==="fixed" || (k==="debt"&&actualMode==="pending");
  $("automationAmountWrap").classList.toggle("hidden",!showAmount);
  $("automationAmountLabel").firstChild.textContent=k==="debt"&&actualMode==="pending"?"예상 상환액 (선택)":"고정 금액";
  $("automationAmountNote").textContent=k==="debt"&&actualMode==="pending"?"비워두면 예정일에 실제 상환액을 직접 입력합니다.":actualMode==="fixed"&&k==="debt"?"예정금액을 미리 채워두지만 실제 상환은 직접 확정해야 합니다.":"";
  $("automationCategoryWrap").classList.toggle("hidden",k==="card"||k==="debt"||actualMode==="reminder");
  $("automationPaymentWrap").classList.toggle("hidden",k==="card"||k==="debt"||actualMode==="reminder");
  $("automationDebtWrap").classList.toggle("hidden",k!=="debt");
  const isSalary=k==="salary";$("automationCategory").innerHTML=(isSalary?C.income:C.expense).filter(x=>x!=="대출상환").map(x=>`<option>${x}</option>`).join("");
  if(isSalary)$("automationCategory").value="급여";else if(C.expense.includes("고정비"))$("automationCategory").value="고정비";
  $("automationDebt").innerHTML=debts.filter(d=>Number(d.remaining)>0).length?debts.filter(d=>Number(d.remaining)>0).map(d=>`<option value="${d.id}">${esc(d.creditor)} · ${esc(d.name)} · 잔여 ${won(d.remaining)}</option>`).join(""):'<option value="">상환할 채무가 없습니다</option>';
}
$("automationKind").onchange=refreshAutomationForm;$("automationMode").onchange=refreshAutomationForm;

function renderSummary(m){
  const a=monthData(m),inc=a.filter(t=>t.type==="income").reduce((s,t)=>s+Number(t.amount),0),exp=a.filter(t=>t.type==="expense").reduce((s,t)=>s+Number(t.amount),0),debt=totalDebt(),asset=totalAssets();
  $("incomeTotal").textContent=won(inc);$("expenseTotal").textContent=won(exp);$("balanceTotal").textContent=won(inc-exp);$("debtTotal").textContent=won(debt);$("dashMonth").textContent=m.slice(0,4)+"년 "+Number(m.slice(5))+"월";
  $("dashAssetsTotal").textContent=won(asset);$("dashLiabilitiesTotal").textContent=won(debt);$("dashNetWorth").textContent=won(asset-debt);
}
function renderDashboard(){
  const m=$("dashMonthInput").value,a=monthData(m),ex=a.filter(t=>t.type==="expense");renderSummary(m);
  const map={};ex.forEach(t=>map[t.category]=(map[t.category]||0)+Number(t.amount));const entries=Object.entries(map).sort((a,b)=>b[1]-a[1]),max=entries[0]?.[1]||1;
  $("categoryEmpty").style.display=entries.length?"none":"block";$("categoryBars").innerHTML=entries.map(([k,v])=>`<div class="bar-row"><span>${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${v/max*100}%"></div></div><span class="bar-money">${won(v)}</span></div>`).join("");
  const recent=[...a].sort((x,y)=>String(y.date).localeCompare(String(x.date))||Number(y.createdAt)-Number(x.createdAt)).slice(0,6);$("recentEmpty").style.display=recent.length?"none":"block";$("recentList").innerHTML=recent.map(t=>`<div class="recent-item"><div><b>${esc(t.description)}</b><div class="meta">${t.date} · ${esc(t.category)}</div></div><span class="money ${t.type}">${t.type==="income"?"+":"-"}${won(t.amount)}</span></div>`).join("");
  renderPending();renderUpcoming();
}

function getFilteredTransactions(){
  const allMonths=$('allMonthsFilter').checked,m=$('monthFilter').value,tf=$('typeFilter').value,cf=$('categoryFilter').value,pf=$('paymentFilter').value;
  const q=$('searchFilter').value.trim().toLowerCase(),minRaw=$('minAmountFilter').value,maxRaw=$('maxAmountFilter').value;
  const min=minRaw===''?null:Number(minRaw),max=maxRaw===''?null:Number(maxRaw);
  return transactions.filter(t=>allMonths||ym(t.date)===m)
    .filter(t=>tf==='all'||t.type===tf)
    .filter(t=>cf==='all'||t.category===cf)
    .filter(t=>pf==='all'||(t.payment||'')===pf)
    .filter(t=>min===null||Number(t.amount)>=min)
    .filter(t=>max===null||Number(t.amount)<=max)
    .filter(t=>!q||[t.description,t.category,t.payment,t.date].some(v=>String(v||'').toLowerCase().includes(q)))
    .sort((x,y)=>String(y.date).localeCompare(String(x.date))||Number(y.createdAt)-Number(x.createdAt));
}
function renderTransactions(){
  const allMonths=$('allMonthsFilter').checked,m=$('monthFilter').value,old=$('categoryFilter').value;
  const base=allMonths?transactions:monthData(m),cats=[...new Set(base.map(t=>t.category).filter(Boolean))].sort();
  $('categoryFilter').innerHTML='<option value="all">카테고리 전체</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join('');if(cats.includes(old))$('categoryFilter').value=old;
  $('monthFilter').disabled=allMonths;
  currentFilteredTransactions=getFilteredTransactions();
  $('monthLabel').innerHTML=(allMonths?'전체 기간':m.slice(0,4)+'년 '+Number(m.slice(5))+'월')+` · <span class="search-count">${currentFilteredTransactions.length}건</span>`;
  $('empty').style.display=currentFilteredTransactions.length?'none':'block';
  $('transactionList').innerHTML=currentFilteredTransactions.map(t=>`<div class="transaction"><div class="date-text">${String(t.date).slice(5).replace('-','.')}</div><div><div class="desc">${esc(t.description)}</div><div class="meta">${esc(t.category)} · ${esc(t.payment||'')}${t.automationRuleId?' · 자동화':''}${t.debtId?' · 채무연결':''}</div></div><div class="money ${t.type}">${t.type==='income'?'+':'-'}${won(t.amount)}</div><div class="tx-actions">${t.debtId?'':`<button class="tx-action" onclick="editTransaction('${t.id}')">수정</button>`}<button class="delete" onclick="removeTransaction('${t.id}')">×</button></div></div>`).join('');
}
window.editTransaction=id=>{
  const t=transactions.find(x=>x.id===id);if(!t)return;if(t.debtId)return alert('채무 상환 거래는 금액 연결 때문에 직접 수정하지 않습니다. 삭제 후 부채 관리에서 다시 상환 등록해주세요.');
  editingTransactionId=id;document.querySelector(`input[name="type"][value="${t.type}"]`).checked=true;refreshCats();
  if(![...$('category').options].some(o=>o.value===t.category))$('category').insertAdjacentHTML('beforeend',`<option>${esc(t.category)}</option>`);
  $('date').value=t.date;$('category').value=t.category;$('description').value=t.description;$('amount').value=t.amount;$('payment').value=t.payment||'기타';
  $('transactionSubmitBtn').textContent='수정 저장';$('transactionCancelEditBtn').classList.remove('hidden');goTab('transactions');$('description').focus();
};
function cancelTransactionEdit(){editingTransactionId=null;$('transactionForm').reset();document.querySelector('input[name="type"][value="expense"]').checked=true;$('date').value=today;refreshCats();$('transactionSubmitBtn').textContent='거래 추가';$('transactionCancelEditBtn').classList.add('hidden')}
$('transactionCancelEditBtn').onclick=cancelTransactionEdit;
window.removeTransaction=id=>{const t=transactions.find(x=>x.id===id);if(!t)return;if(!confirm(t.debtId?'이 상환 거래를 삭제하면 해당 금액만큼 채무 잔액도 되돌립니다. 삭제할까요?':'이 거래를 삭제할까요?'))return;
  if(t.debtId){const d=debts.find(x=>x.id===t.debtId);if(d){d.remaining=Math.min(Number(d.principal)||0,Number(d.remaining||0)+Number(t.amount||0));d.repaid=Math.max(0,Number(d.repaid||0)-Number(t.amount||0));}if(t.pendingId){const p=pending.find(x=>x.id===t.pendingId);if(p){p.status='pending';delete p.transactionId;delete p.actualAmount;delete p.completedAt;}}}
  transactions=transactions.filter(x=>x.id!==id);if(editingTransactionId===id)cancelTransactionEdit();save();renderAll();
};
$('transactionForm').onsubmit=e=>{e.preventDefault();const payload={type:type(),date:$('date').value,category:$('category').value,description:$('description').value.trim(),amount:Number($('amount').value),payment:$('payment').value};
  if(!payload.amount||payload.amount<=0)return alert('금액을 입력해주세요.');
  if(editingTransactionId){const t=transactions.find(x=>x.id===editingTransactionId);if(t)Object.assign(t,payload,{updatedAt:Date.now()});cancelTransactionEdit();}
  else{transactions.push({id:uid(),createdAt:Date.now(),...payload});e.target.reset();$('date').value=today;refreshCats();}
  save();renderAll();
};

$("debtForm").onsubmit=e=>{e.preventDefault();const p=Number($("principal").value);debts.push({id:uid(),type:$("debtType").value,creditor:$("creditor").value.trim(),name:$("debtName").value.trim(),principal:p,remaining:p,repaid:0,memo:$("debtMemo").value.trim()});save();e.target.reset();refreshAutomationForm();renderAll();alert("채무가 등록되었습니다.")};
function createDebtRepayment(d,amount,date,sourceRuleId=null,pendingId=null){const v=Math.min(Number(amount),Number(d.remaining));if(!v||v<=0)return null;d.remaining-=v;d.repaid=Number(d.repaid||0)+v;const tr={id:uid(),createdAt:Date.now(),type:"expense",date,category:"대출상환",description:`${d.creditor} - ${d.name} 상환`,amount:v,payment:"계좌이체",debtId:d.id,automationRuleId:sourceRuleId||undefined,pendingId:pendingId||undefined};transactions.push(tr);return tr}
window.repayDebt=id=>{const d=debts.find(x=>x.id===id),input=document.querySelector(`[data-repay="${id}"]`),v=Number(input.value);if(!v||v<=0)return alert("상환 금액을 입력해주세요.");if(v>d.remaining)return alert("남은 채무보다 많이 상환할 수 없습니다.");createDebtRepayment(d,v,today);save();renderAll()};
window.deleteDebt=id=>{if(confirm("이 채무를 삭제할까요? 기존 상환 거래는 유지됩니다.")){debts=debts.filter(d=>d.id!==id);rules=rules.filter(r=>r.debtId!==id);pending=pending.filter(p=>p.debtId!==id||p.status!=="pending");save();refreshAutomationForm();renderAll()}};
function renderDebts(){
  $("allDebtTotal").textContent=won(totalDebt());$("debtTotal").textContent=won(totalDebt());$("debtEmpty").style.display=debts.length?"none":"block";
  $("debtList").innerHTML=debts.map(d=>{const pct=d.principal?Math.min(100,Number(d.repaid||0)/Number(d.principal)*100):100;return `<div class="debt-card"><div class="debt-top"><div><span class="badge">${debtTypeLabel(d.type)}</span><div class="debt-name">${esc(d.name)}</div><div class="creditor">${esc(d.creditor)}${d.memo?" · "+esc(d.memo):""}</div></div><button class="delete" onclick="deleteDebt('${d.id}')">×</button></div><div class="debt-progress"><div style="width:${pct}%"></div></div><div class="debt-numbers"><span>남은 원금 <b>${won(d.remaining)}</b></span><span>상환 ${pct.toFixed(0)}%</span></div>${Number(d.remaining)>0?`<div class="repay"><input data-repay="${d.id}" type="number" min="1" max="${d.remaining}" placeholder="상환 금액"><button onclick="repayDebt('${d.id}')">상환 등록</button></div>`:`<div class="paid">✓ 전액 상환 완료</div>`}</div>`}).join("");
}

$("automationForm").onsubmit=e=>{
  e.preventDefault();const kind=$("automationKind").value,mode=$("automationMode").value;let amount=(mode==="fixed"||(kind==="debt"&&mode==="pending"))?(Number($("automationAmount").value)||0):0;
  if(kind==="card"&&mode!=="reminder")return alert("카드 결제일은 알림만 사용할 수 있습니다.");
  if(mode==="fixed"&&amount<=0)return alert("고정 금액을 입력해주세요.");
  if(kind==="debt"&&!$("automationDebt").value)return alert("연결할 채무를 먼저 등록해주세요.");
  rules.push({id:uid(),kind,mode,name:$("automationName").value.trim(),amount,category:(kind==="card"||kind==="debt"||mode==="reminder")?"":$("automationCategory").value,payment:(kind==="card"||kind==="debt"||mode==="reminder")?"":$("automationPayment").value,debtId:kind==="debt"?$("automationDebt").value:null,day:Number($("automationDay").value),startMonth:$("automationStartMonth").value,memo:$("automationMemo").value.trim(),active:true,createdAt:Date.now()});
  save();e.target.reset();$("automationKind").value="fixed";$("automationMode").value="fixed";$("automationStartMonth").value=thisMonth;refreshAutomationForm();runAutomation(false);renderAll();
};
function autoTransactionExists(rule,month){return transactions.some(t=>t.automationRuleId===rule.id&&ym(t.date)===month)}
function pendingFor(rule,month){return pending.find(p=>p.ruleId===rule.id&&p.month===month)}
function createPending(rule,month){
  if(pendingFor(rule,month))return false;const due=scheduledDate(rule,month),d=rule.debtId?debts.find(x=>x.id===rule.debtId):null;
  pending.push({id:uid(),ruleId:rule.id,month,dueDate:due,name:rule.name,kind:rule.kind,debtId:rule.debtId||null,status:"pending",suggestedAmount:Number(rule.amount)||0,createdAt:Date.now(),category:rule.category||"",payment:rule.payment||""});return true;
}
function runAutomation(showMessage=false){
  let autoAdded=0,pendingAdded=0;const month=today.slice(0,7);
  rules.forEach(r=>{if(!r.active||month<r.startMonth)return;const due=scheduledDate(r,month);if(due>today)return;
    if(r.kind==="card"||r.mode==="reminder")return;
    if(r.kind==="debt"){if(createPending(r,month))pendingAdded++;return;}
    if(r.mode==="fixed"){if(!autoTransactionExists(r,month)){transactions.push({id:uid(),createdAt:Date.now(),type:r.kind==="salary"?"income":"expense",date:due,category:r.category|| (r.kind==="salary"?"급여":"고정비"),description:r.name,amount:Number(r.amount),payment:r.payment||"계좌이체",automationRuleId:r.id});autoAdded++;}return;}
    if(r.mode==="pending"&&createPending(r,month))pendingAdded++;
  });
  if(autoAdded||pendingAdded){save();renderAll()}
  if(showMessage)alert(`자동 등록 ${autoAdded}건 · 입력 대기 ${pendingAdded}건을 새로 확인했습니다.`);
}
$("runAutomationBtn").onclick=()=>runAutomation(true);

function renderAutomation(){
  $("automationEmpty").style.display=rules.length?"none":"block";
  $("automationList").innerHTML=rules.map(r=>{const d=r.debtId?debts.find(x=>x.id===r.debtId):null,status=r.active?"사용 중":"일시정지";let detail="";
    if(r.kind==="debt")detail=d?`${esc(d.creditor)} · ${esc(d.name)} · ${r.amount?"예정 "+won(r.amount):"금액 직접 입력"}`:"연결 채무 없음";
    else if(r.kind==="card")detail=`매월 ${r.day}일 · 알림만`;
    else if(r.mode==="reminder")detail=`매월 ${r.day}일 · 거래 생성 안 함`;
    else detail=`${esc(r.category||"")} · ${esc(r.payment||"")} · 매월 ${r.day}일${r.mode==="fixed"?" · "+won(r.amount):""}`;
    const manual=(r.kind==="debt"||r.mode==="pending")?`<button class="primary-small" onclick="makePendingNow('${r.id}')">이번 달 입력 대기</button>`:r.mode==="fixed"?`<button class="primary-small" onclick="manualCreateRule('${r.id}')">이번 달 등록</button>`:"";
    return `<div class="automation-item"><div class="automation-top"><div><span class="badge ${kindBadge(r.kind)}">${kindLabel(r.kind)}</span> <span class="mode-pill ${r.mode}">${modeLabel(r.mode)}</span><div class="automation-title">${esc(r.name)}</div><div class="automation-details">${detail}<br>시작 ${r.startMonth}${r.memo?` · ${esc(r.memo)}`:""} · ${status}</div></div><button class="delete" onclick="deleteRule('${r.id}')">×</button></div><div class="automation-actions">${manual}<button onclick="toggleRule('${r.id}')">${r.active?"일시정지":"다시 사용"}</button></div></div>`;
  }).join("");
}
window.manualCreateRule=id=>{const r=rules.find(x=>x.id===id);if(!r)return;const month=$("dashMonthInput").value||thisMonth;if(month<r.startMonth)return alert("시작 월보다 이전 달입니다.");if(autoTransactionExists(r,month))return alert("해당 월에 이미 이 자동화 거래가 있습니다.");const due=scheduledDate(r,month);transactions.push({id:uid(),createdAt:Date.now(),type:r.kind==="salary"?"income":"expense",date:due,category:r.category,description:r.name,amount:Number(r.amount),payment:r.payment||"계좌이체",automationRuleId:r.id});save();renderAll();alert("거래내역에 등록했습니다.")};
window.makePendingNow=id=>{const r=rules.find(x=>x.id===id);if(!r)return;const month=$("dashMonthInput").value||thisMonth;if(month<r.startMonth)return alert("시작 월보다 이전 달입니다.");if(pendingFor(r,month))return alert("해당 월 입력 대기 상태가 이미 있습니다.");createPending(r,month);save();renderAll();alert("입력 대기에 추가했습니다.")};
window.toggleRule=id=>{const r=rules.find(x=>x.id===id);if(r){r.active=!r.active;save();renderAll()}};
window.deleteRule=id=>{if(confirm("이 자동화 일정을 삭제할까요? 이미 생성된 거래는 유지됩니다.")){rules=rules.filter(x=>x.id!==id);pending=pending.filter(p=>p.ruleId!==id||p.status!=="pending");save();renderAll()}};

function renderPending(){
  const list=pending.filter(p=>p.status==="pending").sort((a,b)=>a.dueDate.localeCompare(b.dueDate));$("pendingCount").textContent=`${list.length}건`;$("pendingEmpty").style.display=list.length?"none":"block";
  $("pendingList").innerHTML=list.map(p=>{const r=rules.find(x=>x.id===p.ruleId),d=p.debtId?debts.find(x=>x.id===p.debtId):null;const kind=p.kind==="salary"?"수입":p.kind==="debt"?"채무 상환":"지출";const pre=p.suggestedAmount?`value="${Number(p.suggestedAmount)}"`:"";const meta=p.kind==="debt"&&d?`${esc(d.creditor)} · 잔여 ${won(d.remaining)}`:`${p.dueDate} · ${kind}`;
    return `<div class="pending-item"><div><div class="pending-title">${esc(p.name)}</div><div class="pending-meta">${meta}</div>${p.suggestedAmount?`<div class="pending-prefill">예정금액 ${won(p.suggestedAmount)} · 실제 금액으로 수정 가능</div>`:""}</div><input id="pending-amount-${p.id}" type="number" min="1" step="1" placeholder="실제 금액 입력" ${pre}><div class="pending-actions"><button class="confirm" onclick="confirmPending('${p.id}')">확정</button><button onclick="skipPending('${p.id}')">이번 달 건너뜀</button></div></div>`;
  }).join("");
}
window.confirmPending=id=>{const p=pending.find(x=>x.id===id);if(!p)return;const r=rules.find(x=>x.id===p.ruleId),amount=Number($("pending-amount-"+id).value);if(!amount||amount<=0)return alert("실제 금액을 입력해주세요.");
  if(p.kind==="debt"){const d=debts.find(x=>x.id===p.debtId);if(!d)return alert("연결된 채무를 찾을 수 없습니다.");if(amount>d.remaining)return alert("남은 원금보다 많이 상환할 수 없습니다.");const tr=createDebtRepayment(d,amount,p.dueDate,p.ruleId,p.id);p.transactionId=tr.id;}
  else {const tr={id:uid(),createdAt:Date.now(),type:p.kind==="salary"?"income":"expense",date:p.dueDate,category:p.category||(p.kind==="salary"?"급여":"기타"),description:p.name,amount,payment:p.payment||"계좌이체",automationRuleId:p.ruleId,pendingId:p.id};transactions.push(tr);p.transactionId=tr.id;}
  p.status="completed";p.actualAmount=amount;p.completedAt=Date.now();save();renderAll();
};
window.skipPending=id=>{const p=pending.find(x=>x.id===id);if(!p)return;if(confirm("이번 달 항목을 건너뛸까요? 다음 달 일정은 그대로 유지됩니다.")){p.status="skipped";p.completedAt=Date.now();save();renderAll()}};

function renderUpcoming(){
  const items=[];for(let offset=0;offset<=14;offset++){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+offset);const ds=localDateString(d),m=ds.slice(0,7);rules.filter(r=>r.active&&m>=r.startMonth&&scheduledDate(r,m)===ds).forEach(r=>items.push({r,date:ds,offset}))}
  $("upcomingEmpty").style.display=items.length?"none":"block";$("upcomingList").innerHTML=items.map(({r,date,offset})=>{const d=r.debtId?debts.find(x=>x.id===r.debtId):null,when=offset===0?"오늘":offset===1?"내일":`${offset}일 후`;let meta="";
    if(r.kind==="card")meta="결제일 알림";else if(r.kind==="debt")meta=d?`${esc(d.creditor)} · ${r.amount?"예정 "+won(Math.min(r.amount,d.remaining)):"금액 입력 대기"}`:"연결 채무 없음";else if(r.mode==="fixed")meta=`${esc(r.category)} · ${won(r.amount)} 자동등록`;else if(r.mode==="pending")meta=`${esc(r.category)} · 금액 입력 대기`;else meta="알림만";
    const done=(r.mode==="fixed"&&r.kind!=="debt")&&autoTransactionExists(r,date.slice(0,7));return `<div class="upcoming-item"><div><span class="badge ${kindBadge(r.kind)}">${kindLabel(r.kind)}</span><div class="upcoming-name">${esc(r.name)}</div><div class="upcoming-meta">${meta}${done?" · 등록 완료":""}</div></div><div class="upcoming-right"><div class="upcoming-date">${date.slice(5).replace("-",".")}</div><div class="meta">${when}</div></div></div>`}).join("");
}

$("assetForm").onsubmit=e=>{e.preventDefault();assets.push({id:uid(),type:$("assetType").value,institution:$("assetInstitution").value.trim(),name:$("assetName").value.trim(),balance:Math.max(0,Number($("assetBalance").value)||0),memo:$("assetMemo").value.trim(),updatedAt:Date.now()});save();e.target.reset();renderAll()};
window.updateAsset=id=>{const a=assets.find(x=>x.id===id),input=document.querySelector(`[data-asset-balance="${id}"]`);if(!a||!input)return;const value=Number(input.value);if(value<0||!Number.isFinite(value))return alert("0원 이상의 금액을 입력해주세요.");a.balance=value;a.updatedAt=Date.now();save();renderAll()};
window.deleteAsset=id=>{if(confirm("이 자산을 삭제할까요?")){assets=assets.filter(a=>a.id!==id);save();renderAll()}};
function renderAssets(){
  const asset=totalAssets(),debt=totalDebt();$("assetTotal").textContent=won(asset);$("assetDebtTotal").textContent=won(debt);$("netWorthTotal").textContent=won(asset-debt);$("assetListTotal").textContent=won(asset);$("assetEmpty").style.display=assets.length?"none":"block";
  const types=["bank","cash","saving","investment","other"];$("assetBreakdown").innerHTML=types.map(t=>{const v=assets.filter(a=>a.type===t).reduce((s,a)=>s+Number(a.balance),0);return `<div class="asset-mini"><span>${assetTypeLabel(t)}</span><b>${won(v)}</b></div>`}).join("");
  $("assetList").innerHTML=[...assets].sort((a,b)=>Number(b.balance)-Number(a.balance)).map(a=>`<div class="asset-card"><div class="asset-card-top"><div><span class="badge">${assetTypeLabel(a.type)}</span><div class="asset-name">${esc(a.name)}</div><div class="asset-place">${esc(a.institution||"보관처 미입력")}${a.memo?" · "+esc(a.memo):""}</div></div><div><div class="asset-value">${won(a.balance)}</div><div class="asset-updated">최근 수정 ${a.updatedAt?new Date(a.updatedAt).toLocaleDateString("ko-KR"):"-"}</div></div></div><div class="asset-edit"><input data-asset-balance="${a.id}" type="number" min="0" step="1" value="${Number(a.balance)}"><div class="pending-actions"><button class="save" onclick="updateAsset('${a.id}')">금액 수정</button><button class="mini-danger" onclick="deleteAsset('${a.id}')">삭제</button></div></div></div>`).join("");
}

$('monthFilter').onchange=renderTransactions;$('typeFilter').onchange=renderTransactions;$('categoryFilter').onchange=renderTransactions;$('paymentFilter').onchange=renderTransactions;$('allMonthsFilter').onchange=renderTransactions;$('searchFilter').oninput=renderTransactions;$('minAmountFilter').oninput=renderTransactions;$('maxAmountFilter').oninput=renderTransactions;$('dashMonthInput').onchange=renderDashboard;
$('resetTransactionFiltersBtn').onclick=()=>{$('searchFilter').value='';$('allMonthsFilter').checked=false;$('monthFilter').value=thisMonth;$('typeFilter').value='all';$('categoryFilter').value='all';$('paymentFilter').value='all';$('minAmountFilter').value='';$('maxAmountFilter').value='';renderTransactions()};


function csvCell(v){const x=String(v??'').replace(/"/g,'""');return `"${x}"`}
function exportTransactionsCsv(list,label){
  if(!list.length)return alert('내보낼 거래내역이 없습니다.');
  const header=['날짜','구분','카테고리','내용','금액','결제수단','자동화','채무연결'];
  const rows=list.map(t=>[t.date,t.type==='income'?'수입':'지출',t.category,t.description,Number(t.amount),t.payment||'',t.automationRuleId?'예':'아니오',t.debtId?'예':'아니오']);
  const csv='\ufeff'+[header,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`household-budget-${label}-${today}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
$('exportFilteredCsvBtn').onclick=()=>exportTransactionsCsv(currentFilteredTransactions,'filtered');
$('exportAllCsvBtn').onclick=()=>exportTransactionsCsv([...transactions].sort((a,b)=>String(b.date).localeCompare(String(a.date))),'all');

function cloudConfigReady(){return !!(CLOUD_CONFIG.url&&CLOUD_CONFIG.key&&window.supabase?.createClient)}
function setCloudUi(state,message=''){
  const badge=$('cloudStatusBadge'),head=$('cloudHeaderStatus');badge.className='cloud-status '+state;head.className='sync-chip '+(state==='on'?'online':state==='wait'?'wait':state==='error'?'error':'local');
  const text=state==='on'?'동기화 연결':state==='wait'?'동기화 중':state==='error'?'동기화 오류':'연결 전';badge.textContent=text;head.textContent=state==='on'?'클라우드 동기화':state==='wait'?'동기화 중':state==='error'?'동기화 오류':'로컬 저장';
  if(message){$('cloudUserInfo').textContent=message;$('cloudUserInfo').classList.remove('hidden');}
}
function cloudSnapshot(){return {schemaVersion:6,updatedAt:new Date().toISOString(),sourceDevice:DEVICE_ID,transactions,debts,automationRules:rules,pendingEntries:pending,assets}}
function hasLocalData(){return transactions.length||debts.length||rules.length||pending.length||assets.length}
function applyCloudSnapshot(data){
  if(!data||typeof data!=='object')return;cloudApplying=true;
  transactions=Array.isArray(data.transactions)?data.transactions:[];debts=Array.isArray(data.debts)?data.debts:[];rules=Array.isArray(data.automationRules)?data.automationRules:[];pending=Array.isArray(data.pendingEntries)?data.pendingEntries:[];assets=Array.isArray(data.assets)?data.assets:[];
  normalizeData();localStorage.setItem(KEYS.localUpdated,data.updatedAt||new Date().toISOString());cloudApplying=false;refreshAutomationForm();renderAll();
}
function scheduleCloudPush(){if(cloudApplying||!cloudUser||!$('cloudAutoSync')?.checked)return;clearTimeout(cloudPushTimer);cloudPushTimer=setTimeout(()=>pushCloud(false),700)}
async function pushCloud(show=true){
  if(!cloudClient||!cloudUser)return show&&alert('먼저 클라우드 계정으로 로그인해주세요.');setCloudUi('wait');
  const snap=cloudSnapshot();const {error}=await cloudClient.from('household_budget_data').upsert({user_id:cloudUser.id,data:snap,updated_at:snap.updatedAt},{onConflict:'user_id'});
  if(error){setCloudUi('error',error.message);if(show)alert('클라우드 업로드 실패: '+error.message);return false;}localStorage.setItem(KEYS.localUpdated,snap.updatedAt);setCloudUi('on',`${cloudUser.email} · 마지막 업로드 ${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}`);if(show)alert('이 기기 데이터를 클라우드에 저장했습니다.');return true;
}
async function pullCloud(show=true){
  if(!cloudClient||!cloudUser)return show&&alert('먼저 클라우드 계정으로 로그인해주세요.');setCloudUi('wait');const {data,error}=await cloudClient.from('household_budget_data').select('data,updated_at').eq('user_id',cloudUser.id).maybeSingle();
  if(error){setCloudUi('error',error.message);if(show)alert('클라우드 불러오기 실패: '+error.message);return false;}if(!data?.data){setCloudUi('on',`${cloudUser.email} · 클라우드 데이터 없음`);if(show)alert('클라우드에 저장된 가계부가 아직 없습니다.');return false;}applyCloudSnapshot(data.data);setCloudUi('on',`${cloudUser.email} · 클라우드 데이터 적용됨`);if(show)alert('클라우드 데이터를 이 기기에 적용했습니다.');return true;
}
async function smartInitialSync(){
  if(!cloudClient||!cloudUser||!$('cloudAutoSync').checked)return;const {data,error}=await cloudClient.from('household_budget_data').select('data,updated_at').eq('user_id',cloudUser.id).maybeSingle();if(error)return setCloudUi('error',error.message);
  if(!data?.data){if(hasLocalData())await pushCloud(false);else setCloudUi('on',`${cloudUser.email} · 동기화 준비됨`);return;}
  const cloudTime=Date.parse(data.data.updatedAt||data.updated_at||0)||0,localTime=Date.parse(localStorage.getItem(KEYS.localUpdated)||0)||0;
  if(!hasLocalData()||cloudTime>localTime)applyCloudSnapshot(data.data);else if(localTime>cloudTime)await pushCloud(false);setCloudUi('on',`${cloudUser.email} · 자동 동기화 중`);
}
function subscribeCloud(){
  if(!cloudClient||!cloudUser)return;if(cloudChannel)cloudClient.removeChannel(cloudChannel);
  cloudChannel=cloudClient.channel('household-budget-'+cloudUser.id).on('postgres_changes',{event:'*',schema:'public',table:'household_budget_data',filter:`user_id=eq.${cloudUser.id}`},payload=>{const data=payload.new?.data;if(!$('cloudAutoSync').checked||!data||data.sourceDevice===DEVICE_ID)return;const remote=Date.parse(data.updatedAt||0)||0,local=Date.parse(localStorage.getItem(KEYS.localUpdated)||0)||0;if(remote>=local){applyCloudSnapshot(data);setCloudUi('on',`${cloudUser.email} · 다른 기기 변경 반영됨`);}}).subscribe();
}
async function onCloudUser(user){
  cloudUser=user||null;const signed=!!cloudUser;$('cloudLoginBtn').classList.toggle('hidden',signed);$('cloudSignUpBtn').classList.toggle('hidden',signed);$('cloudLogoutBtn').classList.toggle('hidden',!signed);$('cloudPushBtn').disabled=!signed;$('cloudPullBtn').disabled=!signed;
  if(!signed){setCloudUi('off');$('cloudUserInfo').classList.add('hidden');return;}setCloudUi('on',`${cloudUser.email} 로그인됨`);subscribeCloud();await smartInitialSync();
}
async function initCloud(){
  $('cloudAutoSync').checked=localStorage.getItem(KEYS.cloudAuto)!=='0';
  if(!cloudConfigReady()){$('cloudConfigNotice').classList.remove('hidden');setCloudUi('off','cloud-config.js 설정 후 계정 동기화를 사용할 수 있습니다.');return;}
  $('cloudConfigNotice').classList.add('hidden');cloudClient=window.supabase.createClient(CLOUD_CONFIG.url,CLOUD_CONFIG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data}=await cloudClient.auth.getSession();await onCloudUser(data.session?.user||null);cloudClient.auth.onAuthStateChange((_event,session)=>onCloudUser(session?.user||null));
}
$('cloudAutoSync').onchange=()=>{localStorage.setItem(KEYS.cloudAuto,$('cloudAutoSync').checked?'1':'0');if($('cloudAutoSync').checked)smartInitialSync()};
$('cloudSignUpBtn').onclick=async()=>{if(!cloudClient)return alert('먼저 cloud-config.js 연결 설정이 필요합니다.');const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<6)return alert('이메일과 6자리 이상의 비밀번호를 입력해주세요.');setCloudUi('wait');const {data,error}=await cloudClient.auth.signUp({email,password});if(error)return setCloudUi('error',error.message),alert(error.message);if(data.session)await onCloudUser(data.user);else setCloudUi('wait','가입 확인 메일이 발송되었습니다. 메일 확인 후 로그인해주세요.')};
$('cloudLoginBtn').onclick=async()=>{if(!cloudClient)return alert('먼저 cloud-config.js 연결 설정이 필요합니다.');const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||!password)return alert('이메일과 비밀번호를 입력해주세요.');setCloudUi('wait');const {data,error}=await cloudClient.auth.signInWithPassword({email,password});if(error)return setCloudUi('error',error.message),alert('로그인 실패: '+error.message);await onCloudUser(data.user);$('cloudPassword').value=''};
$('cloudLogoutBtn').onclick=async()=>{if(cloudClient)await cloudClient.auth.signOut();if(cloudChannel&&cloudClient)cloudClient.removeChannel(cloudChannel);cloudChannel=null;cloudUser=null;await onCloudUser(null)};
$('cloudPushBtn').onclick=()=>{if(confirm('이 기기의 현재 데이터를 클라우드 데이터로 저장할까요?'))pushCloud(true)};
$('cloudPullBtn').onclick=()=>{if(confirm('클라우드 데이터를 이 기기에 적용할까요? 이 기기의 현재 데이터가 교체될 수 있습니다.'))pullCloud(true)};

async function hashPassword(password,salt){const enc=new TextEncoder(),material=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]),bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:120000,hash:"SHA-256"},material,256);return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function makeSalt(){const b=new Uint8Array(16);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,"0")).join("")}
function hasPassword(){return !!localStorage.getItem(KEYS.pass)}
async function verifyPassword(p){if(!hasPassword())return false;return await hashPassword(p,localStorage.getItem(KEYS.salt)||"")===localStorage.getItem(KEYS.pass)}
function showLock(msg="비밀번호를 입력하세요."){if(!hasPassword())return;$("lockMessage").textContent=msg;$("unlockPassword").value="";$("lockScreen").classList.remove("hidden");$("unlockPassword").focus()}
function hideLock(){$("lockScreen").classList.add("hidden");resetInactivity()}
$("unlockBtn").onclick=async()=>{if(await verifyPassword($("unlockPassword").value))hideLock();else $("lockMessage").textContent="비밀번호가 맞지 않습니다."};$("unlockPassword").onkeydown=e=>{if(e.key==="Enter")$("unlockBtn").click()};$("lockNowBtn").onclick=()=>{if(hasPassword())showLock();else{goTab("settings");alert("먼저 비밀번호를 설정해주세요.")}};
$("changePasswordBtn").onclick=async()=>{const cur=$("currentPassword").value,n=$("newPassword").value,c=$("confirmPassword").value;if(n.length<4)return alert("새 비밀번호는 4자리 이상으로 입력해주세요.");if(n!==c)return alert("새 비밀번호 확인이 일치하지 않습니다.");if(hasPassword()&&!(await verifyPassword(cur)))return alert("현재 비밀번호가 맞지 않습니다.");const s=makeSalt();localStorage.setItem(KEYS.salt,s);localStorage.setItem(KEYS.pass,await hashPassword(n,s));$("currentPassword").value=$("newPassword").value=$("confirmPassword").value="";resetInactivity();alert("비밀번호가 저장되었습니다.")};
$("removePasswordBtn").onclick=async()=>{if(!hasPassword())return alert("설정된 비밀번호가 없습니다.");const cur=$("currentPassword").value||prompt("현재 비밀번호를 입력하세요.");if(!(await verifyPassword(cur)))return alert("현재 비밀번호가 맞지 않습니다.");if(!confirm("비밀번호 잠금을 해제할까요?"))return;localStorage.removeItem(KEYS.pass);localStorage.removeItem(KEYS.salt);clearTimeout(inactivityTimer);$("currentPassword").value="";alert("비밀번호가 해제되었습니다.")};
function resetInactivity(){clearTimeout(inactivityTimer);const min=Number(localStorage.getItem(KEYS.lock)||0);if(min>0&&hasPassword())inactivityTimer=setTimeout(()=>showLock("자동 잠금되었습니다."),min*60000)}
["click","keydown","touchstart"].forEach(ev=>document.addEventListener(ev,()=>{if($("lockScreen").classList.contains("hidden"))resetInactivity()},{passive:true}));$("saveAutoLockBtn").onclick=()=>{localStorage.setItem(KEYS.lock,$("autoLockMinutes").value);resetInactivity();alert("자동 잠금 설정을 저장했습니다.")};

$("exportBackupBtn").onclick=()=>{const backup={app:"my-household-budget",version:6,backupDate:new Date().toISOString(),transactions,debts,automationRules:rules,pendingEntries:pending,assets,settings:{autoLockMinutes:localStorage.getItem(KEYS.lock)||"0"}};const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`household-budget-backup-${today}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)};
$("importBackupInput").onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.transactions)||!Array.isArray(data.debts))throw new Error();if(!confirm("현재 데이터를 백업 파일 내용으로 교체할까요?"))return;transactions=data.transactions;debts=data.debts;rules=Array.isArray(data.automationRules)?data.automationRules:[];pending=Array.isArray(data.pendingEntries)?data.pendingEntries:[];assets=Array.isArray(data.assets)?data.assets:[];if(data.settings?.autoLockMinutes!=null)localStorage.setItem(KEYS.lock,String(data.settings.autoLockMinutes));normalizeData();$("autoLockMinutes").value=localStorage.getItem(KEYS.lock)||"0";refreshAutomationForm();runAutomation(false);renderAll();alert("백업을 복원했습니다.")}catch{alert("올바른 가계부 백업 파일이 아닙니다.")}e.target.value=""};
$("resetBtn").onclick=()=>{const text=prompt('거래·채무·자동화·자산 데이터를 모두 삭제하려면 "삭제"라고 입력하세요.');if(text!=="삭제")return;transactions=[];debts=[];rules=[];pending=[];assets=[];save();refreshAutomationForm();renderAll();alert("데이터를 초기화했습니다. 비밀번호 설정은 유지됩니다.")};

$("installBtn").hidden=true;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;$("installBtn").hidden=false});$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").hidden=true}};if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));

function renderAll(){renderSummary($("dashMonthInput").value);renderDashboard();renderTransactions();renderDebts();renderAutomation();renderAssets();refreshAutomationForm()}
refreshAutomationForm();runAutomation(false);renderAll();resetInactivity();initCloud();if(hasPassword())showLock();

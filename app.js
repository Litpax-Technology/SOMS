/* =========================================================
 * Litpax SMS — Application Logic
 * ========================================================= */

const State = {
  user: null,
  config: { lists:{}, settings:{} },
  vendors: [], vendorMaterials: [], items: [], orders: [], orderItems: [], receiving: [], followups: [],
  view: 'dashboard'
};

/* ---------- JSONP ---------- */
function api(params){
  return new Promise((resolve, reject)=>{
    if(!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_') === 0){
      return reject(new Error('API_URL not set in config.js'));
    }
    const cb = 'jsonp_' + Date.now() + '_' + Math.floor(Math.random()*1e5);
    const script = document.createElement('script');
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('Request timed out')); }, CONFIG.REQUEST_TIMEOUT || 30000);
    function cleanup(){ clearTimeout(timer); delete window[cb]; if(script.parentNode) script.parentNode.removeChild(script); }
    window[cb] = (res)=>{ cleanup(); (res && res.ok) ? resolve(res.data) : reject(new Error((res && res.error) || 'Unknown error')); };
    const qs = Object.keys(params).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(params[k])).join('&');
    script.src = CONFIG.API_URL + '?' + qs + '&callback=' + cb;
    script.onerror = ()=>{ cleanup(); reject(new Error('Network error — check deployment access = Anyone')); };
    document.body.appendChild(script);
  });
}

/* ---------- Helpers ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayStr = ()=>{ const d=new Date(); return d.toISOString().slice(0,10); };
const money = n => '₹' + (Number(n)||0).toLocaleString('en-IN');
function vendorName(id){ const v=State.vendors.find(x=>x.VendorID==id); return v?v.Name:id; }
function cfgList(name, fb){ const a=State.config.lists[name]; return (a && a.length)?a:(fb||[]); }
function itemNames(){ const it=State.items||[]; return it.length? it.map(i=>i.Item) : (State.config.lists.MaterialList||[]); }
function catIcon(cat){
  const m={'Cells':'🔋','BMS':'⚡','Charger':'🔌','Nickel/Busbar':'🟠','Box':'📦','IOT':'📡','Inverter':'🔧','Wire':'🧵','Consumables':'🧰','Tools':'🛠️','Packaging':'📦','Casing':'🧱','Hardware':'🔩'};
  return m[cat]||'📦';
}

function toast(msg, type='info'){
  const ic = type==='success'?'✓':type==='error'?'!':'i';
  const el = document.createElement('div');
  el.className = 'toast '+type;
  el.innerHTML = `<span class="t-ic">${ic}</span><span>${esc(msg)}</span>`;
  $('#toastWrap').appendChild(el);
  setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),250); }, 3200);
}

function openModal(title, bodyHTML){
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modalBackdrop').classList.remove('hidden');
}
function closeModal(){ $('#modalBackdrop').classList.add('hidden'); $('#modalBody').innerHTML=''; }

/* ---------- Tag helpers ---------- */
function tagClass(t){
  const k = String(t||'').toLowerCase();
  return k==='preferred'?'tag-preferred':k==='blacklisted'?'tag-blacklisted':k==='trial'?'tag-trial':'tag-approved';
}
function vendorTagFor(vendorId, material){
  const m = State.vendorMaterials.find(x=>x.VendorID==vendorId && x.Material==material);
  return m ? m.Tag : '';
}
function vendorsForMaterial(material){
  return State.vendorMaterials.filter(x=>x.Material==material)
    .map(x=>({ ...x, Name: vendorName(x.VendorID) }));
}

/* ---------- Order calculations ---------- */
function orderItemsOf(po){ return State.orderItems.filter(i=>i.PO_No==po); }
function receivingOf(po){ return State.receiving.filter(r=>r.PO_No==po); }
function orderedQtyMaterial(po,mat){ return orderItemsOf(po).filter(i=>i.Material==mat).reduce((a,i)=>a+(Number(i.OrderedQty)||0),0); }
function receivedQtyMaterial(po,mat){ return receivingOf(po).filter(r=>r.Material==mat).reduce((a,r)=>a+(Number(r.ReceivedQty)||0),0); }
function orderProgress(po){
  const ord = orderItemsOf(po).reduce((a,i)=>a+(Number(i.OrderedQty)||0),0);
  const rec = receivingOf(po).reduce((a,r)=>a+(Number(r.ReceivedQty)||0),0);
  return { ordered:ord, received:rec, pct: ord>0?Math.min(100,Math.round(rec/ord*100)):0 };
}
function isOverdue(o){
  const exp = o.RevisedExpectedDate || o.OriginalExpectedDate;
  if(!exp) return false;
  const done = o.Status==='Fully Received' || o.Status==='Closed' || o.Status==='Cancelled';
  return !done && String(exp) < todayStr();
}
function statusBadge(s){
  const map = {'Ordered':'b-blue','Partially Received':'b-amber','Fully Received':'b-green','Closed':'b-gray','Cancelled':'b-red'};
  return `<span class="badge ${map[s]||'b-gray'}">${esc(s)}</span>`;
}

/* =========================================================
 *  AUTH
 * ========================================================= */
async function doLogin(){
  const pin = $('#pinInput').value.trim();
  const err = $('#loginError'); err.textContent='';
  if(!pin){ err.textContent='Please enter your PIN'; return; }
  const btn = $('#loginBtn'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    const u = await api({ action:'login', pin });
    State.user = u;
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#userName').textContent = u.Name;
    $('#userRole').textContent = u.Role;
    $('#userAvatar').textContent = (u.Name||'A').charAt(0).toUpperCase();
    await loadAll();
    switchView('dashboard');
  }catch(e){
    err.textContent = e.message;
  }finally{
    btn.disabled=false; btn.textContent='Sign In';
  }
}

async function loadAll(){
  const d = await api({ action:'getAll' });
  State.config = d.config || {lists:{},settings:{}};
  State.vendors = d.vendors||[];
  State.vendorMaterials = d.vendorMaterials||[];
  State.items = d.items||[];
  State.orders = d.orders||[];
  State.orderItems = d.orderItems||[];
  State.receiving = d.receiving||[];
  State.followups = d.followups||[];
}
async function refresh(){
  const r = $('#refreshBtn'); r.classList.add('spinning');
  try{ await loadAll(); render(); }
  catch(e){ toast(e.message,'error'); }
  finally{ setTimeout(()=>r.classList.remove('spinning'),600); }
}

/* =========================================================
 *  ROUTER
 * ========================================================= */
const TITLES = {dashboard:'Dashboard',orders:'Orders',receiving:'Receiving',followups:'Follow-ups',vendors:'Vendors',masters:'Masters'};
function switchView(v){
  State.view = v;
  $$('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.view===v));
  $('#viewTitle').textContent = TITLES[v]||'';
  closeSidebar();
  render();
}
function render(){
  const root = $('#viewRoot');
  root.style.animation='none'; void root.offsetWidth; root.style.animation='fadeIn .35s ease';
  ({dashboard:renderDashboard,orders:renderOrders,receiving:renderReceiving,followups:renderFollowups,vendors:renderVendors,masters:renderMasters}[State.view])();
}

/* =========================================================
 *  DASHBOARD
 * ========================================================= */
function renderDashboard(){
  const active = State.orders.filter(o=>o.Status==='Ordered'||o.Status==='Partially Received');
  const overdue = State.orders.filter(isOverdue);
  const followDue = State.followups.filter(f=>f.NextFollowUpDate && String(f.NextFollowUpDate) <= todayStr());
  const monthSpend = State.orders
    .filter(o=>String(o.Date||'').slice(0,7)===todayStr().slice(0,7) && o.Status!=='Cancelled')
    .reduce((a,o)=>a+(Number(o.TotalAmount)||0),0);

  const recent = [...State.orders].sort((a,b)=>String(b.Date||'').localeCompare(String(a.Date||''))).slice(0,6);

  $('#viewRoot').innerHTML = `
    <div class="stat-grid">
      ${statCard('Active Orders', active.length, 'Ordered + partially received', '', 0)}
      ${statCard('Overdue', overdue.length, 'Past expected date', overdue.length?'danger':'good', 1)}
      ${statCard('Follow-ups Due', followDue.length, 'Due today or earlier', followDue.length?'warn':'good', 2)}
      ${statCard('This Month Spend', money(monthSpend), 'Ordered value', 'good', 3)}
    </div>

    ${overdue.length ? `
    <div class="panel">
      <div class="panel-head"><h3>⚠ Overdue Orders</h3></div>
      <div class="panel-body flush"><div class="table-wrap"><table>
        <thead><tr><th>PO No</th><th>Vendor</th><th>Expected</th><th>Progress</th><th>Status</th></tr></thead>
        <tbody>${overdue.map(o=>{const p=orderProgress(o);return `<tr>
          <td class="row-strong">${esc(o.PO_No)}</td><td>${esc(vendorName(o.VendorID))}</td>
          <td><span class="badge b-red pulse">${esc(o.RevisedExpectedDate||o.OriginalExpectedDate)}</span></td>
          <td>${progBar(p)}</td><td>${statusBadge(o.Status)}</td></tr>`;}).join('')}</tbody>
      </table></div></div>
    </div>`:''}

    <div class="panel">
      <div class="panel-head"><h3>Recent Orders</h3>
        <button class="link-btn" onclick="switchView('orders')">View all →</button></div>
      <div class="panel-body flush">
        ${recent.length? `<div class="table-wrap"><table>
          <thead><tr><th>PO No</th><th>Date</th><th>Vendor</th><th>Amount</th><th>Progress</th><th>Status</th></tr></thead>
          <tbody>${recent.map(o=>{const p=orderProgress(o);return `<tr>
            <td class="row-strong">${esc(o.PO_No)}</td><td>${esc(o.Date)}</td><td>${esc(vendorName(o.VendorID))}</td>
            <td class="mono">${money(o.TotalAmount)}</td><td>${progBar(p)}</td><td>${statusBadge(o.Status)}</td></tr>`;}).join('')}</tbody>
        </table></div>` : emptyState('No orders yet','Create your first purchase order')}
      </div>
    </div>`;
  animateCounts();
}
function statCard(label,value,hint,cls,i){
  return `<div class="stat-card ${cls}" style="animation-delay:${i*70}ms">
    <div class="stat-label">${label}</div>
    <div class="stat-value" data-count="${typeof value==='number'?value:''}">${typeof value==='number'?'0':value}</div>
    <div class="stat-hint">${hint}</div></div>`;
}
function animateCounts(){
  $$('.stat-value[data-count]').forEach(el=>{
    const target=Number(el.dataset.count); if(!target){el.textContent=el.dataset.count||el.textContent;return;}
    let cur=0; const step=Math.max(1,Math.round(target/24));
    const t=setInterval(()=>{cur+=step; if(cur>=target){cur=target;clearInterval(t);} el.textContent=cur;},22);
  });
}
function progBar(p){
  return `<div style="display:flex;align-items:center;gap:8px">
    <div class="prog ${p.pct>=100?'full':''}"><span style="width:${p.pct}%"></span></div>
    <span style="font-size:12px;color:var(--muted)">${p.received}/${p.ordered}</span></div>`;
}
function emptyState(t,s){return `<div class="empty"><span class="emoji">◇</span><div class="row-strong">${t}</div><div>${s||''}</div></div>`;}

/* =========================================================
 *  ORDERS
 * ========================================================= */
function renderOrders(){
  const statuses = State.config.lists.StatusOptions || [];
  $('#viewRoot').innerHTML = `
    <div class="section-actions">
      <button class="btn btn-primary" onclick="openNewOrder()">+ New Order</button>
      <div class="spacer"></div>
    </div>
    <div class="filters">
      <input class="search-box" id="oSearch" placeholder="Search PO or vendor..." oninput="renderOrderTable()">
      <select id="oStatus" onchange="renderOrderTable()">
        <option value="">All statuses</option>
        ${statuses.map(s=>`<option>${esc(s)}</option>`).join('')}
      </select>
      <select id="oVendor" onchange="renderOrderTable()">
        <option value="">All vendors</option>
        ${State.vendors.map(v=>`<option value="${esc(v.VendorID)}">${esc(v.Name)}</option>`).join('')}
      </select>
    </div>
    <div class="panel"><div class="panel-body flush"><div class="table-wrap"><table>
      <thead><tr><th></th><th>PO No</th><th>Date</th><th>Vendor</th><th>Expected</th><th>Amount</th><th>Progress</th><th>Status</th><th></th></tr></thead>
      <tbody id="orderTbody"></tbody>
    </table></div></div></div>`;
  renderOrderTable();
}
function renderOrderTable(){
  const q=($('#oSearch')?.value||'').toLowerCase();
  const fs=$('#oStatus')?.value||''; const fv=$('#oVendor')?.value||'';
  let list=[...State.orders].sort((a,b)=>String(b.PO_No).localeCompare(String(a.PO_No)));
  list=list.filter(o=>{
    const okQ=!q||String(o.PO_No).toLowerCase().includes(q)||vendorName(o.VendorID).toLowerCase().includes(q);
    return okQ && (!fs||o.Status===fs) && (!fv||o.VendorID==fv);
  });
  const tb=$('#orderTbody');
  if(!list.length){ tb.innerHTML=`<tr><td colspan="9">${emptyState('No matching orders','')}</td></tr>`; return; }
  tb.innerHTML=list.map(o=>{
    const p=orderProgress(o); const od=isOverdue(o);
    const exp=o.RevisedExpectedDate||o.OriginalExpectedDate||'—';
    return `<tr onclick="toggleDetail(this,'${esc(o.PO_No)}')">
      <td><span class="expand-ic">▸</span></td>
      <td class="row-strong">${esc(o.PO_No)}</td>
      <td>${esc(o.Date)}</td>
      <td>${esc(vendorName(o.VendorID))}</td>
      <td>${od?`<span class="badge b-red pulse">${esc(exp)}</span>`:esc(exp)}</td>
      <td class="mono">${money(o.TotalAmount)}</td>
      <td>${progBar(p)}</td>
      <td>${statusBadge(o.Status)}</td>
      <td onclick="event.stopPropagation()">
        ${(o.Status==='Ordered'||o.Status==='Partially Received')?`<button class="btn btn-light btn-sm" onclick="openReceiving('${esc(o.PO_No)}')">Receive</button>`:''}
      </td></tr>`;
  }).join('');
}
function toggleDetail(row,po){
  const next=row.nextElementSibling;
  if(next && next.classList.contains('detail-row')){ next.remove(); row.classList.remove('open'); return; }
  $$('.detail-row').forEach(r=>r.remove()); $$('#orderTbody tr').forEach(r=>r.classList.remove('open'));
  row.classList.add('open');
  const items=orderItemsOf(po), recs=receivingOf(po), fups=State.followups.filter(f=>f.PO_No==po);
  const tr=document.createElement('tr'); tr.className='detail-row';
  tr.innerHTML=`<td class="detail-cell" colspan="9"><div class="detail-inner">
    <h4>Items</h4>
    <table class="mini-table"><tbody>
      ${items.map(i=>{const rec=receivedQtyMaterial(po,i.Material);const pend=(Number(i.OrderedQty)||0)-rec;
        return `<tr><td>${esc(i.Material)}</td><td>${esc(i.OrderedQty)} ${esc(i.Unit||'')}</td>
        <td>Received: <b>${rec}</b></td><td>Pending: <b style="color:${pend>0?'var(--amber)':'var(--green)'}">${pend}</b></td>
        <td class="mono">${money(i.Amount)}</td></tr>`;}).join('')}
    </tbody></table>
    ${recs.length?`<h4>Receiving History</h4><table class="mini-table"><tbody>
      ${recs.map(r=>`<tr><td>${esc(r.GRN_No)}</td><td>${esc(r.Material)}</td><td>Recv ${esc(r.ReceivedQty)}</td>
      <td>Acc ${esc(r.AcceptedQty)} / Rej ${esc(r.RejectedQty)}</td><td>${esc(r.ReceivedDate)}</td></tr>`).join('')}
    </tbody></table>`:''}
    ${fups.length?`<h4>Follow-ups</h4><table class="mini-table"><tbody>
      ${fups.map(f=>`<tr><td>${esc(f.Date)}</td><td>${esc(f.Type)}</td><td>${esc(f.SpokenWith||'')}</td>
      <td>${esc(f.Outcome||'')}</td><td>Next: ${esc(f.NextFollowUpDate||'—')}</td></tr>`).join('')}
    </tbody></table>`:''}
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
      ${(State.orders.find(o=>o.PO_No==po).Status!=='Closed'&&State.orders.find(o=>o.PO_No==po).Status!=='Cancelled')?`
        <button class="btn btn-light btn-sm" onclick="openReceiving('${esc(po)}')">+ Receive</button>
        <button class="btn btn-light btn-sm" onclick="openFollowUp('${esc(po)}')">+ Follow-up</button>
        <button class="btn btn-light btn-sm" onclick="changeStatus('${esc(po)}','Closed')">Close</button>
        <button class="btn btn-danger btn-sm" onclick="changeStatus('${esc(po)}','Cancelled')">Cancel</button>`:''}
    </div>
  </div></td>`;
  row.after(tr);
}

/* ----- New Order modal ----- */
let itemRows=0;
let selectedVendorId='';

function openNewOrder(){
  selectedVendorId='';
  openModal('New Purchase Order', `
    <h4 class="mini-head">1 · Items</h4>
    <div id="itemRows"></div>
    <button class="btn btn-light btn-sm" onclick="addItemRow()">+ Add Item</button>
    <div class="order-total">Total: <span id="noTotal" class="mono">₹0</span></div>

    <h4 class="mini-head" style="margin-top:20px">2 · Select Vendor</h4>
    <div id="vendorPicker" class="vendor-picker"></div>

    <h4 class="mini-head" style="margin-top:20px">3 · Details</h4>
    <div class="form-grid">
      <div class="field"><label>Order Date</label><input type="date" id="noDate" value="${todayStr()}"></div>
      <div class="field"><label>Expected Receiving Date</label><input type="date" id="noExp"></div>
      <div class="field"><label>Priority</label>
        <select id="noPriority"><option>Normal</option><option>High</option><option>Urgent</option></select></div>
      <div class="field"><label>Remarks</label><input id="noRemarks" placeholder="Optional note"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-light" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="noSave" onclick="saveOrder()">Create Order</button>
    </div>`);
  itemRows=0; $('#itemRows').innerHTML=''; addItemRow(); updateVendorPicker();
}
function materialOptions(){
  const items=State.items||[];
  if(!items.length){ return (State.config.lists.MaterialList||[]).map(m=>`<option>${esc(m)}</option>`).join(''); }
  const byCat={};
  items.forEach(i=>{ const c=i.Category||'Other'; (byCat[c]=byCat[c]||[]).push(i); });
  return Object.keys(byCat).sort().map(cat=>
    `<optgroup label="${esc(cat)}">${byCat[cat].map(i=>`<option value="${esc(i.Item)}" data-unit="${esc(i.Unit||'')}">${esc(i.Item)}</option>`).join('')}</optgroup>`
  ).join('');
}
function unitOptions(){ return (State.config.lists.Units||[]).map(u=>`<option>${esc(u)}</option>`).join(''); }
function itemPicked(sel){
  const opt=sel.selectedOptions[0];
  const unit=opt?opt.dataset.unit:'';
  const row=sel.closest('.item-row');
  if(unit && row){
    const us=row.querySelector('[data-f="unit"]');
    if(us){ if(![...us.options].some(o=>o.value===unit)) us.add(new Option(unit,unit)); us.value=unit; }
  }
  itemsChanged();
}
function addItemRow(){
  const id=++itemRows;
  const row=document.createElement('div'); row.className='item-row'; row.dataset.id=id;
  row.innerHTML=`
    <div class="field"><label>Material</label>
      <select data-f="material" onchange="itemPicked(this)"><option value="">Select</option>${materialOptions()}</select></div>
    <div class="field"><label>Qty</label><input type="number" min="0" step="any" data-f="qty" oninput="recalcTotal()"></div>
    <div class="field"><label>Unit</label><select data-f="unit"><option value="">—</option>${unitOptions()}</select></div>
    <div class="field"><label>Rate</label><input type="number" min="0" step="any" data-f="rate" oninput="recalcTotal()"></div>
    <button class="rm" onclick="this.closest('.item-row').remove();itemsChanged()" title="Remove">✕</button>`;
  $('#itemRows').appendChild(row);
}
function itemsChanged(){ recalcTotal(); updateVendorPicker(); }
function collectItems(){
  return $$('#itemRows .item-row').map(r=>({
    Material:r.querySelector('[data-f="material"]').value,
    OrderedQty:r.querySelector('[data-f="qty"]').value,
    Unit:r.querySelector('[data-f="unit"]').value,
    Rate:r.querySelector('[data-f="rate"]').value
  }));
}
function recalcTotal(){
  const t=collectItems().reduce((a,i)=>a+((Number(i.OrderedQty)||0)*(Number(i.Rate)||0)),0);
  const el=$('#noTotal'); if(el) el.textContent=money(t);
}
function addedMaterials(){ return [...new Set(collectItems().map(i=>i.Material).filter(Boolean))]; }

/* Vendor picker driven by the items added above */
function updateVendorPicker(){
  const wrap=$('#vendorPicker'); if(!wrap) return;
  const mats=addedMaterials();
  if(!mats.length){
    wrap.innerHTML='<div class="vp-empty">Add items above to see the vendors who supply them.</div>';
    selectedVendorId=''; return;
  }
  const active=State.vendors.filter(v=>v.Status!=='Inactive');
  const cands=active.map(v=>{
    const perMat=mats.map(m=>({material:m, tag:vendorTagFor(v.VendorID,m)}));
    const supplies=perMat.filter(x=>x.tag).length;
    return {
      v, perMat, supplies,
      blacklisted:perMat.some(x=>String(x.tag).toLowerCase()==='blacklisted'),
      preferred:perMat.some(x=>String(x.tag).toLowerCase()==='preferred')
    };
  }).filter(c=>c.supplies>0)
    .sort((a,b)=> (b.preferred-a.preferred) || (b.supplies-a.supplies) || (a.blacklisted-b.blacklisted));

  const manualDropdown=`<div class="vp-more">
      <select id="vpManual" onchange="selectVendor(this.value)">
        <option value="">Other vendor…</option>
        ${active.map(v=>`<option value="${esc(v.VendorID)}" ${v.VendorID==selectedVendorId?'selected':''}>${esc(v.Name)}</option>`).join('')}
      </select></div>`;

  if(!cands.length){
    wrap.innerHTML=`<div class="vp-empty">No vendor is mapped to these materials yet. Pick one manually (or map materials in the Vendors tab).</div>${manualDropdown}`;
    return;
  }
  wrap.innerHTML = cands.map(c=>{
    const tagsHtml=c.perMat.map(x=> x.tag
      ? `<span class="badge ${tagClass(x.tag)}">${esc(x.material)}: ${esc(x.tag)}</span>`
      : `<span class="badge b-gray" style="opacity:.55">${esc(x.material)}: —</span>`).join('');
    return `<div class="vp-card ${selectedVendorId==c.v.VendorID?'sel':''} ${c.blacklisted?'dis':''}"
        ${c.blacklisted?'':`onclick="selectVendor('${esc(c.v.VendorID)}')"`}>
      <div class="vp-top">
        <span class="vp-name">${esc(c.v.Name)}</span>
        ${c.preferred?'<span class="badge b-green">Preferred</span>':''}
        ${c.blacklisted?'<span class="badge b-red">Blacklisted</span>':''}
        <span class="vp-cover">${c.supplies}/${mats.length} items</span>
      </div>
      <div class="vp-tags">${tagsHtml}</div>
    </div>`;
  }).join('') + manualDropdown;
}
function selectVendor(id){
  if(!id) return;
  const bad=addedMaterials().filter(m=>String(vendorTagFor(id,m)).toLowerCase()==='blacklisted');
  if(bad.length){ toast('Vendor is blacklisted for: '+bad.join(', '),'error'); return; }
  selectedVendorId=id;
  updateVendorPicker();
}
async function saveOrder(){
  const items=collectItems().filter(i=>i.Material);
  if(!items.length) return toast('Add at least one item','error');
  if(!selectedVendorId) return toast('Select a vendor','error');
  for(const it of items){
    if(!(Number(it.OrderedQty)>0)) return toast('Quantity must be greater than 0 ('+it.Material+')','error');
    if(String(vendorTagFor(selectedVendorId,it.Material)).toLowerCase()==='blacklisted')
      return toast('Vendor is blacklisted for '+it.Material,'error');
  }
  const date=$('#noDate').value, exp=$('#noExp').value;
  if(exp && exp<date) return toast('Expected date cannot be before order date','error');
  const btn=$('#noSave'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    const res=await api({action:'addOrder',VendorID:selectedVendorId,Date:date,ExpectedDate:exp,
      Priority:$('#noPriority').value,CreatedBy:State.user.Name,Remarks:$('#noRemarks').value,
      items:JSON.stringify(items)});
    toast('Order '+res.PO_No+' created','success');
    closeModal(); await loadAll(); render();
  }catch(e){ toast(e.message,'error'); btn.disabled=false; btn.textContent='Create Order'; }
}

/* ----- Receiving ----- */
function openReceiving(po){
  const items=orderItemsOf(po).map(i=>{
    const pend=(Number(i.OrderedQty)||0)-receivedQtyMaterial(po,i.Material);
    return {mat:i.Material,unit:i.Unit,pend};
  }).filter(i=>i.pend>0);
  if(!items.length){ toast('Nothing pending on this order','info'); return; }
  openModal('Receive — '+po, `
    <div class="form-grid one">
      <div class="field"><label>Material <span class="req">*</span></label>
        <select id="rvMat" onchange="rvMatChanged()">
          <option value="">Select material</option>
          ${items.map(i=>`<option value="${esc(i.mat)}" data-pend="${i.pend}">${esc(i.mat)} — pending ${i.pend} ${esc(i.unit||'')}</option>`).join('')}
        </select><span class="hint" id="rvPend"></span></div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Received Qty <span class="req">*</span></label><input type="number" min="0" step="any" id="rvRecv" oninput="rvSplit()"></div>
      <div class="field"><label>Received Date</label><input type="date" id="rvDate" value="${todayStr()}"></div>
      <div class="field"><label>Accepted Qty</label><input type="number" min="0" step="any" id="rvAcc"></div>
      <div class="field"><label>Rejected Qty</label><input type="number" min="0" step="any" id="rvRej"></div>
      <div class="field full"><label>Remarks</label><input id="rvRemarks" placeholder="Optional"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-light" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="rvSave" onclick="saveReceiving('${esc(po)}')">Save GRN</button>
    </div>`);
}
function rvMatChanged(){
  const opt=$('#rvMat').selectedOptions[0];
  $('#rvPend').textContent = opt&&opt.value ? 'Pending: '+opt.dataset.pend : '';
}
function rvSplit(){ const v=$('#rvRecv').value; if(v!==''){ $('#rvAcc').value=v; $('#rvRej').value=0; } }
async function saveReceiving(po){
  const mat=$('#rvMat').value; if(!mat) return toast('Select material','error');
  const recv=Number($('#rvRecv').value);
  if(!(recv>0)) return toast('Received qty must be greater than 0','error');
  const pend=Number($('#rvMat').selectedOptions[0].dataset.pend);
  if(recv>pend) return toast('Only '+pend+' pending — cannot over-receive','error');
  let acc=$('#rvAcc').value==='' ? recv : Number($('#rvAcc').value);
  let rej=$('#rvRej').value==='' ? 0 : Number($('#rvRej').value);
  if(acc+rej!==recv) return toast('Accepted + Rejected must equal Received','error');
  const btn=$('#rvSave'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    await api({action:'addReceiving',PO_No:po,Material:mat,ReceivedQty:recv,AcceptedQty:acc,RejectedQty:rej,
      ReceivedDate:$('#rvDate').value,ReceivedBy:State.user.Name,Remarks:$('#rvRemarks').value});
    toast('Receiving recorded','success');
    closeModal(); await loadAll(); render();
  }catch(e){ toast(e.message,'error'); btn.disabled=false; btn.textContent='Save GRN'; }
}

/* ----- Follow-up ----- */
function openFollowUp(po){
  const types=cfgList('FollowUpTypes',['Call','Visit','Email','WhatsApp']);
  openModal('Follow-up — '+po, `
    <div class="form-grid">
      <div class="field"><label>Type</label><select id="fuType">${types.map(t=>`<option>${esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>Date</label><input type="date" id="fuDate" value="${todayStr()}"></div>
      <div class="field"><label>Spoken With</label><input id="fuWith" placeholder="Contact person"></div>
      <div class="field"><label>Next Follow-up Date</label><input type="date" id="fuNext"></div>
      <div class="field full"><label>New Promised Date (updates expected)</label><input type="date" id="fuRevised"></div>
      <div class="field full"><label>Outcome</label><input id="fuOutcome" placeholder="e.g. Dispatching tomorrow"></div>
      <div class="field full"><label>Remarks</label><textarea id="fuRemarks"></textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-light" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="fuSave" onclick="saveFollowUp('${esc(po)}')">Save Follow-up</button>
    </div>`);
}
async function saveFollowUp(po){
  const next=$('#fuNext').value;
  if(next && next<todayStr()) return toast('Next follow-up date must be today or later','error');
  const btn=$('#fuSave'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    await api({action:'addFollowUp',PO_No:po,Type:$('#fuType').value,Date:$('#fuDate').value,
      SpokenWith:$('#fuWith').value,NextFollowUpDate:next,RevisedExpectedDate:$('#fuRevised').value,
      Outcome:$('#fuOutcome').value,Remarks:$('#fuRemarks').value});
    toast('Follow-up saved','success');
    closeModal(); await loadAll(); render();
  }catch(e){ toast(e.message,'error'); btn.disabled=false; btn.textContent='Save Follow-up'; }
}
async function changeStatus(po,status){
  if(status==='Cancelled' && !confirm('Cancel order '+po+'?')) return;
  try{ await api({action:'setStatus',PO_No:po,Status:status}); toast('Order '+status.toLowerCase(),'success'); await loadAll(); render(); }
  catch(e){ toast(e.message,'error'); }
}

/* =========================================================
 *  RECEIVING VIEW
 * ========================================================= */
function renderReceiving(){
  const list=[...State.receiving].sort((a,b)=>String(b.GRN_No).localeCompare(String(a.GRN_No)));
  $('#viewRoot').innerHTML=`
    <div class="panel"><div class="panel-head"><h3>Receiving History (GRN)</h3></div>
    <div class="panel-body flush">${list.length?`<div class="table-wrap"><table>
      <thead><tr><th>GRN</th><th>PO No</th><th>Material</th><th>Received</th><th>Accepted</th><th>Rejected</th><th>Date</th><th>By</th></tr></thead>
      <tbody>${list.map(r=>`<tr>
        <td class="row-strong">${esc(r.GRN_No)}</td><td>${esc(r.PO_No)}</td><td>${esc(r.Material)}</td>
        <td class="mono">${esc(r.ReceivedQty)}</td>
        <td><span class="badge b-green">${esc(r.AcceptedQty)}</span></td>
        <td>${Number(r.RejectedQty)>0?`<span class="badge b-red">${esc(r.RejectedQty)}</span>`:'0'}</td>
        <td>${esc(r.ReceivedDate)}</td><td>${esc(r.ReceivedBy||'')}</td></tr>`).join('')}</tbody>
    </table></div>`:emptyState('No receiving records yet','')}</div></div>`;
}

/* =========================================================
 *  FOLLOW-UPS VIEW
 * ========================================================= */
function renderFollowups(){
  const list=[...State.followups].sort((a,b)=>String(b.Date||'').localeCompare(String(a.Date||'')));
  const due=list.filter(f=>f.NextFollowUpDate && String(f.NextFollowUpDate)<=todayStr());
  $('#viewRoot').innerHTML=`
    ${due.length?`<div class="panel"><div class="panel-head"><h3>⏰ Due Now</h3></div>
      <div class="panel-body flush"><div class="table-wrap"><table>
      <thead><tr><th>PO No</th><th>Next Date</th><th>Last Outcome</th><th></th></tr></thead>
      <tbody>${due.map(f=>`<tr><td class="row-strong">${esc(f.PO_No)}</td>
        <td><span class="badge b-amber">${esc(f.NextFollowUpDate)}</span></td><td>${esc(f.Outcome||'')}</td>
        <td><button class="btn btn-light btn-sm" onclick="openFollowUp('${esc(f.PO_No)}')">Follow-up</button></td></tr>`).join('')}</tbody>
      </table></div></div></div>`:''}
    <div class="panel"><div class="panel-head"><h3>All Follow-ups</h3></div>
    <div class="panel-body flush">${list.length?`<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>PO No</th><th>Type</th><th>Spoken With</th><th>Outcome</th><th>Next</th></tr></thead>
      <tbody>${list.map(f=>`<tr><td>${esc(f.Date)}</td><td class="row-strong">${esc(f.PO_No)}</td>
        <td><span class="badge b-blue">${esc(f.Type)}</span></td><td>${esc(f.SpokenWith||'')}</td>
        <td>${esc(f.Outcome||'')}</td><td>${esc(f.NextFollowUpDate||'—')}</td></tr>`).join('')}</tbody>
    </table></div>`:emptyState('No follow-ups yet','')}</div></div>`;
}

/* =========================================================
 *  VENDORS VIEW
 * ========================================================= */
function renderVendors(){
  $('#viewRoot').innerHTML=`
    <div class="section-actions">
      <button class="btn btn-primary" onclick="openVendorForm()">+ Add Vendor</button>
      <div class="spacer"></div>
    </div>
    <div class="filters"><input class="search-box" id="vSearch" placeholder="Search vendor..." oninput="renderVendorTable()"></div>
    <div class="panel"><div class="panel-body flush"><div class="table-wrap"><table>
      <thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Materials &amp; Tags</th><th>Phone</th><th>Terms</th><th>Status</th><th></th></tr></thead>
      <tbody id="vendorTbody"></tbody>
    </table></div></div></div>`;
  renderVendorTable();
}
function renderVendorTable(){
  const q=($('#vSearch')?.value||'').toLowerCase();
  const list=State.vendors.filter(v=>!q||String(v.Name).toLowerCase().includes(q)||String(v.Category||'').toLowerCase().includes(q));
  const tb=$('#vendorTbody');
  if(!list.length){ tb.innerHTML=`<tr><td colspan="8">${emptyState('No vendors yet','Add your first vendor')}</td></tr>`; return; }
  tb.innerHTML=list.map(v=>{
    const maps=State.vendorMaterials.filter(m=>m.VendorID==v.VendorID);
    const tags=maps.length?maps.map(m=>`<span class="badge ${tagClass(m.Tag)}" style="margin:2px 3px 2px 0">${esc(m.Material)}: ${esc(m.Tag)}</span>`).join(''):'<span style="color:var(--muted)">—</span>';
    return `<tr>
      <td class="row-strong">${esc(v.VendorID)}</td><td>${esc(v.Name)}</td><td>${esc(v.Category||'')}</td>
      <td style="max-width:280px">${tags}</td><td>${esc(v.Phone||'')}</td><td>${esc(v.PaymentTerms||'')}</td>
      <td>${v.Status==='Inactive'?'<span class="badge b-gray">Inactive</span>':'<span class="badge b-green">Active</span>'}</td>
      <td onclick="event.stopPropagation()">
        <button class="link-btn" onclick="openVendorForm('${esc(v.VendorID)}')">Edit</button>
        <button class="link-btn" onclick="openMaterialMap('${esc(v.VendorID)}')">Materials</button></td></tr>`;
  }).join('');
}
function openVendorForm(vendorId){
  const v = vendorId ? State.vendors.find(x=>x.VendorID==vendorId) : null;
  const cats=State.config.lists.VendorCategories||[]; const terms=State.config.lists.PaymentTerms||[];
  const opt=(arr,sel)=>arr.map(c=>`<option ${c===sel?'selected':''}>${esc(c)}</option>`).join('');
  openModal(v?'Edit Vendor':'Add Vendor', `
    <div class="form-grid">
      <div class="field"><label>Name <span class="req">*</span></label><input id="veName" value="${esc(v?v.Name:'')}"></div>
      <div class="field"><label>Category</label><select id="veCat"><option value="">—</option>${opt(cats,v?v.Category:'')}</select></div>
      <div class="field"><label>Contact Person</label><input id="veContact" value="${esc(v?v.Contact:'')}"></div>
      <div class="field"><label>Phone</label><input id="vePhone" maxlength="10" inputmode="numeric" placeholder="10 digits" value="${esc(v?v.Phone:'')}"></div>
      <div class="field"><label>GST</label><input id="veGst" value="${esc(v?v.GST:'')}"></div>
      <div class="field"><label>Payment Terms</label><select id="veTerms"><option value="">—</option>${opt(terms,v?v.PaymentTerms:'')}</select></div>
      <div class="field full"><label>Address</label><input id="veAddr" value="${esc(v?v.Address:'')}"></div>
      ${v?`<div class="field"><label>Status</label><select id="veStatus">
        <option ${v.Status!=='Inactive'?'selected':''}>Active</option>
        <option ${v.Status==='Inactive'?'selected':''}>Inactive</option></select></div>`:''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-light" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="veSave" onclick="saveVendor(${v?`'${esc(v.VendorID)}'`:''})">${v?'Save Changes':'Add Vendor'}</button>
    </div>`);
}
async function saveVendor(vendorId){
  const name=$('#veName').value.trim(); if(!name) return toast('Vendor name required','error');
  const phone=$('#vePhone').value.trim();
  if(phone && !/^\d{10}$/.test(phone)) return toast('Phone must be 10 digits','error');
  const btn=$('#veSave'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const fields={Name:name,Category:$('#veCat').value,Contact:$('#veContact').value,
    Phone:phone,GST:$('#veGst').value,Address:$('#veAddr').value,PaymentTerms:$('#veTerms').value};
  try{
    if(vendorId){
      fields.VendorID=vendorId; fields.action='updateVendor'; fields.Status=$('#veStatus').value;
      await api(fields); toast('Vendor updated','success');
    }else{
      fields.action='addVendor'; fields.Status='Active';
      await api(fields); toast('Vendor added','success');
    }
    closeModal(); await loadAll(); render();
  }catch(e){ toast(e.message,'error'); btn.disabled=false; btn.textContent=vendorId?'Save Changes':'Add Vendor'; }
}

/* ----- Material↔Vendor mapping with tags ----- */
function openMaterialMap(vendorId){
  const v=State.vendors.find(x=>x.VendorID==vendorId);
  const maps=State.vendorMaterials.filter(m=>m.VendorID==vendorId);
  const mats=itemNames(); const tags=cfgList('VendorTags',['Preferred','Approved','Trial','Blacklisted']);
  openModal('Materials — '+(v?v.Name:vendorId), `
    ${maps.length?`<div class="map-list">
      <div class="map-row map-head"><span>Material</span><span>Tag</span><span>Last Rate</span><span>Remarks</span><span></span></div>
      ${maps.map(m=>`<div class="map-row" data-mat="${esc(m.Material)}">
        <span class="map-name">${esc(m.Material)}</span>
        <select data-mf="tag">${tags.map(t=>`<option ${t===m.Tag?'selected':''}>${esc(t)}</option>`).join('')}</select>
        <input data-mf="rate" type="number" min="0" step="any" value="${esc(m.LastRate||'')}" placeholder="Rate">
        <input data-mf="remarks" value="${esc(m.Remarks||'')}" placeholder="Note">
        <span class="map-btns">
          <button class="btn btn-light btn-sm" onclick="saveMapEdit('${esc(vendorId)}','${esc(m.Material)}',this)">Save</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMap('${esc(vendorId)}','${esc(m.Material)}')">Delete</button>
        </span>
      </div>`).join('')}
    </div>`:'<div class="empty" style="padding:16px"><span class="emoji">◇</span>No materials mapped yet</div>'}
    <h4 style="margin:6px 0 10px;font-size:12px;color:var(--muted);text-transform:uppercase">Add Material</h4>
    <div class="form-grid">
      <div class="field"><label>Material</label><select id="mmMat"><option value="">Select</option>${mats.map(m=>`<option>${esc(m)}</option>`).join('')}</select></div>
      <div class="field"><label>Tag</label><select id="mmTag">${tags.map(t=>`<option>${esc(t)}</option>`).join('')}</select></div>
      <div class="field"><label>Last Rate</label><input type="number" min="0" step="any" id="mmRate"></div>
      <div class="field"><label>Remarks</label><input id="mmRemarks"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-light" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" id="mmSave" onclick="saveMap('${esc(vendorId)}')">Add Material</button>
    </div>`);
}
async function saveMap(vendorId){
  const mat=$('#mmMat').value; if(!mat) return toast('Select material','error');
  const btn=$('#mmSave'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    await api({action:'addVendorMaterial',VendorID:vendorId,Material:mat,Tag:$('#mmTag').value,
      LastRate:$('#mmRate').value,Remarks:$('#mmRemarks').value});
    toast('Material mapped','success'); await loadAll(); openMaterialMap(vendorId); renderVendorTable();
  }catch(e){ toast(e.message,'error'); btn.disabled=false; btn.textContent='Add Material'; }
}
async function saveMapEdit(vendorId, material, btn){
  const row=btn.closest('.map-row');
  const tag=row.querySelector('[data-mf="tag"]').value;
  const rate=row.querySelector('[data-mf="rate"]').value;
  const remarks=row.querySelector('[data-mf="remarks"]').value;
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    await api({action:'updateVendorMaterial',VendorID:vendorId,Material:material,Tag:tag,LastRate:rate,Remarks:remarks});
    toast('Material updated','success'); await loadAll(); openMaterialMap(vendorId); renderVendorTable();
  }catch(e){ toast(e.message,'error'); btn.disabled=false; btn.textContent='Save'; }
}
async function deleteMap(vendorId, material){
  if(!confirm('Remove "'+material+'" from this vendor?')) return;
  try{
    await api({action:'deleteVendorMaterial',VendorID:vendorId,Material:material});
    toast('Material removed','success'); await loadAll(); openMaterialMap(vendorId); renderVendorTable();
  }catch(e){ toast(e.message,'error'); }
}

/* =========================================================
 *  MASTERS  (manage Config lists: items, units, etc.)
 * ========================================================= */
const MASTER_GROUPS = [
  {key:'ItemCategories',   title:'Item Categories'},
  {key:'Units',            title:'Units'},
  {key:'VendorCategories', title:'Vendor Categories'},
  {key:'PaymentTerms',     title:'Payment Terms'},
  {key:'VendorTags',       title:'Vendor Tags'},
  {key:'FollowUpTypes',    title:'Follow-up Types'}
];
function renderMasters(){
  const items=[...(State.items||[])].sort((a,b)=>String(a.Category).localeCompare(String(b.Category))||String(a.Item).localeCompare(String(b.Item)));
  const byCat={}; items.forEach(i=>{ const c=i.Category||'Other'; (byCat[c]=byCat[c]||[]).push(i); });
  $('#viewRoot').innerHTML = `
    <div class="section-actions"><button class="btn btn-primary" onclick="openItemForm()">+ Add Item</button><div class="spacer"></div></div>
    <div class="panel">
      <div class="panel-head"><h3>Items</h3><span class="stat-hint">${items.length} item${items.length===1?'':'s'}</span></div>
      <div class="panel-body">
        ${items.length ? Object.keys(byCat).sort().map(cat=>`
          <div class="item-cat-group">
            <div class="item-cat-label">${catIcon(cat)} ${esc(cat)} <span style="color:var(--muted)">· ${byCat[cat].length}</span></div>
            <div class="master-chips">
              ${byCat[cat].map(i=>`<span class="master-chip">
                <span>${esc(i.Item)}${i.Unit?` <em style="color:var(--muted);font-style:normal">· ${esc(i.Unit)}</em>`:''}</span>
                <button title="Edit" data-i="${esc(i.Item)}" onclick="openItemForm(this.dataset.i)">✎</button>
                <button title="Delete" data-i="${esc(i.Item)}" onclick="deleteItemMaster(this.dataset.i)">✕</button>
              </span>`).join('')}
            </div>
          </div>`).join('') : emptyState('No items yet','Click "+ Add Item" to create your first item')}
      </div>
    </div>
    <p class="masters-note">Below lists feed the dropdowns across the app. Changes save to the Config sheet instantly.</p>
    ${MASTER_GROUPS.map(masterPanel).join('')}`;
}

let itemFormCat='';
function openItemForm(itemName){
  const editing = itemName ? (State.items||[]).find(x=>x.Item==itemName) : null;
  itemFormCat = editing ? (editing.Category||'') : '';
  const cats = State.config.lists.ItemCategories || [];
  const units = State.config.lists.Units || [];
  openModal(editing?'Edit Item':'Add Item', `
    <p class="mini-head">Step 1 — Category <span class="req">*</span></p>
    <div class="cat-grid" id="catGrid">
      ${cats.map(c=>`<button type="button" class="cat-card ${c===itemFormCat?'sel':''}" data-c="${esc(c)}" onclick="pickCat(this)">${catIcon(c)} ${esc(c)}</button>`).join('')}
    </div>
    <p class="mini-head" style="margin-top:20px">Step 2 — Details</p>
    <div class="form-grid">
      <div class="field"><label>Item Name <span class="req">*</span></label><input id="itName" value="${editing?esc(editing.Item):''}"></div>
      <div class="field"><label>Unit</label><select id="itUnit"><option value="">—</option>${units.map(u=>`<option ${editing&&editing.Unit===u?'selected':''}>${esc(u)}</option>`).join('')}</select></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-light" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="itSave" onclick="saveItem(${editing?`'${esc(editing.Item)}'`:''})">Save Item</button>
    </div>`);
}
function pickCat(btn){ itemFormCat=btn.dataset.c; $$('#catGrid .cat-card').forEach(b=>b.classList.remove('sel')); btn.classList.add('sel'); }
async function saveItem(oldName){
  const name=$('#itName').value.trim(); const unit=$('#itUnit').value;
  if(!itemFormCat) return toast('Select a category','error');
  if(!name) return toast('Item name required','error');
  const btn=$('#itSave'); btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  try{
    if(oldName) await api({action:'updateItem',old:oldName,Item:name,Category:itemFormCat,Unit:unit});
    else await api({action:'addItem',Item:name,Category:itemFormCat,Unit:unit});
    toast(oldName?'Item updated':'Item added','success');
    closeModal(); await loadAll(); renderMasters();
  }catch(e){ toast(e.message,'error'); btn.disabled=false; btn.textContent='Save Item'; }
}
async function deleteItemMaster(name){
  if(!confirm('Delete "'+name+'"?')) return;
  try{ await api({action:'deleteItem',Item:name}); toast('Item deleted','success'); await loadAll(); renderMasters(); }
  catch(e){ toast(e.message,'error'); }
}
function masterPanel(g){
  const items = State.config.lists[g.key] || [];
  return `<div class="panel">
    <div class="panel-head"><h3>${g.title}</h3><span class="stat-hint">${items.length} item${items.length===1?'':'s'}</span></div>
    <div class="panel-body">
      <div class="master-chips">
        ${items.length ? items.map(v=>`<span class="master-chip">
            <span>${esc(v)}</span>
            <button title="Edit" onclick="editMaster('${g.key}',this)" data-v="${esc(v)}">✎</button>
            <button title="Delete" onclick="deleteMaster('${g.key}',this)" data-v="${esc(v)}">✕</button>
          </span>`).join('') : '<span class="stat-hint">None yet</span>'}
      </div>
      <div class="master-add">
        <input id="add_${g.key}" placeholder="Add new…" onkeydown="if(event.key==='Enter')addMaster('${g.key}')">
        <button class="btn btn-light btn-sm" onclick="addMaster('${g.key}')">+ Add</button>
      </div>
    </div>
  </div>`;
}
async function addMaster(list){
  const inp=$('#add_'+list); const value=inp.value.trim();
  if(!value) return;
  inp.disabled=true;
  try{ await api({action:'addConfigItem',list,value}); toast('Added','success'); await loadAll(); renderMasters(); }
  catch(e){ toast(e.message,'error'); inp.disabled=false; }
}
async function editMaster(list, btn){
  const oldV=btn.dataset.v;
  const nv=prompt('Rename "'+oldV+'" to:', oldV); if(nv===null) return;
  const value=nv.trim(); if(!value || value===oldV) return;
  try{ await api({action:'updateConfigItem',list,old:oldV,value}); toast('Updated','success'); await loadAll(); renderMasters(); }
  catch(e){ toast(e.message,'error'); }
}
async function deleteMaster(list, btn){
  const value=btn.dataset.v;
  if(!confirm('Delete "'+value+'"?')) return;
  try{ await api({action:'deleteConfigItem',list,value}); toast('Deleted','success'); await loadAll(); renderMasters(); }
  catch(e){ toast(e.message,'error'); }
}

/* =========================================================
 *  SIDEBAR (mobile)
 * ========================================================= */
function openSidebar(){ $('#sidebar').classList.add('show'); $('#sidebarOverlay').classList.add('show'); }
function closeSidebar(){ $('#sidebar').classList.remove('show'); $('#sidebarOverlay').classList.remove('show'); }

/* =========================================================
 *  INIT
 * ========================================================= */
function init(){
  $('#loginBtn').addEventListener('click', doLogin);
  $('#pinInput').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  $('#logoutBtn').addEventListener('click', ()=>location.reload());
  $('#refreshBtn').addEventListener('click', refresh);
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBackdrop').addEventListener('click', e=>{ if(e.target===$('#modalBackdrop')) closeModal(); });
  $('#hamburger').addEventListener('click', openSidebar);
  $('#sidebarOverlay').addEventListener('click', closeSidebar);
  $$('.nav-item').forEach(n=>n.addEventListener('click', ()=>switchView(n.dataset.view)));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
  setTimeout(()=>$('#pinInput').focus(), 300);
}
document.addEventListener('DOMContentLoaded', init);

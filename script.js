/* script.js — Musicala · Bitácora de tareas (Leydy Díaz)
   - Carga config.json (o usa fallback con el nuevo URL que me diste)
   - Pinta TODAS las columnas que vengan del backend
   - Filtros: Responsable / Estado / Urgencia + buscador
   - Contadores: Pendientes / En curso / Cumplidas
   - Bitácora: modal con lista de logs + POST para agregar registro

   QoL:
   · Formato de fechas claro en es-CO (dd/MM/yyyy HH:mm) con etiquetas “hoy / mañana / ayer”
   · Ordenar por columnas con indicador ▲▼
   · Guardar/restaurar filtros, búsqueda y orden (localStorage)
   · Chips rápidos por estado (Pendientes / En curso / Cumplidas)
   · Atajos: "/" enfoca buscador; ESC cierra modal
   · Resaltado por fecha límite (vencida / hoy / pronto)
   · “Documento y Herramientas” se convierte a hipervínculos automáticamente
*/

const $  = (s, ctx=document)=>ctx.querySelector(s);
const $$ = (s, ctx=document)=>Array.from(ctx.querySelectorAll(s));

// ---------- Helpers de texto ----------
const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const esc  = v => String(v ?? '').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

// ---------- Estado UI ----------
const TZ = 'America/Bogota';
const LS_KEY = 'bitacora_leydy_ui_v1';
function setStatus(m, isErr=false){ const el=$('#status'); if(el){ el.textContent=m; el.className=isErr?'status err':'status'; } }
function debounce(fn, ms=300){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }

// ---------- Config & Datos ----------
const DEFAULT_CONFIG_FILE = 'config.json';
const FALLBACK_CONFIG = {
  api: {
    baseUrl: 'https://script.google.com/macros/s/AKfycbz4a-jsYayyJmSMyCYRUW36Ck9kWKlkfji47426T_88ss15qyFGeyn427sBG7lzoxO0hw/exec',
    paramName: 'consulta',
    // queryString opcional si tu Web App lo usa:  'token=XYZ'
  },
  // Este "dataset" lo define tu Apps Script; déjalo igual al de tu config.json real.
  dataset: 'tareas_academicas',
  branding: {
    // Si quieres, puedes sobreescribir desde config.json
    // title: 'Bitácora de tareas académicas — Leydy Díaz',
    // subtitle: 'Hoja “Tareas académicas” · Registros en “Bitácora tareas”'
  }
};

let CONFIG = null;
let RAW_HEADERS = [];   // array de strings
let RAW_ROWS    = [];   // array de arrays
let IDX = {};          // nombre columna normalizado -> índice
let SORT = null;       // { col, dir: 1|-1 } o null
let LAST_RENDER_ROWS = [];

// ===================== Carga de configuración =====================
async function loadConfig(){
  // Permitir overrides rápidos por query (?base=...&dataset=...)
  const url = new URL(location.href);
  const confFile = url.searchParams.get('config') || DEFAULT_CONFIG_FILE;

  // Intentar cargar config.json; si falla, usar FALLBACK_CONFIG
  try{
    setStatus('Cargando configuración…');
    const res = await fetch(confFile, { cache:'no-store' });
    if(!res.ok) throw new Error('no encontrado');
    const json = await res.json();
    CONFIG = json;
  }catch(_){
    CONFIG = FALLBACK_CONFIG;
  }

  // Overrides por URL (útil para probar sin tocar archivos)
  const baseOverride = url.searchParams.get('base');
  const dsOverride   = url.searchParams.get('dataset');
  if(baseOverride) CONFIG.api.baseUrl = baseOverride;
  if(dsOverride)   CONFIG.dataset     = dsOverride;

  if(!CONFIG?.api?.baseUrl) throw new Error('Falta api.baseUrl');
  if(!CONFIG?.dataset)      throw new Error('Falta dataset');

  // Branding opcional
  if (CONFIG?.branding?.logo)     { const el=$('#site-logo');     if(el) el.src = CONFIG.branding.logo; }
  if (CONFIG?.branding?.title)    { const el=$('#site-title');    if(el) el.textContent = CONFIG.branding.title; }
  if (CONFIG?.branding?.subtitle) { const el=$('#site-subtitle'); if(el) el.textContent = CONFIG.branding.subtitle; }

  setStatus('Configuración lista.');
}

// ===================== Fetch de datos =====================
async function fetchData(){
  if(!CONFIG) await loadConfig();

  setStatus('Cargando datos…');
  const base    = CONFIG.api.baseUrl.replace(/\?+$/, '');
  const keyName = (CONFIG.api.paramName || 'consulta').trim();
  const dataset = encodeURIComponent(CONFIG.dataset);
  const extraQS = CONFIG.api.queryString ? `&${CONFIG.api.queryString.replace(/^\&/, '')}` : '';
  const url     = `${base}?${encodeURIComponent(keyName)}=${dataset}${extraQS}`;

  const res  = await fetch(url, { cache:'no-store' });
  const text = await res.text();

  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error('Respuesta no-JSON del Web App: ' + text.slice(0, 180)); }

  if (payload.ok === false) throw new Error(payload.error || 'Error backend');

  RAW_HEADERS = payload.headers || [];
  RAW_ROWS    = payload.rows    || [];

  IDX = {};
  RAW_HEADERS.forEach((h,i)=>{ IDX[norm(h)] = i; });

  setStatus(`${RAW_ROWS.length} fila${RAW_ROWS.length===1?'':'s'} cargada${RAW_ROWS.length===1?'':'s'}.`);
}

// ===================== Fechas =====================
function parseDateMaybe(v){
  if(v==null) return null;
  const s = String(v).trim();
  if(!s) return null;

  // ISO (con o sin Z/milisegundos)
  let d = new Date(s);
  if(!isNaN(d)) return d;

  // 2025-09-08 [hh:mm:ss]
  let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if(m){
    const [_, Y, Mo, D, H='0', Mi='0', S='0'] = m;
    d = new Date(Date.UTC(+Y, +Mo-1, +D, +H, +Mi, +S));
    return isNaN(d) ? null : d;
  }

  // 08/09/2025 [hh:mm:ss]
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if(m){
    const [_, D, Mo, Y, H='0', Mi='0', S='0'] = m;
    d = new Date(Date.UTC(+Y, +Mo-1, +D, +H, +Mi, +S));
    return isNaN(d) ? null : d;
  }

  return null;
}

function fmtDate(d){
  if(!d) return '';
  const f = new Intl.DateTimeFormat('es-CO', {
    timeZone: TZ, day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true
  });
  return f.format(d);
}

function todayAtTZ(hours=0, minutes=0, seconds=0){
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('es-CO', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' });
  const parts = fmt.formatToParts(now).reduce((acc,p)=>{ acc[p.type]=p.value; return acc; },{});
  const Y = +parts.year, M = +parts.month, D = +parts.day;
  return new Date(Date.UTC(Y, M-1, D, hours, minutes, seconds));
}

function diffDaysTZ(date){
  if(!date) return null;
  const start = todayAtTZ(0,0,0);
  const end   = todayAtTZ(23,59,59);
  const t0 = start.getTime(), t1 = end.getTime(), t = date.getTime();
  if (t < t0) return Math.ceil((t - t0) / (24*3600e3));
  if (t > t1) return Math.floor((t - t1) / (24*3600e3));
  return 0; // hoy
}

function labelRelative(d){
  const dd = diffDaysTZ(d);
  if(dd===0) return 'hoy';
  if(dd===1) return 'mañana';
  if(dd===-1) return 'ayer';
  if(dd<0) return `hace ${Math.abs(dd)} día${Math.abs(dd)===1?'':'s'}`;
  return `en ${dd} día${dd===1?'':'s'}`;
}

// ===================== Linkify =====================
function linkify(text){
  const s = String(text ?? '');
  if(!s) return '';
  const urlRe = /(https?:\/\/[^\s<>"]+[^<>)\s"'])/g;
  return s.replace(urlRe, (u)=>{
    const safe = esc(u);
    return `<a href="${safe}" target="_blank" rel="noopener">${safe}</a>`;
  });
}

// ===================== Render de tabla =====================
function buildHeaderHTML(){
  return '<tr>' +
    RAW_HEADERS.map((h,i)=>`<th data-col="${i}" role="button" aria-label="Ordenar por ${esc(h)}">${esc(h)} <span class="sort-ico" aria-hidden="true"></span></th>`).join('') +
    '<th>Acciones</th></tr>';
}

function decorateCell(hIndex, value){
  const headerName = norm(RAW_HEADERS[hIndex]);
  // Urgencia -> badge
  if(headerName === 'urgencia'){
    const v = norm(value);
    const cls = v.includes('alta') ? 'alta' : v.includes('media') ? 'media' : v ? 'baja' : '';
    return `<span class="badge-urg ${cls}">${esc(value)}</span>`;
  }
  // Fechas conocidas -> formato claro + etiqueta relativa
  const isDateCol = [
    'fecha', 'fecha limite','fecha límite','vence','plazo','entrega',
    'fecha de entrega','fecha de creacion','fecha de creación','creado','actualizado','fin','inicio'
  ].includes(headerName);
  if(isDateCol){
    const d = parseDateMaybe(value);
    if(!d) return esc(value);
    const pretty = fmtDate(d);
    const rel = labelRelative(d);
    return `${esc(pretty)} <span class="badge badge-deadline">${esc(rel)}</span>`;
  }
  // Documentos -> links
  if(headerName === norm('Documento y Herramientas')){
    const out = linkify(value);
    return out || esc(value);
  }
  return esc(value);
}

function renderTable(rows){
  const thead = $('#tbl thead');
  const tbody = $('#tbl tbody');
  const iId   = IDX[norm('id')];

  thead.innerHTML = buildHeaderHTML();

  const safe = rows || [];
  if(!safe.length){
    tbody.innerHTML = `<tr class="no-results"><td colspan="${RAW_HEADERS.length+1}">No hay resultados con los filtros actuales.</td></tr>`;
    LAST_RENDER_ROWS = [];
    markHeaderSort();
    return;
  }

  tbody.innerHTML = safe.map(r => {
    const id = iId!=null ? r[iId] : '';
    const tds = RAW_HEADERS.map((h,i)=>`<td class="wrap" data-th="${esc(h)}">${decorateCell(i, r[i])}</td>`).join('');
    const acc = `<td data-th="Acciones" style="text-align:center">
      <button class="btn btn-primary btn-detail" data-id="${esc(id)}" title="Abrir registro de bitácora">
        <span class="btn-ico">📝</span><span>Registro</span>
      </button>
    </td>`;
    return `<tr data-id="${esc(id)}">${tds}${acc}</tr>`;
  }).join('');

  LAST_RENDER_ROWS = safe.slice();
  applyDateHighlights();
  markHeaderSort();
}

// ===================== Filtros =====================
function uniqueSorted(values){
  const s = new Set(values.map(v => String(v||'').trim()).filter(Boolean));
  return Array.from(s).sort((a,b)=>a.localeCompare(b, 'es', { sensitivity:'base' }));
}

function fillSelect(sel, options, placeholder){
  if(!sel) return;
  if (!options.length){
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    sel.style.display = 'none';
    return;
  }
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  sel.style.display = '';
}

function fillFilters(){
  const iP = IDX[norm('persona encargada')] ?? IDX[norm('responsable')];
  const iE = IDX[norm('estado')];
  const iU = IDX[norm('urgencia')];

  const personas = (iP!=null) ? uniqueSorted(RAW_ROWS.map(r => r[iP])) : [];
  const estados  = (iE!=null) ? uniqueSorted(RAW_ROWS.map(r => r[iE])) : [];
  const urg      = (iU!=null) ? uniqueSorted(RAW_ROWS.map(r => r[iU])) : [];

  fillSelect($('#fPersona'),  personas, 'Responsable: todos');
  fillSelect($('#fEstado'),   estados,  'Estado: todos');
  fillSelect($('#fUrgencia'), urg,      'Urgencia: todas');
}

function applyFilters(){
  const selP = $('#fPersona')?.value || '';
  const selE = $('#fEstado')?.value  || '';
  const selU = $('#fUrgencia')?.value|| '';
  const qn   = norm( ($('#q')?.value || '').trim() );

  const iP = IDX[norm('persona encargada')] ?? IDX[norm('responsable')];
  const iE = IDX[norm('estado')];
  const iU = IDX[norm('urgencia')];

  let filtered = RAW_ROWS.filter(row => {
    if (selP && iP!=null && String(row[iP]||'') !== selP) return false;
    if (selE && iE!=null && String(row[iE]||'') !== selE) return false;
    if (selU && iU!=null && String(row[iU]||'') !== selU) return false;
    if (qn && !row.some(c => norm(c).includes(qn))) return false;
    return true;
  });

  if(SORT){
    filtered = filtered.slice().sort((a,b)=>compareCells(a,b,SORT.col)*SORT.dir);
  }

  renderTable(filtered);
  updateBadges(filtered);
  saveUI();
}

function updateBadges(rows){
  const pendEl = $('#badgePend');
  const cursoEl= $('#badgeCurso');
  const compEl = $('#badgeComp');

  const iE = IDX[norm('estado')];
  let pend=0, curso=0, comp=0;

  rows.forEach(r=>{
    const s = (iE!=null) ? norm(r[iE]) : '';
    if (!s) { pend++; return; }
    if (s.startsWith('pend') || s.includes('por hacer')) pend++;
    else if (s.includes('curso') || s.includes('progreso')) curso++;
    else if (s.startsWith('cumpl') || s.includes('hecha') || s.includes('termin')) comp++;
    else pend++;
  });

  if (pendEl)  pendEl.textContent  = `Pendientes: ${pend}`;
  if (cursoEl) cursoEl.textContent = `En curso: ${curso}`;
  if (compEl)  compEl.textContent  = `Cumplidas: ${comp}`;
  setStatus(`Mostrando ${rows.length} fila${rows.length===1?'':'s'}.`);
}

// ===================== Ordenamiento =====================
function compareCells(a,b,col){
  const av = a[col], bv = b[col];
  const ad = parseDateMaybe(av), bd = parseDateMaybe(bv);
  if(ad && bd){ return ad - bd; }
  const numRe = /^-?\d+([.,]\d+)?$/;
  if(numRe.test(String(av).trim()) && numRe.test(String(bv).trim())){
    const na = parseFloat(String(av).replace(',','.'));
    const nb = parseFloat(String(bv).replace(',','.'));
    return na - nb;
  }
  return String(av||'').localeCompare(String(bv||''), 'es', { sensitivity:'base', numeric:true });
}

function markHeaderSort(){
  const ths = $$('#tbl thead th');
  ths.forEach(th=>{
    const ico = th.querySelector('.sort-ico');
    if(!ico) return;
    ico.textContent = '';
    th.classList.remove('sorted-asc','sorted-desc');
  });
  if(!SORT) return;
  const th = $(`#tbl thead th[data-col="${SORT.col}"]`);
  if(!th) return;
  const ico = th.querySelector('.sort-ico');
  if(ico) ico.textContent = SORT.dir === 1 ? '▲' : '▼';
  th.classList.add(SORT.dir === 1 ? 'sorted-asc' : 'sorted-desc');
}

// ===================== Resaltado por fecha límite =====================
function applyDateHighlights(){
  const cand = ['fecha límite','fecha limite','vence','plazo','entrega','fecha de entrega','fecha'];
  const idxDeadline = cand.map(norm).map(k => IDX[k]).find(i => i!=null);
  if(idxDeadline==null) return;

  const rows = $$('#tbl tbody tr');
  rows.forEach((tr)=>{
    if(tr.classList.contains('no-results')) return;
    const cell = tr.children[idxDeadline];
    const text = cell ? cell.textContent.trim() : '';
    // La celda ya viene con “dd/MM/yyyy …”; intentamos extraer fecha:
    const d = parseDateMaybe(text) || parseDateMaybe(extractDateFromText(text));
    tr.classList.remove('is-overdue','is-today','is-soon');
    if(!d) return;
    const dd = diffDaysTZ(d);
    if(dd===null) return;
    if(dd < 0) tr.classList.add('is-overdue');
    else if(dd === 0) tr.classList.add('is-today');
    else if(dd <= 3) tr.classList.add('is-soon');
  });
}
function extractDateFromText(s){
  // Busca “dd/mm/yyyy hh:mm” dentro de un texto de celda
  const m = String(s).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(!m) return null;
  const [_, d, mo, y, h='00', mi='00'] = m;
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${mi.padStart(2,'0')}:00Z`;
}

// ===================== Bitácora (modal) =====================
function showModal(){ $('#modalLog')?.classList.add('show'); }
function hideModal(){ $('#modalLog')?.classList.remove('show'); $('#logStatus').textContent=''; }

async function openDetailById(id){
  const iId   = IDX[norm('id')];
  const iName = IDX[norm('tarea')];
  const iPers = IDX[norm('persona encargada')] ?? IDX[norm('responsable')];

  const row = RAW_ROWS.find(r => String(r[iId]) === String(id));

  $('#logTaskId').value           = id || '';
  $('#logTaskIdTxt').textContent  = id || '—';
  $('#logTaskName').textContent   = row ? (row[iName] || '—') : '—';

  // Asignar responsable al hidden (Leydy por defecto si no hay columna)
  const resp = row && iPers!=null ? (row[iPers] || 'Leydy Díaz') : 'Leydy Díaz';
  const hiddenPersona = $('#logPersona');
  if(hiddenPersona) hiddenPersona.value = resp;

  await loadLogs(id);
  showModal();
}

async function loadLogs(id){
  try{
    const base    = CONFIG.api.baseUrl.replace(/\?+$/, '');
    const keyName = (CONFIG.api.paramName || 'consulta').trim();
    const url     = `${base}?${encodeURIComponent(keyName)}=logs_tarea&id=${encodeURIComponent(id)}`;

    const res  = await fetch(url, { cache:'no-store' });
    const text = await res.text();
    let payload; try{ payload = JSON.parse(text); }catch{ throw new Error('Respuesta no-JSON del Web App (logs)'); }
    if (payload.ok === false) throw new Error(payload.error || 'Error backend (logs)');

    const headers = payload.headers || [];
    const rows    = payload.rows || [];

    $('#tblLogs thead').innerHTML = '<tr>' + headers.map(h=>`<th>${esc(h)}</th>`).join('') + '</tr>';
    $('#tblLogs tbody').innerHTML = rows.length
      ? rows.map(r => `<tr>${ headers.map((h,i)=>`<td class="wrap" data-th="${esc(h)}">${esc(r[i])}</td>`).join('') }</tr>`).join('')
      : `<tr class="no-results"><td colspan="${headers.length}">Sin registros aún.</td></tr>`;

    $('#logStatus').textContent = `${rows.length} registro${rows.length===1?'':'s'}`;
  }catch(err){
    console.error(err);
    $('#logStatus').textContent = 'Error: ' + err.message;
  }
}

async function submitLog(e){
  e.preventDefault();
  const id     = $('#logTaskId').value.trim();
  const perso  = $('#logPersona')?.value.trim(); // hidden (Leydy por defecto)
  const inicio = $('#logInicio').value;
  const fin    = $('#logFin').value;
  const tarea  = ($('#logTaskName')?.textContent || '').trim();
  const estado = $('#logEstado').value;

  const avanzo  = $('#logAvanzo').value.trim();
  const falta   = $('#logFalta').value.trim();
  const mejorar = $('#logMejorar').value.trim();

  if (!id){ $('#logStatus').textContent = 'Falta el ID de la tarea.'; return; }

  try{
    $('#logStatus').textContent = 'Guardando…';
    const body = new URLSearchParams({
      action:'add_log',
      id,
      tarea,
      persona: perso || 'Leydy Díaz',
      inicio, fin,
      avanzo, falta, mejorar,
      estado
    });

    const res  = await fetch(CONFIG.api.baseUrl.replace(/\?+$/, ''), { method:'POST', body });
    const text = await res.text();
    const payload = JSON.parse(text);
    if (payload.ok === false) throw new Error(payload.error || 'Error backend (POST)');

    // limpiar y recargar lista
    $('#logInicio').value=''; $('#logFin').value='';
    $('#logAvanzo').value=''; $('#logFalta').value=''; $('#logMejorar').value='';
    $('#logEstado').value='';
    await loadLogs(id);
    $('#logStatus').textContent = 'Guardado ✔';
  }catch(err){
    console.error(err); $('#logStatus').textContent = 'Error: ' + err.message;
  }
}

// ===================== Preferencias (localStorage) =====================
function saveUI(){
  const data = {
    p: $('#fPersona')?.value || '',
    e: $('#fEstado')?.value  || '',
    u: $('#fUrgencia')?.value|| '',
    q: $('#q')?.value || '',
    sort: SORT
  };
  try{ localStorage.setItem(LS_KEY, JSON.stringify(data)); }catch(_){}
}

function loadUI(){
  try{
    const data = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if($('#fPersona')) $('#fPersona').value = data.p ?? '';
    if($('#fEstado'))  $('#fEstado').value  = data.e ?? '';
    if($('#fUrgencia'))$('#fUrgencia').value= data.u ?? '';
    if($('#q'))        $('#q').value        = data.q ?? '';
    SORT = data.sort || null;
  }catch(_){}
}

// ===================== UI extra (chips, atajos, botones) =====================
function setupChips(){
  const iE = IDX[norm('estado')];
  if(iE==null) { $('.chips')?.remove(); return; }

  $$('.chip').forEach(ch=>{
    ch.addEventListener('click', ()=>{
      const k = ch.dataset.chip; // 'pend' | 'curso' | 'comp'
      const sel = $('#fEstado');
      if(sel && sel.options.length){
        const want = k==='pend' ? 'pend' : k==='curso' ? 'curso' : 'cumpl';
        let found = '';
        for(const opt of sel.options){
          if(norm(opt.value).includes(want)){ found = opt.value; break; }
        }
        sel.value = found;
      }
      $$('.chip').forEach(c=>c.classList.remove('active'));
      ch.classList.add('active');
      applyFilters();
    });
  });
}
function clearChipsActive(){ $$('.chip').forEach(c=>c.classList.remove('active')); }

function setupToolbarExtras(){
  $('#btnClear')?.addEventListener('click', ()=>{
    if($('#fPersona')) $('#fPersona').value = '';
    if($('#fEstado'))  $('#fEstado').value  = '';
    if($('#fUrgencia'))$('#fUrgencia').value= '';
    if($('#q'))        $('#q').value        = '';
    clearChipsActive();
    SORT = null;
    applyFilters();
  });

  // Atajo "/" para enfocar buscador
  document.addEventListener('keydown', (e)=>{
    if(e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey){
      const tag = document.activeElement?.tagName?.toLowerCase();
      if(tag!=='input' && tag!=='textarea'){
        e.preventDefault();
        $('#q')?.focus();
      }
    }
  });
}

// Click en encabezados para ordenar
function setupHeaderSort(){
  $('#tbl thead')?.addEventListener('click', (ev)=>{
    const th = ev.target.closest('th[data-col]');
    if(!th) return;
    const col = +th.dataset.col;
    if(!SORT || SORT.col!==col){
      SORT = { col, dir: 1 };
    } else {
      SORT.dir = SORT.dir===1 ? -1 : 1;
    }
    let rows = LAST_RENDER_ROWS.slice();
    rows.sort((a,b)=>compareCells(a,b,col)*SORT.dir);
    renderTable(rows);
    updateBadges(rows);
    saveUI();
  });
}

// ===================== Init =====================
async function init(){
  try{
    await loadConfig();
    await fetchData();
    fillFilters();
    loadUI();          // restaura filtros, búsqueda y sort
    applyFilters();    // pinta con filtros (y aplica sort si existe)
  }catch(err){
    console.error(err);
    setStatus('Error: ' + err.message, true);
  }

  // Listeners básicos
  $('#btnReload')?.addEventListener('click', async ()=>{
    try{
      await fetchData(); fillFilters(); loadUI(); applyFilters();
    }catch(err){ console.error(err); setStatus('Error: ' + err.message, true); }
  });
  $('#fPersona')?.addEventListener('change', ()=>{ applyFilters(); });
  $('#fEstado') ?.addEventListener('change', ()=>{ clearChipsActive(); applyFilters(); });
  $('#fUrgencia')?.addEventListener('change', ()=>{ applyFilters(); });
  $('#q')?.addEventListener('input', debounce(()=>{ applyFilters(); }, 250));

  $('#tbl')?.addEventListener('click', ev=>{
    const btn = ev.target.closest('.btn-detail');
    if (btn) openDetailById(btn.dataset.id);
  });

  $('#modalLog')?.addEventListener('click', ev=>{ if (ev.target.dataset.close) hideModal(); });
  $$('.modal__close')?.forEach(b => b.addEventListener('click', hideModal));
  $('#logForm')?.addEventListener('submit', submitLog);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') hideModal(); });

  setupChips();
  setupToolbarExtras();
  setupHeaderSort();
}

document.addEventListener('DOMContentLoaded', init);

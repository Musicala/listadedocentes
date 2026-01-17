/* =============================================================================
  app.js — Musicala · Buscador de Docentes (TSV)
  -----------------------------------------------------------------------------
  - Fetch TSV (publicado)
  - Selecciona columnas A–K + AC
  - Render tabla + paginación
  - Búsqueda full-text (normalizada)
  - Filtros automáticos por columnas "buenas"
  - Drawer detalle + copiar resumen/contacto + WhatsApp si aplica
  - Cache localStorage con botón "Actualizar"
============================================================================= */

(() => {
  'use strict';

  /* =========================
     Config base (desde config.js)
  ========================= */
  const CFG = (window.DOCENTES_CONFIG || {});

  const TSV_URL = CFG.TSV_URL || '';
  const APP_TITLE = CFG.APP_TITLE || 'Buscador de Docentes';
  const STORAGE_KEY = CFG.STORAGE_KEY || `musicala_docentes_cache__${hashStr(TSV_URL || 'no_url')}`;
  const CACHE_TTL_MS = typeof CFG.CACHE_TTL_MS === 'number' ? CFG.CACHE_TTL_MS : (1000 * 60 * 20); // 20 min default
  const PAGE_SIZE = typeof CFG.PAGE_SIZE === 'number' ? CFG.PAGE_SIZE : 25;

  // Column selection: A..K + AC
  // A=0 ... K=10, AC=28
  const COL_INDEXES = Array.from({ length: 11 }, (_, i) => i).concat([28]);

  // Heurísticas para detectar contacto
  const CONTACT_HEADER_RE = /(whatsapp|wpp|cel|m[oó]vil|tel[eé]fono|phone|contacto|correo|e-?mail|mail)/i;
  const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;

  /* =========================
     DOM refs
  ========================= */
  const $ = (s, root = document) => root.querySelector(s);

  const el = {
    btnRefresh: $('#btnRefresh'),
    syncBadge: $('#syncBadge'),
    q: $('#q'),
    btnClearSearch: $('#btnClearSearch'),
    btnResetFilters: $('#btnResetFilters'),
    filters: $('#filters'),
    kpiTotal: $('#kpiTotal'),
    kpiShowing: $('#kpiShowing'),
    kpiUpdatedAt: $('#kpiUpdatedAt'),
    resultPill: $('#resultPill'),

    btnDense: $('#btnDense'),

    tblHead: $('#tblHead'),
    tblBody: $('#tblBody'),

    btnPrev: $('#btnPrev'),
    btnNext: $('#btnNext'),
    pageInfo: $('#pageInfo'),

    drawer: $('#drawer'),
    drawerTitle: $('#drawerTitle'),
    drawerGrid: $('#drawerGrid'),
    drawerChips: $('#drawerChips'),
    btnCopySummary: $('#btnCopySummary'),
    btnCopyContact: $('#btnCopyContact'),
    btnWhatsApp: $('#btnWhatsApp'),

    toasts: $('#toasts'),
  };

  /* =========================
     State
  ========================= */
  const state = {
    rawTSV: '',
    updatedAt: null,          // Date
    headersAll: [],           // all headers in TSV
    rowsAll: [],              // all rows in TSV (arrays)
    headersSel: [],           // selected headers (A-K + AC)
    idxSel: [],               // indexes used (A-K + AC)
    data: [],                 // selected rows as objects
    search: '',
    filters: {},              // { headerName: selectedValue }
    filterDefs: [],           // [{ key, label, values }]
    page: 1,
    pageSize: PAGE_SIZE,
    dense: false,
    activeRow: null,          // object
    contactKey: null,         // header name for contact (phone/email)
  };

  /* =========================
     Init
  ========================= */
  document.addEventListener('DOMContentLoaded', init);

  function init(){
    document.title = `Musicala · ${APP_TITLE}`;

    wireUI();

    if (!TSV_URL){
      setBadge('error', 'Falta TSV_URL en config.js');
      renderFatal(
        'No hay URL del TSV 😅',
        'Crea un archivo config.js y define: window.DOCENTES_CONFIG = { TSV_URL: "…tu url…" }'
      );
      return;
    }

    // Intenta cargar cache
    const cached = readCache();
    if (cached && cached.rawTSV){
      try {
        setBadge('loading', 'Cargando (cache)…');
        ingestTSV(cached.rawTSV, cached.updatedAt ? new Date(cached.updatedAt) : null);
        setBadge('ok', 'Listo (cache)');
      } catch (e){
        // si el cache se dañó, lo ignoramos
        console.warn('Cache inválido, recargando.', e);
        clearCache();
      }
    }

    // Siempre hacemos fetch, pero suave: si cache está fresco, no molesta
    const cacheFresh = cached && cached.updatedAt && (Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL_MS);
    if (!cacheFresh){
      loadTSV({ force: true });
    } else {
      // fondo: no hacemos “background”, solo dejamos al usuario operar.
      // si quieren siempre recargar, cambien CACHE_TTL_MS o presionen Actualizar.
      hydrateUIAfterData();
    }
  }

  function wireUI(){
    el.btnRefresh?.addEventListener('click', () => loadTSV({ force: true }));

    el.q?.addEventListener('input', () => {
      state.search = el.q.value || '';
      state.page = 1;
      applyAndRender();
    });

    el.btnClearSearch?.addEventListener('click', () => {
      el.q.value = '';
      state.search = '';
      state.page = 1;
      applyAndRender();
      el.q.focus();
    });

    el.btnResetFilters?.addEventListener('click', () => {
      state.filters = {};
      state.page = 1;
      syncFilterUI();
      applyAndRender();
    });

    el.btnDense?.addEventListener('click', () => {
      state.dense = !state.dense;
      document.body.classList.toggle('is-dense', state.dense);
      el.btnDense.textContent = state.dense ? 'Normal' : 'Compacto';
    });

    el.btnPrev?.addEventListener('click', () => {
      if (state.page > 1){
        state.page--;
        renderTable();
      }
    });

    el.btnNext?.addEventListener('click', () => {
      const totalPages = getTotalPages(getFilteredData().length);
      if (state.page < totalPages){
        state.page++;
        renderTable();
      }
    });

    // Drawer close (overlay or X)
    document.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-close') === 'drawer'){
        closeDrawer();
      }
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isDrawerOpen()){
        closeDrawer();
      }
    });

    el.btnCopySummary?.addEventListener('click', () => {
      if (!state.activeRow) return;
      const text = buildSummary(state.activeRow);
      copyToClipboard(text)
        .then(() => toast('✅', 'Resumen copiado'))
        .catch(() => toast('⚠️', 'No se pudo copiar'));
    });

    el.btnCopyContact?.addEventListener('click', () => {
      if (!state.activeRow) return;
      const contact = getContactValue(state.activeRow);
      if (!contact){
        toast('🤷‍♂️', 'No hay contacto para copiar');
        return;
      }
      copyToClipboard(contact)
        .then(() => toast('✅', 'Contacto copiado'))
        .catch(() => toast('⚠️', 'No se pudo copiar'));
    });
  }

  /* =========================
     Load TSV
  ========================= */
  async function loadTSV({ force } = { force: false }){
    if (!TSV_URL){
      setBadge('error', 'Falta TSV_URL');
      return;
    }
    try{
      setBadge('loading', 'Cargando…');

      const tsv = await fetchText(TSV_URL, { noCache: !!force });
      ingestTSV(tsv, new Date());

      writeCache(tsv, state.updatedAt);
      setBadge('ok', 'Listo');

      hydrateUIAfterData();
    } catch (err){
      console.error(err);
      setBadge('error', 'Error cargando TSV');
      toast('❌', 'No se pudo cargar el TSV');
      renderEmptyState('No se pudo cargar el TSV', 'Revisa el link publicado o tu conexión.');
    }
  }

  async function fetchText(url, { noCache } = {}){
    const bust = noCache ? (url.includes('?') ? '&' : '?') + `__t=${Date.now()}` : '';
    const res = await fetch(url + bust, {
      method: 'GET',
      cache: noCache ? 'no-store' : 'default',
      headers: { 'Accept': 'text/tab-separated-values,text/plain' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al pedir TSV`);
    return await res.text();
  }

  /* =========================
     TSV -> State
  ========================= */
  function ingestTSV(tsvText, updatedAt){
    if (!tsvText || !tsvText.trim()){
      throw new Error('TSV vacío');
    }

    state.rawTSV = tsvText;
    state.updatedAt = updatedAt || state.updatedAt || new Date();

    const parsed = parseTSV(tsvText);
    if (!parsed.headers.length){
      throw new Error('TSV sin encabezados');
    }

    state.headersAll = parsed.headers;
    state.rowsAll = parsed.rows;

    // Selección columnas A-K + AC, solo si existen en el TSV
    state.idxSel = COL_INDEXES.filter(i => i >= 0 && i < state.headersAll.length);
    state.headersSel = state.idxSel.map(i => safeHeader(state.headersAll[i], `Col ${indexToLetters(i)}`));

    // Construir data objetos
    state.data = state.rowsAll
      .filter(r => r && r.length) // no filas vacías
      .map((rowArr) => {
        const obj = {};
        state.idxSel.forEach((idx, j) => {
          obj[state.headersSel[j]] = (rowArr[idx] ?? '').toString().trim();
        });
        // helpers internos
        obj.___search = buildSearchBlob(obj);
        return obj;
      });

    // Detectar columna de contacto (si la hay)
    state.contactKey = detectContactKey(state.headersSel);

    // Reset page & filters if keys changed
    state.page = 1;

    // Construir filtros automáticos
    state.filterDefs = buildFilterDefs(state.data, state.headersSel);

    // Mantener filtros seleccionados solo si siguen existiendo
    const validKeys = new Set(state.filterDefs.map(d => d.key));
    const nextFilters = {};
    for (const [k,v] of Object.entries(state.filters)){
      if (validKeys.has(k)) nextFilters[k] = v;
    }
    state.filters = nextFilters;

    // Render base
    renderHead();
    renderFilters();
    applyAndRender();
  }

  function parseTSV(tsvText){
    // Normalizamos saltos y quitamos líneas finales vacías
    const lines = tsvText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter(line => line.trim().length > 0);

    if (!lines.length) return { headers: [], rows: [] };

    const headers = splitTSVLine(lines[0]).map(h => (h ?? '').trim());
    const rows = lines.slice(1).map(line => splitTSVLine(line));

    // Asegurar longitud por lo menos headers
    const rowsNorm = rows.map(r => {
      const out = Array.from({ length: headers.length }, (_, i) => (r[i] ?? ''));
      return out;
    });

    return { headers, rows: rowsNorm };
  }

  function splitTSVLine(line){
    // TSV simple: tab separador. No manejamos comillas complejas.
    return line.split('\t');
  }

  function safeHeader(h, fallback){
    const s = (h || '').toString().trim();
    if (!s) return fallback;
    return s;
  }

  function indexToLetters(idx){
    // 0->A, 25->Z, 26->AA...
    let n = idx + 1;
    let s = '';
    while (n > 0){
      const mod = (n - 1) % 26;
      s = String.fromCharCode(65 + mod) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /* =========================
     Filters
  ========================= */
  function buildFilterDefs(data, headersSel){
    // Heurística:
    // - Columnas con valores repetidos (no casi únicos)
    // - Pocos únicos (<= 40) y suficientes llenos
    // - No contacto
    // Devuelve top 6 filtros “mejores”
    const candidates = [];

    const total = data.length || 1;

    for (const key of headersSel){
      if (!key) continue;
      if (state.contactKey && key === state.contactKey) continue;

      const vals = data.map(r => (r[key] || '').trim()).filter(Boolean);
      const filled = vals.length;
      if (filled < Math.max(10, Math.floor(total * 0.25))) continue; // muy vacío

      const uniq = new Map();
      for (const v of vals){
        const vv = v.length > 80 ? v.slice(0, 80) : v;
        uniq.set(vv, (uniq.get(vv) || 0) + 1);
      }
      const uniqueCount = uniq.size;
      if (uniqueCount <= 1) continue;
      if (uniqueCount > 40) continue; // demasiados, no sirve como filtro

      // score: preferir columnas con uniqueCount medio y alto filled
      const filledRatio = filled / total;
      const score = (filledRatio * 10) + (40 - uniqueCount) * 0.12;

      const values = Array.from(uniq.keys())
        .sort((a,b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

      // label (bonito)
      const label = prettifyLabel(key);

      candidates.push({ key, label, values, score });
    }

    candidates.sort((a,b) => b.score - a.score);

    // máximo 6 filtros para no volver esto un avión
    return candidates.slice(0, (CFG.MAX_FILTERS || 6))
      .map(({ key, label, values }) => ({ key, label, values }));
  }

  function renderFilters(){
    if (!el.filters) return;

    el.filters.innerHTML = '';

    if (!state.filterDefs.length){
      el.filters.innerHTML = `<div class="filters__placeholder">No encontré filtros útiles con estos datos. Igual la búsqueda lo salva todo.</div>`;
      return;
    }

    for (const def of state.filterDefs){
      const wrap = document.createElement('div');
      wrap.className = 'flt';

      const lab = document.createElement('div');
      lab.className = 'flt__label';
      lab.textContent = def.label;

      const sel = document.createElement('select');
      sel.className = 'flt__select';
      sel.setAttribute('data-filter', def.key);

      // opción vacía
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = 'Todos';
      sel.appendChild(opt0);

      for (const v of def.values){
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }

      sel.value = state.filters[def.key] || '';

      sel.addEventListener('change', () => {
        const val = sel.value || '';
        if (!val) delete state.filters[def.key];
        else state.filters[def.key] = val;
        state.page = 1;
        applyAndRender();
      });

      wrap.appendChild(lab);
      wrap.appendChild(sel);
      el.filters.appendChild(wrap);
    }
  }

  function syncFilterUI(){
    // aplica state.filters a selects
    const selects = el.filters?.querySelectorAll('select[data-filter]') || [];
    selects.forEach(s => {
      const key = s.getAttribute('data-filter');
      s.value = state.filters[key] || '';
    });
  }

  /* =========================
     Render Table
  ========================= */
  function renderHead(){
    if (!el.tblHead) return;

    const tr = document.createElement('tr');
    state.headersSel.forEach(h => {
      const th = document.createElement('th');
      th.textContent = prettifyLabel(h);
      tr.appendChild(th);
    });

    el.tblHead.innerHTML = '';
    el.tblHead.appendChild(tr);
  }

  function applyAndRender(){
    updateKPIs();
    renderTable();
  }

  function getFilteredData(){
    let out = state.data;

    // filtros
    const filters = state.filters || {};
    const filterKeys = Object.keys(filters);
    if (filterKeys.length){
      out = out.filter(row => {
        for (const k of filterKeys){
          const want = filters[k];
          if (!want) continue;
          const got = (row[k] || '').trim();
          if (!got) return false;
          if (got !== want) return false;
        }
        return true;
      });
    }

    // búsqueda
    const q = normalize(state.search || '').trim();
    if (q){
      const terms = q.split(/\s+/).filter(Boolean);
      out = out.filter(row => {
        const blob = row.___search || '';
        for (const t of terms){
          if (!blob.includes(t)) return false;
        }
        return true;
      });
    }

    return out;
  }

  function renderTable(){
    if (!el.tblBody) return;

    const filtered = getFilteredData();
    const total = filtered.length;

    const totalPages = getTotalPages(total);
    if (state.page > totalPages) state.page = totalPages || 1;

    const start = (state.page - 1) * state.pageSize;
    const end = start + state.pageSize;
    const pageRows = filtered.slice(start, end);

    // Updates UI bits
    el.kpiTotal.textContent = String(state.data.length);
    el.kpiShowing.textContent = String(total);
    el.resultPill.textContent = `${total} resultado${total === 1 ? '' : 's'}`;

    el.btnPrev.disabled = state.page <= 1;
    el.btnNext.disabled = state.page >= totalPages || totalPages === 0;
    el.pageInfo.textContent = totalPages
      ? `Página ${state.page} de ${totalPages}`
      : '—';

    // Render rows
    el.tblBody.innerHTML = '';

    if (!pageRows.length){
      const tr = document.createElement('tr');
      tr.className = 'is-empty';
      const td = document.createElement('td');
      td.colSpan = 99;
      td.textContent = total === 0
        ? 'No hay resultados con esa búsqueda/filtros.'
        : 'No hay filas para mostrar.';
      tr.appendChild(td);
      el.tblBody.appendChild(tr);
      return;
    }

    for (const row of pageRows){
      const tr = document.createElement('tr');
      tr.tabIndex = 0;

      tr.addEventListener('click', () => openDrawer(row));
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' '){
          ev.preventDefault();
          openDrawer(row);
        }
      });

      for (const h of state.headersSel){
        const td = document.createElement('td');
        const val = (row[h] ?? '').toString().trim();
        td.textContent = val || '—';
        if (!val) td.classList.add('muted');
        tr.appendChild(td);
      }

      el.tblBody.appendChild(tr);
    }
  }

  function getTotalPages(total){
    if (!total) return 0;
    return Math.max(1, Math.ceil(total / state.pageSize));
  }

  function updateKPIs(){
    // Total and showing are updated in renderTable to be consistent
    el.kpiUpdatedAt.textContent = state.updatedAt
      ? formatDateTime(state.updatedAt)
      : '—';
  }

  function hydrateUIAfterData(){
    // Si no había data renderizada por cache, esto asegura que esté.
    if (!state.data.length) return;
    updateKPIs();
    renderFilters();
    applyAndRender();
  }

  /* =========================
     Drawer
  ========================= */
  function openDrawer(row){
    state.activeRow = row;

    // Title: intenta con la primera columna no vacía
    const title = pickTitle(row);
    el.drawerTitle.textContent = title || 'Detalle';

    // Chips: arma 2-4 chips con valores cortos y útiles
    el.drawerChips.innerHTML = '';
    const chips = buildChips(row);
    chips.forEach(c => el.drawerChips.appendChild(c));

    // Grid KV
    el.drawerGrid.innerHTML = '';
    for (const key of state.headersSel){
      const k = prettifyLabel(key);
      const v = (row[key] ?? '').toString().trim();

      const kv = document.createElement('div');
      kv.className = 'kv';

      const kk = document.createElement('div');
      kk.className = 'kv__k';
      kk.textContent = k;

      const vv = document.createElement('div');
      vv.className = 'kv__v';
      if (!v){
        vv.classList.add('is-empty');
        vv.textContent = '—';
      } else {
        vv.textContent = v;
      }

      kv.appendChild(kk);
      kv.appendChild(vv);
      el.drawerGrid.appendChild(kv);
    }

    // Contact actions
    const contact = getContactValue(row);

    const hasContact = !!contact;
    el.btnCopyContact.disabled = !hasContact;
    el.btnCopyContact.title = hasContact ? 'Copiar contacto' : 'No hay dato de contacto disponible';

    // WhatsApp link if phone-like
    const phone = extractPhone(contact || '');
    if (phone){
      const wa = `https://wa.me/${phone}`;
      el.btnWhatsApp.href = wa;
      el.btnWhatsApp.setAttribute('aria-disabled', 'false');
      el.btnWhatsApp.classList.remove('btn--disabled');
      el.btnWhatsApp.style.pointerEvents = 'auto';
      el.btnWhatsApp.style.opacity = '1';
    } else {
      el.btnWhatsApp.href = '#';
      el.btnWhatsApp.setAttribute('aria-disabled', 'true');
      el.btnWhatsApp.style.pointerEvents = 'none';
      el.btnWhatsApp.style.opacity = '.55';
    }

    // Open
    el.drawer.setAttribute('aria-hidden', 'false');

    // Prevent body scroll
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer(){
    el.drawer.setAttribute('aria-hidden', 'true');
    state.activeRow = null;
    document.body.style.overflow = '';
  }

  function isDrawerOpen(){
    return el.drawer.getAttribute('aria-hidden') === 'false';
  }

  function pickTitle(row){
    // prefer: first non-empty value among first 3 columns
    const keys = state.headersSel.slice(0, 3);
    for (const k of keys){
      const v = (row[k] || '').trim();
      if (v) return v;
    }
    // else any non-empty
    for (const k of state.headersSel){
      const v = (row[k] || '').trim();
      if (v) return v;
    }
    return '';
  }

  function buildChips(row){
    const chips = [];

    // accent chip: nombre/título
    const title = pickTitle(row);
    if (title){
      const c = mkChip(title, true);
      chips.push(c);
    }

    // add up to 3 other short fields
    for (const k of state.headersSel){
      const v = (row[k] || '').trim();
      if (!v) continue;
      if (v === title) continue;
      if (v.length > 26) continue;
      if (chips.length >= 4) break;
      chips.push(mkChip(v, false));
    }

    return chips;
  }

  function mkChip(text, accent){
    const d = document.createElement('div');
    d.className = accent ? 'chip chip--accent' : 'chip';
    d.textContent = text;
    return d;
  }

  /* =========================
     Copy / Summary / Contact
  ========================= */
  function buildSummary(row){
    // Si config define summaryKeys, usamos eso
    if (Array.isArray(CFG.SUMMARY_KEYS) && CFG.SUMMARY_KEYS.length){
      const parts = CFG.SUMMARY_KEYS.map(k => {
        const val = (row[k] || '').trim();
        return val ? `${prettifyLabel(k)}: ${val}` : '';
      }).filter(Boolean);
      return parts.join('\n');
    }

    // Default: 5 campos más útiles (primeros con info)
    const parts = [];
    for (const k of state.headersSel){
      const v = (row[k] || '').trim();
      if (!v) continue;
      parts.push(`${prettifyLabel(k)}: ${v}`);
      if (parts.length >= 6) break;
    }
    return parts.join('\n');
  }

  function detectContactKey(headers){
    // Busca header que parezca contacto
    const found = headers.find(h => CONTACT_HEADER_RE.test(h));
    if (found) return found;

    // fallback: busca un header que tenga la palabra "cel" o "tel" etc ya cubierto, pero por si acaso:
    const low = headers.map(h => normalize(h));
    const idx = low.findIndex(s => s.includes('telefono') || s.includes('cel') || s.includes('whatsapp') || s.includes('correo') || s.includes('email'));
    return idx >= 0 ? headers[idx] : null;
  }

  function getContactValue(row){
    if (!row) return '';
    // if config says explicit contact key
    if (CFG.CONTACT_KEY && row[CFG.CONTACT_KEY]){
      return (row[CFG.CONTACT_KEY] || '').trim();
    }
    if (state.contactKey && row[state.contactKey]){
      return (row[state.contactKey] || '').trim();
    }
    // fallback: scan values for something phone-like
    for (const k of state.headersSel){
      const v = (row[k] || '').trim();
      if (PHONE_RE.test(v)) return v;
      if (v.includes('@')) return v;
    }
    return '';
  }

  function extractPhone(text){
    if (!text) return '';
    const m = text.match(PHONE_RE);
    if (!m) return '';
    // limpia a solo dígitos, conserva país si está
    const digits = m[1].replace(/[^\d]/g, '');
    // Colombia: si son 10 dígitos, ok. Si tiene 57 + 10, ok.
    // WhatsApp wa.me requiere country code sin +
    if (digits.length === 10) return `57${digits}`;
    if (digits.length === 12 && digits.startsWith('57')) return digits;
    if (digits.length > 12 && digits.startsWith('57')) return digits.slice(0, 12);
    return digits; // mejor algo que nada
  }

  async function copyToClipboard(text){
    if (navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text);
    }
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('copy failed');
  }

  /* =========================
     Search helpers
  ========================= */
  function buildSearchBlob(obj){
    const parts = [];
    for (const k of state.headersSel){
      const v = (obj[k] || '').toString();
      if (v) parts.push(v);
    }
    return normalize(parts.join(' | '));
  }

  function normalize(s){
    return (s || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/\s+/g, ' ')
      .trim();
  }

  function prettifyLabel(s){
    // si ya viene bonito, no lo dañamos.
    const t = (s || '').toString().trim();
    if (!t) return '';
    // reemplazos suaves
    return t
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* =========================
     Badge, Toasts, Empty/Fatal
  ========================= */
  function setBadge(mode, text){
    if (!el.syncBadge) return;
    el.syncBadge.classList.remove('is-loading', 'is-error');
    if (mode === 'loading') el.syncBadge.classList.add('is-loading');
    if (mode === 'error') el.syncBadge.classList.add('is-error');

    const t = el.syncBadge.querySelector('.badge__text');
    if (t) t.textContent = text || (mode === 'ok' ? 'Listo' : mode);
  }

  function toast(icon, msg){
    if (!el.toasts) return;
    const node = document.createElement('div');
    node.className = 'toast';
    node.innerHTML = `
      <div class="toast__icon" aria-hidden="true">${icon || 'ℹ️'}</div>
      <div class="toast__text">${escapeHTML(msg || '')}</div>
    `;
    el.toasts.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      setTimeout(() => node.remove(), 200);
    }, 2200);
  }

  function renderEmptyState(title, subtitle){
    if (!el.tblBody) return;
    el.tblBody.innerHTML = `
      <tr class="is-empty">
        <td colspan="99">
          <div style="font-weight:900; margin-bottom:6px;">${escapeHTML(title || 'Sin datos')}</div>
          <div style="color:#5b6270; font-weight:700;">${escapeHTML(subtitle || '')}</div>
        </td>
      </tr>
    `;
  }

  function renderFatal(title, subtitle){
    // Usa la tabla como área de mensaje, sin inventar layouts extra
    renderEmptyState(title, subtitle);
  }

  function escapeHTML(str){
    return (str || '').replace(/[&<>"']/g, (m) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  /* =========================
     Cache
  ========================= */
  function readCache(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);

      if (!obj || !obj.rawTSV) return null;

      // TTL check
      if (obj.updatedAt){
        const age = Date.now() - new Date(obj.updatedAt).getTime();
        if (age > CACHE_TTL_MS){
          // cache viejo, pero lo dejamos como fallback si el fetch falla
          return obj;
        }
      }
      return obj;
    } catch {
      return null;
    }
  }

  function writeCache(rawTSV, updatedAt){
    try{
      const obj = { rawTSV, updatedAt: updatedAt ? updatedAt.toISOString() : new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      state.updatedAt = updatedAt || new Date(obj.updatedAt);
    } catch {
      // si no hay espacio, no lloramos
    }
  }

  function clearCache(){
    try{ localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  /* =========================
     Utils
  ========================= */
  function formatDateTime(d){
    try{
      return new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(d);
    } catch {
      return d.toLocaleString();
    }
  }

  function hashStr(s){
    // hash simple para key de storage, no crypto
    let h = 2166136261;
    for (let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
})();

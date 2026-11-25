/* ============================================================
   FleetOps — Application Core Driver Engine
   ============================================================ */
const API_BASE_URL = '/api';
let assets = [], reservations = [], inspections = [], usersList = [], activityLogs = [];
let calMonth = new Date(), assetFilter = 'all', resFilter = 'all';
let charts = {}, currentUser = null, mapInstance = null, currentEditingReservationId = null;
let assetViewMode = 'grid';

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// XSS Protection: Escape any user/database text before injecting into innerHTML
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAuthHeader() {
  const token = localStorage.getItem('fo_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function handleAuthError(res) {
  if (res.status === 401 || res.status === 403) {
    toast('🔒 Session expired. Please sign in again.');
    localStorage.removeItem('fo_token');
    localStorage.removeItem('fo_user');
    setTimeout(() => window.location.reload(), 1200);
    return true;
  }
  return false;
}

async function load() {
  const token = localStorage.getItem('fo_token');

  // If unauthenticated guest scanned a QR code, fetch ONLY the public endpoint
  if (!token) {
    if (window.location.hash.startsWith('#scan=')) {
      const assetId = window.location.hash.split('=')[1];
      try {
        const res = await fetch(`${API_BASE_URL}/public/assets/${encodeURIComponent(assetId)}`);
        if (!res.ok) throw new Error('Vehicle not found');
        const { asset, latestInspection } = await res.json();
        assets = [asset];
        inspections = latestInspection ? [{ ...latestInspection, asset_id: asset.id }] : [];
        simulateScan(asset.id);
        history.replaceState(null, null, ' ');
      } catch (err) {
        toast('⚠️ Invalid or expired QR link.');
      }
    }
    return;
  }

  try {
    const headers = getAuthHeader();
    const [assetsRes, resRes, inspRes] = await Promise.all([
      fetch(`${API_BASE_URL}/assets`, { headers }),
      fetch(`${API_BASE_URL}/reservations`, { headers }),
      fetch(`${API_BASE_URL}/inspections`, { headers })
    ]);

    if (handleAuthError(assetsRes) || handleAuthError(resRes) || handleAuthError(inspRes)) return;

    assets = await assetsRes.json();
    reservations = await resRes.json();
    inspections = inspRes.ok ? await inspRes.json() : [];

    if (currentUser && currentUser.role === 'site_manager') {
      const [uRes, logRes] = await Promise.all([
        fetch(`${API_BASE_URL}/users`, { headers }),
        fetch(`${API_BASE_URL}/logs`, { headers })
      ]);
      if (handleAuthError(uRes) || handleAuthError(logRes)) return;
      if (uRes.ok) usersList = await uRes.json();
      if (logRes.ok) activityLogs = await logRes.json();
    }

    renderAll();
    renderReservations();
    renderCalendar();

    if ($('#view-map') && !$('#view-map').classList.contains('hidden')) renderLiveMap();
    if ($('#view-inspections') && !$('#view-inspections').classList.contains('hidden')) renderInspections();
    if ($('#view-reports') && !$('#view-reports').classList.contains('hidden')) renderReportsView();
    if ($('#view-users') && !$('#view-users').classList.contains('hidden')) renderUsers();
    if ($('#view-logs') && !$('#view-logs').classList.contains('hidden')) renderLogs();

    if (window.location.hash.startsWith('#scan=')) {
      const assetId = window.location.hash.split('=')[1];
      if (assetId && getAsset(assetId)) {
        simulateScan(assetId);
        history.replaceState(null, null, ' ');
      }
    }
  } catch (err) {
    console.error('Sync error:', err);
    toast('Error syncing data.');
  }
}

function getAsset(id) { return assets.find(a => a.id === id); }

function getLatestInspection(assetId) {
  const history = inspections
    .filter(i => i.asset_id === assetId)
    .sort((a, b) => new Date(b.inspection_date) - new Date(a.inspection_date));
  return { latest: history[0] || null, history };
}

function typeIcon(type) {
  const ICONS = { 'Dump Truck': '🚚', 'Articulated Truck': '🚚', 'Crane': '🏗️', 'Excavator': '⛏️', 'Bulldozer': '🚜', 'Loader': '🔧', 'Concrete Mixer': '⚪', 'Compactor': '🗜️', 'Forklift': '🛻' };
  return ICONS[type] || '🚧';
}
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function fmtDateShort(iso) { return iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function hoursBetween(start, end) { return Math.max(0, (new Date(end) - new Date(start)) / 36e5); }
function statusBadge(status) { return `<span class="badge badge-${esc(status)}">${esc(status.replace('-', ' '))}</span>`; }
function statusPillClass(status) { return status === 'in-use' ? 'in-use' : status === 'maintenance' ? 'maintenance' : 'available'; }
function reservationStatus(r) { const now = Date.now(), s = new Date(r.startTime).getTime(), e = new Date(r.endTime).getTime(); return now < s ? 'upcoming' : now > e ? 'completed' : 'active'; }

function goTo(view) {
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach(v => v.classList.add('hidden'));
  const target = $('#view-' + view);
  if (target) target.classList.remove('hidden');

  if (view === 'dashboard') renderDashboard();
  if (view === 'assets') renderAssets();
  if (view === 'reservations') renderReservations();
  if (view === 'calendar') renderCalendar();
  if (view === 'map') renderLiveMap();
  if (view === 'scan') renderScan();
  if (view === 'inspections') renderInspections();
  if (view === 'reports') renderReportsView();
  if (view === 'users') renderUsers();
  if (view === 'logs') renderLogs();
}

function renderLogs() {
  const tbody = $('#logs-tbody'); if (!tbody) return;
  const search = ($('#log-search')?.value || '').toLowerCase();

  let list = activityLogs;
  if (search) {
    list = list.filter(l =>
      (l.user_name || '').toLowerCase().includes(search) ||
      (l.action || '').toLowerCase().includes(search) ||
      (l.details || '').toLowerCase().includes(search) ||
      (l.role || '').toLowerCase().includes(search)
    );
  }

  tbody.innerHTML = list.map(l => {
    let actionColor = 'var(--primary)', actionBg = '#eff6ff';
    const act = (l.action || '').toUpperCase();
    if (act.includes('DELETE') || act.includes('REJECT') || act.includes('REMOVED')) { actionColor = 'var(--red)'; actionBg = '#fef2f2'; }
    else if (act.includes('CREATE') || act.includes('ADD') || act.includes('LOGGED') || act.includes('REGISTERED')) { actionColor = 'var(--green)'; actionBg = '#f0fdf4'; }
    else if (act.includes('UPDATE') || act.includes('CHANGE') || act.includes('STATUS')) { actionColor = 'var(--amber)'; actionBg = '#fffbeb'; }

    return `
      <tr>
        <td class="muted small" style="white-space:nowrap; font-family:monospace; font-size:12px;">${fmtDate(l.timestamp)}</td>
        <td>
          <div class="cell-strong" style="color:var(--text-main); font-size: 13px;">${esc(l.user_name)}</div>
          <div class="muted small" style="font-size:11px; margin-top:2px;">${esc((l.role || '').replace('_', ' ').toUpperCase())}</div>
        </td>
        <td><span style="background:${actionBg}; color:${actionColor}; padding:4px 8px; border-radius:6px; font-size:11px; font-weight:800; border:1px solid ${actionColor}33; letter-spacing:0.5px;">${esc(act)}</span></td>
        <td style="color:var(--text-muted); font-size:13px; line-height:1.5;">${esc(l.details)}</td>
      </tr>`;
  }).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:40px; font-size:14px;">No system activity matching criteria.</td></tr>';
}

let editingUserId = null, passwordUserId = null;
function renderUsers() {
  const tbody = $('#users-tbody'); if (!tbody) return;
  tbody.innerHTML = usersList.map(u => {
    const safeRole = u.role ? u.role.replace('_', ' ').toUpperCase() : 'UNASSIGNED';
    const safeName = u.full_name || 'Unknown User';
    return `<tr><td><div class="cell-strong">${esc(safeName)}</div></td><td>${esc(u.email)}</td><td><span class="badge badge-in-use">${esc(safeRole)}</span></td><td><div style="display:flex; gap:6px;"><button class="btn btn-ghost btn-sm" style="color:var(--primary);" onclick="openEditUserModal('${esc(u.id)}')">✏️ Edit</button><button class="btn btn-ghost btn-sm" style="color:var(--amber);" onclick="openPasswordModal('${esc(u.id)}')">🔑 Pass</button><button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="deleteUser('${esc(u.id)}')">🗑️ Del</button></div></td></tr>`;
  }).join('');
}

function openAddUserModal() { editingUserId = null; $('#form-user').reset(); $('#user-modal-title').textContent = 'Add New User'; $('#user-password-field').classList.remove('hidden'); $('#form-user [name=password]').required = true; openModal('modal-user'); }
function openEditUserModal(id) { const u = usersList.find(x => x.id === id); if (!u) return; editingUserId = id; $('#form-user').reset(); $('#user-modal-title').textContent = 'Edit User Data'; $('#form-user [name=fullName]').value = u.full_name; $('#form-user [name=email]').value = u.email; $('#form-user [name=role]').value = u.role; $('#user-password-field').classList.add('hidden'); $('#form-user [name=password]').required = false; openModal('modal-user'); }

$('#form-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = { fullName: f.get('fullName'), email: f.get('email'), role: f.get('role') };
  try {
    let res;
    if (editingUserId) {
      res = await fetch(`${API_BASE_URL}/users/${editingUserId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(payload) });
    } else {
      payload.password = f.get('password');
      res = await fetch(`${API_BASE_URL}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(payload) });
    }
    if (handleAuthError(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown database rejection');
    toast(editingUserId ? '✅ User updated!' : '✅ New user created!');
    closeModal('modal-user');
    await load();
  } catch (err) {
    alert('SYSTEM ERROR:\n\n' + err.message);
    toast('⚠️ Error saving user.');
  }
});

function openPasswordModal(id) { passwordUserId = id; $('#form-password').reset(); openModal('modal-password'); }
$('#form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch(`${API_BASE_URL}/users/${passwordUserId}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify({ password: new FormData(e.target).get('newPassword') }) });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Password reset failed');
    toast('✅ Password reset securely!');
    closeModal('modal-password');
  } catch (err) {
    toast('Error changing password.');
  }
});

async function deleteUser(id) {
  if (!confirm('Permanently delete this user account?')) return;
  try {
    const res = await fetch(`${API_BASE_URL}/users/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Delete failed');
    toast('🗑️ User removed successfully.');
    await load();
  } catch (err) {
    toast('Error removing user.');
  }
}

function renderDashboard() {
  $('#kpi-total').textContent = assets.length;
  $('#kpi-available').textContent = assets.filter(a => a.status === 'available').length;
  $('#kpi-inuse').textContent = assets.filter(a => a.status === 'in-use').length;
  $('#kpi-maint').textContent = assets.filter(a => a.status === 'maintenance').length;

  let safeCount = 0, soonCount = 0, expCount = 0;
  const today = new Date();
  assets.forEach(a => {
    const { latest } = getLatestInspection(a.id);
    if (latest) {
      const days = Math.ceil((new Date(latest.next_annual_due) - today) / 86400000);
      if (days < 0 || latest.status === 'Rejected') expCount++;
      else if (days <= 30) soonCount++;
      else safeCount++;
    }
  });

  if ($('#dash-safe-cleared')) $('#dash-safe-cleared').textContent = safeCount;
  if ($('#dash-safe-soon')) $('#dash-safe-soon').textContent = soonCount;
  if ($('#dash-safe-expired')) $('#dash-safe-expired').textContent = expCount;

  const activeList = reservations.filter(r => reservationStatus(r) === 'active');
  $('#active-count').textContent = activeList.length + ' running';
  $('#active-list').innerHTML = activeList.length ? activeList.map(r => {
    const a = getAsset(r.assetId); if (!a) return '';
    return `<div class="list-item" onclick="showDetail('${esc(a.id)}')"><div class="li-ico">${typeIcon(a.type)}</div><div class="li-main"><div class="li-title">${esc(a.plate_number)}</div><div class="li-sub">${esc(r.operatorName)} &bull; ${esc(a.name)}</div></div><div class="li-meta"><div class="cell-strong">Until ${fmtDateShort(r.endTime)}</div></div></div>`;
  }).join('') : '<p class="muted small" style="padding:12px">No active assignments running now.</p>';

  drawStatusChart([$('#kpi-available').textContent, $('#kpi-inuse').textContent, $('#kpi-maint').textContent]);
}

function drawStatusChart(data) {
  const ctx = $('#chart-status'); if (!ctx) return;
  if (charts.status) charts.status.destroy();
  charts.status = new Chart(ctx, { type: 'doughnut', data: { labels: ['Available', 'In Use', 'Maintenance'], datasets: [{ data, backgroundColor: ['#16a34a', '#d97706', '#dc2626'], borderWidth: 0 }] }, options: { cutout: '65%', responsive: true, maintainAspectRatio: false } });
}

function renderAssets() {
  const search = ($('#asset-search')?.value || '').toLowerCase();
  let list = assets.filter(a => assetFilter === 'all' ? true : a.status === assetFilter);
  if (search) list = list.filter(a => a.name.toLowerCase().includes(search) || a.plate_number.toLowerCase().includes(search));

  const gridContainer = $('#asset-grid');
  if (assetViewMode === 'list') {
    gridContainer.style.display = 'flex';
    gridContainer.style.flexDirection = 'column';
    gridContainer.style.gap = '12px';
  } else {
    gridContainer.style.display = 'grid';
    gridContainer.style.flexDirection = '';
  }

  gridContainer.innerHTML = list.length ? list.map(a => {
    const { latest } = getLatestInspection(a.id);
    const rate = parseFloat(a.hourly_rate || 0);
    let inspHtml = '<span class="v" style="color:var(--text-muted); font-size:11px;">No Data</span>';
    if (latest) {
      const days = Math.ceil((new Date(latest.next_annual_due) - new Date()) / 86400000);
      if (days < 0 || latest.status === 'Rejected') inspHtml = '<span class="v" style="color:var(--red);font-weight:700;">Expired</span>';
      else if (days <= 30) inspHtml = `<span class="v" style="color:var(--amber);font-weight:700;">Due in ${days}d</span>`;
      else inspHtml = `<span class="v" style="color:var(--green);font-weight:700;">Valid</span>`;
    }

    const imgStyle = a.image_data ? `background-image: url(${esc(a.image_data)}); background-size: cover; background-position: center;` : 'background: #f1f5f9; display:flex; align-items:center; justify-content:center;';

    if (assetViewMode === 'list') {
      const imgContentSmall = a.image_data ? '' : `<span style="font-size: 24px; opacity: 0.25;">${typeIcon(a.type)}</span>`;
      return `
      <div style="display:flex; align-items:center; background:#fff; border:1px solid var(--border); border-radius:10px; padding:12px; gap:16px; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,0.02); transition: transform 0.2s;" onclick="showDetail('${esc(a.id)}')" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
          <div style="width:90px; height:70px; border-radius:6px; flex-shrink:0; border:1px solid var(--border); ${imgStyle}">${imgContentSmall}</div>
          <div style="flex-grow:1; display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:12px; align-items:center;">
              <div>
                  <div style="font-weight: 800; font-size: 15px; color: var(--text-main); margin-bottom: 2px;">${esc(a.plate_number)}</div>
                  <div style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${typeIcon(a.type)} ${esc(a.type)} &bull; ${esc(a.name)}</div>
              </div>
              <div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 2px;">Location</div>
                  <div style="font-size: 13px; font-weight: 600; color: var(--text-main);">${esc(a.current_location || '—')}</div>
              </div>
              <div>
                  <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 2px;">Safety Status</div>
                  <div style="font-size: 13px;">${inspHtml}</div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end;">
                  ${statusBadge(a.status)}
                  <div style="font-weight:800; color:var(--green); font-size:14px; margin-top:4px;">$${rate}<span style="font-size:11px; font-weight:600; color:var(--text-muted);">/hr</span></div>
              </div>
          </div>
      </div>`;
    }

    const imgContent = a.image_data ? '' : `<span style="font-size: 44px; opacity: 0.25;">${typeIcon(a.type)}</span>`;
    return `<div class="asset-card" style="padding:0; overflow:hidden; display:flex; flex-direction:column; cursor:pointer; border:1px solid var(--border); border-radius:12px; box-shadow:0 2px 6px rgba(0,0,0,0.03);" onclick="showDetail('${esc(a.id)}')"><div style="height: 150px; width: 100%; border-bottom: 1px solid var(--border); ${imgStyle}">${imgContent}</div><div style="padding: 16px;"><div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 12px;"><div><div style="font-weight: 800; font-size: 16px; color: var(--text-main); margin-bottom: 2px;">${esc(a.plate_number)}</div><div style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${typeIcon(a.type)} ${esc(a.type)} &bull; <span style="color:var(--primary);">${esc(a.name)}</span></div></div>${statusBadge(a.status)}</div><div style="display:flex; flex-direction:column; gap:6px; margin-top: 12px; font-size:12px;"><div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">Rate</span><span style="font-weight:700; color:var(--green);">$${rate}/hr</span></div><div style="display:flex; justify-content:space-between;"><span style="color:var(--text-muted);">Location</span><span style="font-weight:600; color:var(--text-main);">${esc(a.current_location || '—')}</span></div><div style="display:flex; justify-content:space-between; border-top:1px dashed var(--border); padding-top:8px; margin-top:2px;"><span style="color:var(--text-muted);">Safety Status</span>${inspHtml}</div></div></div></div>`;
  }).join('') : '<div class="muted" style="grid-column: 1 / -1; text-align: center; padding: 40px; font-size: 14px;">No matching vehicles found.</div>';
}

function renderReservations() {
  let list = reservations.slice().sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  if (resFilter !== 'all') list = list.filter(r => reservationStatus(r) === resFilter);
  const tbody = $('#res-tbody'); if (!tbody) return;
  const canEdit = currentUser && (currentUser.role === 'site_manager' || currentUser.role === 'field_engineer');

  tbody.innerHTML = list.length ? list.map(r => {
    const a = getAsset(r.assetId); if (!a) return '';
    const st = reservationStatus(r);
    const actionsHtml = canEdit ? `<div style="display:flex;gap:8px;"><button class="btn btn-ghost btn-sm" onclick="openEditReservation('${esc(r.id)}')">✏️</button><button class="btn btn-ghost btn-sm" onclick="deleteReservation('${esc(r.id)}')">🗑️</button></div>` : '—';
    return `<tr><td><div class="cell-strong">${typeIcon(a.type)} ${esc(a.plate_number)}</div><div class="muted small">${esc(a.name)}</div></td><td>${esc(r.operatorName || '—')}</td><td>${fmtDate(r.startTime)}</td><td>${fmtDate(r.endTime)}</td><td class="cell-strong">${hoursBetween(r.startTime, r.endTime).toFixed(1)} h</td><td>${esc(r.purpose)}</td><td><span class="badge badge-${st === 'active' ? 'in-use' : st === 'upcoming' ? 'available' : 'maintenance'}">${st}</span></td><td>${actionsHtml}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="muted" style="text-align:center;">No reservation sheets.</td></tr>';
}

function shiftMonth(delta) { calMonth.setMonth(calMonth.getMonth() + delta); renderCalendar(); }

function renderCalendar() {
  const year = calMonth.getFullYear(), month = calMonth.getMonth();
  if ($('#cal-title')) $('#cal-title').textContent = calMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const startDay = new Date(year, month, 1).getDay(), daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';
  for (let i = 0; i < startDay; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const check = new Date(year, month, d);
    const dayRes = reservations.filter(r => {
      if (!r.startTime || !r.endTime) return false;
      const s = new Date(r.startTime), e = new Date(r.endTime);
      return check >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) && check <= new Date(e.getFullYear(), e.getMonth(), e.getDate());
    });
    const evHtml = dayRes.slice(0, 3).map((r, i) => {
      const a = getAsset(r.assetId);
      const operator = r.operatorName || 'Unknown';
      return a ? `<div class="cal-event ${['', 'green', 'blue'][i % 3]}" onclick="showDetail('${esc(a.id)}')" title="${esc(a.plate_number)} reserved by ${esc(operator)}">${typeIcon(a.type)} ${esc(a.plate_number)} &bull; ${esc(operator)}</div>` : '';
    }).join('');
    html += `<div class="cal-cell ${check.toDateString() === new Date().toDateString() ? 'today' : ''}"><div class="cal-num">${d}</div>${evHtml}</div>`;
  }
  if ($('#cal-grid')) $('#cal-grid').innerHTML = html;
}

function renderLiveMap() {
  if ($('#map-stat-avail')) {
    $('#map-stat-avail').textContent = assets.filter(a => a.status === 'available').length;
    $('#map-stat-inuse').textContent = assets.filter(a => a.status === 'in-use').length;
    $('#map-stat-maint').textContent = assets.filter(a => a.status === 'maintenance').length;
  }

  setTimeout(() => {
    if (!mapInstance) {
      mapInstance = L.map('map-container', { zoomControl: false }).setView([21.692153, 91.867748], 13);
      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(mapInstance);
    } else {
      mapInstance.invalidateSize();
      mapInstance.eachLayer(l => { if (l instanceof L.Marker) mapInstance.removeLayer(l); });
    }

    const bounds = [];
    assets.forEach(a => {
      if (a.latitude && a.longitude) {
        bounds.push([a.latitude, a.longitude]);
        const c = a.status === 'in-use' ? '#d97706' : a.status === 'maintenance' ? '#dc2626' : '#16a34a';
        const iconHtml = `<div style="background:${c}; width:36px; height:36px; border-radius:50%; display:grid; place-items:center; border:3px solid white; color:white; box-shadow: 0 4px 8px rgba(0,0,0,0.3); font-size:18px; transition: transform 0.2s;">${typeIcon(a.type)}</div>`;
        const imgStr = a.image_data
          ? `<img src="${esc(a.image_data)}" style="width:100%; height:110px; object-fit:cover; border-radius:6px; margin-bottom:12px; display:block; border:1px solid var(--border);" />`
          : `<div style="width:100%; height:90px; background:#f1f5f9; border-radius:6px; margin-bottom:12px; display:grid; place-items:center; color:#94a3b8; font-size:28px;">${typeIcon(a.type)}</div>`;

        const popupContent = `
          <div style="width: 230px; font-family: 'Inter', sans-serif;">
            ${imgStr}
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <div style="font-weight:800; font-size:16px; color:var(--text-main); margin:0;">${esc(a.plate_number)}</div>
              ${statusBadge(a.status)}
            </div>
            <div style="font-size:12px; color:var(--text-muted); font-weight:600; margin-bottom: 6px;">${esc(a.type)} &bull; ${esc(a.name)}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-bottom: 14px; display:flex; align-items:center; gap:4px;"><span>📍</span> ${esc(a.current_location || 'Unknown Zone')}</div>
            <button class="btn btn-primary" style="width:100%; padding:8px; font-size:13px; font-weight:600; border-radius:6px; margin:0;" onclick="showDetail('${esc(a.id)}')">View Full Specs</button>
          </div>`;

        L.marker([a.latitude, a.longitude], {
          icon: L.divIcon({ className: 'custom-map-pin', html: iconHtml, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36] })
        }).addTo(mapInstance).bindPopup(popupContent, { minWidth: 230 });
      }
    });

    if (bounds.length > 0) mapInstance.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  }, 100);
}

function renderScan() {
  const qrGrid = $('#qr-grid'); if (!qrGrid) return;
  qrGrid.innerHTML = assets.map(a => `<div class="qr-card" style="display:flex; flex-direction:column; align-items:center;"><div class="qr-box" id="qr-target-${esc(a.id)}" onclick="simulateScan('${esc(a.id)}')" style="cursor:pointer;"></div><div class="qr-name" style="margin-bottom: 12px;">${typeIcon(a.type)} ${esc(a.plate_number)}</div><button class="btn btn-ghost btn-sm" style="width:100%; border: 1px solid var(--border); color: var(--primary);" onclick="downloadHighResQR('${esc(a.id)}', '${esc(a.plate_number)}')">⬇️ Download High-Res</button></div>`).join('');
  assets.forEach(a => {
    const el = $('#qr-target-' + a.id);
    if (el) { el.innerHTML = ''; new QRCode(el, { text: `${window.location.origin}/#scan=${a.id}`, width: 110, height: 110, colorDark: '#0f1626', colorLight: '#ffffff' }); }
  });
}

function downloadHighResQR(assetId, plateNumber) {
  toast('⌛ Generating high-resolution QR code...');
  const tempDiv = document.createElement('div');
  new QRCode(tempDiv, { text: `${window.location.origin}/#scan=${assetId}`, width: 1024, height: 1024, colorDark: '#000000', colorLight: '#ffffff' });
  setTimeout(() => {
    const canvas = tempDiv.querySelector('canvas');
    if (canvas) {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `FleetOps_QR_${plateNumber.replace(/\s+/g, '_')}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      toast('✅ High-Res QR downloaded successfully!');
    }
  }, 250);
}

function simulateScan(assetId) {
  const a = getAsset(assetId); if (!a) return;
  const { latest: insp } = getLatestInspection(assetId);

  const safeOwner = esc(a.owner || (insp ? insp.owner : '—'));
  const safeBrand = esc(a.brand || (insp ? insp.brand : '—'));
  const safeSerial = esc(a.serial_no || (insp ? insp.serial_no : '—'));
  const safeEngine = esc(a.engine_no || (insp ? insp.engine_no : '—'));
  const safeYear = esc(a.manufacturer_year || (insp ? insp.manufacturer_year : '—'));

  let inspHtml = '<div style="margin-top:16px;padding:12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;text-align:center;"><span style="color:var(--red);font-weight:700;">⚠️ No Pre-Mobilization Inspection on Record</span></div>';
  if (insp) {
    const days = Math.ceil((new Date(insp.next_annual_due) - new Date()) / 86400000);
    const color = days < 0 || insp.status === 'Rejected' ? 'var(--red)' : days <= 30 ? 'var(--amber)' : 'var(--green)';
    const conditionalHtml = insp.status === 'Conditional' && insp.remarks ? `<div style="display: flex; flex-direction: column; margin-bottom: 8px; background: #fffbeb; padding: 8px; border-radius: 6px; border: 1px solid #fcd34d;"><span style="font-size: 11px; color: #b45309; font-weight: 800; text-transform: uppercase;">⚠️ Minor Fix Required:</span><span style="font-size: 12px; color: var(--text-main); font-weight: 600; margin-top: 2px;">${esc(insp.remarks)}</span></div>` : '';
    inspHtml = `<div style="margin-top: 16px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; text-align: left; background: #f8fafc; width: 100%;"><div style="font-size: 11px; color: var(--text-muted); font-weight: 800; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">🛡️ Equipment & Safety Specs</div><div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Status:</span><span style="font-size: 12px; font-weight: 800; color: ${color};">${esc(insp.status.toUpperCase())}</span></div>${conditionalHtml}<div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Owner:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main);">${safeOwner}</span></div><div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Brand / Model:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main);">${safeBrand} ${esc(a.name)} (${safeYear})</span></div><div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Serial No:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main); font-family: monospace;">${safeSerial}</span></div><div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Engine No:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main); font-family: monospace;">${safeEngine}</span></div><div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Location:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main);">${esc(a.current_location)}</span></div><div style="display: flex; justify-content: space-between; margin-bottom: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Inspection Date:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main);">${fmtDateShort(insp.inspection_date)}</span></div><div style="display: flex; justify-content: space-between;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Valid Until:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main);">${fmtDateShort(insp.next_annual_due)}</span></div><div style="display: flex; justify-content: space-between; margin-top: 8px;"><span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Inspected By:</span><span style="font-size: 12px; font-weight: 700; color: var(--text-main);">${esc(insp.inspected_by)}</span></div></div>`;
  }

  const imageHtml = a.image_data ? `<img src="${esc(a.image_data)}" style="width:100%; height:180px; object-fit:cover; border-radius:8px; margin-bottom:12px; display:block;" alt="Vehicle Photo" />` : `<div style="width:100%; height:120px; background:#f1f5f9; border-radius:8px; display:grid; place-items:center; margin-bottom:12px; color:#94a3b8; font-weight:600;">No Photo Uploaded</div>`;
  const canReserve = currentUser && (currentUser.role === 'site_manager' || currentUser.role === 'field_engineer') && a.status !== 'maintenance';
  const reserveBtn = canReserve ? `<button class="btn btn-primary" style="width:100%; margin-bottom: 8px;" onclick="closeModal('modal-scan');openReserveFor('${esc(a.id)}')">+ Reserve This Vehicle</button>` : '';

  $('#scan-body').innerHTML = `<div class="scan-result" style="max-height: 75vh; overflow-y: auto; padding-right: 6px;">${imageHtml}<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;"><div class="scan-status-pill ${statusPillClass(a.status)}" style="margin:0;"><span class="scan-status-dot"></span>${esc(a.status.toUpperCase())}</div><div style="font-size: 13px; font-weight: 700; color: var(--primary); background: #eff6ff; padding: 4px 10px; border-radius: 6px; border: 1px solid #bfdbfe;">ID: ${esc(a.plate_number)}</div></div><div class="scan-vehicle-name" style="margin-bottom: 16px; font-size: 18px;">${typeIcon(a.type)} ${esc(a.type)} &bull; ${esc(a.name)}</div>${reserveBtn}${inspHtml}</div>`;

  closeModal('modal-auth');
  openModal('modal-scan');

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (currentUser && isMobile && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        let locName = 'Field Scanned Zone';
        try {
          const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
          const geoData = await geoRes.json();
          locName = geoData.address.suburb || geoData.address.village || geoData.address.city || geoData.address.county || 'Field Scanned Zone';
        } catch (geoErr) { console.log('Reverse geocoding skipped'); }

        await fetch(`${API_BASE_URL}/assets/${assetId}/location`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          body: JSON.stringify({ latitude: lat, longitude: lon, locationName: locName })
        });
        toast(`📍 Location updated to: ${locName}`);
      } catch (e) {}
    }, () => {}, { enableHighAccuracy: true });
  }
}

function renderReportsView() {
  const tbody = $('#report-tbody'); if (!tbody) return;
  let cost = 0, hrs = 0, count = 0;
  tbody.innerHTML = assets.map(a => {
    const logs = reservations.filter(r => r.assetId === a.id);
    let h = 0; logs.forEach(r => h += hoursBetween(r.startTime, r.endTime));
    const rate = parseFloat(a.hourly_rate || 0);
    const c = h * rate;
    cost += c; hrs += h; count += logs.length;
    return `<tr><td>${esc(a.plate_number)}</td><td>${esc(a.type)}</td><td>$${rate}</td><td>${logs.length}</td><td>${h.toFixed(1)}</td><td>$${c.toFixed(2)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;">No data.</td></tr>';

  if ($('#rep-kpi-cost')) $('#rep-kpi-cost').textContent = `$${cost.toFixed(2)}`;
  if ($('#rep-kpi-hours')) $('#rep-kpi-hours').textContent = `${hrs.toFixed(1)} h`;
  if ($('#rep-kpi-count')) $('#rep-kpi-count').textContent = count;
}

function renderInspections() {
  const tbody = $('#inspection-tbody'); if (!tbody) return;
  let sC = 0, dC = 0, eC = 0, today = new Date();
  const canEdit = currentUser && (currentUser.role === 'site_manager' || currentUser.role === 'safety_team');

  const latestInspections = {};
  inspections.forEach(i => {
    if (!latestInspections[i.asset_id] || new Date(i.inspection_date) > new Date(latestInspections[i.asset_id].inspection_date)) {
      latestInspections[i.asset_id] = i;
    }
  });

  tbody.innerHTML = Object.values(latestInspections).map(i => {
    const a = getAsset(i.asset_id);
    const mID = a ? a.plate_number : i.asset_id;
    const days = Math.ceil((new Date(i.next_annual_due) - today) / 86400000);
    let badge = '';
    if (days < 0 || i.status === 'Rejected') { eC++; badge = `<span class="badge badge-maintenance">EXPIRED</span>`; }
    else if (days <= 30) { dC++; badge = `<span class="badge badge-in-use">DUE SOON</span>`; }
    else { sC++; badge = `<span class="badge badge-available">VALID</span>`; }

    const updateBtn = canEdit ? `<button class="btn btn-ghost btn-sm" onclick="openAnnualRenewalModal('${esc(i.asset_id)}')">🔄 Update</button>` : '—';
    return `<tr><td>${esc(mID)}</td><td>${esc(i.owner)}</td><td>${esc(i.brand)} ${esc(i.model)}</td><td>S/N: ${esc(i.serial_no)}</td><td>${esc(i.manufacturer_year)}</td><td>${esc(i.inspection_location)}</td><td>${fmtDateShort(i.inspection_date)}</td><td>${badge}</td><td>${updateBtn}</td></tr>`;
  }).join('') || '<tr><td colspan="9" style="text-align:center;">No records.</td></tr>';

  if ($('#insp-kpi-valid')) $('#insp-kpi-valid').textContent = sC;
  if ($('#insp-kpi-soon')) $('#insp-kpi-soon').textContent = dC;
  if ($('#insp-kpi-expired')) $('#insp-kpi-expired').textContent = eC;
}

window.viewPDF = function(globalIndex) {
  const inst = inspections[globalIndex];
  if (!inst || !inst.report_doc) return toast('⚠️ No PDF attached to this record.');
  $('#pdf-modal-title').textContent = `Inspection Report: ${fmtDateShort(inst.inspection_date)}`;
  $('#pdf-iframe').src = inst.report_doc;
  openModal('modal-pdf');
};

window.updateInspectionImage = function(assetId) {
  const a = getAsset(assetId);
  const preview = $('#insp-image-preview');
  if (!preview) return;
  if (a && a.image_data) {
    preview.style.backgroundImage = `url(${a.image_data})`;
    preview.innerHTML = '';
  } else {
    preview.style.backgroundImage = 'none';
    preview.innerHTML = 'No Photo Uploaded';
  }
};

function openInspectionModal() {
  $('#form-inspection').reset();
  window.toggleRemarksField('Cleared');
  $('#insp-modal-title').textContent = 'Safety Inspection';
  $('#form-inspection [name=assetId]').innerHTML = assets.map(a => `<option value="${esc(a.id)}">${esc(a.plate_number)} (${esc(a.type)} - ${esc(a.name)})</option>`).join('');
  $('#form-inspection [name=inspectionDate]').value = new Date().toISOString().split('T')[0];
  if (assets.length > 0) window.updateInspectionImage(assets[0].id);
  openModal('modal-inspection');
}

function openAnnualRenewalModal(id) {
  const { latest: r } = getLatestInspection(id); if (!r) return;
  const a = getAsset(id);
  $('#form-inspection').reset();
  $('#insp-modal-title').textContent = 'Annual Renewal';
  $('#form-inspection [name=assetId]').innerHTML = `<option value="${esc(r.asset_id)}">${a ? esc(a.plate_number) + ' (' + esc(a.type) + ' - ' + esc(a.name) + ')' : esc(r.asset_id)}</option>`;
  window.updateInspectionImage(r.asset_id);
  ['owner', 'brand', 'model', 'serialNo', 'engineNo', 'manufacturerYear', 'inspectionLocation'].forEach(k => $('#form-inspection [name=' + k + ']').value = r[k.replace(/[A-Z]/g, m => '_' + m.toLowerCase())]);
  $('#form-inspection [name=status]').value = r.status || 'Cleared';
  window.toggleRemarksField(r.status);
  if (r.status === 'Conditional' && r.remarks) $('#form-inspection [name=remarks]').value = r.remarks;
  openModal('modal-inspection');
}

window.toggleRemarksField = function(status) {
  const container = $('#remarks-container'); if (!container) return;
  const textarea = container.querySelector('textarea');
  if (status === 'Conditional') { container.classList.remove('hidden'); if (textarea) textarea.required = true; }
  else { container.classList.add('hidden'); if (textarea) { textarea.required = false; textarea.value = ''; } }
};

document.addEventListener('DOMContentLoaded', () => {
  const dd = document.querySelector('select[name="status"]');
  if (dd) dd.addEventListener('change', e => window.toggleRemarksField(e.target.value));
});

// Safety Inspection (Multipart PDF)
if ($('#form-inspection')) {
  $('#form-inspection').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const fileInput = $('#inspection-report-upload');
    if (fileInput && fileInput.files.length > 0) f.set('reportDoc', fileInput.files[0]);
    try {
      const res = await fetch(`${API_BASE_URL}/inspections`, { method: 'POST', headers: getAuthHeader(), body: f });
      if (handleAuthError(res)) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      closeModal('modal-inspection'); load(); toast('✅ Safety Inspection Logged!');
    } catch (err) {
      alert('Inspection Error: ' + err.message);
      toast('⚠️ Error saving inspection.');
    }
  });
}

function openAddVehicleModal() { $('#form-add-asset').reset(); openModal('modal-add-asset'); }

// Add Vehicle (Multipart)
$('#form-add-asset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const fileInput = $('#asset-image-upload');
  if (fileInput && fileInput.files.length > 0) f.set('image', fileInput.files[0]);
  f.set('latitude', '21.692153');
  f.set('longitude', '91.867748');
  try {
    const res = await fetch(`${API_BASE_URL}/assets`, { method: 'POST', headers: getAuthHeader(), body: f });
    if (handleAuthError(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    closeModal('modal-add-asset'); load(); toast('✅ Vehicle Saved!');
  } catch (err) {
    alert('Save Error: ' + err.message);
    toast('⚠️ Error saving vehicle.');
  }
});

function openEditAssetModal(id) {
  const a = getAsset(id); if (!a) return;
  const { latest: insp } = getLatestInspection(a.id);
  $('#edit-asset-id').value = a.id;
  $('#edit-asset-name').value = a.name;
  $('#edit-asset-type').value = a.type;
  $('#edit-asset-plate').value = a.plate_number;
  $('#edit-asset-rate').value = parseFloat(a.hourly_rate || 0);
  $('#edit-asset-location').value = a.current_location || '';
  if ($('#edit-asset-owner')) $('#edit-asset-owner').value = a.owner || (insp ? insp.owner : '');
  if ($('#edit-asset-brand')) $('#edit-asset-brand').value = a.brand || (insp ? insp.brand : '');
  if ($('#edit-asset-serial')) $('#edit-asset-serial').value = a.serial_no || (insp ? insp.serial_no : '');
  if ($('#edit-asset-engine')) $('#edit-asset-engine').value = a.engine_no || (insp ? insp.engine_no : '');
  if ($('#edit-asset-year')) $('#edit-asset-year').value = a.manufacturer_year || (insp ? insp.manufacturer_year : '');
  $('#edit-asset-image-upload').value = '';
  closeModal('modal-detail'); openModal('modal-edit-asset');
}

// Edit Vehicle (Multipart)
$('#form-edit-asset').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const assetId = f.get('assetId');
  const fileInput = $('#edit-asset-image-upload');
  if (fileInput && fileInput.files.length > 0) f.set('image', fileInput.files[0]);
  try {
    const res = await fetch(`${API_BASE_URL}/assets/${assetId}`, { method: 'PUT', headers: getAuthHeader(), body: f });
    if (handleAuthError(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    closeModal('modal-edit-asset'); load(); toast('✅ Vehicle profile updated!');
  } catch (err) {
    alert('Update Error: ' + err.message);
    toast('⚠️ Error updating vehicle.');
  }
});

async function deleteAsset(id) {
  if (!confirm('🚨 WARNING: This will permanently delete this vehicle, along with its inspection history and reservations. Continue?')) return;
  try {
    const res = await fetch(`${API_BASE_URL}/assets/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Deletion failed');
    toast('🗑️ Vehicle removed completely.'); closeModal('modal-detail'); load();
  } catch (err) { toast('⚠️ Error removing vehicle.'); }
}

window.toggleMaintenance = async function(id, newStatus) {
  if (!confirm(`Are you sure you want to mark this vehicle as ${newStatus.toUpperCase()}?`)) return;
  try {
    const res = await fetch(`${API_BASE_URL}/assets/${id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify({ status: newStatus }) });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Failed to update status');
    toast(`✅ Vehicle marked as ${newStatus}.`); closeModal('modal-detail'); load();
  } catch (err) { toast('⚠️ Error updating vehicle status.'); }
};

window.toggleHistory = function(hiddenCount) {
  const items = document.querySelectorAll('.hidden-history');
  const btn = document.getElementById('btn-toggle-history');
  if (!items || items.length === 0) return;
  const isCurrentlyHidden = items[0].style.display === 'none';
  items.forEach(item => { item.style.display = isCurrentlyHidden ? 'flex' : 'none'; });
  btn.innerHTML = isCurrentlyHidden ? 'Show Less ▲' : `View ${hiddenCount} More Records ▼`;
};

function showDetail(id) {
  const a = getAsset(id); if (!a) return;
  const { latest: insp, history: assetHistory } = getLatestInspection(a.id);
  $('#detail-title').textContent = a.plate_number;

  const safeOwner = esc(a.owner || (insp ? insp.owner : '—'));
  const safeBrand = esc(a.brand || (insp ? insp.brand : '—'));
  const safeSerial = esc(a.serial_no || (insp ? insp.serial_no : '—'));
  const safeEngine = esc(a.engine_no || (insp ? insp.engine_no : '—'));
  const safeYear = esc(a.manufacturer_year || (insp ? insp.manufacturer_year : '—'));

  const activeResList = reservations
    .filter(r => r.assetId === a.id && ['active', 'upcoming'].includes(reservationStatus(r)))
    .sort((r1, r2) => new Date(r1.startTime) - new Date(r2.startTime));
  const activeRes = activeResList[0];

  let reservationAlertHtml = '';
  if (activeRes) {
    const resStatus = reservationStatus(activeRes);
    const statusColor = resStatus === 'active' ? '#d97706' : '#16a34a';
    const bgColor = resStatus === 'active' ? '#fffbeb' : '#f0fdf4';
    const borderColor = resStatus === 'active' ? '#fcd34d' : '#bbf7d0';
    reservationAlertHtml = `
      <div style="margin-top: 16px; padding: 16px; background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 8px;">
        <div style="font-size: 11px; font-weight: 800; color: ${statusColor}; text-transform: uppercase; margin-bottom: 10px; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
          ${resStatus === 'active' ? '🚧 Currently Reserved & In Use' : '📅 Upcoming Reservation'}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
          <div><span style="color: var(--text-muted); font-size: 11px; display:block; margin-bottom:2px;">Operator</span><span style="font-weight: 700; color: var(--text-main);">${esc(activeRes.operatorName)}</span></div>
          <div><span style="color: var(--text-muted); font-size: 11px; display:block; margin-bottom:2px;">Purpose</span><span style="font-weight: 700; color: var(--text-main);">${esc(activeRes.purpose)}</span></div>
          <div style="grid-column: 1 / -1;"><span style="color: var(--text-muted); font-size: 11px; display:block; margin-bottom:2px;">Schedule</span><span style="font-weight: 700; color: var(--text-main);">${fmtDate(activeRes.startTime)} — ${fmtDate(activeRes.endTime)}</span></div>
        </div>
      </div>`;
  }

  const imageHtml = a.image_data
    ? `<div style="position:relative; margin-bottom:20px;">
         <img src="${esc(a.image_data)}" style="width:100%; height:260px; object-fit:cover; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.08); display:block;" alt="Vehicle Photo" />
         <div style="position:absolute; top:12px; right:12px; background:white; border-radius:20px; padding:2px 4px; box-shadow:0 2px 8px rgba(0,0,0,0.15);">${statusBadge(a.status)}</div>
       </div>`
    : `<div style="width:100%; height:260px; background:#f8fafc; border-radius:12px; display:grid; place-items:center; margin-bottom:20px; color:#94a3b8; font-weight:600; border:2px dashed var(--border);">No Photo Uploaded<br/>${statusBadge(a.status)}</div>`;

  const canEdit = (currentUser && currentUser.role === 'site_manager');
  const canReserve = (currentUser && (currentUser.role === 'site_manager' || currentUser.role === 'field_engineer'));

  let reserveBtn = '';
  if (canReserve) {
    reserveBtn = a.status === 'maintenance'
      ? `<button class="btn btn-ghost" style="width:100%; padding:14px; font-size:14px; font-weight:600; border-radius:8px; margin-bottom:12px; border:1px solid var(--border); color:var(--text-muted); cursor:not-allowed;" disabled>🔧 Unavailable (Under Maintenance)</button>`
      : `<button class="btn btn-primary" style="width:100%; padding:14px; font-size:15px; font-weight:600; border-radius:8px; margin-bottom:12px; box-shadow: 0 4px 6px rgba(14, 165, 233, 0.2); display:flex; justify-content:center; align-items:center; gap:6px;" onclick="closeModal('modal-detail');openReserveFor('${esc(a.id)}')">➕ Reserve This Vehicle</button>`;
  }

  let maintenanceBtnHtml = '';
  if (canEdit) {
    if (a.status === 'maintenance') {
      maintenanceBtnHtml = `<button class="btn btn-ghost" style="width:100%; padding:12px 0; border-radius:8px; border: 1px solid var(--green); color: var(--green); background: #f0fdf4; font-weight:600; display:flex; justify-content:center; align-items:center; gap:6px; box-sizing:border-box;" onclick="toggleMaintenance('${esc(a.id)}', 'available')">✅ Mark Available</button>`;
    } else if (a.status === 'available') {
      maintenanceBtnHtml = `<button class="btn btn-ghost" style="width:100%; padding:12px 0; border-radius:8px; border: 1px solid #f59e0b; color: #d97706; background: #fffbeb; font-weight:600; display:flex; justify-content:center; align-items:center; gap:6px; box-sizing:border-box;" onclick="toggleMaintenance('${esc(a.id)}', 'maintenance')">🔧 Maintenance</button>`;
    } else if (a.status === 'in-use') {
      maintenanceBtnHtml = `<button class="btn btn-ghost" style="width:100%; padding:12px 0; border-radius:8px; border: 1px solid var(--border); color: var(--text-muted); cursor:not-allowed; display:flex; justify-content:center; align-items:center; gap:6px; box-sizing:border-box;" disabled>🔒 In Use</button>`;
    }
  }

  const editBtnHtml = canEdit ? `<button class="btn btn-ghost" style="width:100%; padding:12px 0; border-radius:8px; border: 1px solid var(--border); color: var(--primary); font-weight:600; display:flex; justify-content:center; align-items:center; gap:6px; box-sizing:border-box;" onclick="openEditAssetModal('${esc(a.id)}')">✏️ Edit Specs</button>` : '';
  const deleteBtnHtml = canEdit ? `<button class="btn btn-ghost" style="width:100%; padding:12px 0; border-radius:8px; border: 1px solid #fecaca; color: var(--red); background: #fef2f2; font-weight:600; display:flex; justify-content:center; align-items:center; gap:6px; box-sizing:border-box;" onclick="deleteAsset('${esc(a.id)}')">🗑️ Delete</button>` : '';

  const secBtns = [maintenanceBtnHtml, editBtnHtml, deleteBtnHtml].filter(b => b !== '');
  const actionGrid = secBtns.length > 0 ? `<div style="display:flex; flex-wrap:wrap; gap:8px;">${secBtns.map(btn => `<div style="flex: 1 1 calc(50% - 8px); min-width: 120px;">${btn}</div>`).join('')}</div>` : '';

  let historyHtml = '';
  if (assetHistory.length > 0) {
    const visibleCount = 2;
    historyHtml = `<div style="display:flex; flex-direction:column; gap:8px; max-height: 250px; overflow-y: auto; padding-right: 4px;">`;
    assetHistory.forEach((inst, index) => {
      const globalIdx = inspections.indexOf(inst);
      const pdfBtn = inst.report_doc ? `<button class="btn btn-ghost btn-sm" style="border:1px solid var(--primary); color:var(--primary); padding:6px 12px; font-size:11px; border-radius:6px; background:#f0f9ff;" onclick="viewPDF(${globalIdx})">👁️ PDF</button>` : `<span class="muted small" style="padding-right:8px;">No PDF</span>`;
      const displayStyle = index >= visibleCount ? 'display: none;' : 'display: flex;';
      const hiddenClass = index >= visibleCount ? 'hidden-history' : '';
      historyHtml += `
        <div class="${hiddenClass}" style="${displayStyle} justify-content:space-between; align-items:center; background:#f8fafc; padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
          <div>
            <div style="font-weight:700; font-size:13px; color:var(--text-main);">${fmtDateShort(inst.inspection_date)}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">By ${esc(inst.inspected_by)} &bull; <span style="color:${inst.status === 'Cleared' ? 'var(--green)' : 'var(--red)'}; font-weight:700;">${esc(inst.status)}</span></div>
          </div>
          <div>${pdfBtn}</div>
        </div>`;
    });
    historyHtml += `</div>`;
    if (assetHistory.length > visibleCount) {
      const hiddenCount = assetHistory.length - visibleCount;
      historyHtml += `<button id="btn-toggle-history" class="btn btn-ghost btn-sm" style="width:100%; margin-top:8px; color:var(--primary); font-weight:600; border:1px dashed var(--border); background:#f8fafc;" onclick="toggleHistory(${hiddenCount})">View ${hiddenCount} More Records ▼</button>`;
    }
  } else {
    historyHtml = `<div style="padding:12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;text-align:center;"><span style="color:var(--red);font-weight:700;">⚠️ No Pre-Mobilization Inspection on Record</span></div>`;
  }

  $('#detail-body').innerHTML = `
    <div style="display: grid; grid-template-columns: 1.3fr 1fr; gap: 32px;">
      <div>
        ${imageHtml}
        <div style="background:#f8fafc; border:1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Equipment Type</div>
            <div style="font-size:15px; font-weight:700; color:var(--text-main); margin-top:2px;">${typeIcon(a.type)} ${esc(a.type)} &bull; ${esc(a.name)}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:var(--text-muted); font-weight:700; text-transform:uppercase;">Hourly Rate</div>
            <div style="font-size:16px; font-weight:800; color:var(--green); margin-top:2px;">$${parseFloat(a.hourly_rate || 0)} <span style="font-size:12px; font-weight:600; color:var(--text-muted)">/hr</span></div>
          </div>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); font-weight: 800; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); padding-bottom: 6px;">Registration & Specifications</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div><span style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:2px;">Owner</span><span style="font-weight:700; font-size:13px; color:var(--text-main);">${safeOwner}</span></div>
          <div><span style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:2px;">Brand</span><span style="font-weight:700; font-size:13px; color:var(--text-main);">${safeBrand}</span></div>
          <div><span style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:2px;">Location</span><span style="font-weight:700; font-size:13px; color:var(--text-main);">${esc(a.current_location || '—')}</span></div>
          <div><span style="display:block; font-size:11px; color:var(--text-muted); margin-bottom:2px;">Mfg. Year</span><span style="font-weight:700; font-size:13px; color:var(--text-main);">${safeYear}</span></div>
        </div>
        <div style="background:#f1f5f9; border-radius:6px; padding:10px 12px; margin-top:16px; display:flex; justify-content:space-between; font-family:monospace; font-size:12px;">
          <div><span style="color:var(--text-muted); font-weight:600; margin-right:6px;">S/N:</span><span style="font-weight:700;">${safeSerial}</span></div>
          <div><span style="color:var(--text-muted); font-weight:600; margin-right:6px;">E/N:</span><span style="font-weight:700;">${safeEngine}</span></div>
        </div>
        ${reservationAlertHtml}
      </div>

      <div style="display: flex; flex-direction: column; gap: 24px; border-left: 1px solid var(--border); padding-left: 32px;">
        <div style="background:#fff; border:1px solid var(--border); border-radius:12px; padding: 20px; display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:0 2px 6px rgba(0,0,0,0.02);">
          <div id="detail-qr-target" style="margin-bottom: 12px; background: white; padding: 8px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);"></div>
          <button class="btn btn-ghost btn-sm" style="width:100%; border: 1px solid var(--border); color: var(--primary); font-weight: 600;" onclick="downloadHighResQR('${esc(a.id)}', '${esc(a.plate_number)}')">⬇️ Download QR Link</button>
        </div>
        <div style="flex-grow: 1;">
          <div style="font-size: 11px; color: var(--text-muted); font-weight: 800; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border); padding-bottom: 6px;">Safety Inspection Log</div>
          ${historyHtml}
        </div>
        <div style="margin-top:auto; padding-top:16px; border-top: 1px solid var(--border);">
          ${reserveBtn}
          ${actionGrid}
        </div>
      </div>
    </div>`;

  openModal('modal-detail');

  const qrEl = document.getElementById('detail-qr-target');
  if (qrEl) {
    qrEl.innerHTML = '';
    new QRCode(qrEl, { text: `${window.location.origin}/#scan=${a.id}`, width: 140, height: 140, colorDark: '#0f1626', colorLight: '#ffffff' });
  }
}

function openModal(id) { $('#' + id).classList.remove('hidden'); }
function closeModal(id) { $('#' + id).classList.add('hidden'); }
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600); }
function renderAll() { renderDashboard(); renderAssets(); }

function checkAuthSession() {
  const t = localStorage.getItem('fo_token'), u = localStorage.getItem('fo_user');
  if (!t || !u) {
    if (window.location.hash.startsWith('#scan=')) {
      if ($('.sidebar')) $('.sidebar').style.display = 'none';
      $$('.topbar').forEach(el => el.style.display = 'none');
      const scanCloseBtn = document.querySelector('#modal-scan .x');
      if (scanCloseBtn) scanCloseBtn.style.display = 'none';
      return;
    }
    openModal('modal-auth');
    return;
  }

  currentUser = JSON.parse(u);
  if ($('.user-name')) $('.user-name').textContent = currentUser.fullName;
  if ($('.user-role')) $('.user-role').textContent = currentUser.role.replace('_', ' ').toUpperCase();

  const role = currentUser.role;
  const navUsers = document.querySelector('.nav-item[data-view="users"]');
  const navLogs = document.querySelector('.nav-item[data-view="logs"]');
  const navInspections = document.querySelector('.nav-item[data-view="inspections"]');
  const navReservations = document.querySelector('.nav-item[data-view="reservations"]');
  const navCalendar = document.querySelector('.nav-item[data-view="calendar"]');
  const navScan = document.querySelector('.nav-item[data-view="scan"]');
  const navReports = document.querySelector('.nav-item[data-view="reports"]');
  const navMap = document.querySelector('.nav-item[data-view="map"]');

  if (navUsers) navUsers.style.display = role === 'site_manager' ? 'flex' : 'none';
  if (navLogs) navLogs.style.display = role === 'site_manager' ? 'flex' : 'none';
  if (navReports) navReports.style.display = role === 'site_manager' ? 'flex' : 'none';
  if (navInspections) navInspections.style.display = (role === 'site_manager' || role === 'safety_team') ? 'flex' : 'none';
  if (navReservations) navReservations.style.display = (role === 'site_manager' || role === 'field_engineer') ? 'flex' : 'none';
  if (navCalendar) navCalendar.style.display = (role === 'site_manager' || role === 'field_engineer') ? 'flex' : 'none';
  if (navScan) navScan.style.display = (role === 'site_manager' || role === 'field_engineer') ? 'flex' : 'none';
  if (navMap) navMap.style.display = (role === 'site_manager' || role === 'field_engineer') ? 'flex' : 'none';

  const btnAddAsset = document.querySelector('#btn-add-vehicle');
  if (btnAddAsset) btnAddAsset.style.display = role === 'site_manager' ? 'block' : 'none';

  $$('.btn-primary[onclick="openReserveFor(null)"]').forEach(btn => { btn.style.display = (role === 'site_manager' || role === 'field_engineer') ? 'block' : 'none'; });
  $$('.btn-primary[onclick="openInspectionModal()"]').forEach(btn => { btn.style.display = (role === 'site_manager' || role === 'safety_team') ? 'block' : 'none'; });

  const scanCloseBtn = document.querySelector('#modal-scan .x');
  if (scanCloseBtn) scanCloseBtn.style.display = 'block';
}

if ($('#form-login')) {
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: new FormData(e.target).get('email'), password: new FormData(e.target).get('password') })
    });
    const d = await res.json();
    if (res.ok) { localStorage.setItem('fo_token', d.token); localStorage.setItem('fo_user', JSON.stringify(d.user)); window.location.reload(); }
    else { alert(d.error); }
  });
}

if ($('#btn-logout')) {
  $('#btn-logout').addEventListener('click', () => {
    if (confirm('Are you sure you want to sign out of FleetOps?')) {
      localStorage.clear();
      window.location.reload();
    }
  });
}

window.openReserveFor = function(id) {
  currentEditingReservationId = null;
  const form = $('#form-reserve');
  if (form) form.reset();

  const vehicleSelect = $('#form-reserve [name=vehicle]');
  if (vehicleSelect) {
    vehicleSelect.innerHTML = assets.map(a =>
      `<option value="${esc(a.id)}" ${String(a.id) === String(id) ? 'selected' : ''} ${a.status === 'maintenance' ? 'disabled' : ''}>${esc(a.plate_number)} (${esc(a.type)} - ${esc(a.name)})${a.status === 'maintenance' ? ' [Maintenance]' : ''}</option>`
    ).join('');
  }

  const now = new Date();
  now.setMinutes(0, 0, 0);
  const tzOffset = now.getTimezoneOffset() * 60000;
  const localStart = new Date(now.getTime() - tzOffset).toISOString().slice(0, 16);
  const localEnd = new Date(now.getTime() + (8 * 3600000) - tzOffset).toISOString().slice(0, 16);

  if ($('#form-reserve [name=start]')) $('#form-reserve [name=start]').value = localStart;
  if ($('#form-reserve [name=end]')) $('#form-reserve [name=end]').value = localEnd;

  openModal('modal-reserve');
};

window.openEditReservation = function(id) {
  const r = reservations.find(x => String(x.id) === String(id));
  if (!r) return;

  currentEditingReservationId = id;
  const form = $('#form-reserve');
  if (form) form.reset();

  const a = getAsset(r.assetId);
  const vehicleSelect = $('#form-reserve [name=vehicle]');
  if (vehicleSelect) {
    vehicleSelect.innerHTML = `<option value="${esc(r.assetId)}">${a ? esc(a.plate_number) + ' (' + esc(a.type) + ' - ' + esc(a.name) + ')' : esc(r.assetId)}</option>`;
  }

  if ($('#form-reserve [name=operator]')) $('#form-reserve [name=operator]').value = r.operatorName;
  if ($('#form-reserve [name=phone]')) $('#form-reserve [name=phone]').value = r.phoneNumber || '';
  if ($('#form-reserve [name=purpose]')) $('#form-reserve [name=purpose]').value = r.purpose;

  const tzOffset = new Date().getTimezoneOffset() * 60000;
  if ($('#form-reserve [name=start]')) $('#form-reserve [name=start]').value = new Date(new Date(r.startTime).getTime() - tzOffset).toISOString().slice(0, 16);
  if ($('#form-reserve [name=end]')) $('#form-reserve [name=end]').value = new Date(new Date(r.endTime).getTime() - tzOffset).toISOString().slice(0, 16);

  openModal('modal-reserve');
};

window.deleteReservation = async function(id) {
  if (!confirm('Permanently delete this reservation?')) return;
  try {
    const res = await fetch(`${API_BASE_URL}/reservations/${id}`, { method: 'DELETE', headers: getAuthHeader() });
    if (handleAuthError(res)) return;
    if (!res.ok) throw new Error('Delete failed');
    load(); toast('🗑️ Reservation removed');
  } catch (err) { toast('⚠️ Error deleting reservation'); }
};

if ($('#form-reserve')) {
  $('#form-reserve').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p = {
      assetId: f.get('vehicle'),
      operatorName: f.get('operator'),
      phoneNumber: f.get('phone'),
      startTime: new Date(f.get('start')).toISOString(),
      endTime: new Date(f.get('end')).toISOString(),
      purpose: f.get('purpose')
    };

    if (currentEditingReservationId) {
      try {
        const res = await fetch(`${API_BASE_URL}/reservations/${currentEditingReservationId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(p) });
        if (handleAuthError(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Update failed');
        closeModal('modal-reserve'); load(); toast('✅ Reservation Updated');
      } catch (err) {
        alert('Reservation Error: ' + err.message);
        toast('⚠️ Error saving reservation');
      }
      return;
    }

    const sendReservationWithLocation = async (payload) => {
      try {
        const res = await fetch(`${API_BASE_URL}/reservations`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeader() }, body: JSON.stringify(payload) });
        if (handleAuthError(res)) return;
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Booking failed');
        closeModal('modal-reserve'); load(); toast('✅ New Reservation Created');
      } catch (err) {
        alert('Reservation Error: ' + err.message);
        toast('⚠️ Error saving reservation');
      }
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => sendReservationWithLocation({ ...p, latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => sendReservationWithLocation({ ...p, latitude: 21.692153, longitude: 91.867748 })
      );
    } else {
      await sendReservationWithLocation({ ...p, latitude: 21.692153, longitude: 91.867748 });
    }
  });
}

function wire() {
  $$('.nav-item').forEach(n => n.addEventListener('click', () => goTo(n.dataset.view)));
  if ($('#log-search')) $('#log-search').addEventListener('input', renderLogs);
  if ($('#asset-search')) $('#asset-search').addEventListener('input', renderAssets);
  $$('#asset-filters .chip').forEach(c => c.addEventListener('click', () => { $$('#asset-filters .chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); assetFilter = c.dataset.filter; renderAssets(); }));
  $$('#res-filters .chip').forEach(c => c.addEventListener('click', () => { $$('#res-filters .chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); resFilter = c.dataset.rfilter; renderReservations(); }));

  const btnGrid = $('#btn-grid-view');
  const btnList = $('#btn-list-view');
  if (btnGrid && btnList) {
    btnGrid.addEventListener('click', () => {
      assetViewMode = 'grid';
      btnGrid.style = "background:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.05); color:var(--primary); font-weight:600;";
      btnList.style = "color:var(--text-muted); background:transparent; box-shadow:none; font-weight:600;";
      renderAssets();
    });
    btnList.addEventListener('click', () => {
      assetViewMode = 'list';
      btnList.style = "background:#fff; box-shadow:0 1px 2px rgba(0,0,0,0.05); color:var(--primary); font-weight:600;";
      btnGrid.style = "color:var(--text-muted); background:transparent; box-shadow:none; font-weight:600;";
      renderAssets();
    });
  }
}

const socket = io();
socket.on('fleetUpdate', () => {
  if (!currentUser) return;
  load();
  toast('🔄 Fleet synced!');
});
socket.on('inspectionUpdate', () => { if (currentUser) load(); });
socket.on('logUpdate', () => { if (currentUser && currentUser.role === 'site_manager') load(); });

wire();
checkAuthSession();
load();
goTo('dashboard');
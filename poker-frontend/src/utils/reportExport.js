// Exportación y compartido de reportes (Caja Semanal: Distribución y Dealers).
// Todo client-side. Las libs pesadas (jspdf/xlsx) se cargan con import() dinámico
// SOLO al exportar, para no engordar la carga inicial de la app.

import { formatMoney } from './formatters';

// ---------------------------------------------------------------------------
// Modelo genérico de reporte
// ---------------------------------------------------------------------------
// columns: [{ key, label, type: 'text'|'money'|'number', align? }]
// rows:    [{ [key]: valorCrudo }]   (números crudos en money/number)
// totals:  { [key]: valorCrudo } | null
// kpis:    [{ label, value, money? }]

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

const fmtFecha = (d) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
const isoDay = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const fmtShort = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const round1 = (n) => Math.round(n * 10) / 10;

// Detalle por sesión: filtra los eventos (mesas cash + torneos) del endpoint
// /history/ al rango navegado y arma una tabla fila-por-sesión. Devuelve null
// si no hay nada en el rango (para no agregar hoja/tabla vacía).
function buildSessionsDetail(historyItems, start, end) {
  const sISO = isoDay(start);
  const eISO = isoDay(end);
  const inRange = (historyItems || [])
    .filter((it) => {
      const diso = isoDay(new Date(it.date));
      return diso >= sISO && diso <= eISO;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (inRange.length === 0) return null;

  const rows = inRange.map((it) => ({
    fecha: fmtShort(new Date(it.date)),
    tipo: it.type === 'TOURNAMENT' ? 'Torneo' : 'Cash',
    evento: it.title,
    horas: round1((it.duration_minutes || 0) / 60),
    total_in: it.total_in || 0,
    rake: it.rake || 0,
    secundario: it.secondary_metric || 0,
  }));
  const sum = (k) => rows.reduce((a, r) => a + (typeof r[k] === 'number' ? r[k] : 0), 0);

  return {
    name: 'Sesiones',
    columns: [
      { key: 'fecha', label: 'Fecha', type: 'text' },
      { key: 'tipo', label: 'Tipo', type: 'text' },
      { key: 'evento', label: 'Evento', type: 'text' },
      { key: 'horas', label: 'Horas', type: 'number', align: 'right' },
      { key: 'total_in', label: 'Total In', type: 'money', align: 'right' },
      { key: 'rake', label: 'Rake', type: 'money', align: 'right' },
      { key: 'secundario', label: 'Meta / Premios', type: 'money', align: 'right' },
    ],
    rows,
    totals: {
      fecha: 'Total',
      horas: round1(sum('horas')),
      total_in: sum('total_in'),
      rake: sum('rake'),
      secundario: sum('secundario'),
    },
  };
}

export function periodLabel(viewMode, start, end) {
  if (viewMode === 'day') return `Día ${fmtFecha(start)}`;
  if (viewMode === 'month') return `Mes de ${MESES[start.getMonth()]} de ${start.getFullYear()}`;
  return `Semana del ${start.getDate()} de ${MESES[start.getMonth()]} al ${fmtFecha(end)}`;
}

function nowLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Builders de modelo
// ---------------------------------------------------------------------------
export function buildDistributionModel({ data, totalSocios, totalMeta, totalFondos, viewMode, start, end, user, sessions }) {
  // Mismo vocabulario que la pantalla de Caja: ingresos − egresos = neto a
  // repartir, y luego el reparto del neto (meta / fondos / socios).
  const rows = (data.distribution || []).map((item) => ({
    concepto: item.name,
    tipo: item.percent > 0 ? `Reparto · Utilidad socio (${item.percent}%)` : 'Reparto · Meta / Fondo',
    monto: item.total || 0,
  }));

  const ingresos = data.gross_week ?? data.total_week ?? 0;
  const egresos = data.expenses_week || 0;
  const kpis = [
    { label: 'Ingresos (rake bruto)', value: ingresos, money: true },
    { label: 'Egresos (dealers + cortesías)', value: egresos, money: true },
    { label: 'Neto a repartir', value: data.net_week ?? (ingresos - egresos), money: true },
  ];
  if (totalMeta > 0) kpis.push({ label: 'Reparto · Abono a meta', value: totalMeta, money: true });
  if (totalFondos > 0) kpis.push({ label: 'Reparto · Fondos operativos', value: totalFondos, money: true });
  kpis.push({ label: 'Reparto · Utilidad socios', value: totalSocios || 0, money: true });

  return {
    title: 'Caja Semanal — Distribución',
    periodLabel: periodLabel(viewMode, start, end),
    generatedAt: nowLabel(),
    user: user || '',
    kpis,
    columns: [
      { key: 'concepto', label: 'Concepto', type: 'text' },
      { key: 'tipo', label: 'Tipo', type: 'text' },
      { key: 'monto', label: 'Monto', type: 'money', align: 'right' },
    ],
    rows,
    totals: { concepto: 'Rake bruto del periodo', monto: data.total_week || 0 },
    detail: sessions ? buildSessionsDetail(sessions, start, end) : null,
    filenameBase: `rakeflow-distribucion-${isoDay(start)}`,
  };
}

export function buildDealersModel({ dealerData, viewMode, start, end, user }) {
  const dealers = dealerData?.dealers || [];
  const s = dealerData?.summary || {};
  const rows = dealers.map((d) => ({
    dealer: d.name + (d.is_active === false ? ' (inactivo)' : ''),
    horas: d.hours || 0,
    pago_horas: d.hour_payment || 0,
    rake: d.rake_commission || 0,
    pago_club: d.club_payment || 0,
    propinas: d.tips || 0,
    total: d.grand_total || 0,
  }));

  return {
    title: 'Caja Semanal — Pagos a Dealers',
    periodLabel: periodLabel(viewMode, start, end),
    generatedAt: nowLabel(),
    user: user || '',
    kpis: [
      { label: 'Pago club', value: s.club_payment || 0, money: true },
      { label: 'Propinas', value: s.tips || 0, money: true },
      { label: 'Horas', value: `${s.total_hours || 0}h` },
      { label: 'Total', value: s.grand_total || 0, money: true },
    ],
    columns: [
      { key: 'dealer', label: 'Dealer', type: 'text' },
      { key: 'horas', label: 'Horas', type: 'number', align: 'right' },
      { key: 'pago_horas', label: 'Pago horas', type: 'money', align: 'right' },
      { key: 'rake', label: '% Rake', type: 'money', align: 'right' },
      { key: 'pago_club', label: 'Pago club', type: 'money', align: 'right' },
      { key: 'propinas', label: 'Propinas', type: 'money', align: 'right' },
      { key: 'total', label: 'Total', type: 'money', align: 'right' },
    ],
    rows,
    totals: {
      dealer: 'Total',
      horas: s.total_hours || 0,
      pago_club: s.club_payment || 0,
      propinas: s.tips || 0,
      total: s.grand_total || 0,
    },
    filenameBase: `rakeflow-dealers-${isoDay(start)}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers de celda
// ---------------------------------------------------------------------------
const cellText = (model, col, value) => {
  if (value === undefined || value === null || value === '') return '';
  if (col.type === 'money') return formatMoney(value);
  if (col.type === 'number') return `${value}h`;
  return String(value);
};

// ---------------------------------------------------------------------------
// WhatsApp (texto)
// ---------------------------------------------------------------------------
export function toWhatsAppText(model) {
  const lines = [];
  lines.push(`*${model.title}*`);
  lines.push(`📅 ${model.periodLabel}`);
  lines.push('');
  model.kpis.forEach((k) => {
    lines.push(`*${k.label}:* ${k.money ? formatMoney(k.value) : k.value}`);
  });
  lines.push('');
  lines.push('*Detalle:*');
  model.rows.forEach((r) => {
    const last = model.columns[model.columns.length - 1];
    const name = r[model.columns[0].key];
    const amount = cellText(model, last, r[last.key]);
    lines.push(`• ${name}: ${amount}`);
  });
  lines.push('');
  lines.push(`_Generado ${model.generatedAt} · RakeFlow_`);
  return lines.join('\n');
}

export function shareWhatsAppText(text) {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------------------
// Descarga / Web Share de archivos
// ---------------------------------------------------------------------------
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Intenta compartir el archivo nativo (móvil → permite mandarlo por WhatsApp).
// Si no hay soporte, lo descarga. Devuelve 'shared' | 'downloaded'.
async function deliver(blob, filename, text) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text });
      return 'shared';
    } catch (err) {
      // El sheet nativo ya se mostró. Si el usuario lo cancela (AbortError) o el
      // navegador lo rechaza por gesto consumido (NotAllowedError), NO caemos a
      // descarga: evita la doble acción (compartir + descargar) en móvil.
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return 'cancelled';
      // Solo un fallo inesperado del share justifica el fallback a descarga.
      downloadBlob(blob, filename);
      return 'downloaded';
    }
  }
  // Sin soporte de Web Share de archivos: descarga directa.
  downloadBlob(blob, filename);
  return 'downloaded';
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
async function loadDataURL(url) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function exportPDF(model, { share = false } = {}) {
  const [{ jsPDF }, autoTableMod, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadDataURL('/favicon-192.png'),
  ]);
  const autoTable = autoTableMod.default;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  // Encabezado
  if (logo) {
    try { doc.addImage(logo, 'PNG', M, 32, 34, 34); } catch { /* ignora */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(16, 122, 87);
  doc.text('RakeFlow', M + (logo ? 44 : 0), 54);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120);
  doc.text(model.generatedAt, W - M, 50, { align: 'right' });

  doc.setTextColor(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(model.title, M, 92);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(model.periodLabel, M, 108);

  // KPIs en una línea
  const kpiText = model.kpis
    .map((k) => `${k.label}: ${k.money ? formatMoney(k.value) : k.value}`)
    .join('     ');
  doc.setFontSize(9);
  doc.setTextColor(40);
  doc.text(kpiText, M, 128, { maxWidth: W - 2 * M });

  // Render de una tabla genérica ({ columns, rows, totals }) a partir de startY.
  const renderTable = (table, startY) => {
    const head = [table.columns.map((c) => c.label)];
    const body = table.rows.map((r) => table.columns.map((c) => cellText(table, c, r[c.key])));
    const foot = table.totals
      ? [table.columns.map((c) => (table.totals[c.key] !== undefined ? cellText(table, c, table.totals[c.key]) : ''))]
      : undefined;
    const columnStyles = {};
    table.columns.forEach((c, i) => {
      if (c.align === 'right') columnStyles[i] = { halign: 'right' };
    });
    autoTable(doc, {
      head,
      body,
      foot,
      startY,
      margin: { left: M, right: M },
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [16, 122, 87], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 240], textColor: 20, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 249] },
      columnStyles,
    });
  };

  // Tabla principal (resumen)
  renderTable(model, 144);

  // Tabla de detalle por sesión (si hay)
  if (model.detail && model.detail.rows.length) {
    const y = doc.lastAutoTable.finalY + 26;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text('Detalle por sesión', M, y);
    renderTable(model.detail, y + 8);
  }

  // Pie
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    const foot = model.user ? `Generado por ${model.user} · RakeFlow` : 'RakeFlow';
    doc.text(foot, M, doc.internal.pageSize.getHeight() - 24);
    doc.text(`${i} / ${pageCount}`, W - M, doc.internal.pageSize.getHeight() - 24, { align: 'right' });
  }

  const filename = `${model.filenameBase}.pdf`;
  const blob = doc.output('blob');
  if (share) return deliver(blob, filename, model.periodLabel);
  downloadBlob(blob, filename);
  return 'downloaded';
}

// ---------------------------------------------------------------------------
// Excel (ExcelJS — soporta estilos de marca: encabezados verdes, totales,
// formato de moneda COP. xlsx community no estiliza celdas.)
// ---------------------------------------------------------------------------
// Paleta de marca RakeFlow (ARGB para ExcelJS)
const XL = {
  emerald: 'FF107A57',      // verde fuerte (encabezados)
  emeraldText: 'FF0B7A4B',
  rowAlt: 'FFF2FAF6',       // verde muy claro (filas alternas)
  totalBg: 'FFE6F4EE',      // verde claro (fila total)
  grayText: 'FF6B7280',
  lightText: 'FF9CA3AF',
  border: 'FFE5E7EB',
};
const MONEY_FMT = '"$"\\ #,##0';

export async function exportExcel(model, { share = false } = {}) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'RakeFlow';

  const thinBorder = {
    top: { style: 'thin', color: { argb: XL.border } },
    bottom: { style: 'thin', color: { argb: XL.border } },
    left: { style: 'thin', color: { argb: XL.border } },
    right: { style: 'thin', color: { argb: XL.border } },
  };

  const addSheet = (name, table, meta) => {
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
    const ncol = table.columns.length;
    let r = 1;

    if (meta) {
      ws.mergeCells(r, 1, r, ncol);
      const tc = ws.getCell(r, 1);
      tc.value = meta.title;
      tc.font = { bold: true, size: 16, color: { argb: XL.emeraldText } };
      r++;
      ws.mergeCells(r, 1, r, ncol);
      ws.getCell(r, 1).value = meta.periodLabel;
      ws.getCell(r, 1).font = { size: 11, color: { argb: XL.grayText } };
      r++;
      ws.mergeCells(r, 1, r, ncol);
      ws.getCell(r, 1).value = `Generado ${meta.generatedAt}${meta.user ? ' · ' + meta.user : ''}`;
      ws.getCell(r, 1).font = { size: 9, italic: true, color: { argb: XL.lightText } };
      r += 2;

      meta.kpis.forEach((k) => {
        const lc = ws.getCell(r, 1);
        lc.value = k.label;
        lc.font = { bold: true, color: { argb: XL.grayText } };
        const vc = ws.getCell(r, 2);
        vc.value = k.value;
        if (k.money) vc.numFmt = MONEY_FMT;
        vc.font = { bold: true };
        r++;
      });
      r++;
    }

    // Encabezado de tabla
    const headerRow = ws.getRow(r);
    headerRow.height = 22;
    table.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.label;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.emerald } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left', vertical: 'middle' };
      cell.border = thinBorder;
    });
    r++;

    // Filas
    table.rows.forEach((row, idx) => {
      const tr = ws.getRow(r);
      table.columns.forEach((c, i) => {
        const cell = tr.getCell(i + 1);
        cell.value = row[c.key] ?? '';
        if (c.type === 'money') cell.numFmt = MONEY_FMT;
        cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left' };
        cell.border = thinBorder;
        if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.rowAlt } };
      });
      r++;
    });

    // Totales
    if (table.totals) {
      const tr = ws.getRow(r);
      table.columns.forEach((c, i) => {
        const cell = tr.getCell(i + 1);
        const v = table.totals[c.key];
        cell.value = v !== undefined ? v : '';
        if (c.type === 'money') cell.numFmt = MONEY_FMT;
        cell.font = { bold: true, color: { argb: XL.emeraldText } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.totalBg } };
        cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left' };
        cell.border = thinBorder;
      });
      r++;
    }

    // Anchos
    table.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.type === 'text' ? 30 : 16;
    });
  };

  addSheet('Resumen', { columns: model.columns, rows: model.rows, totals: model.totals }, {
    title: model.title,
    periodLabel: model.periodLabel,
    generatedAt: model.generatedAt,
    user: model.user,
    kpis: model.kpis,
  });

  if (model.detail && model.detail.rows.length) {
    addSheet(model.detail.name.slice(0, 31), model.detail, null);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = `${model.filenameBase}.xlsx`;
  if (share) return deliver(blob, filename, model.periodLabel);
  downloadBlob(blob, filename);
  return 'downloaded';
}

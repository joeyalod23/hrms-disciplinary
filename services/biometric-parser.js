const fs = require('fs');

function parseDateTime(raw) {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (m) return { date: m[1], time: m[2] };
  return null;
}

function parseZKTecoLine(parts) {
  if (parts.length < 4) return null;
  const id = parts[0].trim();
  if (!/^\d+$/.test(id)) return null;
  const dt = parseDateTime(parts[1]);
  if (!dt) return null;
  const code = parts[3].trim();
  const punchMap = { '0': 'IN', '1': 'OUT', '2': 'OUT', '3': 'IN', '4': 'OT_IN', '5': 'OT_OUT' };
  const status = punchMap[code] || null;
  return { id, date: dt.date, time: dt.time, status, raw_code: code };
}

function detectFormat(lines) {
  if (lines.length === 0) return 'unknown';
  const sample = lines.slice(0, 20);
  for (const line of sample) {
    const parts = line.split('\t');
    if (parts.length >= 4 && /^\d+$/.test(parts[0].trim())) {
      const dt = parseDateTime(parts[1]);
      if (dt) return 'zkteco';
    }
  }
  return 'generic';
}

function parseGenericLine(parts) {
  let id = null, date = null, time = null, status = null;
  for (const v of parts) {
    if (!v) continue;
    if (!id && /^\d+$/.test(v)) { id = v; continue; }
    if (!date) {
      const d = v.trim().match(/^(\d{4}-\d{2}-\d{2})$/);
      if (d) { date = d[1]; continue; }
      const d2 = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (d2) { date = `${d2[3]}-${d2[1].padStart(2,'0')}-${d2[2].padStart(2,'0')}`; continue; }
    }
    if (!time) {
      const t = v.trim().match(/^(\d{2}:\d{2}:\d{2})$/);
      if (t) { time = t[1]; continue; }
      const t2 = v.trim().match(/^(\d{2}:\d{2})$/);
      if (t2) { time = t2[1] + ':00'; continue; }
    }
    if (!status && /^(IN|OUT|0|1)$/i.test(v.trim())) {
      status = /^(IN|1)$/i.test(v.trim()) ? 'IN' : 'OUT';
    }
  }
  if (id && date) return { id, date, time, status: status || null, raw_code: null };
  return null;
}

function parseDAT(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  const result = { parsed_rows: [], errors: [], total: 0, success: 0 };

  const format = detectFormat(lines);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const delim = line.includes('\t') ? '\t' : (line.includes(',') ? ',' : (line.includes('|') ? '|' : null));
    const parts = delim ? line.split(delim).map(p => p.trim()) : line.split(/\s+/).filter(p => p);

    let row = null;
    if (format === 'zkteco') {
      row = parseZKTecoLine(parts);
      if (!row) row = parseGenericLine(parts);
    } else {
      row = parseGenericLine(parts);
    }

    if (row) {
      result.parsed_rows.push(row);
      result.success++;
    } else {
      result.errors.push({ line: i + 1, text: line.substring(0, 80), reason: 'Could not parse' });
    }
  }

  result.total = result.parsed_rows.length + result.errors.length;
  return result;
}

function determineSlot(timeStr) {
  if (!timeStr) return null;
  if (timeStr < '12:00:00') return 'AM';
  if (timeStr < '13:00:00') return 'LUNCH';
  if (timeStr <= '16:30:00') return 'PM';
  return 'OT';
}

function generateAttendance(parsedRows, db) {
  const results = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const empMap = buildEmployeeMap(db);

  const grouped = {};
  for (const row of parsedRows) {
    if (!row.id || !row.date) continue;
    const key = `${row.id}|${row.date}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }

  // Sort dates for cross-day OT lookup
  const dateKeys = Object.keys(grouped).sort();

  for (let ki = 0; ki < dateKeys.length; ki++) {
    const key = dateKeys[ki];
    const [id, date] = key.split('|');
    const emp = empMap[id];
    if (!emp) {
      results.errors.push({ id, date, reason: `No employee found with ID ${id}` });
      results.skipped++;
      continue;
    }

    const punches = grouped[key].sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    let amIn = null, amOut = null, pmIn = null, pmOut = null, otIn = null, otOut = null;
    let seenPM = false;

    for (const p of punches) {
      if (!p.time) continue;
      const slot = determineSlot(p.time);
      const isIn = p.status === 'IN' || p.status === 'OT_IN';
      const isOut = p.status === 'OUT' || p.status === 'OT_OUT';

      if (slot === 'LUNCH') {
        if (isOut && (!amOut || p.time > amOut)) amOut = p.time;
        if (isIn && (!pmIn || p.time < pmIn)) pmIn = p.time;
        continue;
      }
      if (slot === 'OT') {
        if (seenPM) {
          if (isIn && (!otIn || p.time < otIn)) otIn = p.time;
          if (isOut && (!otOut || p.time > otOut)) otOut = p.time;
        } else {
          if (isIn && !pmIn) { pmIn = p.time; }
          else if (isIn && pmIn && !pmOut) { pmOut = p.time; }
          else if (isOut && (!pmOut || p.time > pmOut)) { pmOut = p.time; }
          else if (isIn && (!pmIn || p.time < pmIn)) { pmIn = p.time; }
          if (!isIn && !isOut && !pmIn) pmIn = p.time;
        }
        continue;
      }
      if (slot === 'AM') {
        if (isIn && amIn && !amOut) { amOut = p.time; }
        else if (isIn && (!amIn || p.time < amIn)) { amIn = p.time; }
        if (isOut && (!amOut || p.time > amOut)) amOut = p.time;
        if (!isIn && !isOut && !amIn) amIn = p.time;
      }
      if (slot === 'PM') {
        seenPM = true;
        if (isOut && (!pmOut || p.time > pmOut)) { pmOut = p.time; }
        else if (isIn && pmIn && !pmOut) { pmOut = p.time; }
        else if (isIn && (!pmIn || p.time < pmIn)) { pmIn = p.time; }
        if (!isIn && !isOut && !pmIn) pmIn = p.time;
      }
    }

    if (!pmOut && amOut && !amIn) {
      pmOut = amOut;
      amOut = null;
    }

    // Fix: if amOut precedes amIn chronologically, swap (OT_OUT→IN misclassification)
    if (amIn && amOut && amOut < amIn) {
      [amIn, amOut] = [amOut, amIn];
    }
    // Fix: if the only AM punch is before lunch but mis-typed as OUT, treat it as IN
    if (!amIn && amOut && amOut < '12:00:00') {
      amIn = amOut;
      amOut = null;
    }

    // --- OT across midnight: if PM/OT activity without matching OUT, check next day ---
    const hasOpenEnd = (pmIn && !pmOut && !otOut) || (otIn && !otOut);
    if (hasOpenEnd) {
      const nextKey = `${id}|${nextDate(date)}`;
      const nextPunches = grouped[nextKey];
      if (nextPunches) {
        const earlyPunches = nextPunches.filter(p => {
          if (!p.time) return false;
          const slot = determineSlot(p.time);
          if (slot !== 'AM' && slot !== 'LUNCH') return false;
          return p.time >= '00:00:00' && p.time <= '05:00:00';
        }).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        if (earlyPunches.length > 0) {
          const lastEarly = earlyPunches[earlyPunches.length - 1];
          otOut = lastEarly.time;
          grouped[nextKey] = nextPunches.filter(p =>
            !(p.time && p.time >= '00:00:00' && p.time <= '05:00:00')
          );
        }
      }
    }

    // --- Night Differential (ND) detection ---
    // ND = minutes worked past 22:00 (10 PM per PH labor law). Check both PM and OT.
    function computeND(pmIn, pmOut, otIn, otOut) {
      // Determine the true latest out time.
      // otOut < 06:00 means cross-midnight (next day), always latest.
      // otOut > 22:00 means same-day late OT, also latest.
      let lastOut;
      if (otOut && (otOut < '06:00:00' || otOut > '22:00:00')) {
        lastOut = otOut;
      } else if (pmOut && (!otOut || pmOut > otOut)) {
        lastOut = pmOut;
      } else {
        lastOut = otOut || pmOut;
      }
      if (!lastOut) return 0;
      // Determine latest IN in the late period (PM after 16:30 or OT)
      let lastIn = otIn || (pmIn && pmIn > '16:30:00' ? pmIn : null);
      // Same-day ND: last out past 10 PM
      if (lastOut > '22:00:00') {
        const ndStart = (lastIn && lastIn > '22:00:00') ? lastIn : '22:00:00';
        return Math.round(timeDiff(ndStart, lastOut));
      }
      // Cross-midnight ND: last out is early next morning
      if (lastIn && lastOut < '06:00:00' && lastOut < lastIn && lastIn > '16:30:00') {
        const ndStart = (lastIn > '22:00:00') ? lastIn : '22:00:00';
        const [ndH, ndM] = ndStart.split(':').map(Number);
        const preMidnight = (24 - ndH) * 60 - ndM;
        const postMidnight = timeDiff('00:00:00', lastOut);
        return Math.round(preMidnight + postMidnight);
      }
      return 0;
    }
    const ndMinutes = computeND(pmIn, pmOut, otIn, otOut);

    // --- Detect lacking punches ---
    const missing = [];
    if (amIn && !amOut) missing.push('AM Out');
    if (amOut && !pmIn) missing.push('PM In');
    if (pmIn && !pmOut) missing.push('PM Out');
    if (amIn && amOut && !pmIn && !pmOut) missing.push('PM In/Out');
    if (otIn && !otOut) missing.push('OT Out');
    if (!amIn && !amOut && !pmIn && !pmOut && !otIn && !otOut) {
      results.errors.push({ id, date, reason: 'No usable IN/OUT times' });
      results.skipped++;
      continue;
    }
    const missingStr = missing.length > 0 ? 'Lacking: ' + missing.join(', ') : null;

    const existing = db.prepare('SELECT id, am_in, am_out, pm_in, pm_out, ot_in, ot_out, status, missing_punches, nd_minutes FROM attendance_records WHERE employee_id = ? AND date = ?').get(emp.id, date);
    const month = new Date(date).getMonth() + 1;
    const year = new Date(date).getFullYear();

    if (existing) {
      const updates = {};
      if (amIn && (!existing.am_in || amIn < existing.am_in)) updates.am_in = amIn;
      if (amOut && (!existing.am_out || amOut > existing.am_out)) updates.am_out = amOut;
      if (pmIn && (!existing.pm_in || pmIn < existing.pm_in)) updates.pm_in = pmIn;
      if (pmOut && (!existing.pm_out || pmOut > existing.pm_out)) updates.pm_out = pmOut;
      if (otIn && (!existing.ot_in || otIn > existing.ot_in)) updates.ot_in = otIn;
      if (otOut && (!existing.ot_out || otOut > existing.ot_out)) updates.ot_out = otOut;
      if (ndMinutes !== (existing.nd_minutes || 0)) updates.nd_minutes = ndMinutes;

      if (Object.keys(updates).length > 0 || missingStr !== existing.missing_punches) {
        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        const params = Object.values(updates);
        let finalAmIn = updates.am_in || existing.am_in || null;
        let finalPmIn = updates.pm_in || existing.pm_in || null;

        if (setClauses) {
          if (missingStr) {
            db.prepare(`UPDATE attendance_records SET ${setClauses}, missing_punches = ?, status = ?, tardiness_minutes = ? WHERE id = ?`)
              .run(...params, missingStr, getStatus(finalAmIn, finalPmIn), getTardiness(finalAmIn, finalPmIn), existing.id);
          } else {
            db.prepare(`UPDATE attendance_records SET ${setClauses}, missing_punches = NULL, status = ?, tardiness_minutes = ? WHERE id = ?`)
              .run(...params, getStatus(finalAmIn, finalPmIn), getTardiness(finalAmIn, finalPmIn), existing.id);
          }
        } else {
          db.prepare('UPDATE attendance_records SET missing_punches = ?, nd_minutes = ? WHERE id = ?').run(missingStr, ndMinutes, existing.id);
        }
        results.updated++;
      } else {
        results.skipped++;
      }
    } else {
      if (!amIn && !pmOut) {
        results.errors.push({ id, date, reason: 'No usable IN/OUT times' });
        results.skipped++;
        continue;
      }
      const firstIn = amIn || pmIn || null;
      const shiftStart = amIn ? '07:30:00' : '13:00:00';
      const attStatus = firstIn && isLate(firstIn, shiftStart) ? 'Late' : 'Present';
      const tardiness = attStatus === 'Late' ? Math.round(timeDiff(shiftStart, firstIn)) : 0;
      db.prepare(`INSERT INTO attendance_records (employee_id, date, am_in, am_out, pm_in, pm_out, ot_in, ot_out, status, tardiness_minutes, missing_punches, nd_minutes, recorded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(emp.id, date, amIn, amOut, pmIn, pmOut, otIn, otOut, attStatus, tardiness, missingStr, ndMinutes, null);
      db.prepare('INSERT OR IGNORE INTO attendance_monthly_summary (employee_id, month, year) VALUES (?, ?, ?)').run(emp.id, month, year);
      results.inserted++;
    }
  }
  return results;
}

function nextDate(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function getStatus(amIn, pmIn) {
  const firstIn = amIn || pmIn || null;
  if (!firstIn) return 'Present';
  const shiftStart = amIn ? '07:30:00' : '13:00:00';
  return isLate(firstIn, shiftStart) ? 'Late' : 'Present';
}

function getTardiness(amIn, pmIn) {
  const firstIn = amIn || pmIn || null;
  if (!firstIn) return 0;
  const shiftStart = amIn ? '07:30:00' : '13:00:00';
  return isLate(firstIn, shiftStart) ? Math.round(timeDiff(shiftStart, firstIn)) : 0;
}

function timeDiff(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
}

function isLate(timeStr, shiftStart) {
  if (!timeStr) return false;
  if (!shiftStart) shiftStart = '07:30:00';
  return timeStr > shiftStart;
}

function buildEmployeeMap(db) {
  const employees = db.prepare("SELECT id, employee_id, full_name FROM employees WHERE status = 'Active'").all();
  const map = {};
  for (const e of employees) {
    map[e.employee_id] = e;
    map[String(e.employee_id)] = e;
  }
  return map;
}

module.exports = { parseDAT, generateAttendance, buildEmployeeMap };

const fs = require('fs');
const Tesseract = require('tesseract.js');

function extractFields(text) {
  const fields = {};

  const labelPatterns = [
    { key: 'project_name', patterns: [/project\s*name[:\s;]*([^\n]*)/i] },
    { key: 'address', patterns: [/address[:\s]*_*([^\n]*)/i, /address[:\s;]*([^\n]*)/i] },
    { key: 'alleged_violator_name', patterns: [/name\s*of\s*alleged\s*violator[:\s]*([^\n]*)/i, /Violator[:\s]*([^\n]*)/i] },
    { key: 'craft_position', patterns: [/craft[\/\\]?position[:\s]*([^\n]*)/i, /Craft[:\s]*([^\n]*)/i] },
    { key: 'department', patterns: [/Flr[.\s]*or\s*Bldg[.\s]*Assignment[\/\\]?Dept[:\s]*([^\n]*)/i, /Assignment[\/\\]?Dept[:\s]*([^\n]*)/i, /Dept[:\s]*([^\n]*)/i] },
    { key: 'immediate_supervisor', patterns: [/immediate\s*supervisor[:\s]*([^\n]*)/i] },
    { key: 'incident_date', patterns: [/date\s*of\s*incident[:\s]*([^\n]*)/i] },
    { key: 'incident_time', patterns: [/time\s*of\s*incident[:\s]*([^\n]*)/i] },
    { key: 'date_reported', patterns: [/date\s*reported[:\s]*([^\n]*)/i] },
  ];

  for (const { key, patterns } of labelPatterns) {
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m && m[1] && m[1].trim()) {
        fields[key] = m[1].trim().replace(/[_]+$/, '').trim();
        break;
      }
    }
  }

  const locKeywords = ['construction site', 'warehouse', 'office', 'bunkhouse', 'canteen'];
  const locOthers = text.match(/others[^]*?specify[:\s]*([^\n]*)/i);
  const locationTypes = [];
  for (const kw of locKeywords) {
    if (new RegExp(kw, 'i').test(text)) locationTypes.push(kw.charAt(0).toUpperCase() + kw.slice(1));
  }
  if (text.match(/others[^]*?specify/i) || locationTypes.some(l => l === 'Others')) {
    locationTypes.push('Others');
  }
  if (locationTypes.length) fields.location_of_incident = locationTypes.join(', ');
  if (locOthers && locOthers[1] && locOthers[1].trim()) fields.location_other = locOthers[1].trim();

  const typeKeywords = ['inappropriate behavior', 'property damage', 'negligence of duty', 'inappropriate comment', 'physical harm'];
  const typeOthers = text.match(/others[^]*?specify/i);
  const incidentTypes = [];
  for (const kw of typeKeywords) {
    if (new RegExp(kw, 'i').test(text)) {
      let label = kw.charAt(0).toUpperCase() + kw.slice(1);
      if (kw === 'property damage') label = 'Property Damage/Misuse';
      incidentTypes.push(label);
    }
  }
  if (typeOthers) incidentTypes.push('Others');
  if (incidentTypes.length) fields.incident_type = incidentTypes.join(', ');

  const narrativeMatch = text.match(/narrative\s*description[^]*?responded[:\s]*([\s\S]*?)(?:\n\s*(?:reported\s*by|noted\s*by|reviewed\s*by|f-hrd|print\s*full|$))/i);
  if (narrativeMatch && narrativeMatch[1].trim()) fields.narrative_description = narrativeMatch[1].trim();

  const othersMatch = text.match(/others\s*involved[^]*?(?:names|involved)[:\s]*([\s\S]*?)(?:\n\s*(?:witnesses|narrative|$))/i);
  if (othersMatch && othersMatch[1].trim()) fields.others_involved = othersMatch[1].trim();

  const witnessesMatch = text.match(/witnesses[^]*?names[:\s]*([\s\S]*?)(?:\n\s*(?:narrative|others|$))/i);
  if (witnessesMatch && witnessesMatch[1].trim()) fields.witnesses = witnessesMatch[1].trim();

  const reportedMatch = text.match(/reported\s*by[\/\\]?\s*date[:\s]*([^\n]*)/i);
  if (reportedMatch && reportedMatch[1].trim()) fields.reported_by = reportedMatch[1].trim().replace(/[_]+/g, '').trim();

  const notedMatch = text.match(/noted\s*by[\/\\]?\s*date[:\s]*([^\n]*)/i);
  if (notedMatch && notedMatch[1].trim()) fields.noted_by = notedMatch[1].trim().replace(/[_]+/g, '').trim();

  const reviewedMatch = text.match(/reviewed\s*by[\/\\]?\s*date[:\s]*([^\n]*)/i);
  if (reviewedMatch && reviewedMatch[1].trim()) fields.reviewed_by = reviewedMatch[1].trim().replace(/[_]+/g, '').trim();

  return fields;
}

async function ocrImage(filePath) {
  let result;
  try {
    const buf = fs.readFileSync(filePath);
    result = await Tesseract.recognize(buf, 'eng', {
      logger: () => {}
    });
  } catch (err) {
    const msg = err && err.message ? err.message : 'OCR engine error (tesseract not available on this system)';
    throw new Error('OCR failed: ' + msg);
  }
  if (!result || !result.data) throw new Error('OCR returned no data');
  const fields = extractFields(result.data.text);
  return { text: result.data.text, fields, confidence: result.data.confidence };
}

module.exports = { ocrImage };

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'sitevigil.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

try { db.exec(`ALTER TABLE offense_categories ADD COLUMN code TEXT`); } catch {}
try { db.exec(`ALTER TABLE offense_categories ADD COLUMN weight INTEGER DEFAULT 1`); } catch {}

console.log('Seeding full COD-based offense categories...');

db.exec(`DELETE FROM offense_categories`);

const offenses = [
  // ======================== A. PERSON ========================
  { code: 'A1', name: 'Failure to serve notice of absence within 2 hours', severity: 'Light', weight: 1, group: 'A' },
  { code: 'A2', name: 'Refusal to acknowledge official communication', severity: 'Light', weight: 1, group: 'A' },
  { code: 'A3', name: 'Acts of discourtesy toward visitors, clients, officers', severity: 'Less Serious', weight: 2, group: 'A' },
  { code: 'A4', name: 'Acts of threat, intimidation, coercion, harassment', severity: 'Less Serious', weight: 2, group: 'A' },
  { code: 'A5', name: 'Quarrelling with co-employees / heated arguments', severity: 'Less Serious', weight: 2, group: 'A' },
  { code: 'A6', name: 'Disrespectful/insulting language toward superior', severity: 'Less Serious', weight: 2, group: 'A' },
  { code: 'A7', name: 'Using indecent/abusive language while on duty', severity: 'Less Serious', weight: 2, group: 'A' },
  { code: 'A8', name: 'Insubordination / willful refusal to obey orders', severity: 'Serious', weight: 4, group: 'A' },
  { code: 'A9', name: 'Refusal to follow transfer/reassignment instructions', severity: 'Serious', weight: 3, group: 'A' },
  { code: 'A10', name: 'Rumormongering / false statements about employee/officer', severity: 'Serious', weight: 3, group: 'A' },
  { code: 'A11', name: 'Physical force/violence / inflicting bodily harm', severity: 'Serious', weight: 5, group: 'A' },
  { code: 'A12', name: 'Assigning subordinate in conflict of interest', severity: 'Serious', weight: 4, group: 'A' },
  { code: 'A13', name: 'Conduct unbecoming of officer/superior', severity: 'Serious', weight: 4, group: 'A' },
  { code: 'A14', name: 'Persuading another to commit serious violation', severity: 'Serious', weight: 4, group: 'A' },
  { code: 'A15', name: 'Swindling or other deceits', severity: 'Serious', weight: 5, group: 'A' },
  { code: 'A16', name: 'Crime against employer or family', severity: 'Serious', weight: 5, group: 'A' },

  // ======================== B. PRODUCTIVITY ========================
  { code: 'B1', name: 'Habitual tardiness', severity: 'Light', weight: 1, group: 'B' },
  { code: 'B2', name: 'Peddling/soliciting within company premises', severity: 'Light', weight: 1, group: 'B' },
  { code: 'B3', name: 'Attending to personal matters during work hours', severity: 'Light', weight: 1, group: 'B' },
  { code: 'B4', name: 'Using company phone/gadgets for personal reasons', severity: 'Light', weight: 1, group: 'B' },
  { code: 'B5', name: 'Absence from workplace / loitering / extended break', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B6', name: 'Negligence/inefficiency / delayed work', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B7', name: 'Excessive/habitual absences (5+/month)', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B8', name: 'Habitual neglect in timing-in/out (facial scanner)', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B9', name: 'Improper use of leave credits', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B10', name: 'Under time without permission', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B11', name: 'Malingering / pretending to be sick', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B12', name: 'Leaving work without prior permission', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B13', name: 'Delay/inadvertence in assigned tasks', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B14', name: 'Failure to report erroneous payment within 72 hrs', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B15', name: 'Refusal/failure to report for scheduled overtime', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B16', name: 'Insisting on leave after request denied', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B17', name: 'Sleeping on jobsite during work hours', severity: 'Serious', weight: 3, group: 'B' },
  { code: 'B18', name: 'Gross negligence causing disruption/damage/losses', severity: 'Serious', weight: 4, group: 'B' },
  { code: 'B19', name: 'Deliberately slowing down production', severity: 'Serious', weight: 4, group: 'B' },
  { code: 'B20', name: 'Inciting/participating in unauthorized work stoppage', severity: 'Serious', weight: 5, group: 'B' },
  { code: 'B21', name: 'Consistent inefficiency (3 consecutive evals)', severity: 'Serious', weight: 3, group: 'B' },
  { code: 'B22', name: 'Willful disregard in attending required training', severity: 'Serious', weight: 3, group: 'B' },
  { code: 'B23', name: 'Unreasonable absences without official leave / AWOL', severity: 'Serious', weight: 4, group: 'B' },
  { code: 'B24', name: 'Abandonment of job (3 consecutive days absent)', severity: 'Serious', weight: 5, group: 'B' },
  { code: 'B25', name: 'Non-compliance with reportorial requirements (penalty >Php5k)', severity: 'Serious', weight: 3, group: 'B' },
  { code: 'B26', name: 'Failure to comply with control measures', severity: 'Less Serious', weight: 2, group: 'B' },
  { code: 'B27', name: 'Gross delay causing loss >Php5k', severity: 'Serious', weight: 4, group: 'B' },
  { code: 'B28', name: 'Conducting non-company business during work hours', severity: 'Serious', weight: 3, group: 'B' },
  { code: 'B29', name: 'Other violations of Attendance policies', severity: 'Less Serious', weight: 2, group: 'B' },

  // ======================== C. COMPANY & OTHER'S PROPERTY ========================
  { code: 'C1', name: 'Bringing unauthorized people into company premises', severity: 'Light', weight: 1, group: 'C' },
  { code: 'C2', name: 'Failure to report loss/damage to property within 72 hrs', severity: 'Light', weight: 1, group: 'C' },
  { code: 'C3', name: 'Operating vehicle/machinery without prescribed shoes', severity: 'Light', weight: 1, group: 'C' },
  { code: 'C4', name: 'Removing/relocating documents without authorization', severity: 'Light', weight: 1, group: 'C' },
  { code: 'C5', name: 'Failure to report property loss/damage', severity: 'Less Serious', weight: 2, group: 'C' },
  { code: 'C6', name: 'Unauthorized use of company property for fabrication', severity: 'Less Serious', weight: 2, group: 'C' },
  { code: 'C7', name: 'Using company vehicle for unauthorized purpose', severity: 'Less Serious', weight: 2, group: 'C' },
  { code: 'C8', name: 'Allowing outsider to operate company vehicle/equipment', severity: 'Less Serious', weight: 2, group: 'C' },
  { code: 'C9', name: 'Unauthorized use of company property off premises', severity: 'Less Serious', weight: 2, group: 'C' },
  { code: 'C10', name: 'Driving without valid driver\'s license', severity: 'Less Serious', weight: 2, group: 'C' },
  { code: 'C11', name: 'Abandoning company vehicle/equipment causing loss', severity: 'Serious', weight: 4, group: 'C' },
  { code: 'C12', name: 'Driving under influence of liquor/drugs', severity: 'Serious', weight: 5, group: 'C' },
  { code: 'C13', name: 'Carelessness causing major delay in operations', severity: 'Serious', weight: 3, group: 'C' },
  { code: 'C14', name: 'Willful damage to property or causing injuries', severity: 'Serious', weight: 4, group: 'C' },
  { code: 'C15', name: 'Using company equipment/personnel for personal enrichment', severity: 'Serious', weight: 4, group: 'C' },
  { code: 'C16', name: 'Unauthorized/wasteful use of materials/supplies', severity: 'Serious', weight: 3, group: 'C' },
  { code: 'C17', name: 'Theft of company property', severity: 'Serious', weight: 5, group: 'C' },
  { code: 'C18', name: 'Unauthorized possession/improper use of company property', severity: 'Serious', weight: 4, group: 'C' },
  { code: 'C19', name: 'Theft from others while on company premises', severity: 'Serious', weight: 5, group: 'C' },
  { code: 'C20', name: 'Withholding info about loss/damage during investigations', severity: 'Serious', weight: 3, group: 'C' },
  { code: 'C21', name: 'Prying into company records without authorization', severity: 'Serious', weight: 3, group: 'C' },
  { code: 'C22', name: 'Retrieving records from other depts without authorization', severity: 'Serious', weight: 3, group: 'C' },
  { code: 'C23', name: 'Tampering with company documents for fraud', severity: 'Serious', weight: 5, group: 'C' },
  { code: 'C24', name: 'Hacking company computer software', severity: 'Serious', weight: 5, group: 'C' },
  { code: 'C25', name: 'Embezzlement / misappropriation of company funds', severity: 'Serious', weight: 5, group: 'C' },
  { code: 'C26', name: 'Check kiting', severity: 'Serious', weight: 5, group: 'C' },
  { code: 'C27', name: 'Vandalism / defacing company or client property', severity: 'Serious', weight: 4, group: 'C' },

  // ======================== D. HEALTH, SAFETY & SECURITY ========================
  { code: 'D1', name: 'Refusal to receive prescribed medical treatment', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D2', name: 'Horseplay, malicious mischief, running, throwing things', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D3', name: 'Failure to wear prescribed company uniform', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D4', name: 'Failure to observe personal cleanliness', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D5', name: 'Refusal to show ID/badge to authorized personnel', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D6', name: 'Poor housekeeping, littering, unsanitary practices', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D7', name: 'Urinating/defecating in non-designated areas', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D8', name: 'Drinking alcohol during work hours', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D9', name: 'Failure to wear prescribed PPE', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D10', name: 'Entering premises after hours without official business', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D11', name: 'Safety Officer failure to secure workplace', severity: 'Serious', weight: 4, group: 'D' },
  { code: 'D12', name: 'Unauthorized removal/tampering of safety signage', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D13', name: 'Refusal to comply with sanitation/housekeeping rules', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D14', name: 'Improper waste disposal', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D15', name: 'Failure to attend safety meetings/toolbox talks', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D16', name: 'Creating unsafe conditions', severity: 'Serious', weight: 3, group: 'D' },
  { code: 'D17', name: 'Safety violation causing injury', severity: 'Serious', weight: 4, group: 'D' },
  { code: 'D18', name: 'Tampering with safety equipment', severity: 'Serious', weight: 4, group: 'D' },
  { code: 'D19', name: 'Failure to report safety hazards', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D20', name: 'Performing work without approved work permit', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D21', name: 'Violation of Bunkhouse Policy (smoking/drinking/drugs/foul language)', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D22', name: 'Alcohol or drugs on company premises', severity: 'Serious', weight: 5, group: 'D' },
  { code: 'D23', name: 'Failure to follow safety signs/warnings/barricades', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D24', name: 'Unauthorized entry to restricted areas', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D25', name: 'Improper use of firefighting equipment', severity: 'Serious', weight: 3, group: 'D' },
  { code: 'D26', name: 'Not wearing required PPE', severity: 'Less Serious', weight: 2, group: 'D' },
  { code: 'D27', name: 'Unauthorized use of company phone/electronics', severity: 'Light', weight: 1, group: 'D' },
  { code: 'D28', name: 'Smoking within No Smoking areas', severity: 'Less Serious', weight: 2, group: 'D' },

  // ======================== E. COMPANY INTEREST & BUSINESS ETHICS ========================
  { code: 'E1', name: 'Violation of work hours/attendance policies', severity: 'Light', weight: 1, group: 'E' },
  { code: 'E2', name: 'Failing to disclose relatives who are/were employees', severity: 'Light', weight: 1, group: 'E' },
  { code: 'E3', name: 'Violation of circular/regulation causing loss', severity: 'Less Serious', weight: 2, group: 'E' },
  { code: 'E4', name: 'Failure to attend company-paid training', severity: 'Less Serious', weight: 2, group: 'E' },
  { code: 'E5', name: 'Payroll padding / time fraud', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E6', name: 'Breach of Confidentiality Agreement', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E7', name: 'Breach of Conflict of Interest Policy', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E8', name: 'Willful non-observance of SOP for personal gain', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E9', name: 'Collusion with suppliers/subcontractors', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E10', name: 'Collusion with co-employees for fraudulent gain', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E11', name: 'Poaching/stealing clients, employees, processes', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E12', name: 'Accepting money/gifts from clients without disclosure', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E13', name: 'Private business without disclosure/approval', severity: 'Serious', weight: 3, group: 'E' },
  { code: 'E14', name: 'Moonlighting / unauthorized second job', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E15', name: 'Subcontracting using bogus business name', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E16', name: 'Activities benefiting competitor', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E17', name: 'Starting similar-services company while employed', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E18', name: 'Starting company that employs company\'s employees', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E19', name: 'Owning competitor\'s stock without disclosure', severity: 'Serious', weight: 3, group: 'E' },
  { code: 'E20', name: 'Part-owner of business selling to company without disclosure', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E21', name: 'Working part-time for competing product/service', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E22', name: 'Favoring suppliers for kickbacks', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E23', name: 'Divulging confidential information', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E24', name: 'Making false/malicious statements against company', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E25', name: 'Profane/abusive language against company', severity: 'Serious', weight: 3, group: 'E' },
  { code: 'E26', name: 'Using company uniform for financial gain', severity: 'Serious', weight: 3, group: 'E' },
  { code: 'E27', name: 'Causing damaging social media news about company', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E28', name: 'Unauthorized social media posting during work hours', severity: 'Serious', weight: 3, group: 'E' },
  { code: 'E29', name: 'Sharing IDs/passwords jeopardizing company', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E30', name: 'Concealing knowledge of anomalies/irregular transactions', severity: 'Serious', weight: 3, group: 'E' },
  { code: 'E31', name: 'Unauthorized use of company name for personal advantage', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E32', name: 'Bribing or taking bribes', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E33', name: 'Using company name to borrow money', severity: 'Serious', weight: 4, group: 'E' },
  { code: 'E34', name: 'Using company name/funds for illegal purposes', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E35', name: 'Counterfeiting/forging signatures on company documents', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E36', name: 'Falsification of employee records/expenses/claims', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E37', name: 'Removing/destroying/concealing evidence', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E38', name: 'Entering disadvantageous contracts for company', severity: 'Serious', weight: 5, group: 'E' },
  { code: 'E39', name: 'Violation of grooming/uniform policy', severity: 'Light', weight: 1, group: 'E' },
  { code: 'E40', name: 'Using cellphone during work hours', severity: 'Light', weight: 1, group: 'E' },
  { code: 'E41', name: 'Usurpation of authority / name dropping', severity: 'Less Serious', weight: 2, group: 'E' },
  { code: 'E42', name: 'Failure to log in/out using biometrics', severity: 'Light', weight: 1, group: 'E' },
  { code: 'E43', name: 'Disruptive behavior affecting operations', severity: 'Less Serious', weight: 2, group: 'E' },
  { code: 'E44', name: 'Wearing earrings/jewelry creating safety risk', severity: 'Light', weight: 1, group: 'E' },
  { code: 'E45', name: 'Unauthorized posting on social media about company', severity: 'Less Serious', weight: 2, group: 'E' },
  { code: 'E46', name: 'Improper use of materials causing waste', severity: 'Less Serious', weight: 2, group: 'E' },
  { code: 'E47', name: 'Failure to follow safety procedures', severity: 'Less Serious', weight: 2, group: 'E' },
  { code: 'E48', name: 'Serious misconduct / willful disobedience', severity: 'Serious', weight: 5, group: 'E' },
];

const insert = db.prepare(
  'INSERT INTO offense_categories (name, description, severity, code, weight) VALUES (?, ?, ?, ?, ?)'
);

const insertAll = db.transaction(() => {
  for (const o of offenses) {
    insert.run(o.name, o.description || '', o.severity, o.code, o.weight);
  }
});

insertAll();
console.log(`Inserted ${offenses.length} COD-based offense categories with severity weights.`);

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const hp = (s) => bcrypt.hashSync(s, 10);
  db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('admin', hp('admin123'), 'System Administrator', 'admin');
  db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('hrd', hp('hrd123'), 'HR Department', 'hrd');
  db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('auditor', hp('audit123'), 'Auditor View', 'user');
  console.log('Default users created: admin/admin123, hrd/hrd123, auditor/audit123');
}

const offCount = db.prepare('SELECT COUNT(*) as count FROM offense_categories').get();
console.log(`Total offense categories in DB: ${offCount.count}`);

db.close();
console.log('COD seed complete!');

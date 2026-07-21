const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'sitevigil.db');

let db;

function getDB() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initializeDatabase() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'hrd', 'user')),
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id TEXT UNIQUE NOT NULL,
      last_name TEXT NOT NULL,
      first_name TEXT NOT NULL,
      middle_name TEXT,
      full_name TEXT NOT NULL,
      position TEXT NOT NULL,
      trade TEXT,
      department TEXT NOT NULL,
      project_site TEXT DEFAULT 'Vail Land Development',
      classification TEXT DEFAULT 'Project-Based',
      date_hired DATE,
      date_ended DATE,
      status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive', 'Resigned', 'Terminated')),
      gender TEXT,
      birth_date DATE,
      nationality TEXT DEFAULT 'Filipino',
      civil_status TEXT,
      religion TEXT,
      blood_type TEXT,
      height TEXT,
      weight TEXT,
      contact_number TEXT,
      address TEXT,
      sss_no TEXT,
      pagibig_no TEXT,
      philhealth_no TEXT,
      daily_rate REAL,
      monthly_rate REAL,
      emergency_contact TEXT,
      emergency_contact_no TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      leadman TEXT,
      foreman TEXT,
      project_site TEXT DEFAULT 'Vail Land Development',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employee_team_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      assigned_date DATE DEFAULT (date('now')),
      end_date DATE,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date DATE NOT NULL,
      am_in TIME,
      am_out TIME,
      pm_in TIME,
      pm_out OT TIME,
      ot_in TIME,
      ot_out TIME,
      status TEXT DEFAULT 'Present' CHECK(status IN ('Present', 'Late', 'Half Day', 'Absent', 'Sick Leave', 'Filed Leave', 'Emergency Leave', 'AWOL', 'Holiday')),
      tardiness_minutes INTEGER DEFAULT 0,
      remarks TEXT,
      recorded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attendance_monthly_summary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      total_working_days INTEGER DEFAULT 0,
      days_present INTEGER DEFAULT 0,
      total_tardiness INTEGER DEFAULT 0,
      total_halfday INTEGER DEFAULT 0,
      total_awol INTEGER DEFAULT 0,
      total_sick_leave INTEGER DEFAULT 0,
      total_filed_leave INTEGER DEFAULT 0,
      total_emergency_leave INTEGER DEFAULT 0,
      total_absent INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS offense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL CHECK(severity IN ('Light', 'Less Serious', 'Serious')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS disciplinary_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_number TEXT UNIQUE NOT NULL,
      employee_id INTEGER NOT NULL,
      offense_category_id INTEGER,
      incident_date DATE NOT NULL,
      report_date DATE NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'Open' CHECK(status IN ('Open', 'Under Investigation', 'For Hearing', 'Resolved', 'Dismissed', 'Appealed')),
      penalty TEXT,
      resolution_date DATE,
      nte_date DATE,
      cdaf_date DATE,
      verdict TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (offense_category_id) REFERENCES offense_categories(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS case_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      document_type TEXT NOT NULL CHECK(document_type IN ('Incident Report', 'Notice to Explain', 'Investigation Report', 'Corrective Action', 'Verdict', 'Appeal', 'Other')),
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      signatory_role TEXT,
      signed_date DATE,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES disciplinary_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS hearings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      hearing_date DATE NOT NULL,
      start_time TEXT,
      end_time TEXT,
      status TEXT DEFAULT 'Scheduled' CHECK(status IN ('Scheduled', 'Ongoing', 'Completed', 'Cancelled')),
      notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES disciplinary_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS case_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES disciplinary_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notice_of_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_report_id INTEGER NOT NULL,
      case_number TEXT NOT NULL,
      status TEXT DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted to Main Office','Reviewed','Returned to Site')),
      findings TEXT,
      recommended_action TEXT,
      main_office_notes TEXT,
      submitted_to_main_office_date DATE,
      reviewed_by_main_office_date DATE,
      returned_to_site_date DATE,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (incident_report_id) REFERENCES incident_reports(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      contract_type TEXT DEFAULT 'Project-Based',
      daily_rate REAL,
      monthly_rate REAL,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Expired', 'Terminated', 'Completed')),
      project_site TEXT DEFAULT 'Vail Land Development',
      contract_file TEXT,
      remarks TEXT,
      is_latest INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS contract_extensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      extension_date_from DATE NOT NULL,
      extension_date_to DATE NOT NULL,
      reason TEXT,
      memo_number TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contract_id) REFERENCES contracts(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS recruitment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prf_number TEXT UNIQUE NOT NULL,
      department TEXT NOT NULL,
      position TEXT NOT NULL,
      trade TEXT,
      skilled_required INTEGER DEFAULT 0,
      non_skilled_required INTEGER DEFAULT 0,
      total_required INTEGER DEFAULT 0,
      project_site TEXT DEFAULT 'Vail Land Development',
      status TEXT DEFAULT 'Open' CHECK(status IN ('Open', 'In Progress', 'Filled', 'Cancelled')),
      date_requested DATE DEFAULT (date('now')),
      date_filled DATE,
      prepared_by TEXT,
      noted_by TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS recruitment_applicants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER,
      full_name TEXT NOT NULL,
      position TEXT,
      trade TEXT,
      classification TEXT DEFAULT 'Non-Skilled' CHECK(classification IN ('Skilled', 'Non-Skilled')),
      status TEXT DEFAULT 'For Screening' CHECK(status IN ('For Screening', 'For Interview', 'For Medical', 'For Orientation', 'For Job Offer', 'Hired', 'Rejected', 'No Response')),
      date_applied DATE DEFAULT (date('now')),
      date_hired DATE,
      medical_status TEXT,
      documents_complete INTEGER DEFAULT 0,
      remarks TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES recruitment_requests(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS applicant_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_id INTEGER NOT NULL,
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_by INTEGER,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (applicant_id) REFERENCES recruitment_applicants(id) ON DELETE CASCADE,
      FOREIGN KEY (changed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_name TEXT NOT NULL,
      location TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prf_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prf_no TEXT NOT NULL,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      trade_position TEXT NOT NULL,
      total_manpower_requested INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_prf_project ON prf_requests(project_id);

    CREATE TABLE IF NOT EXISTS prf_applicants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prf_request_id INTEGER NOT NULL REFERENCES prf_requests(id) ON DELETE CASCADE,
      applicant_name TEXT NOT NULL,
      sourced_from TEXT NOT NULL,
      recruitment_status TEXT NOT NULL DEFAULT 'PROCESSING DOCUMENTS',
      remarks TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_prf_applicant_prf ON prf_applicants(prf_request_id);

    CREATE TABLE IF NOT EXISTS pre_employment_checklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      completed_date DATE,
      remarks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (applicant_id) REFERENCES recruitment_applicants(id)
    );

    CREATE TABLE IF NOT EXISTS field_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inspection_date DATE NOT NULL,
      inspection_time TIME,
      project_site TEXT DEFAULT 'Vail Land Development',
      inspector TEXT,
      foreman TEXT,
      leadman TEXT,
      summary TEXT,
      photo_evidence TEXT,
      status TEXT DEFAULT 'Open' CHECK(status IN ('Open', 'Addressed', 'Closed')),
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS field_check_violations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      field_check_id INTEGER NOT NULL,
      employee_id INTEGER,
      employee_name TEXT,
      designation TEXT,
      violation TEXT NOT NULL,
      action_taken TEXT,
      photo_file TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (field_check_id) REFERENCES field_checks(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS bunkhouse_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_number TEXT NOT NULL,
      bunkhouse_name TEXT DEFAULT 'LVLCI Bunkhouse',
      capacity INTEGER DEFAULT 4,
      current_occupants INTEGER DEFAULT 0,
      project_site TEXT DEFAULT 'Vail Land Development',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bunkhouse_occupants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      employee_id INTEGER,
      occupant_name TEXT NOT NULL,
      designation TEXT,
      start_date DATE NOT NULL,
      end_date DATE,
      rental_rate REAL DEFAULT 100,
      rental_frequency TEXT DEFAULT 'Weekly' CHECK(rental_frequency IN ('Weekly', 'Monthly', 'One Time')),
      is_active INTEGER DEFAULT 1,
      remarks TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES bunkhouse_rooms(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS atd_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      atd_number TEXT UNIQUE NOT NULL,
      employee_id INTEGER NOT NULL,
      total_deduction REAL DEFAULT 0,
      weekly_deduction REAL DEFAULT 0,
      start_date DATE,
      end_date DATE,
      status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Completed', 'Cancelled')),
      remarks TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS atd_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      atd_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      amount REAL NOT NULL,
      is_paid INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (atd_id) REFERENCES atd_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evaluation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      evaluation_type TEXT DEFAULT 'Annual' CHECK(evaluation_type IN ('Annual', 'Quarterly', 'Monthly', 'Probationary')),
      period_start DATE,
      period_end DATE,
      rating REAL,
      rating_label TEXT,
      degree_of_performance TEXT,
      overall_evaluation TEXT,
      evaluated_by TEXT,
      remarks TEXT DEFAULT 'RETAIN',
      is_completed INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS manpower_loading (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade TEXT NOT NULL,
      project_site TEXT DEFAULT 'Vail Land Development',
      prf_number TEXT,
      total_hired INTEGER DEFAULT 0,
      balance INTEGER DEFAULT 0,
      date_updated DATE DEFAULT (date('now')),
      updated_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS manpower_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      is_bow INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS manpower_loading_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loading_id INTEGER NOT NULL,
      period_id INTEGER NOT NULL,
      value INTEGER DEFAULT 0,
      FOREIGN KEY (loading_id) REFERENCES manpower_loading(id) ON DELETE CASCADE,
      FOREIGN KEY (period_id) REFERENCES manpower_periods(id),
      UNIQUE(loading_id, period_id)
    );

    CREATE TABLE IF NOT EXISTS manpower_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      project_site TEXT NOT NULL,
      trade TEXT NOT NULL,
      team_id INTEGER,
      date_assigned DATE DEFAULT (date('now')),
      date_ended DATE,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      reference_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS incident_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_number TEXT UNIQUE NOT NULL,
      project_name TEXT DEFAULT 'Vail Land Development',
      address TEXT,
      employee_id INTEGER NOT NULL,
      alleged_violator_name TEXT NOT NULL,
      craft_position TEXT,
      department TEXT,
      immediate_supervisor TEXT,
      incident_date DATE NOT NULL,
      incident_time TEXT,
      date_reported DATE NOT NULL,
      location_of_incident TEXT,
      location_other TEXT,
      incident_type TEXT,
      type_other TEXT,
      others_involved TEXT,
      witnesses TEXT,
      narrative_description TEXT NOT NULL,
      reported_by TEXT,
      reported_date DATE,
      noted_by TEXT,
      noted_date DATE,
      reviewed_by TEXT,
      reviewed_date DATE,
      status TEXT DEFAULT 'Open' CHECK(status IN ('Open', 'Resolved', 'Closed')),
      nte_deadline_date DATE,
      nte_issued_date DATE,
      nte_notes TEXT,
      resolution_date DATE,
      resolution_notes TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS document_vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      document_type TEXT NOT NULL CHECK(document_type IN ('Policy', 'Form', 'Report', 'Contract', 'Other')),
      category TEXT,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      revision TEXT,
      description TEXT,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS leave_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      days_per_year INTEGER NOT NULL DEFAULT 0,
      is_paid INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      leave_type_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      total_days REAL NOT NULL DEFAULT 0,
      used_days REAL NOT NULL DEFAULT 0,
      pending_days REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_bal ON leave_balances(employee_id, leave_type_id, year);

    CREATE TABLE IF NOT EXISTS leave_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      leave_type_id INTEGER NOT NULL,
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      days REAL NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Denied', 'Cancelled')),
      approver_id INTEGER,
      approved_date DATE,
      denied_reason TEXT,
      attachment_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
      FOREIGN KEY (approver_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attendance_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      exception_type TEXT NOT NULL CHECK(exception_type IN ('3-Day AWOL', 'Habitual Tardiness', 'Pattern Absenteeism')),
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      days_missed INTEGER NOT NULL,
      status TEXT DEFAULT 'Open' CHECK(status IN ('Open', 'Reviewed', 'Resolved', 'Dismissed')),
      notes TEXT,
      reviewed_by INTEGER,
      reviewed_date DATE,
      resolution TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      recipient TEXT,
      subject TEXT,
      status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'failed')),
      reference_module TEXT,
      reference_id INTEGER,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { db.exec(`ALTER TABLE employees ADD COLUMN email TEXT`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN password_hash TEXT`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN can_login INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN sil_credited INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN sil_credited_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN awol_flag INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN awol_flag_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN awol_cleared_date DATE`); } catch {}

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const hp = (s) => bcrypt.hashSync(s, 10);
    db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('admin', hp('admin123'), 'System Administrator', 'admin');
    db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('hrd', hp('hrd123'), 'HR Department', 'hrd');
    db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('auditor', hp('audit123'), 'Auditor View', 'user');
    console.log('Default users created: admin/admin123, hrd/hrd123, auditor/audit123');
  }

  const offCount = db.prepare('SELECT COUNT(*) as count FROM offense_categories').get();
  if (offCount.count === 0) {
    const ins = db.prepare('INSERT INTO offense_categories (name, description, severity) VALUES (?, ?, ?)');
    ins.run('Tardiness', 'Reporting for work past the required time', 'Light');
    ins.run('Failure to Log In/Out', 'Not using biometrics or signing TBM attendance', 'Light');
    ins.run('Not Wearing PPE', 'Failure to use required personal protective equipment', 'Less Serious');
    ins.run('Smoking in Prohibited Area', 'Smoking outside designated areas', 'Less Serious');
    ins.run('Absenteeism', 'Habitual failure to report for work', 'Less Serious');
    ins.run('Wearing Earrings/Jewelry', 'Wearing prohibited accessories during work hours', 'Light');
    ins.run('Inappropriate Conduct', 'Inappropriate comments or behavior towards coworkers', 'Less Serious');
    ins.run('Insubordination', 'Refusal to obey orders or disrespect towards supervisor', 'Serious');
    ins.run('AWOL', 'Absence without official leave', 'Serious');
    ins.run('Dishonesty', 'Acts of fraud, theft, or misrepresentation', 'Serious');
    ins.run('Disruptive Behavior', 'Inappropriate conduct affecting operations', 'Less Serious');
    console.log('Default offense categories created (11 COD-based)');
  }

  const teamCount = db.prepare('SELECT COUNT(*) as count FROM teams').get();
  if (teamCount.count === 0) {
    const ins = db.prepare('INSERT INTO teams (name, leadman, foreman) VALUES (?, ?, ?)');
    ins.run('Team Foreman Riky', '', 'Riky');
    ins.run('Team Foreman Munta', '', 'Munta');
    ins.run('MEVA Formworks', 'Enad', '');
    ins.run('Team Carpenters', 'Ronie', '');
    ins.run('Team Fabricator', '', '');
    ins.run('Team Electrician', '', '');
    ins.run('Team Operator/Drivers', '', '');
    ins.run('Safety Crew', '', '');
    ins.run('Team Scaffolder', '', '');
    ins.run('Team Plumber', '', '');
  }

  const ltCount = db.prepare('SELECT COUNT(*) as count FROM leave_types').get();
  if (ltCount.count === 0) {
    const ins = db.prepare('INSERT INTO leave_types (name, code, description, days_per_year, is_paid) VALUES (?, ?, ?, ?, ?)');
    ins.run('Vacation Leave', 'VL', 'Annual vacation leave (unlimited)', 0, 1);
    ins.run('Sick Leave', 'SL', 'Medical leave', 5, 1);
    ins.run('Emergency Leave', 'EL', 'Emergency circumstances', 3, 0);
    ins.run('Birthday Leave', 'BL', 'Birthday leave privilege', 1, 1);
    console.log('Default leave types created');
  }
  try { db.exec(`INSERT OR IGNORE INTO leave_types (name, code, description, days_per_year, is_paid) VALUES ('Service Incentive Leave', 'SIL', 'Mandatory 5-day SIL per Philippine Labor Law (Art. 95)', 5, 1)`); } catch {}

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_att_summary_emp_month ON attendance_monthly_summary(employee_id, month, year);`);

  db.exec(`CREATE TABLE IF NOT EXISTS nte_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memo_number TEXT NOT NULL,
    employee_id INTEGER NOT NULL,
    employee_name TEXT NOT NULL,
    position TEXT,
    project_location TEXT,
    classification TEXT NOT NULL,
    classification_group TEXT NOT NULL,
    offense_category_id INTEGER,
    specific_violation TEXT,
    incident_date DATE NOT NULL,
    incident_time TEXT,
    incident_description TEXT NOT NULL,
    nte_body TEXT,
    incident_report_id INTEGER,
    prepared_by TEXT,
    checked_by TEXT,
    approved_by TEXT,
    concurred_by TEXT,
    remarks TEXT,
    status TEXT DEFAULT 'Draft',
    date_received DATE,
    explanation_deadline DATE,
    employee_signed INTEGER DEFAULT 0,
    date_signed DATE,
    refused_to_sign INTEGER DEFAULT 0,
    witness_name TEXT,
    witness_position TEXT,
    date_explanation_submitted DATE,
    employee_explanation TEXT,
    explanation_document TEXT,
    final_decision TEXT,
    resolution_date DATE,
    preventive_suspension INTEGER DEFAULT 0,
    suspension_days INTEGER,
    suspension_effective_date DATE,
    suspension_return_date DATE,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  db.exec(`CREATE TABLE IF NOT EXISTS compliance_calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    module TEXT NOT NULL,
    reference_id INTEGER,
    due_date DATE NOT NULL,
    priority TEXT DEFAULT 'Normal',
    status TEXT DEFAULT 'Pending',
    completed_date DATE,
    completed_by INTEGER,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);

  try { db.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE offense_categories ADD COLUMN code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE offense_categories ADD COLUMN weight INTEGER DEFAULT 1`); } catch {}
  try { db.exec(`ALTER TABLE nte_cases ADD COLUMN nte_body TEXT`); } catch {}
  try { db.exec(`ALTER TABLE nte_cases ADD COLUMN incident_report_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_decided_by TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_served_by TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_received_by TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_received_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_document TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN incident_report_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN nte_case_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN memo_number TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN nov_nte_document TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN notice_served_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN notice_received_by TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN notice_received_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN violation_classification TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN violation_details TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN closed_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE case_documents ADD COLUMN signatory_role TEXT`); } catch {}
  try { db.exec(`ALTER TABLE case_documents ADD COLUMN signed_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE incident_reports ADD COLUMN nov_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE incident_reports ADD COLUMN nov_status TEXT DEFAULT NULL`); } catch {}
  try { db.exec(`ALTER TABLE attendance_records ADD COLUMN missing_punches TEXT`); } catch {}
  try { db.exec(`ALTER TABLE attendance_records ADD COLUMN nd_minutes INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE leave_applications ADD COLUMN attachment_url TEXT`); } catch {}

  db.exec(`CREATE TABLE IF NOT EXISTS subcon_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  try { db.exec(`ALTER TABLE subcon_employees ADD COLUMN is_active INTEGER DEFAULT 1`); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      address TEXT,
      contact_person TEXT,
      contact_number TEXT,
      email TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const branchCount = db.prepare('SELECT COUNT(*) as count FROM branches').get();
  if (branchCount.count === 0) {
    const ins = db.prepare('INSERT INTO branches (name, code, address) VALUES (?, ?, ?)');
    ins.run('Vail Land Development', 'VLD', 'Vail, Philippines');
    ins.run('Main Office', 'MAIN', 'Corporate Headquarters');
    console.log('Default branches created');
  }

  try { db.exec(`ALTER TABLE users ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE employees ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE teams ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE contracts ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE incident_reports ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE field_checks ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE bunkhouse_rooms ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE manpower_loading ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE manpower_loading ADD COLUMN category TEXT DEFAULT 'Direct'`); } catch {}
  try { db.exec(`ALTER TABLE manpower_loading ADD COLUMN q4_2025 INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE manpower_loading ADD COLUMN jan_2026 INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE manpower_loading ADD COLUMN required_bow INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE manpower_loading ADD COLUMN is_subcon INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE manpower_loading ADD COLUMN required_bow INTEGER DEFAULT 0`); } catch {}

  // Seed default periods
  const periodCount = db.prepare('SELECT COUNT(*) as c FROM manpower_periods').get().c;
  if (periodCount === 0) {
    const insP = db.prepare('INSERT INTO manpower_periods (label, sort_order) VALUES (?,?)');
    insP.run('2025 Q4', 1);
    insP.run('2026 January', 2);
    console.log('Default manpower periods created');

    // Migrate existing q4_2025 / jan_2026 values to new periods table
    const existing = db.prepare("SELECT id, q4_2025, jan_2026 FROM manpower_loading WHERE q4_2025 IS NOT NULL OR jan_2026 IS NOT NULL").all();
    if (existing.length > 0) {
      const p1 = db.prepare("SELECT id FROM manpower_periods WHERE label = '2025 Q4'").get();
      const p2 = db.prepare("SELECT id FROM manpower_periods WHERE label = '2026 January'").get();
      const insV = db.prepare('INSERT OR IGNORE INTO manpower_loading_values (loading_id, period_id, value) VALUES (?,?,?)');
      for (const row of existing) {
        if (row.q4_2025) insV.run(row.id, p1.id, row.q4_2025);
        if (row.jan_2026) insV.run(row.id, p2.id, row.jan_2026);
      }
      console.log('Migrated ' + existing.length + ' loading entries to period values');
    }
  }
  try { db.exec(`ALTER TABLE manpower_assignments ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE recruitment_requests ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE notice_of_violations ADD COLUMN branch_id INTEGER REFERENCES branches(id)`); } catch {}
  try { db.exec(`ALTER TABLE notice_of_violations ADD COLUMN pdf_path TEXT`); } catch {}

  const defaultBranch = db.prepare("SELECT id FROM branches WHERE code = 'VLD'").get();
  if (defaultBranch) {
    db.prepare('UPDATE employees SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE teams SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE contracts SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE incident_reports SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE field_checks SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE bunkhouse_rooms SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE manpower_loading SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE manpower_assignments SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
    db.prepare('UPDATE recruitment_requests SET branch_id = ? WHERE branch_id IS NULL').run(defaultBranch.id);
  }

  console.log('HRMS database initialized successfully');
}

if (db) {
  // F-HRD-049: Corrective Disciplinary Action Form (Verbal/Written Reprimand)
  db.exec(`CREATE TABLE IF NOT EXISTS cdaf_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cdaf_number TEXT UNIQUE NOT NULL,
    employee_id INTEGER NOT NULL,
    offense_category_id INTEGER,
    offense_number INTEGER NOT NULL DEFAULT 1,
    incident_date DATE NOT NULL,
    description TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('Verbal Reprimand', 'Written Reprimand')),
    counselled_by TEXT,
    counselling_notes TEXT,
    employee_response TEXT,
    employee_acknowledged INTEGER DEFAULT 0,
    acknowledged_date DATE,
    status TEXT DEFAULT 'Open' CHECK(status IN ('Open', 'Acknowledged', 'Closed')),
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (offense_category_id) REFERENCES offense_categories(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );`);

  // F-HRD-035: Investigation Report
  db.exec(`CREATE TABLE IF NOT EXISTS investigation_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    report_number TEXT UNIQUE NOT NULL,
    investigator TEXT NOT NULL,
    investigation_date DATE NOT NULL,
    findings TEXT NOT NULL,
    conclusion TEXT NOT NULL,
    recommended_action TEXT,
    is_guilty INTEGER,
    submitted_by INTEGER,
    submitted_date DATE,
    reviewed_by INTEGER,
    reviewed_date DATE,
    status TEXT DEFAULT 'Draft' CHECK(status IN ('Draft', 'Submitted', 'Reviewed', 'Final')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES disciplinary_cases(id) ON DELETE CASCADE,
    FOREIGN KEY (submitted_by) REFERENCES users(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
  );`);

  // Case Appeals
  db.exec(`CREATE TABLE IF NOT EXISTS case_appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    appeal_date DATE NOT NULL,
    appeal_reason TEXT NOT NULL,
    supporting_document TEXT,
    status TEXT DEFAULT 'Pending' CHECK(status IN ('Pending', 'Approved', 'Denied')),
    decision TEXT,
    decided_by INTEGER,
    decided_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES disciplinary_cases(id) ON DELETE CASCADE,
    FOREIGN KEY (decided_by) REFERENCES users(id)
  );`);

  // Add verdict approval columns to disciplinary_cases
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_status TEXT DEFAULT NULL CHECK(verdict_status IN ('Pending Top Mgmt Approval', 'Approved', 'Rejected'))`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_approved_by TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_approved_date DATE`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN verdict_rejection_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN needs_investigation INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE disciplinary_cases ADD COLUMN decision_date DATE`); } catch {}

  // SLA tracking columns for incident_reports
  try { db.exec(`ALTER TABLE incident_reports ADD COLUMN sla_incident_submission INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE incident_reports ADD COLUMN sla_incident_notes TEXT`); } catch {}
}

module.exports = { getDB, initializeDatabase };

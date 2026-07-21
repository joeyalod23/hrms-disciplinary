const { getDB } = require('../db/schema');

function branchScope(tableAlias, checkCorporate = true) {
  return (req, res, next) => {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const userBranchId = req.user?.branch_id;
    if (checkCorporate && !userBranchId) {
      res.locals.branchFilter = '';
      return next();
    }
    if (userBranchId) {
      res.locals.branchFilter = ` AND ${prefix}branch_id = ${parseInt(userBranchId)}`;
    } else {
      res.locals.branchFilter = '';
    }
    next();
  };
}

function corporateBranchScope(tableAlias) {
  return (req, res, next) => {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const userBranchId = req.user?.branch_id;
    if (req.query.corporate === '1' && !userBranchId) {
      res.locals.branchFilter = '';
      return next();
    }
    if (userBranchId) {
      res.locals.branchFilter = ` AND ${prefix}branch_id = ${parseInt(userBranchId)}`;
    } else {
      const requestedBranch = req.query.branch_id;
      if (requestedBranch) {
        res.locals.branchFilter = ` AND ${prefix}branch_id = ${parseInt(requestedBranch)}`;
      } else {
        res.locals.branchFilter = '';
      }
    }
    next();
  };
}

function loadBranches(req, res, next) {
  try {
    const db = getDB();
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='branches'").get();
    if (tableExists) {
      res.locals.branches = db.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY name').all();
    } else {
      res.locals.branches = [];
    }
    if (req.user) {
      const userBranchId = req.user.branch_id;
      if (userBranchId && res.locals.branches.length > 0) {
        res.locals.userBranch = db.prepare('SELECT * FROM branches WHERE id = ?').get(userBranchId);
        res.locals.isCorporate = false;
      } else if (userBranchId) {
        res.locals.userBranch = null;
        res.locals.isCorporate = false;
      } else {
        res.locals.userBranch = null;
        res.locals.isCorporate = true;
      }
    }
  } catch (e) {
    res.locals.branches = [];
    res.locals.userBranch = null;
    res.locals.isCorporate = false;
  }
  next();
}

module.exports = { branchScope, corporateBranchScope, loadBranches };

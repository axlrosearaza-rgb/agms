const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Sequelize validation error
  if (err.name === 'SequelizeValidationError') {
    const errors = err.errors.map((e) => ({ field: e.path, message: e.message }));
    return res.status(400).json({ message: 'Validation error', errors });
  }

  // Sequelize unique constraint
  if (err.name === 'SequelizeUniqueConstraintError') {
    const field = err.errors[0]?.path || 'field';
    return res.status(409).json({ message: `A record with this ${field} already exists.` });
  }

  // Sequelize foreign key error
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({ message: 'Referenced record does not exist.' });
  }

  // Raw Postgres "value too long for type character varying(N)" (code 22001,
  // string data right truncation) — happens whenever a column is narrower than
  // real-world input and slips past app-level validation. Without this, the raw
  // driver message (e.g. "value too long for type character varying(20)") leaks
  // straight to the user, which is confusing and doesn't say what field to fix.
  if (err.name === 'SequelizeDatabaseError' && (err.original?.code === '22001' || /value too long/i.test(err.message))) {
    return res.status(400).json({ message: 'One of the fields you entered is too long. Please shorten it and try again.' });
  }

  // Default
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler };

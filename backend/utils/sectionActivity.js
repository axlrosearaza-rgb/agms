// History of a Program / Year / Section — class list imports, promotions and
// adviser changes. Stored against the section, not the adviser, so a new
// adviser of the section sees everything done to it before them.
const { sequelize } = require('../config/database');

const sectionKey = (s) => `${s.program}|${Number(s.year_level)}|${s.section}`;

// Never throws — a history entry failing to save must not fail the action itself.
async function logSectionActivity(section, user, action) {
  try {
    await sequelize.query(
      'INSERT INTO section_activities (program, year_level, section, user_id, user_name, action) VALUES (:program, :year_level, :section, :user_id, :user_name, :action)',
      {
        replacements: {
          program: section.program,
          year_level: Number(section.year_level),
          section: section.section,
          user_id: user?.id || null,
          user_name: user?.name || null,
          action,
        },
      }
    );
  } catch (err) {
    console.warn('[section activity] not saved:', err.message);
  }
}

// The latest `limit` entries for each of the given sections → { key: [entries] }.
async function recentSectionActivity(sections, limit = 15) {
  const out = {};
  if (!sections.length) return out;
  const conds = sections.map((_, i) => `(program = :p${i} AND year_level = :y${i} AND section = :s${i})`).join(' OR ');
  const replacements = {};
  sections.forEach((s, i) => { replacements[`p${i}`] = s.program; replacements[`y${i}`] = Number(s.year_level); replacements[`s${i}`] = s.section; });
  const [rows] = await sequelize.query(
    `SELECT * FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY program, year_level, section ORDER BY created_at DESC) AS rn
       FROM section_activities WHERE ${conds}
     ) t WHERE rn <= ${Number(limit)} ORDER BY created_at DESC`,
    { replacements }
  );
  rows.forEach((r) => {
    const key = sectionKey(r);
    (out[key] = out[key] || []).push({ id: r.id, user_name: r.user_name, action: r.action, created_at: r.created_at });
  });
  return out;
}

module.exports = { logSectionActivity, recentSectionActivity, sectionKey };

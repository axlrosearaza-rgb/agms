// One-off script: bulk-add the 43 part-time faculty from the College of Arts
// and Sciences roster (Office of the Dean, part-time list). Each gets a
// Faculty account, visible to every program's Chairperson, username =
// lowercase(first given name + last name) matching the existing convention,
// password 123456 (hashed by the User model's beforeCreate hook).
const { User } = require('../models');
const { Op } = require('sequelize');

const ALL_PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

// [full name as it should be stored, given name used for the username]
const FACULTY = [
  ['Chrisselda G. Abalos', 'Chrisselda'],
  ['Jeff S. Acedillo', 'Jeff'],
  ['Donna Mae Alaga', 'Donna'],
  ['Walvies Mc L. Alcos', 'Walvies'],
  ['Vienuell B. Aying', 'Vienuell'],
  ['Lobela Bulos', 'Lobela'],
  ['Trizha Maebelle C. Calosor', 'Trizha'],
  ['Dannica H. Carbonquillo', 'Dannica'],
  ['Jake Boy D. Carbonquillo', 'Jake'],
  ['Paul Marty D. Carbonquillo', 'Paul'],
  ['Vincent Joshua Cruz', 'Vincent'],
  ['Francisco A. Dequito Jr.', 'Francisco'],
  ['Mclyn Diamos', 'Mclyn'],
  ['Glenn B. Donadillo', 'Glenn'],
  ['Gina U. Español', 'Gina'],
  ['Christine O. Estilles', 'Christine'],
  ['Nikko Ardel P. Floretes', 'Nikko'],
  ['Dianne G. Fructuoso', 'Dianne'],
  ['Mar June J. Gabon', 'Mar'],
  ['Jessie T. Gabonpa', 'Jessie'],
  ['Adrian Gadin', 'Adrian'],
  ['Ephraim John A. Gadin', 'Ephraim'],
  ['Patricia Paula Gonzales', 'Patricia'],
  ['Elmar A. Irene', 'Elmar'],
  ['Jessica May Irinco', 'Jessica'],
  ['Marc Joseph J. Latoja', 'Marc'],
  ['Eunice Joy L. Llantos', 'Eunice'],
  ['Christian Mamitag', 'Christian'],
  ['Geolly L. Maglines', 'Geolly'],
  ['Jomar Nacario', 'Jomar'],
  ['Mark Angel V. Nuevo', 'Mark'],
  ['Eduardo O. Pacoma', 'Eduardo'],
  ['Judy Ann Pandong', 'Judy'],
  ['Albert Pantaleon', 'Albert'],
  ['John Patrick J. Quemaño', 'John'],
  ['Michael Angelo I. Rediang', 'Michael'],
  ['Art T. Roncesvalles', 'Art'],
  ['Nilo B. Solayo', 'Nilo'],
  ['Princess Camille Tagaloy', 'Princess'],
  ['Ruth F. Tanseco', 'Ruth'],
  ['Fiel Clarette R. Tongol', 'Fiel'],
  ['Alfred Vicente', 'Alfred'],
  ['Aivan L. Zilmar', 'Aivan'],
];

const slug = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents (Español -> Espanol)
  .toLowerCase()
  .replace(/[^a-z]/g, '');

const usernameFor = (fullName, given) => {
  const lastName = fullName.split(',')[0].trim().split(' ').pop(); // fallback, unused (names already "Given ... Last")
  const parts = fullName.replace(/\bJr\.?$/i, '').trim().split(/\s+/);
  const last = parts[parts.length - 1];
  return slug(given) + slug(last);
};

(async () => {
  const results = [];
  for (const [name, given] of FACULTY) {
    const username = usernameFor(name, given);
    const existing = await User.findOne({ where: { username } });
    if (existing) {
      console.log(`SKIP (username taken): ${name} -> ${username} (existing user #${existing.id})`);
      continue;
    }
    const user = await User.create({
      name,
      username,
      password: '123456',
      role: 'Faculty',
      department: 'College of Arts and Sciences',
      programs: ALL_PROGRAMS,
      employment_type: 'Part Time',
      is_teaching: false,
    });
    results.push({ id: user.id, name, username });
    console.log(`Created: ${name} -> ${username} (#${user.id})`);
  }
  console.log(`\nDone. Created ${results.length} of ${FACULTY.length} accounts.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

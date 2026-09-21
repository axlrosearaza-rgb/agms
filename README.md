# 🎓 Academic Grade Management System (AGMS)
## Samar State University — College of Arts and Sciences

A full-stack web-based Academic Grade Management System with four role-based user types: **Admin**, **Chairperson**, **Instructor**, and **Student**.

---

## 🏗️ Tech Stack

| Layer      | Technology                        |
|------------|-----------------------------------|
| Frontend   | React.js 18 + Tailwind CSS 3      |
| Backend    | Node.js + Express.js              |
| Database   | PostgreSQL + Sequelize ORM        |
| Auth       | JWT (JSON Web Tokens)             |
| Charts     | Chart.js + react-chartjs-2        |
| HTTP       | Axios                             |
| Toasts     | react-hot-toast                   |

---

## 📁 Project File Structure

```
agms/
├── package.json                          # Root monorepo config
├── .gitignore
├── README.md
│
├── backend/
│   ├── package.json
│   ├── server.js                         # Express entry point
│   ├── .env.example                      # Environment variables template
│   │
│   ├── config/
│   │   └── database.js                   # Sequelize + PostgreSQL connection
│   │
│   ├── models/
│   │   ├── index.js                      # Model associations & exports
│   │   ├── User.js                       # User model (all roles)
│   │   ├── Subject.js                    # Subject/course model
│   │   ├── Prerequisite.js               # Subject prerequisite relations
│   │   ├── Class.js                      # Class (section) model
│   │   ├── Enrollment.js                 # Student-Class join table
│   │   ├── Grade.js                      # Grade records
│   │   ├── Endorsement.js                # Chairperson endorsements
│   │   └── ActivityLog.js                # System audit trail
│   │
│   ├── controllers/
│   │   ├── authController.js             # Login, getMe, changePassword
│   │   ├── userController.js             # CRUD users (Admin only creates)
│   │   ├── subjectController.js          # CRUD subjects + prerequisites
│   │   ├── classController.js            # CRUD classes, enrollment
│   │   ├── gradeController.js            # Encode, submit, distribution
│   │   ├── endorsementController.js      # Endorse/flag students
│   │   └── dashboardController.js        # Admin stats & activities
│   │
│   ├── middleware/
│   │   ├── auth.js                       # JWT verify + role authorization
│   │   └── errorHandler.js               # Global error handler + asyncHandler
│   │
│   ├── routes/
│   │   ├── auth.js                       # POST /api/auth/login, etc.
│   │   ├── users.js                      # /api/users
│   │   ├── subjects.js                   # /api/subjects
│   │   ├── classes.js                    # /api/classes
│   │   ├── grades.js                     # /api/grades
│   │   ├── endorsements.js               # /api/endorsements
│   │   └── dashboard.js                  # /api/dashboard
│   │
│   ├── seeds/
│   │   └── seed.js                       # Database seeder with demo data
│   │
│   └── utils/
│       └── activityLogger.js             # Activity log helper
│
└── frontend/
    ├── package.json
    ├── tailwind.config.js                # Tailwind + custom colors/fonts
    ├── postcss.config.js
    │
    ├── public/
    │   └── index.html
    │
    └── src/
        ├── index.js                      # React entry point
        ├── index.css                     # Tailwind directives + custom styles
        ├── App.js                        # Router + role-based route config
        │
        ├── context/
        │   └── AuthContext.js            # Auth state provider (JWT)
        │
        ├── services/
        │   ├── api.js                    # Axios instance + interceptors
        │   └── index.js                  # All API service modules
        │
        ├── components/
        │   ├── common/
        │   │   └── index.js              # Icons, Avatar, Badge, Modal, SearchBar, StatCard, etc.
        │   ├── layout/
        │   │   └── AppLayout.js          # Sidebar + Topbar + Breadcrumb shell
        │   ├── auth/
        │   │   └── LoginPage.js          # Login page with demo credentials
        │   └── charts/
        │       └── GradeCharts.js        # Chart.js: bar, doughnut, department
        │
        └── pages/
            ├── admin/
            │   ├── AdminDashboard.js     # Stats, activities, grade distribution
            │   ├── UserManagement.js     # CRUD users, tabs, search, modal
            │   ├── ClassManagement.js    # Classes table with filters
            │   └── Reports.js            # Report type cards + filters
            │
            ├── chairperson/
            │   ├── ChairpersonDashboard.js  # Pending review, endorse/flag, summary
            │   └── DepartmentStudents.js    # Student table with GWA, prereq checks
            │
            ├── instructor/
            │   ├── InstructorDashboard.js   # Class cards, recent submissions
            │   ├── InstructorClasses.js     # Classes table with progress
            │   └── GradeEncoding.js         # Grade input, auto-compute, submit
            │
            └── student/
                ├── StudentDashboard.js      # Hero card, GWA, expandable grades
                └── StudentGrades.js         # Grades table view
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+ and npm
- **PostgreSQL** v14+
- Git

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd agms

# Install all dependencies
npm run install:all
```

### 2. Database Setup

```bash
# Create the PostgreSQL database
psql -U postgres
CREATE DATABASE agms_db;
\q

# Configure environment
cd backend
cp .env.example .env
# Edit .env with your PostgreSQL credentials
```

### 3. Seed the Database

```bash
cd backend
npm run seed
```

This creates all tables and populates demo data including:
- 1 Admin, 4 Chairpersons, 3 Instructors, 7 Students
- 9 Subjects with prerequisites
- 8 Classes with enrollments
- 14 Grade records
- 5 Endorsements
- Activity logs

### 4. Run the Application

```bash
# From root directory - runs both backend and frontend
npm run dev

# Or separately:
npm run dev:backend    # http://localhost:5000
npm run dev:frontend   # http://localhost:3000
```

### 5. Login with Demo Credentials

| Role         | Email                        | Password   |
|-------------|------------------------------|------------|
| Admin       | admin@ssu.edu.ph             | admin123   |
| Chairperson | e.villanueva@ssu.edu.ph      | chair123   |
| Instructor  | j.cruz@ssu.edu.ph            | faculty123 |
| Student     | m.delacruz@ssu.edu.ph        | student123 |

---

## 📋 API Endpoints

### Authentication
| Method | Endpoint              | Description           | Auth |
|--------|-----------------------|-----------------------|------|
| POST   | /api/auth/login       | Login                 | No   |
| GET    | /api/auth/me          | Get current user      | Yes  |
| PUT    | /api/auth/password    | Change password       | Yes  |

### Users (Admin only for create/update/delete)
| Method | Endpoint                          | Description                |
|--------|-----------------------------------|----------------------------|
| GET    | /api/users                        | List users (filtered)      |
| GET    | /api/users/:id                    | Get user by ID             |
| POST   | /api/users                        | Create user                |
| PUT    | /api/users/:id                    | Update user                |
| DELETE | /api/users/:id                    | Deactivate user            |
| GET    | /api/users/department/:department | Get users by department    |

### Subjects
| Method | Endpoint           | Description              |
|--------|--------------------|--------------------------|
| GET    | /api/subjects      | List subjects (filtered) |
| POST   | /api/subjects      | Create subject (Admin)   |
| PUT    | /api/subjects/:id  | Update subject (Admin)   |
| DELETE | /api/subjects/:id  | Delete subject (Admin)   |

### Classes
| Method | Endpoint                              | Description              |
|--------|---------------------------------------|--------------------------|
| GET    | /api/classes                          | List classes             |
| GET    | /api/classes/:id                      | Get class details        |
| POST   | /api/classes                          | Create class (Admin)     |
| PUT    | /api/classes/:id                      | Update class (Admin)     |
| DELETE | /api/classes/:id                      | Delete class (Admin)     |
| POST   | /api/classes/:id/enroll               | Enroll students (Admin)  |
| GET    | /api/classes/instructor/:instructorId | Get instructor's classes |

### Grades
| Method | Endpoint                    | Description                    |
|--------|-----------------------------|--------------------------------|
| GET    | /api/grades/class/:classId  | Get grades for a class         |
| POST   | /api/grades/encode          | Save draft grades (Instructor) |
| POST   | /api/grades/submit          | Submit grades (Instructor)     |
| GET    | /api/grades/student/:id     | Get student's grades           |
| GET    | /api/grades/distribution    | Grade distribution stats       |
| GET    | /api/grades/recent          | Recent submissions             |

### Endorsements (Chairperson)
| Method | Endpoint                               | Description             |
|--------|----------------------------------------|-------------------------|
| GET    | /api/endorsements                      | List endorsements       |
| GET    | /api/endorsements/department-students  | Get dept students + GWA |
| POST   | /api/endorsements/endorse              | Endorse student         |
| POST   | /api/endorsements/flag                 | Flag student            |

### Dashboard
| Method | Endpoint                  | Description          |
|--------|---------------------------|----------------------|
| GET    | /api/dashboard/admin      | Admin stats          |
| GET    | /api/dashboard/activities | Activity log         |

---

## 👥 Role Permissions

### Admin (Dean's Office)
- ✅ Create/edit/deactivate ALL user accounts
- ✅ Manage subjects, prerequisites, classes, semesters
- ✅ View system-wide statistics and grade distribution
- ✅ View complete activity log
- ✅ Generate and export reports

### Chairperson (Per Department)
- ✅ View only students within assigned department (auto-filtered)
- ✅ Validate academic standing and prerequisite completion
- ✅ Endorse students to Dean's Office for enrollment
- ✅ Flag students with unmet prerequisites
- ❌ Cannot encode grades

### Instructor
- ✅ View assigned classes and student rosters
- ✅ Encode Midterm and Finals grades
- ✅ Auto-computed: Average = (Midterm + Finals) / 2
- ✅ Auto-determined: Pass (≥75) / Fail (<75)
- ✅ Save drafts and submit final grades

### Student
- ✅ View personal profile and GWA
- ✅ View enrolled subjects with expandable grade details
- ✅ Real-time grade reflection once instructor submits
- ❌ Read-only access (cannot modify any data)

---

## 🎨 Design System

- **Primary**: Navy (#1B3A5C) — headers, sidebar, topbar
- **Accent**: Gold (#C9A84C) — buttons, active states, GWA circle
- **Typography**: DM Sans (body) + Playfair Display (headings)
- **Cards**: White with subtle borders and shadows
- **Responsive**: Mobile-first with collapsible sidebar

---

## 📄 License

This project is developed as a capstone project for Samar State University.
 
 
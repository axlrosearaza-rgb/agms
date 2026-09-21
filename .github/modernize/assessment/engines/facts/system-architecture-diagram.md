# AGMS System Architecture

```mermaid
flowchart LR
    subgraph Users[Web Users]
        Admin[Admin]
        Chairperson[Chairperson]
        Faculty[Faculty]
        Student[Student]
    end

    subgraph WebAccess[Web Access]
        Browser[Browser / React SPA]
    end

    subgraph Frontend[Frontend Layer]
        App[App.js Router]
        Layout[AppLayout.js Shell]
        Pages[Role Dashboards and Pages]
    end

    subgraph Auth[Authentication & Session]
        AuthContext[AuthContext.js]
        JWT[JWT Token]
        AuthStorage[Browser Storage]
    end

    subgraph Backend[Backend Layer]
        Express[Express Server]
        Routes[Routes]
        Controllers[Controllers]
        Middleware[Middleware]
        Services[Utils / Notification / Activity Logging]
    end

    subgraph Data[Data Layer]
        Models[Sequelize Models]
        DB[(PostgreSQL Database)]
    end

    subgraph Realtime[Realtime / Communication]
        Socket[Socket.IO]
        Chat[Chat and Notifications]
    end

    Admin --> Browser
    Chairperson --> Browser
    Faculty --> Browser
    Student --> Browser

    Browser --> App
    App --> Layout
    App --> Pages

    Pages --> AuthContext
    AuthContext --> JWT
    AuthContext --> AuthStorage

    App --> Express
    Layout --> Express
    Pages --> Express

    Express --> Routes
    Routes --> Controllers
    Controllers --> Middleware
    Controllers --> Models
    Controllers --> Services

    Models --> DB
    Services --> DB

    Socket --> Chat
    Chat --> Express

    classDef role fill:#f8fafc,stroke:#334155,color:#0f172a;
    class Admin,Chairperson,Faculty,Student role;
```

## Architecture Summary

The AGMS project uses a role-based full-stack web architecture:

- Users access the system through a single React web application.
- The React frontend renders dashboards and pages based on the logged-in role.
- Auth state is stored in the browser and backed by JWT authentication.
- Backend Express routes process API requests through the controller and model layers.
- Sequelize models map to PostgreSQL data tables for users, subjects, classes, grades, enrollments, endorsements, notifications, chat, and activity logs.
- Socket.IO supports realtime chat and notification communication.
- Activity logging and notifications provide audit and communication services across the system.

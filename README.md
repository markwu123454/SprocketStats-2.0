# FRC Scouting App (SprocketStats)

![Version](https://img.shields.io/github/v/release/markwu123454/SprocketStats?sort=semver)
![Python](https://img.shields.io/badge/Python-3.13-blue)
![Node.js](https://img.shields.io/badge/Node.js-24.12-brightgreen)

SprocketStats is an ML-automated scouting system for **FIRST Robotics Competition (FRC)** teams.
It is designed for fast, reliable match and team data collection, and seamless analysis and data interpretation.

---

## License & Usage Notice

**This software is source-available but proprietary.**

- You MAY view and review the source code
- You may NOT use, run, modify, or distribute this software without explicit written permission

This repository is published for **reference and transparency only**.

However, I look forward to any teams or individuals who want to use SprocketStats or contribute to it. **Want to use or contribute to SprocketStats?** All inquiries regarding usage, licensing, collaboration, or adaptation should be directed to the author at [me@markwu.org](mailto:me@markwu.org)

See [LICENSE.md](LICENSE.md) for full legal terms.

---

## Overview

SprocketStats is an ML-automated scouting system: match and team data collection is driven by machine learning rather than manual entry, which changes what the rest of the app needs to do. The frontend and backend focus on the **team ops** side of the app, which is a significant part of the app:

- RBAC (Role Based Access Control)
- Attendance and meeting management
- Member and notification management
- Analytics engine
- Data presentation and sharing

The system is built to persist across seasons with minimal rework, allowing teams to adapt quickly to annual game changes.

---

## Project Status

This project is **actively maintained** and used in real competition settings by **Team 3473 (Team Sprocket)**.

The app is currently undergoing a significant overhaul in preparation for the **2027 season**. Some areas are under active development and refactoring, particularly:

- ML-driven scouting automation
- Mobile push notifications based on scouting assignment
- Advanced analytics workflows

Public documentation may lag behind internal changes.

---

## System Overview

### Frontend

- React + Vite (TypeScript)
- Tailwind CSS
- Progressive Web App (PWA)
- Covers the team ops surface: RBAC, attendance, meetings, members, notifications, dashboards

### Backend

- Python FastAPI server
- Async-first architecture for concurrent device connections
- TBA API integration for teams, matches, and metadata

### Database

- PostgreSQL, hosted on Neon
- Accessed asynchronously via `asyncpg` connection pools
- Separate databases for app data and Label Studio (ML labeling)

### Analysis Tooling

- SThe scouting pipeline is currently being rewritten, more details will be avaliable once we start implementing and testing it.

---

## Ownership & Inquiries

SprocketStats is a privately developed project authored by Mark Wu and maintained by Mark Wu and the Team Sprocket Scouting Subteam.

It is licensed for use by **Team 3473 (Team Sprocket)** and is **primarily developed to support that team's competition workflows**.

### Contact

All inquiries regarding usage, licensing, collaboration, adaptation for other teams, or contributions must be directed to the author:

**Author:** Mark Wu (Legal: Mai Wu)  
**Email:** [me@markwu.org](mailto:me@markwu.org)

---

## Attribution

If you have been granted permission to use this software, you must provide attribution to Mark Wu in any distribution or public deployment.

---

## License

Copyright © 2025–2026 Mark Wu (Mai Wu)

All rights reserved. No use, reproduction, modification, or distribution is permitted without explicit written permission from the author. 
See [LICENSE.md](LICENSE.md) for complete terms.

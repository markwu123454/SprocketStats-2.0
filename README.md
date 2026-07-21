# SprocketStats — FRC Scouting & Team Operations

[![License](https://img.shields.io/badge/License-AGPL--3.0--or--later-blue)](LICENSE)
![Python](https://img.shields.io/badge/Python-3.13-blue)
![Node.js](https://img.shields.io/badge/Node.js-24.12-brightgreen)

SprocketStats is an open source **scouting and team operations** platform for **FIRST Robotics Competition (FRC)** teams, built for fast and reliable match data collection and for running the team behind it.

It is used in real competition by **Team 3473 (Team Sprocket)** and is free for any team to run: see [SELF_HOSTING.md](SELF_HOSTING.md).

---

## License & Usage Notice

**This software is free and open source under the [GNU AGPL v3.0 or later](LICENSE).**

- You MAY use, run, study, modify, and distribute this software
- If you distribute a modified version, it must also be licensed under the AGPL
- **If you run a modified version as a network service, you must offer its complete source code to the users of that service** (AGPL §13)
- **You must preserve author attribution and mark modified versions as modified**, required additional terms under AGPL §7, see [NOTICE](NOTICE) and [Attribution](#attribution)

That last point is the whole reason for choosing the AGPL: other FRC teams are welcome to run SprocketStats and adapt it to their own workflows, and improvements made to a hosted deployment stay available to the community rather than disappearing behind a server.

**Running your own instance?** See [SELF_HOSTING.md](SELF_HOSTING.md),  fork to working deployment in about 90 minutes, entirely on free tiers.

The software comes with **no warranty**, see sections 15–17 of the [LICENSE](LICENSE).

Other teams and individuals are genuinely welcome to use SprocketStats or contribute to it. Questions, collaboration, or a commercial license that isn't the AGPL: [me@markwu.org](mailto:me@markwu.org).

---

## Overview

SprocketStats covers two halves of running a competitive FRC team.

**Team operations**: the bulk of this repository, and what you get working on day one:

- RBAC (Role Based Access Control)
- Attendance and meeting management
- Member and notification management
- Analytics engine
- Data presentation and sharing

**Scouting**: match and team data collection, driven by machine learning rather than manual entry, which changes what the rest of the app needs to do. This half is season-specific and currently being rewritten for 2027.

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

- The scouting pipeline is currently being rewritten. More details will be available once we start implementing and testing it.

---

## Authorship & Inquiries

SprocketStats is authored by Mark Wu and maintained by Mark Wu and the Team Sprocket Scouting Subteam.

It is **primarily developed to support Team 3473 (Team Sprocket)'s competition workflows**, but it is open source and other teams are free to run and adapt it under the AGPL.

### Contact

Inquiries about collaboration, contributions, or alternative licensing terms:

**Author:** Mark Wu (Legal: Mai Wu)  
**Email:** [me@markwu.org](mailto:me@markwu.org)

---

## Attribution

Attribution is a **required term**, not a courtesy. Under Section 7 of the AGPL, SprocketStats carries additional terms set out in [NOTICE](NOTICE):

- **You must preserve the attribution notice**, project name, copyright line, the credit to the **Team Sprocket (FRC 3473) Scouting Subteam**, and a link to this repository, in copies, modified versions, source distributions, and any legal-notices screen your deployment shows
- **Modified versions must be clearly marked as modified**, so users can tell your version from the original
- **You may not imply endorsement** by SprocketStats' authors or Team 3473

These are permitted additional terms under AGPL §7(b)–(e), so they travel with the code and downstream recipients cannot strip them. They restrict none of the freedoms the AGPL grants you to run, study, modify, and redistribute the software.

If you convey SprocketStats, include the [NOTICE](NOTICE) file alongside the [LICENSE](LICENSE).

---

## License

Copyright © 2025–2026 Mark Wu (Mai Wu)

SprocketStats is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License** as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [LICENSE](LICENSE) for details, or <https://www.gnu.org/licenses/>.

Additional terms apply under Section 7 of the AGPL, covering author attribution, marking of modified versions, and endorsement. See [NOTICE](NOTICE).

`SPDX-License-Identifier: AGPL-3.0-or-later`

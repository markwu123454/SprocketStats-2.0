# FRC Scouting App (SprocketStats)

[![License: Polyform Strict](https://img.shields.io/badge/License-Polyform%20Strict-red.svg)](LICENSE.md)
![Version](https://img.shields.io/github/v/release/markwu123454/SprocketStats?sort=semver)
![Python](https://img.shields.io/badge/Python-3.11-blue)
![Node.js](https://img.shields.io/badge/Node.js-24.12-brightgreen)
![.NET](https://img.shields.io/badge/.NET-10%20LTS-purple)

SprocketStats is a cross-platform scouting system for **FIRST Robotics Competition (FRC)** teams.
It is designed for fast, reliable match and team data collection, and seamless analysis and data interpretation.

---

## License & Usage Notice

**This software is source-available but proprietary.**

-  You MAY view and review the source code
-  You may NOT use, run, modify, or distribute this software without explicit written permission

This repository is published for **reference and transparency only**.

**Want to use SprocketStats?** All inquiries regarding usage, licensing, collaboration, or adaptation must be directed to the author at [me@markwu.org](mailto:me@markwu.org)

See [LICENSE.md](LICENSE.md) for full legal terms.

---

## Overview

This project provides a full scouting workflow:

- Match scouting
- Pit scouting
- RBAC (Role Based Access Control)
- Analytics engine
- Data presentation and sharing

The system is built to persist across seasons with minimal rework, allowing teams to adapt quickly to
annual game changes.

---

## Project Status

This project is **actively maintained** and used in real competition settings by **Team 3473 (Team Sprocket)**.

Some areas are under active development and refactoring, particularly:
- Mobile offline caching and sync logic
- Mobile push notifications based on scouting assignment
- Advanced analytics workflows

Public documentation may lag behind internal changes.

---

## System Overview

### Frontend
- React + Vite (TypeScript)
- Tailwind CSS
- Progressive Web App (PWA)
- Stateless client design for scalability

### Backend
- Python FastAPI server
- Async-first architecture for concurrent device connections
- TBA API integration for teams, matches, and metadata

### Analysis Tooling
- Separate desktop-oriented application for:
  - Statistical analysis
  - Algorithm testing
  - Performance modeling

Releases for the analysis tool are available on GitHub Releases
(usage requires your own database API key).

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

Copyright © 2025 Mark Wu (Mai Wu)

This project is licensed under the **Polyform Strict License 1.0**.  
See [LICENSE.md](LICENSE.md) for complete terms.

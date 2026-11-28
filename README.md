# FleetOps — Site Vehicle Control & Safety Inspection System

**Version:** `2.0.3`  
**Project Site:** MPDP PTJV — Moheshkhali  

FleetOps is a real-time construction fleet management, equipment reservation, and pre-mobilization safety compliance platform built for field engineers, safety officers, and site managers.

---

## Key Features

### Fleet & Asset Management
* **Grid & List Views:** Browse all site vehicles with live status badges (`Available`, `In Use`, `Maintenance`), dynamic vehicle-type filter chips, and instant search.
* **Vehicle Detail Specs:** View photos, registration details (Owner, Brand, Serial/Engine No., Mfg. Year), active bookings, safety inspection history, and compact quick-action controls (`Reserve`, `Maintenance`, `Edit`, `Delete`).
* **High-Res QR Codes:** Generate and download print-ready (1024×1024) QR stickers for every machine.

### Dispatch & Booking
* **Interactive Schedule:** Multi-range Gantt timeline (`Day`, `Week`, `Month`, `3M`, `6M`, `12M`) with color-coded vehicles and one-click slot booking.
* **Smart Reservations:** Real-time booking overlap warnings, operator name autocomplete (`<datalist>`), and automatic double-booking prevention on the server.
* **Monthly Calendar:** Visual monthly overview of past, active, and upcoming equipment allocations.

### Safety Inspections & Compliance
* **All-Vehicles Register:** Track every asset's compliance status (`Valid`, `Due Soon`, `Expired`, `No Record`) with status filter chips, search, and a sticky header.
* **Live Sidebar Alert Badge:** Displays a real-time red counter next to **Safety Inspection** whenever vehicles are expired or due within 30 days.
* **PDF Certificates & Renewals:** Upload inspection reports and view them directly inside the in-app PDF viewer, with one-click annual renewal workflows.

### Mobile QR Equipment Pass & Live Map
* **Public Equipment Pass:** Scanning any vehicle QR code opens a branded mobile pass showing live status, specs, and safety clearance—no login required for read-only checks.
* **Public GPS Sync:** Mobile QR scans automatically sync vehicle coordinates and reverse-geocoded zone names to the Live Map (requires HTTPS).
* **Live Fleet Map:** Real-time Leaflet satellite map featuring custom Moheshkhali site boundary overlays (**Area A**, **Area B**, **Access Road**) and a live status HUD.

### Analytics & Administration
* **Vehicle Workload Statistics:** Monthly fleet utilization percentage, booked hours by vehicle type, average duration, and request status doughnut charts.
* **Usage Reports:** Printable PDF expenditure and utilization summaries per machine.
* **User Management & Audit Logs:** Manage staff accounts and review a searchable master audit trail of all site operations.

---

## Security & Hardening

* **Role-Based Access Control (RBAC):** Server-side middleware enforces permissions across three roles:
  * `site_manager` — Full access (fleet CRUD, users, logs, reports, bookings, inspections).
  * `field_engineer` — Reservations, schedule, calendar, live map, QR scan, statistics.
  * `safety_team` — Safety inspections and compliance renewals.
* **Rate Limiting:** Brute-force protection on `/api/auth/login` (10 attempts / 15 min), general API throttling, and public GPS rate limiting (15 updates / 10 min).
* **GPS Geofence & Cooldown:** Public QR GPS updates are restricted to a **15 km radius** around the Moheshkhali project site with a **2-minute per-asset cooldown** to prevent off-site spoofing.
* **Input & Upload Protection:** Zod schema validation on API payloads, `helmet` security headers, XSS escaping on dynamic UI rendering, and Multer file-type/size restrictions (`JPG`, `PNG`, `WEBP`, `PDF`, max 10 MB).

---

## Tech Stack

* **Backend:** Node.js, Express, PostgreSQL (`pg`), Socket.IO, JWT, `bcrypt`, `multer`, `zod`, `helmet`, `express-rate-limit`
* **Frontend:** Vanilla JavaScript, HTML5, CSS3, Leaflet.js, Chart.js, QRCode.js

---

## Getting Started

### 1. Prerequisites
* Node.js (v18+ recommended)
* PostgreSQL database

### 2. Installation
```bash
git clone <your-repo-url>
cd fleetops-backend
npm install





### 3. Database Setup
Ensure PostgreSQL is running, create a database named fleetops, and execute the initial schema (you may need to create a schema.sql based on your setup).

Create a .env file in the root directory and add your credentials:

Code snippet
PORT=5055
DATABASE_URL=postgres://user:password@localhost:5432/fleetops
JWT_SECRET=your_secure_jwt_secret


###  4. Run the Application
Start the Node.js server:

Bash
npm start
# or use nodemon for development:
npm run dev
Navigate to http://localhost:5055 in your web browser.



Roadmap / Upcoming Features
[ ] Analytics PDF Export: Generate and download formatted PDF usage reports for management.

[ ] Cloud Migration: Upgrade backend for production (AWS S3 for heavy image/PDF storage, Cloud PostgreSQL).

[ ] Maintenance Ticketing: Integration with mechanics for repair tracking.

Developed for robust heavy equipment management and site safety.


### How to push this to GitHub:
If you create the file directly in your terminal, you can push it immediately with these commands:

```bash
git add README.md
git commit -m "docs: add comprehensive project README"
git push origin main


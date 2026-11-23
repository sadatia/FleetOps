# 🚜 FleetOps: Heavy Vehicle Reservation & Safety Inspection System

FleetOps is an enterprise-grade, mobile-responsive web application designed to manage, track, and maintain heavy vehicle fleets (Dump Trucks, Excavators, Cranes, etc.). It features real-time GPS tracking, role-based access control, scannable QR security, and multi-year chronological safety inspection logs.

## ✨ Core Features

* **📡 Real-Time GPS Tracking & Live Map:** Interactive fleet map powered by Leaflet and OpenStreetMap. Features auto-zoom, reverse geocoding to resolve street/zone names, and a floating HUD for live fleet availability counts.
* **🛡️ Advanced Safety Compliance:** Multi-year chronological safety inspection logs. Supports Conditional clearings, automated expiry tracking, and built-in PDF rendering for official safety certificates.
* **📱 Deep-Linked QR Security:** Every vehicle generates a unique high-res QR code. Field Engineers and Guests can scan the machine with their mobile device to instantly update live GPS coordinates and view public specs, while being securely locked out of the administrative dashboard.
* **📅 Smart Reservation Engine:** Prevent booking conflicts with timezone-aware scheduling. Instantly see operator names, booking purposes, and active/upcoming alerts directly on vehicle profiles and the interactive calendar.
* **📸 Native Mobile Integration:** Use a smartphone camera to directly snap and upload vehicle profile photos to the system.
* **📋 Master System Activity Logs:** Color-coded, searchable audit trails tracking all creations, updates, and deletions across the application.

## 🛠️ Technology Stack

**Frontend:**
* Vanilla HTML5, CSS3, JavaScript (No heavy frameworks, highly optimized)
* **Leaflet.js** (Live Maps & Tracking)
* **Chart.js** (Dashboard Analytics)
* **QRCode.js** (Dynamic QR Generation)
* **Socket.io-client** (Real-time UI synchronization)

**Backend:**
* **Node.js & Express.js** (Core API & Server)
* **PostgreSQL** (Relational Database)
* **Socket.io** (Real-time bidirectional event-based communication)

## 🔐 Role-Based Access Control (RBAC)

FleetOps utilizes strict permissions to ensure data integrity and operational security:

* **👑 Site Manager:** Full administrative control. Can add/delete vehicles, manage users, edit safety logs, view master activity audits, and override reservations.
* **🛡️ Safety Team:** Dedicated to compliance. Can perform annual renewals, update vehicle safety statuses, and upload inspection PDFs.
* **👷 Field Engineer:** Operational focus. Can reserve available machines, scan QR codes to sync live GPS locations, and view the interactive calendar.
* **👤 Guest (Locked Mode):** Unauthenticated users who scan a QR code are trapped in a read-only spec view and cannot navigate to the main application.

## 🚀 Getting Started (Local Development)

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v16 or higher)
* [PostgreSQL](https://www.postgresql.org/) (running locally)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone [https://github.com/sadatia/FleetOps.git](https://github.com/sadatia/FleetOps.git)
cd FleetOps
npm install

### 3. Database Setup
Ensure PostgreSQL is running, create a database named fleetops, and execute the initial schema (you may need to create a schema.sql based on your setup).

Create a .env file in the root directory and add your credentials:

Code snippet
DB_USER=your_postgres_username
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fleetops
PORT=3000


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


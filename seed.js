// seed.js
const db = require('./db');

const initialAssets = [
  { id: 'A001', name: 'Volvo A40G Dump Truck', type: 'Dump Truck', plate: 'DT-001', rate: 220, lat: 24.72500, lng: 46.68200, loc: 'Plot B3' },
  { id: 'A002', name: 'Liebherr LTM 1090 Crane', type: 'Crane', plate: 'CR-014', rate: 450, lat: 24.71050, lng: 46.66950, loc: 'Yard A' },
  { id: 'A003', name: 'Caterpillar 320 Excavator', type: 'Excavator', plate: 'EX-007', rate: 280, lat: 24.71800, lng: 46.69000, loc: 'Plot C1' }
];

async function seed() {
  try {
    for (let a of initialAssets) {
      await db.query(
        `INSERT INTO assets (id, name, type, plate_number, hourly_rate, latitude, longitude, current_location, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'available') ON CONFLICT (id) DO NOTHING`,
        [a.id, a.name, a.type, a.plate, a.rate, a.lat, a.lng, a.loc]
      );
    }
    console.log('🌱 Seeded fleet assets successfully!');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
const db = require('./db');

// Transcribed directly from the MPDP ID Master List
const fleetData = [
  // --- AMPHIBIOUS EXCAVATORS ---
  { machineId: "AMEX01", brand: "CATERPILLAR", model: "329DL", type: "Excavator", serial: "MNB00945", engine: "KHX38828", owner: "PTJV", location: "SOUTH BEACH", date: "2025-11-19", inspectedBy: "RIAD AHMED" },
  { machineId: "AMEX02", brand: "CATERPILLAR", model: "329DL", type: "Excavator", serial: "DJF00846", engine: "KHX52865", owner: "DARUMA", location: "SOUTH BEACH", date: "2025-11-19", inspectedBy: "RIAD AHMED" },
  { machineId: "AMEX03", brand: "CATERPILLAR", model: "329DL", type: "Excavator", serial: "DJF00845", engine: "KHX52802", owner: "CAT BANGLA", location: "SOUTH BEACH", date: "2025-09-20", inspectedBy: "RIAD AHMED" },

  // --- BULLDOZERS ---
  { machineId: "BU01", brand: "CATERPILLAR", model: "D6R", type: "Bulldozer", serial: "4TR00663", engine: "10Z37513", owner: "DARUMA", location: "SOUTH BEACH", date: "2026-02-17", inspectedBy: "RIAD AHMED" },
  { machineId: "BU02", brand: "CATERPILLAR", model: "D6R", type: "Bulldozer", serial: "4TR00800", engine: "10Z39040", owner: "CAT BANGLA", location: "SOUTH BEACH", date: "2025-11-19", inspectedBy: "RIAD AHMED" },

  // --- ARTICULATED TRUCKS ---
  { machineId: "DU01", brand: "CATERPILLAR", model: "730C", type: "Dump Truck", serial: "LFF00256", engine: "TXX00614", owner: "DARUMA", location: "CPG LAYDOWN", date: null, inspectedBy: null },
  { machineId: "DU02", brand: "CATERPILLAR", model: "730C", type: "Dump Truck", serial: "LFF00239", engine: "TXX00592", owner: "CAT BANGLA", location: "SOUTH BEACH", date: "2026-01-12", inspectedBy: "MANI" },
  { machineId: "DU-19", brand: "VOLVO", model: "A40F", type: "Dump Truck", serial: "K00053078", engine: "72597", owner: "DARUMA", location: "SOUTH BEACH", date: "2026-02-17", inspectedBy: "AZHAGE" },

  // --- EXCAVATORS ---
  { machineId: "EX01", brand: "CATERPILLAR", model: "336GC", type: "Excavator", serial: "JFW00911", engine: "E7A28992", owner: "DARUMA", location: "SOUTH BEACH", date: "2025-11-19", inspectedBy: "MANI" },
  { machineId: "EX02", brand: "CATERPILLAR", model: "336", type: "Excavator", serial: "GDY01677", engine: "NTB02473", owner: "CAT BANGLA", location: "SOUTH BEACH", date: "2025-10-29", inspectedBy: "MANI" },

  // --- COMPACTORS & WHEEL LOADERS ---
  { machineId: "RC01", brand: "CATERPILLAR", model: "CS56", type: "Compactor", serial: "FCS00466", engine: "C6E20564", owner: "CAT BANGLA", location: "SOUTH BEACH", date: "2025-10-29", inspectedBy: "MANI" },
  { machineId: "WL01", brand: "CATERPILLAR", model: "980H", type: "Loader", serial: "A8J04091", engine: "LHX25030", owner: "CAT BANGLA", location: "SOUTH BEACH", date: "2025-10-29", inspectedBy: "MANI" },
  
  // --- FORKLIFT ---
  { machineId: "FL-01", brand: "TCM", model: "FD100Z8", type: "Forklift", serial: "30G30412", engine: "TBA", owner: "CAT BANGLA", location: "CPG LAYDOWN", date: null, inspectedBy: null }
];

async function importFleet() {
  console.log(`Starting bulk import of ${fleetData.length} vehicles...`);
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    for (let i = 0; i < fleetData.length; i++) {
      const v = fleetData[i];
      // Generate a unique ID (e.g., A169283723)
      const assetId = 'A' + (Date.now() + i).toString().slice(-4) + Math.floor(Math.random() * 1000);
      
      // Default rate if none provided on sheet
      const hourlyRate = v.type === 'Excavator' ? 85 : v.type === 'Dump Truck' ? 65 : 50;

      // 1. Insert Core Asset
      await client.query(
        `INSERT INTO assets (id, name, type, plate_number, hourly_rate, status, current_location, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, 'available', $6, 21.692153, 91.867748)`,
        [assetId, v.model, v.type, v.machineId, hourlyRate, v.location]
      );

      // 2. Insert Safety Inspection Record
      const inspDate = v.date ? new Date(v.date) : new Date();
      const nextDue = new Date(inspDate);
      nextDue.setFullYear(nextDue.getFullYear() + 1);

      await client.query(
        `INSERT INTO inspections (asset_id, owner, brand, model, serial_no, engine_no, manufacturer_year, inspection_location, inspection_date, next_annual_due, inspected_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Cleared')`,
        [
          assetId, v.owner, v.brand, v.model, v.serial, v.engine, 
          2020, // Default Mfg Year as it wasn't on this specific spreadsheet
          v.location, inspDate.toISOString().split('T')[0], nextDue.toISOString().split('T')[0], 
          v.inspectedBy || 'Pending Inspector'
        ]
      );
      
      console.log(`✅ Imported: ${v.machineId} (${v.model})`);
    }
    
    await client.query('COMMIT');
    console.log('🎉 Bulk import completed successfully!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Import Failed:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}

importFleet();

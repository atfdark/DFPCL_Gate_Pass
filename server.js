const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '')));

const fs = require('fs');
const screenshotsDir = path.join(__dirname, 'passes_screenshots');
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
}
app.use('/passes', express.static(screenshotsDir));

// Database Setup
const db = new sqlite3.Database('./gatepass.db', (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Existing passes table
        db.run(`CREATE TABLE IF NOT EXISTS passes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            vendor_code TEXT,
            po_number TEXT,
            screenshot_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating passes table', err.message);
            } else {
                db.run(`ALTER TABLE passes ADD COLUMN screenshot_path TEXT`, () => {});
                db.run(`ALTER TABLE passes ADD COLUMN fiscal_year TEXT`, () => {});
                db.run(`ALTER TABLE passes ADD COLUMN aadhaar TEXT`, () => {});
            }
        });

        // New lots table for PO/Contract team management
        db.run(`CREATE TABLE IF NOT EXISTS lots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contract_type TEXT NOT NULL,
            po_number TEXT NOT NULL UNIQUE,
            team_size INTEGER NOT NULL,
            vendor_code TEXT,
            po_valid_upto TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating lots table', err.message);
            } else {
                console.log('Lots table ready.');
                // Safely attempt to add columns for existing databases
                db.run(`ALTER TABLE lots ADD COLUMN vendor_code TEXT`, () => {});
                db.run(`ALTER TABLE lots ADD COLUMN po_valid_upto TEXT`, () => {});
            }
        });
    }
});

const upload = multer();

// =============================================
// LOTS API — PO / Contract Lot Management
// =============================================

// List all lots (with passes_issued count)
app.get('/api/lots', (req, res) => {
    const search = req.query.search || '';
    let query = `
        SELECT lots.*, 
               COALESCE(pass_counts.cnt, 0) AS passes_issued
        FROM lots
        LEFT JOIN (
            SELECT po_number, COUNT(*) as cnt 
            FROM passes 
            GROUP BY po_number
        ) pass_counts ON lots.po_number = pass_counts.po_number
    `;
    const params = [];

    if (search) {
        query += ` WHERE lots.po_number LIKE ?`;
        params.push(`%${search}%`);
    }

    query += ` ORDER BY lots.created_at DESC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            console.error('Error fetching lots:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ lots: rows });
    });
});

// Get single lot by PO number (used by gate pass form)
app.get('/api/lots/by-po/:poNumber', (req, res) => {
    const poNumber = req.params.poNumber;

    const query = `
        SELECT lots.*, 
               COALESCE(pass_counts.cnt, 0) AS passes_issued
        FROM lots
        LEFT JOIN (
            SELECT po_number, COUNT(*) as cnt 
            FROM passes 
            GROUP BY po_number
        ) pass_counts ON lots.po_number = pass_counts.po_number
        WHERE lots.po_number = ?
    `;

    db.get(query, [poNumber], (err, row) => {
        if (err) {
            console.error('Error fetching lot:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!row) {
            return res.json({ found: false });
        }
        res.json({
            found: true,
            lot: row,
            remaining: row.team_size - row.passes_issued
        });
    });
});

// Create a new lot
app.post('/api/lots', (req, res) => {
    const { contractType, poNumber, teamSize, vendorCode, poValidUpto } = req.body;

    if (!contractType || !poNumber || !teamSize) {
        return res.status(400).json({ error: 'Required fields are missing' });
    }

    const query = `INSERT INTO lots (contract_type, po_number, team_size, vendor_code, po_valid_upto) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [contractType, poNumber, parseInt(teamSize), vendorCode || null, poValidUpto || null], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE')) {
                return res.status(409).json({ error: `PO/Contract number "${poNumber}" is already registered` });
            }
            console.error('Error creating lot:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, id: this.lastID });
    });
});

// Get single lot by Vendor Code (used for auto-fill in gate pass form)
app.get('/api/lots/by-vendor/:vendorCode', (req, res) => {
    const vendorCode = req.params.vendorCode;

    const query = `
        SELECT lots.*, 
               COALESCE(pass_counts.cnt, 0) AS passes_issued
        FROM lots
        LEFT JOIN (
            SELECT po_number, COUNT(*) as cnt 
            FROM passes 
            GROUP BY po_number
        ) pass_counts ON lots.po_number = pass_counts.po_number
        WHERE lots.vendor_code = ?
    `;

    db.get(query, [vendorCode], (err, row) => {
        if (err) {
            console.error('Error fetching lot by vendor:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        if (!row) {
            return res.json({ found: false });
        }
        res.json({
            found: true,
            lot: row,
            remaining: row.team_size - row.passes_issued
        });
    });
});

// Update lot team size
app.put('/api/lots/:id', (req, res) => {
    const { teamSize } = req.body;
    const lotId = req.params.id;

    if (!teamSize || teamSize < 1) {
        return res.status(400).json({ error: 'Valid team size is required' });
    }

    // Check that new team size is not below already issued passes
    db.get(`SELECT lots.po_number, COALESCE(pc.cnt, 0) as issued 
            FROM lots 
            LEFT JOIN (SELECT po_number, COUNT(*) as cnt FROM passes GROUP BY po_number) pc 
            ON lots.po_number = pc.po_number 
            WHERE lots.id = ?`, [lotId], (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!row) return res.status(404).json({ error: 'Lot not found' });

        if (parseInt(teamSize) < row.issued) {
            return res.status(400).json({ 
                error: `Cannot set team size below ${row.issued} (passes already issued)` 
            });
        }

        db.run(`UPDATE lots SET team_size = ? WHERE id = ?`, [parseInt(teamSize), lotId], function(err) {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json({ success: true });
        });
    });
});

// Delete a lot
app.delete('/api/lots/:id', (req, res) => {
    const lotId = req.params.id;
    db.run(`DELETE FROM lots WHERE id = ?`, [lotId], function(err) {
        if (err) {
            console.error('Error deleting lot:', err.message);
            return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Lot not found' });
        }
        res.json({ success: true });
    });
});

// =============================================
// GATE PASS API (existing + enhanced with lot check)
// =============================================

app.post('/api/generate-pass', upload.single('photoUpload'), (req, res) => {
    const { firstName, surname, vendorCode, poNumber, aadhaar } = req.body;
    const name = `${firstName || ''} ${surname || ''}`.trim();

    if (!aadhaar) {
        return res.status(400).json({ error: 'Aadhaar number is required.' });
    }

    // Check if Aadhaar already used
    db.get(`SELECT id FROM passes WHERE aadhaar = ?`, [aadhaar], (aadhaarErr, aadhaarRow) => {
        if (aadhaarErr) return res.status(500).json({ error: 'Database check failed' });
        if (aadhaarRow) {
            return res.status(409).json({ error: 'This Aadhaar card has already been used to generate a pass.' });
        }

        // Check if this PO has a registered lot with capacity remaining
        const lotQuery = `
            SELECT lots.team_size, COALESCE(pc.cnt, 0) as issued
            FROM lots
            LEFT JOIN (SELECT po_number, COUNT(*) as cnt FROM passes GROUP BY po_number) pc
            ON lots.po_number = pc.po_number
            WHERE lots.po_number = ?
        `;

    db.get(lotQuery, [poNumber], (lotErr, lotRow) => {
        // If lot exists, enforce capacity
        if (!lotErr && lotRow) {
            if (lotRow.issued >= lotRow.team_size) {
                return res.status(400).json({ 
                    error: `All ${lotRow.team_size} passes for PO "${poNumber}" have been issued. No capacity remaining.`
                });
            }
        }

        // Proceed to create the pass
        // Compute fiscal year dynamically (April to March)
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-indexed
        let fyStart, fyEnd;
        if (month >= 3) { // April (3) onwards = current year start
            fyStart = year;
            fyEnd = year + 1;
        } else {
            fyStart = year - 1;
            fyEnd = year;
        }
        const fiscalYear = `FY ${fyStart}/${String(fyEnd).slice(2)}`;

        const query = `INSERT INTO passes (name, vendor_code, po_number, fiscal_year, aadhaar) VALUES (?, ?, ?, ?, ?)`;
        db.run(query, [name, vendorCode, poNumber, fiscalYear, aadhaar], function(err) {
            if (err) {
                console.error('Error inserting into database', err.message);
                return res.status(500).json({ error: 'Database execution error' });
            }

            const passId = this.lastID;
            const paddedId = String(passId).padStart(5, '0');

            const responseData = { 
                success: true, 
                passId: passId, 
                paddedId: paddedId,
                fiscalYear: fiscalYear,
                passNumber: `${fiscalYear} / ${paddedId}`
            };

            // If lot exists, include remaining info
            if (!lotErr && lotRow) {
                responseData.lotInfo = {
                    teamSize: lotRow.team_size,
                    issued: lotRow.issued + 1,
                    remaining: lotRow.team_size - lotRow.issued - 1
                };
            }

            res.json(responseData);
        });
    });
});
});

// Save screenshot (unchanged)
app.post('/api/save-screenshot', (req, res) => {
    const { passId, imageBase64 } = req.body;

    if (!passId || !imageBase64) {
        return res.status(400).json({ error: 'Missing passId or imageBase64' });
    }

    const base64Data = imageBase64.replace(/^data:image\/png;base64,/, "");
    const fileName = `pass_${passId}_${Date.now()}.png`;
    const filePath = path.join(__dirname, 'passes_screenshots', fileName);
    const dbFilePath = `/passes/${fileName}`;

    fs.writeFile(filePath, base64Data, 'base64', (err) => {
        if (err) {
            console.error('Error saving screenshot file:', err);
            return res.status(500).json({ error: 'Failed to save screenshot' });
        }

        const upDbQuery = `UPDATE passes SET screenshot_path = ? WHERE id = ?`;
        db.run(upDbQuery, [dbFilePath, passId], function(updateErr) {
            if (updateErr) {
                console.error('Error updating database with screenshot path:', updateErr);
                return res.status(500).json({ error: 'Failed to update database' });
            }
            res.json({ success: true, path: dbFilePath });
        });
    });
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
    console.log(`Press Ctrl+C to close it. Open your browser and go to http://localhost:${port}`);
});

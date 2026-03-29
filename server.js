require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.warn('Warning: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are NOT set in environment variables.');
    console.warn('Database operations will fail.');
}

const supabase = createClient(supabaseUrl || '', supabaseKey || '');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '')));

const upload = multer();

// =============================================
// LOTS API — PO / Contract Lot Management
// =============================================

// List all lots (with passes_issued count)
app.get('/api/lots', async (req, res) => {
    const search = req.query.search || '';
    
    try {
        // Fetch lots and their corresponding pass counts
        let { data: lots, error } = await supabase
            .from('lots')
            .select(`
                *,
                passes:passes(id)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Process lots to include passes_issued count
        const processedLots = lots.map(lot => ({
            ...lot,
            passes_issued: lot.passes ? lot.passes.length : 0
        }));

        if (search) {
            const filteredLots = processedLots.filter(lot => 
                lot.po_number.toLowerCase().includes(search.toLowerCase())
            );
            return res.json({ lots: filteredLots });
        }

        res.json({ lots: processedLots });
    } catch (err) {
        console.error('Error fetching lots:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get single lot by PO number
app.get('/api/lots/by-po/:poNumber', async (req, res) => {
    const { poNumber } = req.params;

    try {
        const { data: lot, error } = await supabase
            .from('lots')
            .select(`
                *,
                passes:passes(id)
            `)
            .eq('po_number', poNumber)
            .single();

        if (error || !lot) {
            return res.json({ found: false });
        }

        const issued = lot.passes ? lot.passes.length : 0;
        res.json({
            found: true,
            lot: { ...lot, passes_issued: issued },
            remaining: lot.team_size - issued
        });
    } catch (err) {
        console.error('Error fetching lot:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create a new lot
app.post('/api/lots', async (req, res) => {
    const { contractType, poNumber, teamSize, vendorCode, poValidUpto } = req.body;

    if (!contractType || !poNumber || !teamSize) {
        return res.status(400).json({ error: 'Required fields are missing' });
    }

    try {
        const { data, error } = await supabase
            .from('lots')
            .insert([{
                contract_type: contractType,
                po_number: poNumber,
                team_size: parseInt(teamSize),
                vendor_code: vendorCode || null,
                po_valid_upto: poValidUpto || null
            }])
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Postgres Unique Violation
                return res.status(409).json({ error: `PO/Contract number "${poNumber}" is already registered` });
            }
            throw error;
        }

        res.json({ success: true, id: data.id });
    } catch (err) {
        console.error('Error creating lot:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get single lot by Vendor Code
app.get('/api/lots/by-vendor/:vendorCode', async (req, res) => {
    const { vendorCode } = req.params;

    try {
        const { data: lot, error } = await supabase
            .from('lots')
            .select(`
                *,
                passes:passes(id)
            `)
            .eq('vendor_code', vendorCode)
            .single();

        if (error || !lot) {
            return res.json({ found: false });
        }

        const issued = lot.passes ? lot.passes.length : 0;
        res.json({
            found: true,
            lot: { ...lot, passes_issued: issued },
            remaining: lot.team_size - issued
        });
    } catch (err) {
        console.error('Error fetching lot by vendor:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update lot team size
app.put('/api/lots/:id', async (req, res) => {
    const { teamSize } = req.body;
    const lotId = req.params.id;

    if (!teamSize || teamSize < 1) {
        return res.status(400).json({ error: 'Valid team size is required' });
    }

    try {
        // Check current issued count
        const { data: lot, error: lotErr } = await supabase
            .from('lots')
            .select(`po_number, passes:passes(id)`)
            .eq('id', lotId)
            .single();

        if (lotErr || !lot) return res.status(404).json({ error: 'Lot not found' });

        const issued = lot.passes ? lot.passes.length : 0;
        if (parseInt(teamSize) < issued) {
            return res.status(400).json({ 
                error: `Cannot set team size below ${issued} (passes already issued)` 
            });
        }

        const { error: updateErr } = await supabase
            .from('lots')
            .update({ team_size: parseInt(teamSize) })
            .eq('id', lotId);

        if (updateErr) throw updateErr;

        res.json({ success: true });
    } catch (err) {
        console.error('Database update error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete a lot
app.delete('/api/lots/:id', async (req, res) => {
    const lotId = req.params.id;
    try {
        const { error } = await supabase.from('lots').delete().eq('id', lotId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting lot:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// =============================================
// GATE PASS API
// =============================================

app.post('/api/generate-pass', upload.single('photoUpload'), async (req, res) => {
    const { firstName, surname, vendorCode, poNumber, aadhaar } = req.body;
    const name = `${firstName || ''} ${surname || ''}`.trim();

    if (!aadhaar) {
        return res.status(400).json({ error: 'Aadhaar number is required.' });
    }

    try {
        // 1. Check if Aadhaar already used
        const { data: existingPass, error: accCheckErr } = await supabase
            .from('passes')
            .select('id')
            .eq('aadhaar', aadhaar)
            .maybeSingle();

        if (existingPass) {
            return res.status(409).json({ error: 'This Aadhaar card has already been used to generate a pass.' });
        }

        // 2. Check if this PO has capacity
        const { data: lot, error: lotCheckErr } = await supabase
            .from('lots')
            .select(`team_size, passes:passes(id)`)
            .eq('po_number', poNumber)
            .maybeSingle();

        if (lot) {
            const issued = lot.passes ? lot.passes.length : 0;
            if (issued >= lot.team_size) {
                return res.status(400).json({ 
                    error: `All ${lot.team_size} passes for PO "${poNumber}" have been issued. No capacity remaining.`
                });
            }
        }

        // 3. Compute fiscal year
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        let fyStart, fyEnd;
        if (month >= 3) {
            fyStart = year;
            fyEnd = year + 1;
        } else {
            fyStart = year - 1;
            fyEnd = year;
        }
        const fiscalYear = `FY ${fyStart}/${String(fyEnd).slice(2)}`;

        // 4. Create the pass
        const { data: newPass, error: createPassErr } = await supabase
            .from('passes')
            .insert([{
                name,
                vendor_code: vendorCode,
                po_number: poNumber,
                fiscal_year: fiscalYear,
                aadhaar
            }])
            .select()
            .single();

        if (createPassErr) throw createPassErr;

        const passId = newPass.id;
        const paddedId = String(passId).padStart(5, '0');

        const responseData = { 
            success: true, 
            passId: passId, 
            paddedId: paddedId,
            fiscalYear: fiscalYear,
            passNumber: `${fiscalYear} / ${paddedId}`
        };

        if (lot) {
            const issued = lot.passes ? lot.passes.length : 0;
            responseData.lotInfo = {
                teamSize: lot.team_size,
                issued: issued + 1,
                remaining: lot.team_size - issued - 1
            };
        }

        res.json(responseData);
    } catch (err) {
        console.error('Error in generate-pass:', err.message);
        res.status(500).json({ error: 'Database execution error' });
    }
});

// Save screenshot to Supabase Storage
app.post('/api/save-screenshot', async (req, res) => {
    const { passId, imageBase64 } = req.body;

    if (!passId || !imageBase64) {
        return res.status(400).json({ error: 'Missing passId or imageBase64' });
    }

    try {
        const base64Data = imageBase64.replace(/^data:image\/png;base64,/, "");
        const fileName = `pass_${passId}_${Date.now()}.png`;
        const buffer = Buffer.from(base64Data, 'base64');

        // Upload to Supabase Storage (Bucket name: gate-passes)
        const { data: uploadData, error: uploadErr } = await supabase
            .storage
            .from('gate-passes')
            .upload(fileName, buffer, {
                contentType: 'image/png',
                upsert: true
            });

        if (uploadErr) throw uploadErr;

        // Get public URL
        const { data: urlData } = supabase
            .storage
            .from('gate-passes')
            .getPublicUrl(fileName);

        const publicUrl = urlData.publicUrl;

        // Update database with public URL
        const { error: updateErr } = await supabase
            .from('passes')
            .update({ screenshot_path: publicUrl })
            .eq('id', passId);

        if (updateErr) throw updateErr;

        res.json({ success: true, path: publicUrl });
    } catch (err) {
        console.error('Error saving screenshot:', err.message);
        res.status(500).json({ error: 'Failed to save screenshot: ' + err.message });
    }
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

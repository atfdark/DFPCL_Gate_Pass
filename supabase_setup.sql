-- Table for Gate Passes
CREATE TABLE IF NOT EXISTS public.passes (
    id SERIAL PRIMARY KEY,
    name TEXT,
    vendor_code TEXT,
    po_number TEXT,
    fiscal_year TEXT,
    aadhaar TEXT UNIQUE,
    screenshot_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for Lot/PO Management
CREATE TABLE IF NOT EXISTS public.lots (
    id SERIAL PRIMARY KEY,
    contract_type TEXT NOT NULL,
    po_number TEXT NOT NULL UNIQUE,
    team_size INTEGER NOT NULL,
    vendor_code TEXT,
    po_valid_upto TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign key: link passes to lots via po_number
-- Run this AFTER both tables exist:
ALTER TABLE public.passes
    ADD CONSTRAINT fk_passes_lots
    FOREIGN KEY (po_number)
    REFERENCES public.lots(po_number)
    ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_passes_po ON public.passes(po_number);
CREATE INDEX IF NOT EXISTS idx_lots_vendor ON public.lots(vendor_code);

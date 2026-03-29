document.addEventListener('DOMContentLoaded', () => {
    const lotForm = document.getElementById('lotForm');
    const contractTypeSelect = document.getElementById('lotContractType');
    const poNumberInput = document.getElementById('lotPoNumber');
    const poLabel = document.getElementById('lotPoLabel');
    const lotsTableBody = document.getElementById('lotsTableBody');
    const emptyState = document.getElementById('emptyState');
    const searchInput = document.getElementById('searchLots');

    // Edit modal
    const editModal = document.getElementById('editLotModal');
    const closeEditModal = document.getElementById('closeEditModal');
    const editLotIdInput = document.getElementById('editLotId');
    const editTeamSizeInput = document.getElementById('editTeamSize');
    const editNote = document.getElementById('editNote');
    const saveEditBtn = document.getElementById('saveEditBtn');

    const API_BASE = '';

    // ===== Dynamic label for PO vs Contract Number =====
    contractTypeSelect.addEventListener('change', () => {
        poNumberInput.disabled = false;
        const type = contractTypeSelect.value;
        if (type === 'ARC') {
            poLabel.textContent = 'Contract Number *';
            poNumberInput.placeholder = '10 Digit Contract No';
            poNumberInput.setAttribute('pattern', '\\d{10}');
            poNumberInput.setAttribute('minlength', '10');
            poNumberInput.setAttribute('maxlength', '10');
        } else if (type === 'MANPOWER') {
            poLabel.textContent = 'OP Number *';
            poNumberInput.placeholder = '9 Digit OP Number';
            poNumberInput.setAttribute('pattern', '\\d{9}');
            poNumberInput.setAttribute('minlength', '9');
            poNumberInput.setAttribute('maxlength', '9');
        } else {
            poLabel.textContent = 'PO Number *';
            poNumberInput.placeholder = '9 Digit PO Number';
            poNumberInput.setAttribute('pattern', '\\d{9}');
            poNumberInput.setAttribute('minlength', '9');
            poNumberInput.setAttribute('maxlength', '9');
        }
    });

    // ===== Toast notification =====
    function showToast(message, type = 'success') {
        // Remove existing toast
        document.querySelectorAll('.toast').forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ===== Load lots from API =====
    async function loadLots(filter = '') {
        try {
            const url = filter
                ? `${API_BASE}/api/lots?search=${encodeURIComponent(filter)}`
                : `${API_BASE}/api/lots`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.lots && data.lots.length > 0) {
                renderTable(data.lots);
                emptyState.classList.add('hidden');
                document.getElementById('lotsTable').style.display = '';
            } else {
                lotsTableBody.innerHTML = '';
                document.getElementById('lotsTable').style.display = 'none';
                emptyState.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Failed to load lots:', err);
            showToast('Failed to load lots. Is the server running?', 'error');
        }
    }

    // ===== Render table rows =====
    function renderTable(lots) {
        lotsTableBody.innerHTML = '';

        lots.forEach((lot, index) => {
            const issued = lot.passes_issued || 0;
            const total = lot.team_size;
            const remaining = total - issued;
            const percentage = total > 0 ? Math.round((issued / total) * 100) : 0;

            let statusClass, statusText;
            if (issued === 0) {
                statusClass = 'open';
                statusText = 'Open';
            } else if (issued < total) {
                statusClass = 'partial';
                statusText = 'In Progress';
            } else {
                statusClass = 'full';
                statusText = 'Full';
            }

            let barColorClass;
            if (percentage < 50) barColorClass = 'green';
            else if (percentage < 90) barColorClass = 'yellow';
            else barColorClass = 'red';

            let createdDate = '-';
            try {
                // Supabase returns proper ISO 8601 (e.g. "2026-03-29T16:10:00+00:00")
                // Old SQLite returned "2026-03-29 16:10:00" — handle both
                const rawDate = lot.created_at.includes('T') 
                    ? lot.created_at  // Already ISO format from Supabase
                    : lot.created_at.replace(' ', 'T') + 'Z'; // Legacy SQLite format
                createdDate = new Date(rawDate).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true
                });
            } catch (_) { /* keep '-' */ }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${index + 1}</td>
                <td><span style="font-weight:600;">${lot.contract_type}</span></td>
                <td style="font-family: 'Courier New', monospace; font-weight: 700; letter-spacing: 0.5px;">${lot.po_number}</td>
                <td style="font-family: 'Courier New', monospace; font-weight: 700;">${lot.vendor_code || '-'}</td>
                <td>${lot.po_valid_upto ? new Date(lot.po_valid_upto).toLocaleDateString('en-IN') : '-'}</td>
                <td style="font-weight: 700;">${total}</td>
                <td>
                    <div class="issued-cell">
                        <span>${issued} / ${total}</span>
                        <div class="progress-bar-bg">
                            <div class="progress-bar-fill ${barColorClass}" style="width: ${percentage}%"></div>
                        </div>
                    </div>
                </td>
                <td style="font-weight: 700; color: ${remaining > 0 ? '#34d399' : '#f87171'};">${remaining}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td style="color: var(--text-muted); font-size: 0.8rem;">${createdDate}</td>
                <td>
                    <div class="action-btns">
                        <button class="action-btn edit-lot-btn" data-id="${lot.id}" data-team="${total}" data-issued="${issued}" data-po="${lot.po_number}" title="Edit Team Size">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="action-btn delete delete-lot-btn" data-id="${lot.id}" data-po="${lot.po_number}" title="Delete Lot">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                </td>
            `;
            lotsTableBody.appendChild(tr);
        });

        // Bind edit & delete buttons
        document.querySelectorAll('.edit-lot-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const team = btn.dataset.team;
                const issued = btn.dataset.issued;
                const po = btn.dataset.po;
                openEditModal(id, team, issued, po);
            });
        });

        document.querySelectorAll('.delete-lot-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const po = btn.dataset.po;
                if (confirm(`Are you sure you want to delete lot "${po}"? This cannot be undone.`)) {
                    try {
                        const res = await fetch(`${API_BASE}/api/lots/${id}`, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                            showToast(`Lot "${po}" deleted successfully`);
                            loadLots(searchInput.value.trim());
                        } else {
                            showToast(data.error || 'Failed to delete', 'error');
                        }
                    } catch (err) {
                        showToast('Server error while deleting', 'error');
                    }
                }
            });
        });
    }

    // ===== Register lot =====
    lotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = {
            contractType: contractTypeSelect.value,
            poNumber: poNumberInput.value.trim(),
            teamSize: parseInt(document.getElementById('lotTeamSize').value),
            vendorCode: document.getElementById('lotVendorCode').value.trim(),
            poValidUpto: document.getElementById('lotPoValidUpto').value
        };

        if (!formData.contractType || !formData.poNumber || !formData.teamSize || !formData.vendorCode || !formData.poValidUpto) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/lots`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            const data = await response.json();

            if (data.success) {
                showToast(`Lot registered: ${formData.poNumber} (Team: ${formData.teamSize})`);
                lotForm.reset();
                poNumberInput.disabled = true;
                poNumberInput.placeholder = 'Select Contract Type First';
                loadLots();
            } else {
                showToast(data.error || 'Failed to register lot', 'error');
            }
        } catch (err) {
            console.error('Error registering lot:', err);
            showToast('Server error. Is the server running?', 'error');
        }
    });

    // ===== Edit modal =====
    function openEditModal(id, currentTeam, issued, po) {
        editLotIdInput.value = id;
        editTeamSizeInput.value = currentTeam;
        editTeamSizeInput.min = issued; // Can't set below already issued
        editNote.textContent = `PO: ${po} — ${issued} passes already issued. New team size cannot be less than ${issued}.`;
        editModal.classList.remove('hidden');
    }

    closeEditModal.addEventListener('click', () => editModal.classList.add('hidden'));
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) editModal.classList.add('hidden');
    });

    saveEditBtn.addEventListener('click', async () => {
        const id = editLotIdInput.value;
        const newTeamSize = parseInt(editTeamSizeInput.value);

        if (!newTeamSize || newTeamSize < 1) {
            showToast('Invalid team size', 'error');
            return;
        }

        try {
            const res = await fetch(`${API_BASE}/api/lots/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teamSize: newTeamSize })
            });
            const data = await res.json();

            if (data.success) {
                showToast('Team size updated successfully');
                editModal.classList.add('hidden');
                loadLots(searchInput.value.trim());
            } else {
                showToast(data.error || 'Failed to update', 'error');
            }
        } catch (err) {
            showToast('Server error while updating', 'error');
        }
    });

    // ===== Search =====
    let searchDebounce;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            loadLots(searchInput.value.trim());
        }, 300);
    });

    // ===== Init =====
    loadLots();
});

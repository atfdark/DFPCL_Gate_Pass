document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('gatePassForm');
    const previewBtn = document.getElementById('previewBtn');
    const modal = document.getElementById('previewModal');
    const closeBtn = document.getElementById('closePreviewBtn');
    const printBtn = document.getElementById('printBtn');

    // Display fields
    const displayName = document.getElementById('displayName');
    const displayContractor = document.getElementById('displayContractor');
    const displayVendor = document.getElementById('displayVendor');
    const displayAadhaar = document.getElementById('displayAadhaar');
    const displayPO = document.getElementById('displayPO');
    const displayExpiry = document.getElementById('displayExpiry');
    const displayCategory = document.getElementById('displayCategory');
    const displayContractType = document.getElementById('displayContractType');

    // Input fields used globally
    const dobInput = document.getElementById('dob');
    const ageInput = document.getElementById('age');

    const displayPOLabel = document.getElementById('displayPOLabel');
    const contractTypeSelect = document.getElementById('contractType');
    const poNumberLabel = document.getElementById('poNumberLabel');
    const poNumberInput = document.getElementById('poNumber');

    // Dynamic PO/Contract labeling
    contractTypeSelect.addEventListener('change', () => {
        poNumberInput.disabled = false;
        const type = contractTypeSelect.value;
        if (type === 'ARC') {
            poNumberLabel.textContent = 'Contract No *';
            poNumberInput.placeholder = '10 Digit Contract No';
            poNumberInput.setAttribute('pattern', '\\d{10}');
            poNumberInput.setAttribute('minlength', '10');
            poNumberInput.setAttribute('maxlength', '10');
            
            // clear invalid value if typing before change
            if (poNumberInput.value.length > 10) poNumberInput.value = poNumberInput.value.slice(0, 10);
        } else {
            poNumberLabel.textContent = 'PO Number *';
            poNumberInput.placeholder = '9 Digit PO Number';
            poNumberInput.setAttribute('pattern', '\\d{9}');
            poNumberInput.setAttribute('minlength', '9');
            poNumberInput.setAttribute('maxlength', '9');
            
            // clear invalid value if typing before change
            if (poNumberInput.value.length > 9) poNumberInput.value = poNumberInput.value.slice(0, 9);
        }
    });

    // Trigger initial state if populated by browser memory
    if (contractTypeSelect.value) {
        contractTypeSelect.dispatchEvent(new Event('change'));
    }

    // Auto-select Company Code based on PO first 4 digits (Skip for ARC/Contract No)
    const companyCodeSelect = document.getElementById('companyCode');
    poNumberInput.addEventListener('input', () => {
        if (contractTypeSelect.value !== 'ARC' && poNumberInput.value.length >= 4) {
            const prefix = poNumberInput.value.slice(0, 4);
            const validateOption = Array.from(companyCodeSelect.options).some(opt => opt.value === prefix);
            if (validateOption) {
                companyCodeSelect.value = prefix;
            }
        }

        // PO Lot lookup when full number is entered
        lookupPOLot();
    });

    // ===== VENDOR CODE AUTO-FILL =====
    const vendorCodeInput = document.getElementById('vendorCode');
    const poValidityInput = document.getElementById('poValidity');
    
    let vendorLookupDebounce;
    if (vendorCodeInput) {
        vendorCodeInput.addEventListener('input', () => {
            const code = vendorCodeInput.value.trim();
            if (code.length === 7) {
                clearTimeout(vendorLookupDebounce);
                vendorLookupDebounce = setTimeout(async () => {
                    try {
                        const res = await fetch(`http://localhost:3000/api/lots/by-vendor/${code}`);
                        const data = await res.json();
                        
                        if (data.found) {
                            const lot = data.lot;
                            // Auto-fill contract type
                            contractTypeSelect.value = lot.contract_type;
                            contractTypeSelect.dispatchEvent(new Event('change'));
                            
                            // Auto-fill PO Number
                            poNumberInput.value = lot.po_number;
                            // Trigger the input events so companyCode logic and lookupPOLot() execute
                            poNumberInput.dispatchEvent(new Event('input'));
                            
                            // Auto-fill PO Validity
                            if (lot.po_valid_upto) {
                                poValidityInput.value = lot.po_valid_upto;
                            }
                        }
                    } catch (e) {
                        console.error('Vendor code auto-fill fast lookup failed', e);
                    }
                }, 300);
            }
        });
    }


    // Clear Form logic
    const clearFormBtn = document.getElementById('clearFormBtn');
    if (clearFormBtn) {
        clearFormBtn.addEventListener('click', () => {
            form.reset();
            
            // Reset visual states safely
            const poLotInfoEl = document.getElementById('poLotInfo');
            if (poLotInfoEl) poLotInfoEl.classList.add('hidden');
            
            const displayPhoto = document.getElementById('displayPhoto');
            const photoIcon = document.getElementById('photoIcon');
            if (displayPhoto) displayPhoto.style.display = 'none';
            if (photoIcon) photoIcon.style.display = 'block';
            
            const dobInp = document.getElementById('dob');
            const ageInp = document.getElementById('age');
            if (dobInp) dobInp.classList.remove('is-invalid');
            if (ageInp) ageInp.classList.remove('is-invalid');
            
            const dobErr = document.getElementById('dobError');
            if (dobErr) dobErr.classList.add('hidden');
        });
    }

    // ===== PO LOT LOOKUP =====
    const poLotInfo = document.getElementById('poLotInfo');
    const lotStatusBadge = document.getElementById('lotStatusBadge');
    const lotInfoType = document.getElementById('lotInfoType');
    const lotTeamSizeEl = document.getElementById('lotTeamSize');
    const lotIssuedEl = document.getElementById('lotIssued');
    const lotRemainingEl = document.getElementById('lotRemaining');
    const lotProgressFill = document.getElementById('lotProgressFill');

    let lookupDebounce;
    function lookupPOLot() {
        clearTimeout(lookupDebounce);
        const poVal = poNumberInput.value.trim();
        const type = contractTypeSelect.value;
        const requiredLength = type === 'ARC' ? 10 : 9;

        // Hide if not enough digits
        if (poVal.length < requiredLength) {
            poLotInfo.classList.add('hidden');
            return;
        }

        lookupDebounce = setTimeout(async () => {
            try {
                const res = await fetch(`http://localhost:3000/api/lots/by-po/${poVal}`);
                const data = await res.json();

                if (data.found) {
                    const lot = data.lot;
                    const issued = lot.passes_issued;
                    const total = lot.team_size;
                    const remaining = data.remaining;
                    const percentage = total > 0 ? Math.round((issued / total) * 100) : 0;

                    lotInfoType.textContent = `${lot.contract_type} — ${lot.po_number}`;
                    lotTeamSizeEl.textContent = total;
                    lotIssuedEl.textContent = issued;
                    lotRemainingEl.textContent = remaining;

                    // Progress bar color
                    lotProgressFill.className = 'lot-progress-fill';
                    if (percentage >= 90) lotProgressFill.classList.add('red');
                    else if (percentage >= 50) lotProgressFill.classList.add('yellow');
                    lotProgressFill.style.width = `${percentage}%`;

                    // Status & styling
                    if (remaining <= 0) {
                        lotStatusBadge.textContent = 'Full — No Capacity';
                        lotStatusBadge.className = 'lot-info-badge full';
                        lotRemainingEl.className = 'lot-stat-value danger';
                        poLotInfo.classList.add('lot-full');
                    } else {
                        lotStatusBadge.textContent = 'Registered';
                        lotStatusBadge.className = 'lot-info-badge';
                        lotRemainingEl.className = 'lot-stat-value highlight';
                        poLotInfo.classList.remove('lot-full');
                    }

                    poLotInfo.classList.remove('hidden');
                } else {
                    poLotInfo.classList.add('hidden');
                }
            } catch (err) {
                // Server not available — silently hide
                poLotInfo.classList.add('hidden');
            }
        }, 300);
    }

    // Handle form submission to show preview via button click
    previewBtn.addEventListener('click', async (e) => {
        e.preventDefault();

        // Let the browser validate standard HTML5 required fields first
        if (!form.reportValidity()) {
            return; // Stops here, no refresh
        }

        // Validate age is between 18 and 60
        const currentAge = parseInt(ageInput.value);
        const dobError = document.getElementById('dobError');
        
        // Reset previous errors
        dobInput.classList.remove('is-invalid');
        ageInput.classList.remove('is-invalid');
        dobError.classList.add('hidden');
        dobError.textContent = '';

        if (isNaN(currentAge)) {
            dobInput.classList.add('is-invalid');
            dobError.textContent = '⚠️ Please enter a valid Date of Birth.';
            dobError.classList.remove('hidden');
            dobInput.focus();
            return;
        }

        if (currentAge > 60) {
            dobInput.classList.add('is-invalid');
            ageInput.classList.add('is-invalid');
            dobError.textContent = '⚠️ Age cannot exceed 60 years. Entry not allowed.';
            dobError.classList.remove('hidden');
            dobInput.focus();
            return;
        }
        
        if (currentAge < 18) {
            dobInput.classList.add('is-invalid');
            ageInput.classList.add('is-invalid');
            dobError.textContent = '⚠️ Age must be at least 18 years.';
            dobError.classList.remove('hidden');
            dobInput.focus();
            return;
        }
        
        // Gather data
        const formData = new FormData(form);
        const firstName = formData.get('firstName');
        const middleName = formData.get('middleName') || '';
        const surname = formData.get('surname');
        const fullName = `${firstName} ${middleName} ${surname}`.replace(/\s+/g, ' ').trim();
        
        const aadhaar = formData.get('aadhaar');

        // Process Photo Upload
        const photoFile = formData.get('photoUpload');
        const displayPhoto = document.getElementById('displayPhoto');
        const photoIcon = document.getElementById('photoIcon');

        if (photoFile && photoFile.size > 0) {
            const reader = new FileReader();
            reader.onload = function(event) {
                displayPhoto.src = event.target.result;
                displayPhoto.style.display = 'block';
                if (photoIcon) photoIcon.style.display = 'none';
            };
            reader.readAsDataURL(photoFile);
        } else {
            displayPhoto.style.display = 'none';
            if (photoIcon) photoIcon.style.display = 'block';
        }

        // Populate modal fields
        displayName.textContent = fullName.toUpperCase();
        displayContractor.textContent = formData.get('contractorName').toUpperCase();
        displayVendor.textContent = formData.get('vendorCode');
        displayAadhaar.textContent = aadhaar; // Show full Aadhaar as requested
        const contractType = formData.get('contractType');
        displayPOLabel.textContent = contractType === 'ARC' ? 'Contract No:' : 'PO No:';
        displayPO.textContent = formData.get('poNumber');
        
        // Populate DOB & Age
        const displayDOB = document.getElementById('displayDOB');
        const displayAge = document.getElementById('displayAge');
        
        const dobDate = new Date(formData.get('dob'));
        displayDOB.textContent = dobDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        displayAge.textContent = formData.get('age');
        
        // Format Date
        const expDate = new Date(formData.get('expiryDate'));
        displayExpiry.textContent = expDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        
        displayCategory.textContent = `COMP: ${formData.get('companyCode')}`;
        displayContractType.textContent = formData.get('contractType');

        // Check lengths for better visual fitting
        if (fullName.length > 25) {
            displayName.style.fontSize = '9px';
        } else {
            displayName.style.fontSize = '11px';
        }

        // Generate Unique ID from SQL Database via Node API
        let generatedPassId = null;
        try {
            const response = await fetch('http://localhost:3000/api/generate-pass', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    document.getElementById('displayPassID').textContent = 'GATE PASS No. ' + data.passNumber;
                    generatedPassId = data.passId;

                    // Update lot info box if lot data was returned
                    if (data.lotInfo) {
                        lotTeamSizeEl.textContent = data.lotInfo.teamSize;
                        lotIssuedEl.textContent = data.lotInfo.issued;
                        lotRemainingEl.textContent = data.lotInfo.remaining;
                        const pct = Math.round((data.lotInfo.issued / data.lotInfo.teamSize) * 100);
                        lotProgressFill.className = 'lot-progress-fill';
                        if (pct >= 90) lotProgressFill.classList.add('red');
                        else if (pct >= 50) lotProgressFill.classList.add('yellow');
                        lotProgressFill.style.width = `${pct}%`;

                        if (data.lotInfo.remaining <= 0) {
                            lotStatusBadge.textContent = 'Full — No Capacity';
                            lotStatusBadge.className = 'lot-info-badge full';
                            lotRemainingEl.className = 'lot-stat-value danger';
                            poLotInfo.classList.add('lot-full');
                        }
                    }
                }
            } else {
                const errData = await response.json().catch(() => ({}));
                if ((response.status === 400 || response.status === 409) && errData.error) {
                    alert('⚠️ ERROR: ' + errData.error);
                    return; // Don't open modal
                }
                console.warn("API route hit error, running locally");
                
                // Local fallback counter
                let localCount = parseInt(localStorage.getItem('localPassCount') || '0') + 1;
                localStorage.setItem('localPassCount', localCount);
                document.getElementById('displayPassID').textContent = 'GATE PASS No. ' + String(localCount).padStart(5, '0');
            }
        } catch (err) {
            console.warn("Server not reachable, falling back to static UI", err);
            
            // Local fallback counter
            let localCount = parseInt(localStorage.getItem('localPassCount') || '0') + 1;
            localStorage.setItem('localPassCount', localCount);
            document.getElementById('displayPassID').textContent = 'GATE PASS No. ' + String(localCount).padStart(5, '0');
        }

        // Show Modal
        modal.classList.remove('hidden');
        document.body.classList.add('modal-open');

        // Capture screenshot if a passId was generated
        if (generatedPassId) {
            // Give the browser a tiny bit of time to render the modal fully before capturing
            setTimeout(async () => {
                try {
                    const passElement = document.getElementById('gatePassCard');
                    // We may need to ensure images are loaded before taking screenshot
                    const canvas = await html2canvas(passElement, { 
                        scale: 2, // Higher quality
                        useCORS: true, 
                        logging: false
                    });
                    const base64Image = canvas.toDataURL('image/png');
                    
                    // Upload screenshot to backend
                    const uploadResponse = await fetch('http://localhost:3000/api/save-screenshot', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            passId: generatedPassId,
                            imageBase64: base64Image
                        })
                    });
                    
                    if (uploadResponse.ok) {
                        console.log('Screenshot saved successfully!');
                    } else {
                        console.error('Failed to save screenshot');
                    }
                } catch (captureErr) {
                    console.error('Error capturing screenshot:', captureErr);
                }
            }, 300); // 300ms delay to allow CSS animations and image rendering
        }
    });

    // Close Modal
    closeBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        document.body.classList.remove('modal-open');
    });

    // Close on clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
            document.body.classList.remove('modal-open');
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
        }
    });

    // Auto-calculate Age from DOB
    dobInput.addEventListener('change', () => {
        if (!dobInput.value) {
            ageInput.value = '';
            return;
        }
        
        const dob = new Date(dobInput.value);
        const today = new Date();
        
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
            age--;
        }
        
        ageInput.value = age;

        // Remove previous invalid classes if user is changing the date
        dobInput.classList.remove('is-invalid');
        ageInput.classList.remove('is-invalid');
        const dobError = document.getElementById('dobError');
        if (dobError) {
            dobError.classList.add('hidden');
            dobError.textContent = '';
        }
    });

    // Print functionality
    printBtn.addEventListener('click', () => {
        window.print();
    });
});

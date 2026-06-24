// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCEInTAPaT-XwjDzu-f72wh4RnoxSgT1tE",
  authDomain: "serial-box-1d9f3.firebaseapp.com",
  databaseURL: "https://serial-box-1d9f3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "serial-box-1d9f3",
  storageBucket: "serial-box-1d9f3.firebasestorage.app",
  messagingSenderId: "591497997191",
  appId: "1:591497997191:web:3efec55d232f2bc04e0122",
  measurementId: "G-M1DLWYDWHH"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
    window.database = firebase.database();
    window.dbRef = database.ref('boxes');
} catch (e) {
    console.warn("Failed to initialize Firebase SDK:", e);
}

// Session Identity for Presence Tracking
const sessionId = Math.random().toString(36).substring(2, 9);
const deviceType = window.innerWidth <= 768 ? "Mobile Phone" : "Desktop PC";
let sessionRef = null;

// App State
const state = {
    activeInputTab: 'bulk', // 'bulk' | 'scan'
    activeOutputTab: 'grouped', // 'grouped' | 'flat'
    liveMode: false,
    singleProductMode: false,
    firebaseActive: true, // Defaults to true, toggles to false if Firebase permissions or connection fails
    scannedSerials: [],
    boxes: [], // { boxIndex: 1, startSerial: '...', sequence: [...], isDuplicate: false }
    flatSerials: [], // all generated items flattened
    duplicatesCount: 0,
    pendingScan: null, // holds scanned item awaiting mismatch validation approval
    allowedLengths: new Set(), // Whitelisted serial character lengths
    vehicleNumber: null,
    productName: null,
    productList: ["Smart TV", "LED Panel", "Refrigerator", "Washing Machine", "Air Conditioner", "Solar Battery"],
    sessionSkipped: false
};

// DOM Elements
const dom = {
    toggleTheme: document.getElementById('toggleTheme'),
    themeIcon: document.getElementById('themeIcon'),
    
    // Stats
    statBoxes: document.getElementById('statBoxes'),
    statTotalSerials: document.getElementById('statTotalSerials'),
    statDuplicates: document.getElementById('statDuplicates'),
    statCardDuplicates: document.getElementById('statCardDuplicates'),
    
    // Inputs & Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    outTabButtons: document.querySelectorAll('.out-tab-btn'),
    outTabContents: document.querySelectorAll('.out-tab-content'),
    
    seqLength: document.getElementById('seqLength'),
    sequenceToggle: document.getElementById('sequenceToggle'),
    liveModeToggle: document.getElementById('liveModeToggle'),
    bulkInput: document.getElementById('bulkInput'),
    scanInput: document.getElementById('scanInput'),
    scannedList: document.getElementById('scannedList'),
    scanCount: document.getElementById('scanCount'),
    
    // Camera Elements
    btnStartCamera: document.getElementById('btnStartCamera'),
    btnCloseCamera: document.getElementById('btnCloseCamera'),
    cameraModal: document.getElementById('cameraModal'),
    
    // Actions
    btnGenerate: document.getElementById('btnGenerate'),
    btnClear: document.getElementById('btnClear'),
    
    // Outputs
    groupedContainer: document.getElementById('groupedContainer'),
    flatOutput: document.getElementById('flatOutput'),
    btnCopyFlat: document.getElementById('btnCopyFlat'),
    btnDownloadCSV: document.getElementById('btnDownloadCSV'),
    toastContainer: document.getElementById('toastContainer'),
    
    // Length Mismatch Modal Elements
    mismatchModal: document.getElementById('mismatchModal'),
    mismatchScannedSerial: document.getElementById('mismatchScannedSerial'),
    mismatchScannedLen: document.getElementById('mismatchScannedLen'),
    mismatchExpectedSerial: document.getElementById('mismatchExpectedSerial'),
    mismatchExpectedLen: document.getElementById('mismatchExpectedLen'),
    btnRejectScan: document.getElementById('btnRejectScan'),
    btnApproveScan: document.getElementById('btnApproveScan'),
    
    // Duplicate Modal Elements
    duplicateModal: document.getElementById('duplicateModal'),
    duplicateScannedSerial: document.getElementById('duplicateScannedSerial'),
    btnRejectDuplicate: document.getElementById('btnRejectDuplicate'),
    
    // History Panel Elements
    historyContainer: document.getElementById('historyContainer'),
    
    // Session Setup Modal Elements
    sessionSetupModal: document.getElementById('sessionSetupModal'),
    setupVehicleInput: document.getElementById('setupVehicleInput'),
    setupProductSelect: document.getElementById('setupProductSelect'),
    customProductWrapper: document.getElementById('customProductWrapper'),
    setupCustomProductInput: document.getElementById('setupCustomProductInput'),
    btnStartSession: document.getElementById('btnStartSession'),
    sessionInfoBar: document.getElementById('sessionInfoBar'),
    infoVehicleNumber: document.getElementById('infoVehicleNumber'),
    btnEditVehicle: document.getElementById('btnEditVehicle'),
    bannerProductSelect: document.getElementById('bannerProductSelect'),
    btnDeleteProduct: document.getElementById('btnDeleteProduct'),
    infoProductStatic: document.getElementById('infoProductStatic'),
    btnSetupSession: document.getElementById('btnSetupSession'),
    btnSkipSetup: document.getElementById('btnSkipSetup')
};

// Safe Icon Rendering (handles slow or blocked Lucide script loading)
function renderIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        try {
            lucide.createIcons();
        } catch (e) {
            console.warn("Lucide icons failed to render:", e);
        }
    }
}

// Theme Management
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        dom.themeIcon.setAttribute('data-lucide', 'moon');
    } else {
        document.body.classList.remove('light-theme');
        dom.themeIcon.setAttribute('data-lucide', 'sun');
    }
    renderIcons();
}

dom.toggleTheme.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'theme');
    dom.themeIcon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
    renderIcons();
});

// Toast System
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-triangle';
    if (type === 'warning') iconName = 'alert-circle';
    
    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <span>${message}</span>
    `;
    dom.toastContainer.appendChild(toast);
    renderIcons();
    
    setTimeout(() => {
        toast.remove();
    }, 4500); 
}

// // --- SESSION SETUP & VEHICLE/PRODUCT INFO BAR ---

function toggleAppInputs(disable) {
    if (dom.scanInput) dom.scanInput.disabled = disable;
    if (dom.bulkInput) dom.bulkInput.disabled = disable;
    if (dom.btnGenerate) dom.btnGenerate.disabled = disable;
    if (dom.btnStartCamera) dom.btnStartCamera.disabled = disable;
}

function checkStartupModal() {
    if (!state.vehicleNumber || !state.productName) {
        if (state.sessionSkipped) {
            if (dom.sessionSetupModal) {
                dom.sessionSetupModal.classList.remove('active');
            }
            if (dom.sessionInfoBar) {
                dom.sessionInfoBar.style.display = 'flex';
            }
            if (dom.infoVehicleNumber) {
                dom.infoVehicleNumber.textContent = 'None (View Only)';
            }
            if (dom.btnEditVehicle) dom.btnEditVehicle.style.display = 'none';
            if (dom.bannerProductSelect) dom.bannerProductSelect.style.display = 'none';
            if (dom.infoProductStatic) {
                dom.infoProductStatic.style.display = 'inline';
                dom.infoProductStatic.textContent = 'None (View Only)';
            }
            if (dom.btnSetupSession) dom.btnSetupSession.style.display = 'inline-flex';
            toggleAppInputs(true);
        } else {
            if (dom.sessionSetupModal) {
                dom.sessionSetupModal.classList.add('active');
            }
            if (dom.sessionInfoBar) {
                dom.sessionInfoBar.style.display = 'none';
            }
            toggleAppInputs(true);
        }
    } else {
        if (dom.sessionSetupModal) {
            dom.sessionSetupModal.classList.remove('active');
        }
        if (dom.sessionInfoBar) {
            dom.sessionInfoBar.style.display = 'flex';
        }
        if (dom.infoVehicleNumber) {
            dom.infoVehicleNumber.textContent = state.vehicleNumber;
        }
        if (dom.btnEditVehicle) dom.btnEditVehicle.style.display = 'inline-block';
        if (dom.bannerProductSelect) dom.bannerProductSelect.style.display = 'inline-block';
        if (dom.infoProductStatic) dom.infoProductStatic.style.display = 'none';
        if (dom.btnSetupSession) dom.btnSetupSession.style.display = 'none';
        
        renderBannerProductDropdown();
        toggleAppInputs(false);
    }
}

function renderProductDropdown() {
    if (!dom.setupProductSelect) return;
    
    const currentVal = dom.setupProductSelect.value;
    
    let html = '<option value="" disabled selected>-- Select Product --</option>';
    if (state.productList && Array.isArray(state.productList)) {
        state.productList.forEach(product => {
            html += `<option value="${product}">${product}</option>`;
        });
    }
    html += '<option value="custom">[Add Custom Product...]</option>';
    
    dom.setupProductSelect.innerHTML = html;
    
    // Restore previous value if it still exists, else clear
    if (currentVal && (state.productList.includes(currentVal) || currentVal === 'custom')) {
        dom.setupProductSelect.value = currentVal;
    } else {
        dom.setupProductSelect.value = '';
    }
    
    updateDeleteProductButtonVisibility();
}

function renderBannerProductDropdown() {
    if (!dom.bannerProductSelect) return;
    
    let html = '';
    if (state.productList && Array.isArray(state.productList)) {
        state.productList.forEach(product => {
            html += `<option value="${product}">${product}</option>`;
        });
    }
    html += '<option value="custom">[Add Custom Product...]</option>';
    
    dom.bannerProductSelect.innerHTML = html;
    
    if (state.productName && state.productList.includes(state.productName)) {
        dom.bannerProductSelect.value = state.productName;
    } else {
        dom.bannerProductSelect.value = '';
    }
}

function updateDeleteProductButtonVisibility() {
    if (!dom.btnDeleteProduct) return;
    const selectVal = dom.setupProductSelect ? dom.setupProductSelect.value : '';
    if (selectVal && selectVal !== 'custom') {
        dom.btnDeleteProduct.style.display = 'flex';
    } else {
        dom.btnDeleteProduct.style.display = 'none';
    }
}

function saveProductList() {
    localStorage.setItem('local_product_list', JSON.stringify(state.productList));
    if (state.firebaseActive && window.database) {
        database.ref('products').set(state.productList);
    }
}

function validateSetupInputs() {
    const vehicleVal = dom.setupVehicleInput ? dom.setupVehicleInput.value.trim() : '';
    const selectVal = dom.setupProductSelect ? dom.setupProductSelect.value : '';
    let productVal = '';
    
    if (selectVal === 'custom') {
        productVal = dom.setupCustomProductInput ? dom.setupCustomProductInput.value.trim() : '';
    } else if (selectVal) {
        productVal = selectVal;
    }
    
    const isValid = (vehicleVal.length > 0) && (productVal.length > 0);
    if (dom.btnStartSession) {
        dom.btnStartSession.disabled = !isValid;
    }
}

// Bind Session Setup Listeners
if (dom.setupProductSelect) {
    dom.setupProductSelect.addEventListener('change', () => {
        const selectVal = dom.setupProductSelect.value;
        if (selectVal === 'custom') {
            if (dom.customProductWrapper) dom.customProductWrapper.classList.add('active');
            if (dom.setupCustomProductInput) dom.setupCustomProductInput.focus();
        } else {
            if (dom.customProductWrapper) dom.customProductWrapper.classList.remove('active');
            if (dom.setupCustomProductInput) dom.setupCustomProductInput.value = '';
        }
        updateDeleteProductButtonVisibility();
        validateSetupInputs();
    });
}

if (dom.setupVehicleInput) {
    dom.setupVehicleInput.addEventListener('input', validateSetupInputs);
}

if (dom.setupCustomProductInput) {
    dom.setupCustomProductInput.addEventListener('input', validateSetupInputs);
}

if (dom.btnDeleteProduct) {
    dom.btnDeleteProduct.addEventListener('click', () => {
        const selectVal = dom.setupProductSelect ? dom.setupProductSelect.value : '';
        if (!selectVal || selectVal === 'custom') return;
        
        if (confirm(`Are you sure you want to delete "${selectVal}" from the product list?`)) {
            state.productList = state.productList.filter(p => p !== selectVal);
            saveProductList();
            renderProductDropdown();
            renderBannerProductDropdown();
            validateSetupInputs();
            showToast(`Product "${selectVal}" deleted.`, "info");
        }
    });
}

if (dom.btnSkipSetup) {
    dom.btnSkipSetup.addEventListener('click', () => {
        state.sessionSkipped = true;
        checkStartupModal();
        showToast("Operating in View-Only Mode.", "info");
    });
}

if (dom.btnSetupSession) {
    dom.btnSetupSession.addEventListener('click', () => {
        state.sessionSkipped = false;
        checkStartupModal();
    });
}

if (dom.btnStartSession) {
    dom.btnStartSession.addEventListener('click', () => {
        const vehicleVal = dom.setupVehicleInput ? dom.setupVehicleInput.value.trim() : '';
        const selectVal = dom.setupProductSelect ? dom.setupProductSelect.value : '';
        let productVal = '';
        
        if (selectVal === 'custom') {
            productVal = dom.setupCustomProductInput ? dom.setupCustomProductInput.value.trim() : '';
            // Save new product automatically to list
            if (productVal && !state.productList.includes(productVal)) {
                state.productList.push(productVal);
                saveProductList();
                renderProductDropdown();
            }
        } else if (selectVal) {
            productVal = selectVal;
        }
        
        if (!vehicleVal || !productVal) return;
        
        state.sessionSkipped = false;
        state.vehicleNumber = vehicleVal;
        state.productName = productVal;
        
        localStorage.setItem('local_vehicle_number', vehicleVal);
        localStorage.setItem('local_product_name', productVal);
        
        if (state.firebaseActive && window.database) {
            database.ref('vehicleNumber').set(vehicleVal);
            database.ref('productName').set(productVal);
        }
        
        checkStartupModal();
        playSuccessBeep();
        showToast("Session details saved successfully.", "success");
    });
}

// Bind Banner Controls
if (dom.bannerProductSelect) {
    dom.bannerProductSelect.addEventListener('change', () => {
        const val = dom.bannerProductSelect.value;
        if (val === 'custom') {
            const newProd = prompt("Enter new custom product name:");
            if (newProd && newProd.trim()) {
                const cleanedProd = newProd.trim();
                if (!state.productList.includes(cleanedProd)) {
                    state.productList.push(cleanedProd);
                    saveProductList();
                }
                state.productName = cleanedProd;
                localStorage.setItem('local_product_name', cleanedProd);
                if (state.firebaseActive && window.database) {
                    database.ref('productName').set(cleanedProd);
                }
                showToast(`Switched active product to: ${cleanedProd}`, "success");
            } else {
                dom.bannerProductSelect.value = state.productName || '';
            }
        } else if (val) {
            state.productName = val;
            localStorage.setItem('local_product_name', val);
            if (state.firebaseActive && window.database) {
                database.ref('productName').set(val);
            }
            showToast(`Switched active product to: ${val}`, "success");
        }
    });
}

if (dom.btnEditVehicle) {
    dom.btnEditVehicle.addEventListener('click', () => {
        const newVehicle = prompt("Enter new Vehicle Number:", state.vehicleNumber || '');
        if (newVehicle && newVehicle.trim()) {
            const cleanedVehicle = newVehicle.trim();
            state.vehicleNumber = cleanedVehicle;
            localStorage.setItem('local_vehicle_number', cleanedVehicle);
            if (state.firebaseActive && window.database) {
                database.ref('vehicleNumber').set(cleanedVehicle);
            }
            if (dom.infoVehicleNumber) {
                dom.infoVehicleNumber.textContent = cleanedVehicle;
            }
            showToast(`Vehicle Number updated to: ${cleanedVehicle}`, "success");
        }
    });
}

// Sync Status Badge Indicator
function updateSyncBadge() {
    const badge = document.getElementById('syncStatus');
    if (!badge) return;
    if (state.firebaseActive) {
        badge.className = 'sync-badge cloud';
        badge.textContent = 'Cloud Live';
        badge.title = 'Connected to Firebase Realtime Database';
    } else {
        badge.className = 'sync-badge local';
        badge.textContent = 'Local Offline';
        badge.title = 'Firebase Rules locked or Offline. Storing data in browser.';
    }
}

// Fallback to LocalStorage Mode
function switchToLocalMode(errorMsg = '') {
    if (!state.firebaseActive) return; // Already in local mode
    
    state.firebaseActive = false;
    updateSyncBadge();
    
    // Detach Firebase listeners to prevent background overwrites
    try {
        if (window.dbRef && typeof dbRef.off === 'function') {
            dbRef.off();
        }
        sessionRef = null;
    } catch (e) {
        console.warn("Failed to detach Firebase listeners:", e);
    }
    
    showToast("Firebase Offline/Permission Denied. Operating in LocalStorage Mode.", "warning");
    console.warn("Firebase Database Fallback triggered:", errorMsg);
    
    // Load local storage data
    loadLocalData();
    state.vehicleNumber = localStorage.getItem('local_vehicle_number');
    state.productName = localStorage.getItem('local_product_name');
    const savedProducts = localStorage.getItem('local_product_list');
    if (savedProducts) {
        state.productList = JSON.parse(savedProducts);
    }
    renderProductDropdown();
    renderBannerProductDropdown();
    checkStartupModal();
}

function loadLocalData() {
    try {
        const localData = localStorage.getItem('local_serial_boxes');
        if (localData) {
            state.boxes = JSON.parse(localData);
        } else {
            state.boxes = [];
        }
    } catch (e) {
        console.error("Failed to load local storage data:", e);
        state.boxes = [];
    }
    recalculateDuplicates();
}

function saveLocalData() {
    try {
        localStorage.setItem('local_serial_boxes', JSON.stringify(state.boxes));
    } catch (e) {
        console.error("Failed to save local storage data:", e);
    }
    recalculateDuplicates();
}

// Save scanned starting serials to localStorage
function saveScannedSerials() {
    try {
        localStorage.setItem('local_scanned_serials', JSON.stringify(state.scannedSerials));
    } catch (e) {
        console.error("Failed to save scanned serials:", e);
    }
}

// Save active configurations/tabs
function saveSettings() {
    try {
        localStorage.setItem('local_seq_length', dom.seqLength.value);
        localStorage.setItem('local_live_mode', state.liveMode);
        localStorage.setItem('local_single_product_mode', state.singleProductMode);
        localStorage.setItem('local_active_input_tab', state.activeInputTab);
        localStorage.setItem('local_active_output_tab', state.activeOutputTab);
    } catch (e) {
        console.error("Failed to save configurations:", e);
    }
}

// Restore state on page reload
function restoreState() {
    try {
        // 1. Scanned starting serials
        const savedScans = localStorage.getItem('local_scanned_serials');
        state.scannedSerials = savedScans ? JSON.parse(savedScans) : [];
        renderScannedList();
        
        // 2. Sequence Length
        const savedSeqLen = localStorage.getItem('local_seq_length');
        if (savedSeqLen) {
            dom.seqLength.value = savedSeqLen;
        }
        
        // 3. Live Scanner Mode
        const savedLiveMode = localStorage.getItem('local_live_mode');
        if (savedLiveMode === 'true') {
            state.liveMode = true;
            dom.liveModeToggle.checked = true;
        } else {
            state.liveMode = false;
            dom.liveModeToggle.checked = false;
        }

        // Restore Sequence Toggle Status
        const savedSingleProduct = localStorage.getItem('local_single_product_mode');
        if (savedSingleProduct === 'true') {
            state.singleProductMode = true;
            if (dom.sequenceToggle) dom.sequenceToggle.checked = false;
            dom.seqLength.disabled = true;
        } else {
            state.singleProductMode = false;
            if (dom.sequenceToggle) dom.sequenceToggle.checked = true;
            dom.seqLength.disabled = false;
        }
        
        // 4. Tabs Status
        const savedInputTab = localStorage.getItem('local_active_input_tab');
        if (savedInputTab) {
            state.activeInputTab = savedInputTab;
            const btn = document.querySelector(`[data-tab="${savedInputTab}"]`);
            if (btn) {
                dom.tabButtons.forEach(b => b.classList.remove('active'));
                dom.tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab${savedInputTab.charAt(0).toUpperCase() + savedInputTab.slice(1)}`).classList.add('active');
            }
        }
        
        const savedOutputTab = localStorage.getItem('local_active_output_tab');
        if (savedOutputTab) {
            state.activeOutputTab = savedOutputTab;
            const btn = document.querySelector(`[data-out-tab="${savedOutputTab}"]`);
            if (btn) {
                dom.outTabButtons.forEach(b => b.classList.remove('active'));
                dom.outTabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`outTab${savedOutputTab.charAt(0).toUpperCase() + savedOutputTab.slice(1)}`).classList.add('active');
            }
        }
        
        // 5. Session Setup Details
        state.vehicleNumber = localStorage.getItem('local_vehicle_number');
        state.productName = localStorage.getItem('local_product_name');
        const savedProducts = localStorage.getItem('local_product_list');
        if (savedProducts) {
            state.productList = JSON.parse(savedProducts);
        }
        renderProductDropdown();
        renderBannerProductDropdown();
        checkStartupModal();
    } catch (e) {
        console.error("Failed to restore states:", e);
    }
}

// Sound Effects System
function playBeep(frequency, duration, type = 'sine') {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = frequency;
        osc.type = type;
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn("Sound blocked or not supported", e);
    }
}

function playSuccessBeep() {
    playBeep(880, 0.08, 'sine'); // Clean high pitch
}

function playWarningBeep() {
    playBeep(220, 0.3, 'sawtooth'); // Deep warning buzzy sound
}

// Tab Switching
dom.tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        dom.tabButtons.forEach(btn => btn.classList.remove('active'));
        dom.tabContents.forEach(content => content.classList.remove('active'));
        
        button.classList.add('active');
        state.activeInputTab = button.dataset.tab;
        document.getElementById(`tab${state.activeInputTab.charAt(0).toUpperCase() + state.activeInputTab.slice(1)}`).classList.add('active');
        
        saveSettings();
        if (state.activeInputTab === 'scan') {
            dom.scanInput.focus();
        }
    });
});

dom.outTabButtons.forEach(button => {
    button.addEventListener('click', () => {
        dom.outTabButtons.forEach(btn => btn.classList.remove('active'));
        dom.outTabContents.forEach(content => content.classList.remove('active'));
        
        button.classList.add('active');
        state.activeOutputTab = button.dataset.outTab;
        document.getElementById(`outTab${state.activeOutputTab.charAt(0).toUpperCase() + state.activeOutputTab.slice(1)}`).classList.add('active');
        
        saveSettings();
    });
});

// Settings Events
dom.liveModeToggle.addEventListener('change', () => {
    state.liveMode = dom.liveModeToggle.checked;
    saveSettings();
    if (state.liveMode) {
        showToast("Live Scanner Mode Enabled (Auto-generate active)", "success");
        const scanTabBtn = document.querySelector('[data-tab="scan"]');
        if (scanTabBtn) scanTabBtn.click();
    } else {
        showToast("Live Scanner Mode Disabled", "info");
    }
});

if (dom.sequenceToggle) {
    dom.sequenceToggle.addEventListener('change', () => {
        state.singleProductMode = !dom.sequenceToggle.checked;
        dom.seqLength.disabled = state.singleProductMode;
        saveSettings();
        if (state.singleProductMode) {
            showToast("Sequence Generation Disabled (Single Product Mode)", "info");
            if (!state.firebaseActive) {
                recalculateDuplicates();
                saveLocalData();
            }
        } else {
            showToast("Sequence Generation Enabled", "success");
            if (!state.firebaseActive) {
                recalculateDuplicates();
                saveLocalData();
            }
        }
    });
}

dom.seqLength.addEventListener('change', () => {
    saveSettings();
    if (!state.firebaseActive) {
        recalculateDuplicates();
        saveLocalData();
    }
});

// Input Helper to strip trailing commas and common scanner suffixes
function cleanSerial(serial) {
    if (!serial) return '';
    return serial.replace(/[,;\s]+$/, '').trim();
}

// Barcode Scanning Handlers
dom.scanInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const rawVal = dom.scanInput.value.trim();
        if (!rawVal) return;
        
        const cleanedVal = cleanSerial(rawVal);
        if (!cleanedVal) return;
        
        validateAndProcessScan(cleanedVal);
        dom.scanInput.value = '';
        dom.scanInput.focus();
    }
});

function handleNormalScan(cleanedVal) {
    if (state.scannedSerials.includes(cleanedVal)) {
        playWarningBeep();
        showToast(`"${cleanedVal}" is already in the scan list.`, 'warning');
    } else {
        state.scannedSerials.push(cleanedVal);
        saveScannedSerials();
        playSuccessBeep();
        showToast(`Added starting serial: ${cleanedVal}`, 'success');
        renderScannedList();
    }
}

function handleLiveScan(cleanedVal) {
    const count = state.singleProductMode ? 0 : parseInt(dom.seqLength.value, 10);
    if (!state.singleProductMode && (isNaN(count) || count < 1)) {
        playWarningBeep();
        showToast("Please enter a valid sequence length.", "warning");
        return;
    }
    
    // Evaluate if starting serial already exists in the system
    const activeSerials = new Set(state.flatSerials.map(s => s.serial));
    const isDuplicate = activeSerials.has(cleanedVal);
    
    // Suppress sequence generation if starting serial is duplicate
    const newSequence = isDuplicate ? [] : generateSequence(cleanedVal, count);
    const newBoxIndex = state.boxes.length + 1;
    const newBox = {
        boxIndex: newBoxIndex,
        startSerial: cleanedVal,
        sequence: newSequence,
        isDuplicate: isDuplicate,
        productName: state.productName
    };
    
    // Write flow: Try Firebase first, fallback to localStorage on fail
    if (state.firebaseActive && window.dbRef) {
        dbRef.push(newBox).then(() => {
            if (isDuplicate) {
                playWarningBeep();
                showToast(`Scan Rejected! Starting serial "${cleanedVal}" is a duplicate.`, 'error');
            } else {
                playSuccessBeep();
                const msg = state.singleProductMode ? `Box ${newBoxIndex} added.` : `Box ${newBoxIndex} added. Generated next ${count} serials.`;
                showToast(msg, 'success');
            }
        }).catch(err => {
            console.error("Firebase write error. Switching to Local Mode:", err);
            switchToLocalMode(err.message);
            // Local fallback write
            state.boxes.push(newBox);
            saveLocalData();
            if (isDuplicate) {
                playWarningBeep();
                showToast(`Scan Rejected! Starting serial "${cleanedVal}" is a duplicate (Local).`, 'error');
            } else {
                playSuccessBeep();
                const msg = state.singleProductMode ? `Box ${newBoxIndex} added locally.` : `Box ${newBoxIndex} added locally.`;
                showToast(msg, 'success');
            }
        });
    } else {
        state.boxes.push(newBox);
        saveLocalData();
        if (isDuplicate) {
            playWarningBeep();
            showToast(`Scan Rejected! Starting serial "${cleanedVal}" is a duplicate (Local).`, 'error');
        } else {
            playSuccessBeep();
            const msg = state.singleProductMode ? `Box ${newBoxIndex} added locally.` : `Box ${newBoxIndex} added locally.`;
            showToast(msg, 'success');
        }
    }
    
    // Auto-scroll to newly generated card
    setTimeout(() => {
        const cards = dom.groupedContainer.querySelectorAll('.box-card');
        if (cards.length > 0) {
            const firstCard = cards[0];
            firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, 80);
}

function removeScannedItem(index) {
    state.scannedSerials.splice(index, 1);
    saveScannedSerials();
    renderScannedList();
    dom.scanInput.focus();
}

function renderScannedList() {
    dom.scanCount.textContent = state.scannedSerials.length;
    if (state.scannedSerials.length === 0) {
        dom.scannedList.innerHTML = '<div class="empty-list-text">No starting serials scanned yet.</div>';
        return;
    }
    
    dom.scannedList.innerHTML = state.scannedSerials.map((serial, idx) => `
        <div class="scan-item">
            <span class="serial-val">${serial}</span>
            <button class="btn-remove-scan" onclick="removeScannedItem(${idx})" title="Remove">
                <i data-lucide="x" style="width:14px;height:14px;"></i>
            </button>
        </div>
    `).join('');
    renderIcons();
}

// Interactive Box Deletion (Synchronized or local)
window.deleteBox = function(boxIndex) {
    const updatedBoxes = state.boxes.filter(b => b.boxIndex !== boxIndex);
    
    // Re-index remaining boxes consecutively
    updatedBoxes.forEach((box, i) => {
        box.boxIndex = i + 1;
    });
    
    if (state.firebaseActive && window.dbRef) {
        dbRef.set(updatedBoxes).then(() => {
            showToast(`Box ${boxIndex} deleted.`, 'info');
        }).catch(err => {
            console.error("Firebase delete error. Switching to Local Mode:", err);
            switchToLocalMode(err.message);
            state.boxes = updatedBoxes;
            saveLocalData();
            showToast(`Box ${boxIndex} deleted locally.`, 'info');
        });
    } else {
        state.boxes = updatedBoxes;
        saveLocalData();
        showToast(`Box ${boxIndex} deleted locally.`, 'info');
    }
};

// Collapsible Accordion Toggle Handler
window.toggleBox = function(headerElement) {
    const card = headerElement.closest('.box-card');
    card.classList.toggle('collapsed');
};

// Camera Scanning Module
let html5QrCode = null;

dom.btnStartCamera.addEventListener('click', () => {
    dom.cameraModal.classList.add('active');
    startCamera();
});

dom.btnCloseCamera.addEventListener('click', () => {
    stopCamera();
});

function startCamera() {
    if (typeof Html5Qrcode === 'undefined') {
        showToast("Camera library not loaded. Check internet connection.", "error");
        dom.cameraModal.classList.remove('active');
        return;
    }
    
    if (html5QrCode) {
        stopCamera();
    }
    
    html5QrCode = new Html5Qrcode("cameraReader");
    const config = { 
        fps: 10, 
        qrbox: (width, height) => {
            const minSize = Math.min(width, height);
            const boxWidth = Math.floor(minSize * 0.75);
            const boxHeight = Math.floor(boxWidth * 0.45);
            return { width: boxWidth, height: boxHeight };
        }
    };
    
    html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            const cleanedVal = cleanSerial(decodedText);
            if (cleanedVal) {
                validateAndProcessScan(cleanedVal);
            }
            stopCamera();
        },
        (errorMessage) => {
            // Ignore frame check failure console noise
        }
    ).catch(err => {
        showToast("Camera access failed or permission denied.", "error");
        console.error(err);
        stopCamera();
    });
}

function stopCamera() {
    dom.cameraModal.classList.remove('active');
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode = null;
        }).catch(err => {
            console.error("Failed to stop html5QrCode", err);
            html5QrCode = null;
        });
    }
}

// Recalculate Duplicates Across State
function recalculateDuplicates() {
    const activeSerials = new Set();
    let dupCount = 0;
    
    state.boxes.forEach(box => {
        const start = box.startSerial;
        
        if (activeSerials.has(start)) {
            box.isDuplicate = true;
            box.sequence = [];
            dupCount++;
        } else {
            box.isDuplicate = false;
            activeSerials.add(start);
            
            if (!box.sequence) box.sequence = [];
            
            box.sequence.forEach(item => {
                if (activeSerials.has(item.serial)) {
                    item.isDuplicate = true;
                    dupCount++;
                } else {
                    item.isDuplicate = false;
                    activeSerials.add(item.serial);
                }
            });
        }
    });
    
    state.duplicatesCount = dupCount;
    
    // Compile flatSerials for display/export
    const flat = [];
    state.boxes.forEach(box => {
        flat.push({
            serial: box.startSerial,
            type: 'start',
            isDuplicate: box.isDuplicate,
            boxIndex: box.boxIndex,
            productName: box.productName || 'Unknown Product'
        });
        
        if (!box.isDuplicate && box.sequence) {
            box.sequence.forEach(item => {
                flat.push({
                    serial: item.serial,
                    type: 'generated',
                    isDuplicate: item.isDuplicate,
                    boxIndex: box.boxIndex,
                    productName: box.productName || 'Unknown Product'
                });
            });
        }
    });
    
    state.flatSerials = flat;
    
    updateStats();
    renderOutput();
}

function clearLocalState() {
    state.scannedSerials = [];
    state.boxes = [];
    state.flatSerials = [];
    state.duplicatesCount = 0;
    state.vehicleNumber = null;
    state.productName = null;
    if (state.allowedLengths) {
        state.allowedLengths.clear();
    }
    dom.bulkInput.value = '';
    dom.scanInput.value = '';
    dom.flatOutput.value = '';
    
    // Clear localStorage entries
    localStorage.removeItem('local_scanned_serials');
    localStorage.removeItem('local_serial_boxes');
    localStorage.removeItem('local_vehicle_number');
    localStorage.removeItem('local_product_name');
    
    renderScannedList();
    checkStartupModal();
}

// Clear all inputs and state
dom.btnClear.addEventListener('click', () => {
    const password = prompt("Enter passcode to Clear All data:");
    if (password !== "2026") {
        playWarningBeep();
        showToast("Incorrect passcode. Action cancelled.", "error");
        return;
    }
    
    // Save current active state to history before clearing
    saveToHistory();
    
    if (state.firebaseActive && window.dbRef) {
        // Clear active session info and boxes
        Promise.all([
            dbRef.set(null),
            database.ref('vehicleNumber').set(null),
            database.ref('productName').set(null)
        ]).then(() => {
            clearLocalState();
            showToast("System cleared in database.", "info");
        }).catch(err => {
            console.error("Failed to clear database, falling back to local:", err);
            switchToLocalMode(err.message);
            clearLocalState();
            showToast("System cleared locally.", "info");
        });
    } else {
        clearLocalState();
        showToast("System cleared locally.", "info");
    }
});

// --- LENGTH MISMATCH VALIDATION SYSTEM ---

// Sync whitelisted lengths from active state (boxes and scans)
function updateAllowedLengthsFromState() {
    if (state.boxes && state.boxes.length > 0) {
        state.boxes.forEach(box => {
            if (box.startSerial) {
                state.allowedLengths.add(box.startSerial.length);
            }
        });
    }
    if (state.scannedSerials && state.scannedSerials.length > 0) {
        state.scannedSerials.forEach(serial => {
            state.allowedLengths.add(serial.length);
        });
    }
}

// Find a starting serial example for a specific length from the active data
function getExampleForLength(len) {
    if (state.boxes) {
        const found = state.boxes.find(b => b.startSerial && b.startSerial.length === len);
        if (found) return found.startSerial;
    }
    if (state.scannedSerials) {
        const found = state.scannedSerials.find(s => s.length === len);
        if (found) return found;
    }
    return "Serial of length " + len;
}

// Validate scanned serial length and show warning modal if mismatched
function validateAndProcessScan(cleanedVal) {
    // 1. Check for Duplicate Scan
    const isDuplicate = state.liveMode 
        ? state.flatSerials.some(s => s.serial === cleanedVal)
        : state.scannedSerials.includes(cleanedVal);
        
    if (isDuplicate) {
        playWarningBeep();
        
        if (dom.duplicateScannedSerial) dom.duplicateScannedSerial.textContent = cleanedVal;
        if (dom.duplicateModal) dom.duplicateModal.classList.add('active');
        if (dom.scanInput) dom.scanInput.disabled = true;
        return; // Halt and do not add duplicate at all
    }

    // 2. Sync allowed lengths from database/local lists
    updateAllowedLengthsFromState();
    
    // 3. Perform validation check
    if (state.allowedLengths.size > 0 && !state.allowedLengths.has(cleanedVal.length)) {
        // Mismatch detected! Play warning beep, show dialog, halt inputs
        playWarningBeep();
        
        state.pendingScan = cleanedVal;
        
        // Use the first allowed length as reference in the warning popup
        const refLength = Array.from(state.allowedLengths)[0];
        const refExample = getExampleForLength(refLength);
        
        if (dom.mismatchScannedSerial) dom.mismatchScannedSerial.textContent = cleanedVal;
        if (dom.mismatchScannedLen) dom.mismatchScannedLen.textContent = `Length: ${cleanedVal.length}`;
        if (dom.mismatchExpectedSerial) dom.mismatchExpectedSerial.textContent = refExample;
        if (dom.mismatchExpectedLen) dom.mismatchExpectedLen.textContent = `Length: ${refLength}`;
        
        if (dom.mismatchModal) dom.mismatchModal.classList.add('active');
        if (dom.scanInput) dom.scanInput.disabled = true;
    } else {
        // Safe length or first scan: process normally
        processScan(cleanedVal);
    }
}

// Process valid or approved scans
function processScan(cleanedVal) {
    if (state.liveMode) {
        handleLiveScan(cleanedVal);
    } else {
        handleNormalScan(cleanedVal);
    }
}

// Length mismatch modal button handlers
if (dom.btnRejectScan) {
    dom.btnRejectScan.addEventListener('click', () => {
        if (dom.mismatchModal) dom.mismatchModal.classList.remove('active');
        if (dom.scanInput) {
            dom.scanInput.disabled = false;
            dom.scanInput.focus();
        }
        state.pendingScan = null;
        showToast("Scan rejected.", "info");
    });
}

if (dom.btnApproveScan) {
    dom.btnApproveScan.addEventListener('click', () => {
        if (dom.mismatchModal) dom.mismatchModal.classList.remove('active');
        if (dom.scanInput) {
            dom.scanInput.disabled = false;
            dom.scanInput.focus();
        }
        if (state.pendingScan) {
            // IMMEDIATELY whitelist the approved length locally
            state.allowedLengths.add(state.pendingScan.length);
            
            processScan(state.pendingScan);
            state.pendingScan = null;
        }
    });
}

// Duplicate modal button handlers
if (dom.btnRejectDuplicate) {
    dom.btnRejectDuplicate.addEventListener('click', () => {
        if (dom.duplicateModal) dom.duplicateModal.classList.remove('active');
        if (dom.scanInput) {
            dom.scanInput.disabled = false;
            dom.scanInput.focus();
        }
        showToast("Duplicate scan rejected.", "info");
    });
}

// --- CLEARED HISTORY LOG SYSTEM ---

// Save cleared session data to history log
function saveToHistory() {
    const hasBoxes = state.boxes && state.boxes.length > 0;
    const hasScanned = state.scannedSerials && state.scannedSerials.length > 0;
    const hasBulkText = dom.bulkInput && dom.bulkInput.value.trim() !== '';
    
    if (!hasBoxes && !hasScanned && !hasBulkText) {
        return; // nothing to save
    }
    
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        let history = historyData ? JSON.parse(historyData) : [];
        
        const now = new Date();
        const options = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit',
            hour12: true 
        };
        const timestampStr = now.toLocaleString('en-US', options);
        
        // Build readable summary
        let summaryParts = [];
        if (hasBoxes) {
            const totalSerials = state.flatSerials ? state.flatSerials.length : 0;
            summaryParts.push(`${state.boxes.length} Box${state.boxes.length > 1 ? 'es' : ''} (${totalSerials} Serials)`);
        }
        if (hasScanned) {
            summaryParts.push(`${state.scannedSerials.length} Scanned`);
        }
        if (hasBulkText && !hasBoxes) {
            summaryParts.push("Bulk Text");
        }
        const summary = summaryParts.join(', ') || 'Saved Session';
        
        const newEntry = {
            id: 'hist_' + now.getTime(),
            timestamp: timestampStr,
            summary: summary,
            vehicleNumber: state.vehicleNumber || '',
            productName: state.productName || '',
            boxes: state.boxes || [],
            scannedSerials: state.scannedSerials || [],
            bulkInput: dom.bulkInput ? dom.bulkInput.value : ''
        };
        
        history.unshift(newEntry);
        
        // Keep last 20 entries
        if (history.length > 20) {
            history = history.slice(0, 20);
        }
        
        localStorage.setItem('serial_manager_history', JSON.stringify(history));
        renderHistory();
    } catch (e) {
        console.error("Failed to save session to history:", e);
    }
}

// Render history list inside panel container
function renderHistory() {
    if (!dom.historyContainer) return;
    
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        const history = historyData ? JSON.parse(historyData) : [];
        
        if (history.length === 0) {
            dom.historyContainer.innerHTML = `
                <div class="empty-list-text" style="padding: 12px 0;">No cleared history found.</div>
            `;
            return;
        }
        
        dom.historyContainer.innerHTML = history.map(item => {
            const vehicleText = item.vehicleNumber ? `<strong>V:</strong> ${item.vehicleNumber}` : '';
            const productText = item.productName ? `<strong>P:</strong> ${item.productName}` : '';
            const sessionDetails = [vehicleText, productText].filter(x => x).join(' | ');
            const detailsHtml = sessionDetails ? `<span class="history-session-details" style="font-size: 0.85rem; color: var(--text-muted); display: block; margin-top: 4px;">${sessionDetails}</span>` : '';
            
            return `
                <div class="history-card">
                    <div class="history-info">
                        <span class="history-time">${item.timestamp}</span>
                        <span class="history-summary">${item.summary}</span>
                        ${detailsHtml}
                    </div>
                    <div class="history-actions">
                        <button class="btn-restore-history" onclick="restoreHistory('${item.id}')" title="Restore this data">
                            Restore
                        </button>
                        <button class="btn-delete-history" onclick="deleteHistory('${item.id}')" title="Delete history entry">
                            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        renderIcons();
    } catch (e) {
        console.error("Failed to render history list:", e);
    }
}

// Restore a history entry
window.restoreHistory = function(id) {
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        if (!historyData) return;
        const history = JSON.parse(historyData);
        const entry = history.find(h => h.id === id);
        if (!entry) return;
        
        if (confirm(`Are you sure you want to restore the history from ${entry.timestamp}? This will replace your current active list.`)) {
            // Restore active state
            state.boxes = entry.boxes || [];
            state.scannedSerials = entry.scannedSerials || [];
            state.vehicleNumber = entry.vehicleNumber || null;
            state.productName = entry.productName || null;
            if (dom.bulkInput) {
                dom.bulkInput.value = entry.bulkInput || '';
            }
            
            if (state.vehicleNumber) {
                localStorage.setItem('local_vehicle_number', state.vehicleNumber);
            } else {
                localStorage.removeItem('local_vehicle_number');
            }
            if (state.productName) {
                localStorage.setItem('local_product_name', state.productName);
            } else {
                localStorage.removeItem('local_product_name');
            }
            
                        // Save state locally
            saveLocalData();
            saveScannedSerials();
            renderScannedList();
            checkStartupModal();
            
            // Remove the restored entry from history list to prevent duplicates and old states
            const updatedHistory = history.filter(h => h.id !== id);
            localStorage.setItem('serial_manager_history', JSON.stringify(updatedHistory));
            renderHistory();
            
            // Sync to Firebase if online
            if (state.firebaseActive && window.dbRef) {
                Promise.all([
                    dbRef.set(state.boxes),
                    database.ref('vehicleNumber').set(state.vehicleNumber),
                    database.ref('productName').set(state.productName)
                ]).then(() => {
                    showToast("History data restored and synced to cloud.", "success");
                }).catch(err => {
                    console.error("Firebase sync failed on restore:", err);
                    showToast("History data restored locally (cloud sync failed).", "warning");
                });
            } else {
                showToast("History data restored locally.", "success");
            }
        }
    } catch (e) {
        console.error("Failed to restore history:", e);
        showToast("Error restoring history data.", "error");
    }
};

// Delete a history entry
window.deleteHistory = function(id) {
    try {
        const historyData = localStorage.getItem('serial_manager_history');
        if (!historyData) return;
        const history = JSON.parse(historyData);
        const updatedHistory = history.filter(h => h.id !== id);
        localStorage.setItem('serial_manager_history', JSON.stringify(updatedHistory));
        renderHistory();
        showToast("History entry deleted.", "info");
    } catch (e) {
        console.error("Failed to delete history:", e);
    }
};

// Parse Serial Sequences
function parseStartingSerials() {
    let list = [];
    if (state.activeInputTab === 'bulk') {
        const text = dom.bulkInput.value.trim();
        if (text) {
            list = text.split(/[,\n]+/).map(s => cleanSerial(s)).filter(s => s !== '');
        }
    } else {
        list = [...state.scannedSerials];
    }
    return list;
}

// Generates next subsequent serial numbers starting from the startSerial offset
function generateSequence(startSerial, count) {
    const sequence = [];
    const match = startSerial.match(/^(.*?)(\d+)$/);
    
    let prefix = '';
    let numericStr = '';
    let startNum = 0;
    let padLength = 0;
    
    if (match) {
        prefix = match[1];
        numericStr = match[2];
        startNum = parseInt(numericStr, 10);
        padLength = numericStr.length;
    } else {
        prefix = startSerial + '-';
        numericStr = '0000';
        startNum = 0;
        padLength = 4;
    }
    
    for (let i = 1; i <= count; i++) {
        const currentNum = startNum + i;
        let currentNumStr = String(currentNum);
        if (currentNumStr.length < padLength) {
            currentNumStr = currentNumStr.padStart(padLength, '0');
        }
        
        const serial = prefix + currentNumStr;
        sequence.push({
            serial: serial,
            type: 'generated',
            isDuplicate: false
        });
    }
    return sequence;
}

// Bulk Generation Click handler (Synchronized or local fallback)
dom.btnGenerate.addEventListener('click', () => {
    const startSerials = parseStartingSerials();
    const count = state.singleProductMode ? 0 : parseInt(dom.seqLength.value, 10);
    
    if (startSerials.length === 0) {
        playWarningBeep();
        showToast("Please input or scan at least one starting serial number.", "warning");
        return;
    }
    if (!state.singleProductMode && (isNaN(count) || count < 1)) {
        playWarningBeep();
        showToast("Please enter a valid sequence length (minimum 1).", "warning");
        return;
    }
    
    const tempBoxes = [];
    const activeSerials = new Set();
    
    startSerials.forEach((start, index) => {
        const isDuplicate = activeSerials.has(start);
        let sequence = [];
        if (isDuplicate) {
            // Suppress
        } else {
            activeSerials.add(start);
            sequence = generateSequence(start, count);
            sequence.forEach(item => activeSerials.add(item.serial));
        }
        
        tempBoxes.push({
            boxIndex: index + 1,
            startSerial: start,
            sequence: sequence,
            isDuplicate: isDuplicate,
            productName: state.productName
        });
    });
    
    if (state.firebaseActive && window.dbRef) {
        dbRef.set(tempBoxes).then(() => {
            playSuccessBeep();
            showToast("Bulk sequences generated & synced to cloud!", 'success');
        }).catch(err => {
            console.error("Firebase bulk write error. Switching to Local Mode:", err);
            switchToLocalMode(err.message);
            state.boxes = tempBoxes;
            saveLocalData();
            playSuccessBeep();
            showToast("Bulk sequences generated locally (Cloud sync failed).", 'success');
        });
    } else {
        state.boxes = tempBoxes;
        saveLocalData();
        playSuccessBeep();
        showToast("Bulk sequences generated locally.", 'success');
    }
});

// Update Statistics Cards
function updateStats() {
    dom.statBoxes.textContent = state.boxes.length;
    dom.statTotalSerials.textContent = state.flatSerials.length;
    dom.statDuplicates.textContent = state.duplicatesCount;
    
    if (state.duplicatesCount > 0) {
        dom.statCardDuplicates.classList.add('has-duplicates');
    } else {
        dom.statCardDuplicates.classList.remove('has-duplicates');
    }
}

// Render Results
function renderOutput() {
    if (state.boxes.length === 0) {
        dom.groupedContainer.innerHTML = `
            <div class="empty-output-state">
                <i data-lucide="layers-2"></i>
                <p>No sequences generated yet. Input starting serials and click "Generate".</p>
            </div>
        `;
        dom.flatOutput.value = '';
        renderIcons();
        return;
    }
    
    dom.groupedContainer.innerHTML = [...state.boxes].reverse().map(box => {
        const productBadge = box.productName ? `<span class="box-badge text-indigo" style="border-color: var(--accent-indigo); background: rgba(99, 102, 241, 0.05);">${box.productName}</span>` : '';
        
        if (box.isDuplicate) {
            return `
                <div class="box-card" style="border-color: var(--color-rose); background: rgba(244, 63, 94, 0.03);">
                    <div class="box-header" onclick="toggleBox(this)">
                        <div class="box-title text-rose">
                            <i data-lucide="chevron-down" class="collapse-icon" style="stroke:var(--color-rose);"></i>
                            <i data-lucide="package" style="width:18px;height:18px;stroke:var(--color-rose);"></i>
                            <span>Box ${box.boxIndex}</span>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            ${productBadge}
                            <span class="box-badge text-rose" style="border-color: var(--color-rose); background: var(--color-rose-light);">REJECTED: Duplicate Start</span>
                            <button class="btn-delete-box" onclick="event.stopPropagation(); deleteBox(${box.boxIndex})" title="Delete Box">
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </div>
                    <div class="box-serials-grid">
                        <span class="serial-tag duplicate" title="Duplicate scan starting serial!">${box.startSerial}</span>
                    </div>
                </div>
            `;
        }
        
        const total = box.sequence ? box.sequence.length : 0;
        const boxDups = box.sequence ? box.sequence.filter(s => s.isDuplicate).length : 0;
        const dupBadge = boxDups > 0 ? `<span class="box-badge text-rose" style="border-color: var(--color-rose); background: var(--color-rose-light);">${boxDups} Duplicates</span>` : '';
        
        return `
            <div class="box-card">
                <div class="box-header" onclick="toggleBox(this)">
                    <div class="box-title">
                        <i data-lucide="chevron-down" class="collapse-icon"></i>
                        <i data-lucide="package" style="width:18px;height:18px;"></i>
                        <span>Box ${box.boxIndex}</span>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        ${productBadge}
                        ${dupBadge}
                        <span class="box-badge">Start: ${box.startSerial}</span>
                        <span class="box-badge">${total} Serials</span>
                        <button class="btn-delete-box" onclick="event.stopPropagation(); deleteBox(${box.boxIndex})" title="Delete Box">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
                <div class="box-serials-grid">
                    ${box.sequence ? box.sequence.map(item => {
                        let classes = 'serial-tag';
                        if (item.isDuplicate) classes += ' duplicate';
                        const titleAttr = item.isDuplicate ? 'title="Duplicate Serial Number!"' : '';
                        return `<span class="${classes}" ${titleAttr}>${item.serial}</span>`;
                    }).join('') : ''}
                </div>
            </div>
        `;
    }).join('');
    
    dom.flatOutput.value = state.flatSerials.map(s => s.serial).join('\n');
    
    renderIcons();
}

// Clipboard Action
dom.btnCopyFlat.addEventListener('click', () => {
    if (state.flatSerials.length === 0) {
        showToast("No generated serials to copy.", "warning");
        return;
    }
    dom.flatOutput.select();
    document.execCommand('copy');
    showToast("All serial numbers copied to clipboard!", "success");
});

// Excel Export Action (Multi-Sheet by Product)
dom.btnDownloadCSV.addEventListener('click', () => {
    if (state.flatSerials.length === 0) {
        showToast("No generated serials to download.", "warning");
        return;
    }
    
    if (typeof XLSX === 'undefined') {
        showToast("Excel library is loading or failed to load. Please check internet connection.", "error");
        return;
    }
    
    // Create new workbook
    const wb = XLSX.utils.book_new();
    
    // Group serials by product name
    const groupedProducts = {};
    state.flatSerials.forEach(item => {
        const prod = item.productName || 'Unknown Product';
        if (!groupedProducts[prod]) {
            groupedProducts[prod] = [];
        }
        groupedProducts[prod].push(item);
    });
    
    // Create Excel sheet for each product
    for (const [prodName, serials] of Object.entries(groupedProducts)) {
        const sheetData = serials.map(item => ({
            "Box Number": `Box ${item.boxIndex}`,
            "Serial Number": item.serial,
            "Type": item.type === 'start' ? "Starting Serial" : "Generated Sequence",
            "Status": item.isDuplicate ? "Duplicate" : "Unique"
        }));
        
        const ws = XLSX.utils.json_to_sheet(sheetData);
        
        // Clean sheet name (SheetJS limit: 31 chars, no special chars)
        let safeSheetName = prodName.replace(/[\\\/?:*\[\]]/g, '').substring(0, 30);
        if (!safeSheetName) safeSheetName = "Product";
        
        XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    }
    
    // Generate filename and trigger download
    const timestamp = new Date().toISOString().slice(0, 10);
    const vehicleStr = state.vehicleNumber ? state.vehicleNumber.replace(/[\\\/?:*\[\]]/g, '') : 'session';
    const filename = `serial_sequences_${vehicleStr}_${timestamp}.xlsx`;
    
    try {
        XLSX.writeFile(wb, filename);
        showToast("Excel file download started.", "success");
    } catch (e) {
        console.error("Failed to generate Excel file:", e);
        showToast("Failed to download Excel file.", "error");
    }
});

// Firebase Connection Timeout (Switches to Local mode if connection hangs > 3.5 seconds)
let firebaseTimeout = setTimeout(() => {
    if (state.firebaseActive && state.boxes.length === 0) {
        console.warn("Firebase Connection timed out. Falling back to LocalMode.");
        switchToLocalMode("Connection Timeout");
    }
}, 3500);

// Firebase Initialization and Listener Binding
if (window.dbRef) {
    dbRef.on('value', (snapshot) => {
        clearTimeout(firebaseTimeout);
        state.firebaseActive = true;
        updateSyncBadge();
        
        // Write dynamic active session to database
        if (!sessionRef && window.database) {
            sessionRef = database.ref('active_sessions/session_' + sessionId);
            sessionRef.set(deviceType + " (Online) - Last Active: " + new Date().toLocaleTimeString());
            sessionRef.onDisconnect().remove();
        }
        
        const data = snapshot.val();
        if (data) {
            const rawList = Array.isArray(data) ? data : Object.values(data);
            state.boxes = rawList.filter(b => b !== null);
            state.boxes.sort((a, b) => a.boxIndex - b.boxIndex);
        } else {
            state.boxes = [];
        }
        recalculateDuplicates();
    }, (error) => {
        clearTimeout(firebaseTimeout);
        console.warn("Firebase Listener failed (permission rules locked). Switching to local fallback:", error);
        switchToLocalMode(error.message);
    });

    // Sync vehicleNumber
    database.ref('vehicleNumber').on('value', (snapshot) => {
        const val = snapshot.val();
        state.vehicleNumber = val || null;
        if (val) {
            localStorage.setItem('local_vehicle_number', val);
        } else {
            localStorage.removeItem('local_vehicle_number');
        }
        checkStartupModal();
    }, (error) => {
        console.warn("Firebase vehicleNumber listener error:", error);
    });

    // Sync productName
    database.ref('productName').on('value', (snapshot) => {
        const val = snapshot.val();
        state.productName = val || null;
        if (val) {
            localStorage.setItem('local_product_name', val);
        } else {
            localStorage.removeItem('local_product_name');
        }
        checkStartupModal();
    }, (error) => {
        console.warn("Firebase productName listener error:", error);
    });

    // Sync products
    database.ref('products').on('value', (snapshot) => {
        const val = snapshot.val();
        if (val && Array.isArray(val)) {
            state.productList = val;
        } else {
            state.productList = ["Smart TV", "LED Panel", "Refrigerator", "Washing Machine", "Air Conditioner", "Solar Battery"];
        }
        renderProductDropdown();
    }, (error) => {
        console.warn("Firebase products listener error:", error);
    });
} else {
    clearTimeout(firebaseTimeout);
    switchToLocalMode("Firebase SDK not initialized correctly");
}

// Initialize UI & Restore State
initTheme();
restoreState();
handleQueryParams();
registerFileLaunchHandler();
updateStats();
updateSyncBadge();
renderHistory();

// Parse query parameters from PWA shortcuts / share targets / protocols
function handleQueryParams() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        
        // 1. Handle tab switching
        const tab = urlParams.get('tab');
        if (tab === 'scan' || tab === 'bulk') {
            state.activeInputTab = tab;
            const btn = document.querySelector(`[data-tab="${tab}"]`);
            if (btn) {
                dom.tabButtons.forEach(b => b.classList.remove('active'));
                dom.tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
                saveSettings();
                if (tab === 'scan') {
                    dom.scanInput.focus();
                }
            }
        }
        
        // 2. Handle Share Target & Protocol Handler & Note-taking
        const sharedText = urlParams.get('text') || urlParams.get('url');
        const sharedTitle = urlParams.get('title');
        const customSerial = urlParams.get('serial');
        const isNewNote = urlParams.get('new-note');
        
        let importedContent = '';
        
        if (sharedText) {
            importedContent = sharedText;
            showToast(`Shared content imported: ${sharedTitle || 'Text'}`, 'success');
        } else if (customSerial) {
            let serialVal = decodeURIComponent(customSerial);
            if (serialVal.startsWith('web+serial://')) {
                serialVal = serialVal.substring('web+serial://'.length);
            }
            importedContent = serialVal;
            showToast(`Serial link loaded: ${serialVal}`, 'success');
        } else if (isNewNote === 'true') {
            showToast("New note-taking workspace initiated.", "info");
        }
        
        if (importedContent) {
            if (dom.bulkInput.value) {
                dom.bulkInput.value += '\n' + importedContent;
            } else {
                dom.bulkInput.value = importedContent;
            }
            const bulkTabBtn = document.querySelector('[data-tab="bulk"]');
            if (bulkTabBtn) bulkTabBtn.click();
        }
    } catch (e) {
        console.error("Failed to parse query parameters:", e);
    }
}

// Register launchQueue file handler for associated files (.txt, .csv)
function registerFileLaunchHandler() {
    if ('launchQueue' in window && 'files' in LaunchParams.prototype) {
        window.launchQueue.setConsumer(async (launchParams) => {
            if (launchParams.files && launchParams.files.length > 0) {
                for (const fileHandle of launchParams.files) {
                    try {
                        const file = await fileHandle.getFile();
                        const text = await file.text();
                        if (text) {
                            dom.bulkInput.value = text;
                            const bulkTabBtn = document.querySelector('[data-tab="bulk"]');
                            if (bulkTabBtn) bulkTabBtn.click();
                            showToast(`Imported serials from: ${file.name}`, 'success');
                        }
                    } catch (err) {
                        console.error("Failed to read file from launchParams:", err);
                        showToast("Failed to open file.", "error");
                    }
                }
            }
        });
    }
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=14')
            .then(reg => {
                console.log('Service Worker registered successfully:', reg.scope);
                
                // Watch for updates
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New worker available and ready, tell it to skipWaiting
                                console.log('New service worker available, skipping waiting.');
                                newWorker.postMessage({ action: 'skipWaiting' });
                            }
                        });
                    }
                });
            })
            .catch(err => console.warn('Service Worker registration failed:', err));
    });

    // Reload page once the new service worker has taken control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            console.log('Controller changed, reloading page...');
            window.location.reload();
        }
    });
}

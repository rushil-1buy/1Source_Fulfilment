/**
 * Seed: master / reference data.
 *
 * All GSTINs here are checksum-valid (Luhn-mod-36), so the engine's own
 * validator accepts them — an invented number would be rejected and would make
 * every seeded invoice throw a warning.
 */

import { toMinor } from '../lib/domain/money';

/**
 * The trading entity. Taken from the supplier PO / PI hand-off spec: the legal
 * entity behind the 1BUY brand is Sharpbuy Global Solutions Pvt Ltd, registered
 * in DELHI (state code 07). Its GSTIN is checksum-valid.
 *
 * The registration state is what drives place-of-supply, so this single value
 * decides whether any given customer invoice comes out as CGST+SGST or IGST.
 */
export const ORG = {
  id: 'org',
  legalName: 'Sharpbuy Global Solutions Private Limited',
  brandName: '1BUY',
  gstin: '07ABLCS4389M1ZG',
  stateCode: '07',
  stateName: 'Delhi',
  addressLine1: '3rd Floor, Building 258, Okhla Industrial Estate Phase 3',
  addressLine2: 'New Delhi',
  city: 'New Delhi',
  pincode: '110019',
  country: 'India',
  // The receiving dock differs from the registered billing address.
  shipAddressLine1: '3rd Floor, Building 258, Okhla Industrial Estate Phase 3',
  shipAddressLine2: 'New Delhi',
  shipCity: 'New Delhi',
  shipPincode: '110020',
  cin: 'U46521DL2023PTC418339',
  phone: '+91 99101 66255 / +91 70076 00960',
  email: 'ankitsharma@1buy.ai / akash@1buy.ai',
  contactAttn: 'Mr. Ankit Sharma — VP & Mr. Akash Dwivedi — MGR',
  jurisdiction: 'Delhi',
  poVoucherPrefix: 'PO/SGSPL/26-27/',
  lutNumber: 'LUT/DL/2026-27/00418',
  lutValidUpto: new Date('2027-03-31'),
  eInvoiceThreshold: toMinor(500_000), // configurable, never hardcoded (§11A.5b)
  eWayBillThreshold: toMinor(50_000),
  baseCurrency: 'INR',
  reportingCurrency: 'INR',
  marginFloorPct: 8,
};

export const USERS = [
  { id: 'u-rushil', name: 'Rushil Kohli', email: 'rushil@1buy.ai', role: 'Admin', title: 'Administrator', initials: 'RK' },
  // 1BUY is represented by exactly two people, on paper and in correspondence.
  // Both hold Finance access because the final escrow release requires two
  // distinct Finance approvers (§11A.4, AC#23) and these are the two.
  {
    id: 'u-ankit',
    name: 'Ankit Sharma',
    email: 'ankit.sharma@1buy.ai',
    role: 'Finance',
    title: 'Vice President',
    initials: 'AS',
  },
  {
    id: 'u-priya',
    name: 'Akash Dwivedi',
    email: 'akash.dwivedi@1buy.ai',
    role: 'Finance',
    title: 'Manager',
    initials: 'AD',
  },
  {
    id: 'u-audit',
    name: 'External Auditor',
    email: 'auditor@1buy.ai',
    role: 'Viewer',
    title: 'Independent Auditor',
    initials: 'EA',
  },
];

export const NUMBERING = [
  { docType: 'CUSTOMER_PO', prefix: 'CPO', padding: 4, nextNumber: 48, label: 'Customer PO' },
  { docType: 'CUSTOMER_PI', prefix: 'PI-1B', padding: 4, nextNumber: 37, label: 'Customer PI' },
  { docType: 'SUPPLIER_PO', prefix: 'PO-1B', padding: 4, nextNumber: 113, label: 'Supplier PO' },
  { docType: 'SUPPLIER_PI', prefix: 'SPI', padding: 4, nextNumber: 94, label: 'Supplier PI' },
  { docType: 'TAX_INVOICE', prefix: 'INV-1B', padding: 4, nextNumber: 221, label: 'Tax invoice' },
  { docType: 'CREDIT_NOTE', prefix: 'CN-1B', padding: 4, nextNumber: 12, label: 'Credit note' },
  { docType: 'GRN', prefix: 'GRN', padding: 4, nextNumber: 226, label: 'Goods receipt note' },
  { docType: 'SALES_ORDER', prefix: 'SO-1B', padding: 4, nextNumber: 221, label: 'Sales order' },
  { docType: 'WORK_ORDER', prefix: 'WO', padding: 4, nextNumber: 113, label: 'Work order alias' },
  { docType: 'TEST_REQUEST', prefix: 'TR', padding: 4, nextNumber: 66, label: 'Test request' },
];

/**
 * Three customers chosen so all three GST treatments are demonstrable:
 * same-state (CGST+SGST), different-state (IGST), and SEZ (zero-rated).
 */
export const CUSTOMERS = [
  {
    // Delhi — same state as our registration, so this one demonstrates the
    // CGST + SGST split.
    id: 'c-acme',
    code: 'ACME',
    name: 'ACME Electronics Private Limited',
    gstin: '07AAACI1195H1ZO',
    stateCode: '07',
    stateName: 'Delhi',
    addressLine1: 'B-42, Mohan Cooperative Industrial Estate, Mathura Road',
    city: 'New Delhi',
    pincode: '110044',
    country: 'India',
    isSez: false,
    isExport: false,
    contactName: 'Rohit Verma',
    contactEmail: 'rohit.verma@acme-electronics.in',
    contactPhone: '+91 98450 11234',
    paymentTerms: '30 days',
    creditLimit: toMinor(5_000_000),
  },
  {
    id: 'c-nova',
    code: 'NOVA',
    name: 'Nova Systems Limited',
    gstin: '27AAACI1195H1ZM',
    stateCode: '27',
    stateName: 'Maharashtra',
    addressLine1: 'Unit 9, MIDC Andheri East',
    city: 'Mumbai',
    pincode: '400093',
    isSez: false,
    isExport: false,
    contactName: 'Sneha Kulkarni',
    contactEmail: 'sneha.k@novasystems.co.in',
    contactPhone: '+91 98200 44112',
    paymentTerms: '45 days',
    creditLimit: toMinor(8_000_000),
  },
  {
    id: 'c-zenith',
    code: 'ZENITH',
    name: 'Zenith Devices (SEZ) Private Limited',
    gstin: '33AACCZ4521M1Z7',
    stateCode: '33',
    stateName: 'Tamil Nadu',
    addressLine1: 'SDF Block II, MEPZ Special Economic Zone, Tambaram',
    city: 'Chennai',
    pincode: '600045',
    isSez: true,
    isExport: false,
    contactName: 'Arun Selvam',
    contactEmail: 'arun.selvam@zenithdevices.com',
    contactPhone: '+91 90030 77219',
    paymentTerms: '30 days',
    creditLimit: toMinor(3_000_000),
  },
];

/**
 * Five suppliers, four foreign (so the import + ICEGATE path is the norm) and
 * one domestic. The foreign ones exercise reverse charge on services.
 */
export const SUPPLIERS = [
  {
    id: 's-nexus',
    code: 'NEXUS',
    name: 'Nexus Components Pte Ltd',
    gstin: null,
    isForeign: true,
    stateCode: null,
    stateName: null,
    addressLine1: '18 Boon Lay Way, #05-112 Tradehub 21',
    addressLine2: 'Jurong East',
    city: 'Singapore',
    postcode: '609966',
    country: 'Singapore',
    contactName: 'Wei Ling Tan',
    contactEmail: 'weiling.tan@nexuscomp.sg',
    contactPhone: '+65 6788 4412',
    contactFax: '+65 6788 4413',
    currency: 'USD',
    incoterms: 'FOB',
    bankName: 'DBS Bank Ltd',
    bankAddress: '12 Marina Boulevard, Marina Bay Financial Centre Tower 3, Singapore 018982',
    bankAccount: '003-912447-8',
    swiftCode: 'DBSSSGSGXXX',
  },
  {
    id: 's-shenzhen',
    code: 'SZYE',
    name: 'Shenzhen Yuan Electronics Co Ltd',
    gstin: null,
    isForeign: true,
    stateCode: null,
    stateName: null,
    addressLine1: 'Block C, Huaqiangbei Electronics Market, Futian District',
    addressLine2: 'Futian',
    city: 'Shenzhen',
    postcode: '518031',
    country: 'China',
    contactName: 'Li Chen',
    contactEmail: 'li.chen@szyuan-elec.cn',
    contactPhone: '+86 755 8321 7744',
    contactFax: '+86 755 8321 7745',
    currency: 'USD',
    incoterms: 'FOB',
    bankName: 'HSBC Bank (China) Company Limited, Shenzhen Branch',
    bankAddress: 'Financial Center, 88 Fuhua Road, Futian District, Shenzhen',
    bankAccount: '625-042318-901',
    swiftCode: 'HSBCCNSHXXX',
  },
  {
    id: 's-global',
    code: 'GCSF',
    name: 'Global Chip Source FZE',
    gstin: null,
    isForeign: true,
    stateCode: null,
    stateName: null,
    addressLine1: 'Warehouse 14, Jebel Ali Free Zone South',
    addressLine2: 'Jebel Ali',
    city: 'Dubai',
    postcode: '17000',
    country: 'United Arab Emirates',
    contactName: 'Faisal Al-Mansoori',
    contactEmail: 'faisal@globalchipsource.ae',
    contactPhone: '+971 4 883 2211',
    contactFax: '+971 4 883 2212',
    currency: 'USD',
    incoterms: 'CIF',
    bankName: 'Emirates NBD Bank PJSC',
    bankAddress: 'Baniyas Road, Deira, PO Box 777, Dubai, UAE',
    bankAccount: 'AE07 0331 2345 6789 0123 456',
    swiftCode: 'EBILAEADXXX',
  },
  {
    id: 's-pacific',
    code: 'PACM',
    name: 'Pacific Micro Supply Sdn Bhd',
    gstin: null,
    isForeign: true,
    stateCode: null,
    stateName: null,
    addressLine1: 'Lot 8, Bayan Lepas Industrial Zone Phase 4',
    addressLine2: 'Bayan Lepas',
    city: 'Penang',
    postcode: '11900',
    country: 'Malaysia',
    contactName: 'Nurul Aisyah',
    contactEmail: 'nurul@pacificmicro.my',
    contactPhone: '+60 4 642 1180',
    contactFax: '+60 4 642 1181',
    currency: 'USD',
    incoterms: 'EXW',
    bankName: 'Malayan Banking Berhad (Maybank)',
    bankAddress: 'Menara Maybank, 100 Jalan Tun Perak, 50050 Kuala Lumpur',
    bankAccount: '5140 2210 3387',
    swiftCode: 'MBBEMYKLXXX',
  },
  {
    id: 's-bharat',
    code: 'BSDI',
    name: 'Bharat Semicon Distributors LLP',
    // Checksum-valid. The GSTINs in the hand-off spec's PO_SUPPLIER_ADDR block
    // failed their check digit, so they were placeholders and are not reused.
    gstin: '24AABCB7391K1ZH',
    isForeign: false,
    stateCode: '24',
    stateName: 'Gujarat',
    addressLine1: 'B-118, Electronics Estate, GIDC Sector 25',
    addressLine2: 'Sector 25',
    city: 'Gandhinagar',
    postcode: '382025',
    country: 'India',
    contactName: 'Jignesh Patel',
    contactEmail: 'jignesh@bharatsemicon.in',
    contactPhone: '+91 79 2323 8890',
    contactFax: '+91 79 2323 8891',
    currency: 'INR',
    incoterms: 'FOR',
    bankName: 'HDFC Bank Ltd, Gandhinagar',
    bankAddress: 'Sector 11, Gandhinagar, Gujarat 382011',
    bankAccount: '50200034567891',
    swiftCode: 'HDFCINBBXXX',
  },
];

export const AVL = [
  {
    supplierId: 's-nexus',
    status: 'APPROVED',
    approvedOn: new Date('2025-04-12'),
    approvedUpto: new Date('2027-03-31'),
    categories: ['Microcontrollers', 'Memory', 'Interface ICs'],
    certifications: ['ISO 9001:2015', 'ESD S20.20', 'AS6081'],
    qualityRating: 4.6,
    deliveryRating: 4.4,
    riskScore: 18,
    notes: 'Preferred vendor for STM and Microchip lines. Strong on traceability paperwork.',
  },
  {
    supplierId: 's-shenzhen',
    status: 'APPROVED',
    approvedOn: new Date('2025-08-02'),
    approvedUpto: new Date('2026-12-31'),
    categories: ['Passives', 'Discretes', 'Modules'],
    certifications: ['ISO 9001:2015'],
    qualityRating: 3.8,
    deliveryRating: 4.1,
    riskScore: 52,
    notes:
      'Competitive pricing but higher counterfeit risk — full-batch testing is mandatory on this vendor.',
  },
  {
    supplierId: 's-global',
    status: 'APPROVED',
    approvedOn: new Date('2026-01-20'),
    approvedUpto: new Date('2027-06-30'),
    categories: ['Memory', 'Obsolete / long-tail'],
    certifications: ['ISO 9001:2015', 'AS6081'],
    qualityRating: 4.2,
    deliveryRating: 3.9,
    riskScore: 34,
    notes: 'Good source for end-of-life parts. Lead times can slip.',
  },
  {
    supplierId: 's-pacific',
    status: 'APPROVED',
    approvedOn: new Date('2025-11-05'),
    approvedUpto: new Date('2027-03-31'),
    categories: ['Analog', 'Logic', 'Power'],
    certifications: ['ISO 9001:2015', 'ESD S20.20'],
    qualityRating: 4.5,
    deliveryRating: 4.7,
    riskScore: 14,
    notes: 'Most reliable on delivery dates. First choice where lead time is tight.',
  },
  {
    // Deliberately expired, to prove the AVL gate actually blocks selection (AC#3).
    supplierId: 's-bharat',
    status: 'EXPIRED',
    approvedOn: new Date('2024-02-01'),
    approvedUpto: new Date('2026-03-31'),
    categories: ['Passives', 'Connectors'],
    certifications: ['ISO 9001:2015'],
    qualityRating: 4.0,
    deliveryRating: 4.2,
    riskScore: 28,
    notes: 'Approval lapsed on 31 Mar 2026. Re-audit pending — cannot be used on new POs.',
  },
];

/** 20 real part numbers with genuine HSN classifications. */
export const MPNS = [
  { mpn: 'STM32F407VGT6', manufacturer: 'STMicroelectronics', description: 'ARM Cortex-M4 MCU, 168MHz, LQFP-100', hsnCode: '85423100', defaultGstRate: 18, msl: 'MSL 3', packaging: 'Tray', countryOfOrigin: 'Malaysia' },
  { mpn: 'ATMEGA328P-PU', manufacturer: 'Microchip Technology', description: '8-bit AVR MCU, 32KB Flash, PDIP-28', hsnCode: '85423100', defaultGstRate: 18, msl: 'N/A', packaging: 'Tube', countryOfOrigin: 'Thailand' },
  { mpn: 'ESP32-WROOM-32D', manufacturer: 'Espressif Systems', description: 'Wi-Fi + Bluetooth SoC module, 4MB Flash', hsnCode: '85423100', defaultGstRate: 18, msl: 'MSL 3', packaging: 'Tray', countryOfOrigin: 'China' },
  { mpn: 'FT232RL', manufacturer: 'FTDI', description: 'USB to UART bridge, SSOP-28', hsnCode: '85423100', defaultGstRate: 18, msl: 'MSL 3', packaging: 'Reel', countryOfOrigin: 'China' },
  { mpn: 'W25Q128JVSIQ', manufacturer: 'Winbond', description: '128Mb serial NOR flash, SOIC-8', hsnCode: '85423200', defaultGstRate: 18, msl: 'MSL 3', packaging: 'Reel', countryOfOrigin: 'Taiwan' },
  { mpn: 'MT41K256M16TW-107', manufacturer: 'Micron', description: 'DDR3L SDRAM 4Gb, FBGA-96', hsnCode: '85423200', defaultGstRate: 18, msl: 'MSL 3', packaging: 'Tray', countryOfOrigin: 'Singapore' },
  { mpn: 'LM358N', manufacturer: 'Texas Instruments', description: 'Dual operational amplifier, PDIP-8', hsnCode: '85423900', defaultGstRate: 18, msl: 'N/A', packaging: 'Tube', countryOfOrigin: 'Malaysia' },
  { mpn: 'NE555P', manufacturer: 'Texas Instruments', description: 'Precision timer IC, PDIP-8', hsnCode: '85423900', defaultGstRate: 18, msl: 'N/A', packaging: 'Tube', countryOfOrigin: 'Philippines' },
  { mpn: 'TL072CP', manufacturer: 'Texas Instruments', description: 'Low-noise JFET dual op-amp, PDIP-8', hsnCode: '85423900', defaultGstRate: 18, msl: 'N/A', packaging: 'Tube', countryOfOrigin: 'Malaysia' },
  { mpn: 'SN74HC595N', manufacturer: 'Texas Instruments', description: '8-bit shift register, PDIP-16', hsnCode: '85423900', defaultGstRate: 18, msl: 'N/A', packaging: 'Tube', countryOfOrigin: 'China' },
  { mpn: 'LM7805CT', manufacturer: 'ON Semiconductor', description: '5V linear voltage regulator, TO-220', hsnCode: '85423900', defaultGstRate: 18, msl: 'N/A', packaging: 'Tube', countryOfOrigin: 'China' },
  { mpn: 'RC0603FR-0710KL', manufacturer: 'Yageo', description: 'Thick film resistor 10k 1% 0603', hsnCode: '85332100', defaultGstRate: 18, msl: 'N/A', packaging: 'Reel', countryOfOrigin: 'Taiwan' },
  { mpn: 'CL10B104KB8NNNC', manufacturer: 'Samsung Electro-Mechanics', description: 'MLCC 100nF 50V X7R 0603', hsnCode: '85322400', defaultGstRate: 18, msl: 'N/A', packaging: 'Reel', countryOfOrigin: 'Philippines' },
  { mpn: 'GRM188R71H104KA93D', manufacturer: 'Murata', description: 'MLCC 100nF 50V X7R 0603', hsnCode: '85322400', defaultGstRate: 18, msl: 'N/A', packaging: 'Reel', countryOfOrigin: 'Japan' },
  { mpn: 'EEU-FR1V101', manufacturer: 'Panasonic', description: 'Aluminium electrolytic cap 100uF 35V', hsnCode: '85322200', defaultGstRate: 18, msl: 'N/A', packaging: 'Tray', countryOfOrigin: 'Japan' },
  { mpn: '1N4007', manufacturer: 'Diodes Incorporated', description: 'General purpose rectifier diode 1A 1000V', hsnCode: '85411000', defaultGstRate: 18, msl: 'N/A', packaging: 'Tape', countryOfOrigin: 'China' },
  { mpn: 'BC547B', manufacturer: 'ON Semiconductor', description: 'NPN small-signal transistor, TO-92', hsnCode: '85412100', defaultGstRate: 18, msl: 'N/A', packaging: 'Tape', countryOfOrigin: 'China' },
  { mpn: '2N3904', manufacturer: 'ON Semiconductor', description: 'NPN switching transistor, TO-92', hsnCode: '85412100', defaultGstRate: 18, msl: 'N/A', packaging: 'Tape', countryOfOrigin: 'Malaysia' },
  { mpn: 'IRF540N', manufacturer: 'Infineon', description: 'N-channel power MOSFET 100V 33A, TO-220', hsnCode: '85412900', defaultGstRate: 18, msl: 'N/A', packaging: 'Tube', countryOfOrigin: 'Italy' },
  { mpn: 'LTV-817S', manufacturer: 'Lite-On', description: 'Phototransistor optocoupler, SOP-4', hsnCode: '85414100', defaultGstRate: 18, msl: 'MSL 3', packaging: 'Reel', countryOfOrigin: 'Taiwan' },
];

/**
 * Date-effective GST rates. Note the superseded 12% row for 85423100 — it
 * proves the lookup is genuinely date-driven rather than a hardcoded 18%.
 */
export const HSN_RATES = [
  {
    hsnCode: '85423100',
    description: 'Processors and controllers (rate in force before 01 Jan 2020)',
    cgstRate: 6,
    sgstRate: 6,
    igstRate: 12,
    cessRate: 0,
    effectiveFrom: new Date('2017-07-01'),
    effectiveTo: new Date('2019-12-31'),
  },
  ...[
    ['85423100', 'Electronic integrated circuits — processors and controllers'],
    ['85423200', 'Electronic integrated circuits — memories'],
    ['85423900', 'Electronic integrated circuits — other'],
    ['85332100', 'Fixed resistors, power handling not exceeding 20W'],
    ['85322400', 'Ceramic dielectric capacitors, multilayer'],
    ['85322200', 'Aluminium electrolytic capacitors'],
    ['85411000', 'Diodes, other than photosensitive or LED'],
    ['85412100', 'Transistors, dissipation rating under 1W'],
    ['85412900', 'Transistors, other'],
    ['85414100', 'Photosensitive semiconductor devices — LEDs and optocouplers'],
  ].map(([hsnCode, description]) => ({
    hsnCode,
    description,
    cgstRate: 9,
    sgstRate: 9,
    igstRate: 18,
    cessRate: 0,
    effectiveFrom: new Date('2020-01-01'),
    effectiveTo: null,
  })),
  // Service codes, used for testing and freight input credit.
  {
    hsnCode: '998346',
    description: 'Technical testing and analysis services',
    cgstRate: 9,
    sgstRate: 9,
    igstRate: 18,
    cessRate: 0,
    effectiveFrom: new Date('2017-07-01'),
    effectiveTo: null,
  },
  {
    hsnCode: '996511',
    description: 'Road transport services of goods',
    cgstRate: 9,
    sgstRate: 9,
    igstRate: 18,
    cessRate: 0,
    effectiveFrom: new Date('2017-07-01'),
    effectiveTo: null,
  },
];

export const TEST_PARAMETERS = [
  { code: 'VIS-EXT', name: 'External visual inspection', category: 'VISUAL', method: 'IDEA-STD-1010', isDefault: true },
  { code: 'MRK-PERM', name: 'Marking permanency', category: 'MARKING', method: 'IDEA-STD-1010 §5', isDefault: true },
  { code: 'XRAY-2D', name: '2D X-ray die and bond-wire check', category: 'XRAY', method: 'AS6081 §3.6', isDefault: true },
  { code: 'DECAP', name: 'Decapsulation and die verification', category: 'DECAP', method: 'AS6081 §3.7', isDefault: false },
  { code: 'ELEC-DC', name: 'DC parametric electrical test', category: 'ELECTRICAL', method: 'Datasheet limits', unit: 'V/A', isDefault: true },
  { code: 'ELEC-AC', name: 'AC / switching parametric test', category: 'ELECTRICAL', method: 'Datasheet limits', unit: 'ns', isDefault: false },
  { code: 'FUNC-BENCH', name: 'Functional bench test', category: 'FUNCTIONAL', method: 'Reference design', isDefault: true },
  { code: 'SOLDER', name: 'Solderability / wetting balance', category: 'SOLDERABILITY', method: 'J-STD-002', isDefault: false },
  { code: 'MSL-BAKE', name: 'Moisture sensitivity bake and reflow', category: 'MSL_BAKE', method: 'J-STD-020', isDefault: false },
  { code: 'RES-SOLV', name: 'Resistance to solvents', category: 'MARKING', method: 'MIL-STD-883 §2015', isDefault: false },
];

export const CARRIERS = [
  { code: 'DHL', name: 'DHL Express', isIntegrated: true, supportsPod: true },
  { code: 'FEDEX', name: 'FedEx', isIntegrated: false, supportsPod: true },
  { code: 'BLUEDART', name: 'Blue Dart', isIntegrated: false, supportsPod: true },
  { code: 'SFEXP', name: 'SF Express', isIntegrated: false, supportsPod: false },
];

export const TESTING_LABS = [
  {
    id: 'lab-whl-blr',
    code: 'LAB-BLR',
    name: 'Independent Test Laboratory, Bengaluru',
    isForeign: false,
    gstin: '29AADCW8812L1ZQ',
    country: 'India',
    addressLine1: 'Unit 4, Peenya Industrial Area Phase 2',
    city: 'Bengaluru',
    contactEmail: 'intake.blr@testlab-blr.in',
    accreditations: ['NABL ISO/IEC 17025', 'AS6081 capable', 'IDEA-STD-1010'],
  },
  {
    id: 'lab-whl-szx',
    code: 'LAB-SZX',
    name: 'Independent Test Laboratory, Shenzhen',
    isForeign: true,
    gstin: null,
    country: 'China',
    addressLine1: 'Bldg 6, Nanshan Hi-Tech Industrial Park',
    city: 'Shenzhen',
    contactEmail: 'intake@testlab-szx.cn',
    accreditations: ['ISO/IEC 17025', 'AS6081 capable'],
  },
];

/**
 * The five connectors from §11A. WHL and ESCROW carry vendorStatus
 * NOT_FINALISED, which the UI surfaces so nobody assumes a vendor is chosen.
 */
export const CONNECTORS = [
  {
    id: 'WHL',
    label: 'Testing Laboratory',
    mode: 'MOCK',
    vendorName: null,
    vendorStatus: 'NOT_FINALISED',
    syncSeconds: 600,
    credentialsOk: false,
  },
  {
    id: 'DHL',
    label: 'DHL Express (logistics partner)',
    mode: 'MOCK',
    vendorName: 'DHL Express (MyDHL API)',
    vendorStatus: 'CONFIRMED',
    syncSeconds: 300,
    credentialsOk: false,
  },
  {
    id: 'ICEGATE',
    label: 'Indian Customs (ICEGATE portal)',
    mode: 'MOCK',
    vendorName: 'CBIC ICEGATE',
    vendorStatus: 'CONFIRMED',
    syncSeconds: 900,
    credentialsOk: false,
  },
  {
    id: 'ESCROW',
    label: 'Escrow provider',
    mode: 'MOCK',
    vendorName: null,
    vendorStatus: 'NOT_FINALISED',
    syncSeconds: 600,
    credentialsOk: false,
  },
  {
    id: 'GST_GSP',
    label: 'Goods and Services Tax — electronic invoice and way bill',
    mode: 'MOCK',
    vendorName: null,
    vendorStatus: 'CONFIRMED',
    syncSeconds: 1800,
    credentialsOk: false,
  },
];
